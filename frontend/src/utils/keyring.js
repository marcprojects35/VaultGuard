/**
 * Keyring: estado de chaves de um usuário desbloqueado e as operações de alto
 * nível do cofre (abrir/cifrar credenciais, distribuir chaves, migrar legado).
 * Não depende de axios nem de React: recebe um adaptador de API
 * { get(path), post(path, body), put(path, body) } que devolve o corpo da
 * resposta e lança um erro com `.status` em respostas não-2xx.
 * Compartilhado entre o frontend e a extensão.
 */
import {
  deriveKek, exportAesKey, importAesKey, randomKeyBytes,
  aesEncryptBytes, aesDecryptBytes, aesEncryptString, aesDecryptString, isV2, legacyDecrypt,
  generateUserKeyPair, exportPublicKey, exportPrivateKey, importPrivateKey,
  sealPrivateKey, openPrivateKey, rsaWrap, rsaUnwrap, hybridSeal, hybridOpen,
  b64ToBytes, bytesToB64,
} from './vaultCrypto.js';

export const ORG_HOLDER = 'ORG';
// Tipos de campo personalizado cujo valor é cifrado
export const SECRET_FIELD_TYPES = ['password'];

function keyError(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

export class Keyring {
  constructor(api) {
    this.api = api;
    this.lock();
  }

  lock() {
    this.me = null;
    this.kek = null;
    this.privateKey = null;
    this.orgPrivateKey = null;
    this.folderKeys = new Map();    // folderId -> { key, bytes }
    this.folderMeta = new Map();    // folderId -> { initialized, isPersonal, via }
    this.credKeys = new Map();      // credentialId -> { key, bytes }
    this.migrationSkipped = new Set(); // legadas que este usuário não consegue abrir
  }

  get isUnlocked() {
    return !!this.privateKey;
  }

  // ─── Desbloqueio ───────────────────────────────────────────────────────────

  /**
   * Abre a chave privada com a senha. Na primeira vez gera o par de chaves
   * (e, para o primeiro admin, a chave da organização).
   * Erros: NO_KEYS (allowCreate=false e o usuário não tem chaves),
   *        KEY_DECRYPT_FAILED (senha errada ou senha trocada desde que as chaves foram cifradas).
   */
  async unlock(password, { allowCreate = true } = {}) {
    const me = await this.api.get('/keys/me');
    if (!me.encryptionSalt) throw keyError('NO_SALT');
    const kek = await deriveKek(password, me.encryptionSalt, true);

    let privateKey;
    if (!me.publicKey) {
      if (!allowCreate) throw keyError('NO_KEYS', 'Abra o cofre web uma vez para gerar suas chaves');
      const pair = await generateUserKeyPair();
      const publicKey = await exportPublicKey(pair.publicKey);
      await this.api.put('/keys/me', { publicKey, encryptedPrivateKey: await sealPrivateKey(pair.privateKey, kek) });
      me.publicKey = publicKey;
      privateKey = pair.privateKey;
    } else {
      try {
        privateKey = await openPrivateKey(me.encryptedPrivateKey, kek, true);
      } catch {
        throw keyError('KEY_DECRYPT_FAILED');
      }
    }

    this.lock();
    this.me = me;
    this.kek = kek;
    this.privateKey = privateKey;

    if (me.isAdmin && me.orgWrappedKey) {
      const pkcs8 = await hybridOpen(privateKey, me.orgWrappedKey);
      this.orgPrivateKey = await importPrivateKey(bytesToB64(pkcs8), true);
    } else if (me.isAdmin && !me.orgPublicKey && allowCreate) {
      await this.createOrgKey();
    }
  }

  /** Senha do AD trocada: abre a chave com a senha antiga e re-cifra com a atual. */
  async recoverWithOldPassword(oldPassword, currentPassword) {
    const me = await this.api.get('/keys/me');
    let privateKey;
    try {
      privateKey = await openPrivateKey(me.encryptedPrivateKey, await deriveKek(oldPassword, me.encryptionSalt), true);
    } catch {
      throw keyError('KEY_DECRYPT_FAILED', 'Senha anterior incorreta');
    }
    const kek = await deriveKek(currentPassword, me.encryptionSalt);
    await this.api.put('/keys/me/private', {
      encryptedPrivateKey: await sealPrivateKey(privateKey, kek),
      password: currentPassword,
    });
    await this.unlock(currentPassword);
  }

  /** Descarta as chaves atuais e gera novas. O conteúdo da pasta pessoal se perde. */
  async resetKeys(password) {
    const me = await this.api.get('/keys/me');
    const kek = await deriveKek(password, me.encryptionSalt);
    const pair = await generateUserKeyPair();
    await this.api.post('/keys/me/reset', {
      publicKey: await exportPublicKey(pair.publicKey),
      encryptedPrivateKey: await sealPrivateKey(pair.privateKey, kek),
      password,
    });
    await this.unlock(password);
  }

  /** Chave privada re-cifrada para a senha nova (enviada junto na troca de senha). */
  async sealForNewPassword(newPassword) {
    if (!this.isUnlocked) throw keyError('LOCKED');
    return sealPrivateKey(this.privateKey, await deriveKek(newPassword, this.me.encryptionSalt));
  }

  async createOrgKey() {
    const pair = await generateUserKeyPair();
    const pkcs8 = b64ToBytes(await exportPrivateKey(pair.privateKey));
    const publicKey = await exportPublicKey(pair.publicKey);
    try {
      await this.api.post('/keys/org', { publicKey, wrappedKey: await hybridSeal(this.me.publicKey, pkcs8) });
      this.orgPrivateKey = pair.privateKey;
      this.me.orgPublicKey = publicKey;
    } catch (e) {
      // Outro admin criou ao mesmo tempo: ele libera o acesso no próximo sync
      if (e.status !== 409) throw e;
      const me = await this.api.get('/keys/me');
      this.me.orgPublicKey = me.orgPublicKey;
    }
  }

  // ─── Sessão serializável (extensão: popup <-> service worker) ─────────────

  async exportSession() {
    if (!this.isUnlocked) return null;
    return {
      me: this.me,
      kek: await exportAesKey(this.kek),
      privateKey: await exportPrivateKey(this.privateKey),
      orgPrivateKey: this.orgPrivateKey ? await exportPrivateKey(this.orgPrivateKey) : null,
    };
  }

  async importSession(s) {
    this.lock();
    if (!s) return;
    this.me = s.me;
    this.kek = await importAesKey(s.kek, true);
    this.privateKey = await importPrivateKey(s.privateKey, true);
    this.orgPrivateKey = s.orgPrivateKey ? await importPrivateKey(s.orgPrivateKey, true) : null;
  }

  // ─── Chaves de pasta ───────────────────────────────────────────────────────

  async loadFolderKeys() {
    const list = await this.api.get('/keys/folders');
    for (const k of list) {
      this.folderMeta.set(k.folderId, { initialized: k.initialized, isPersonal: k.isPersonal, via: k.via });
      if (!k.wrappedKey) { this.folderKeys.delete(k.folderId); continue; }
      // Mesma cópia já aberta: nada a fazer. Cópia diferente = chave rotacionada
      if (this.folderKeys.get(k.folderId)?.wrapped === k.wrappedKey) continue;
      const unwrapWith = k.via === 'org' ? this.orgPrivateKey : this.privateKey;
      if (!unwrapWith) continue;
      try {
        const bytes = await rsaUnwrap(unwrapWith, k.wrappedKey);
        this.folderKeys.set(k.folderId, { key: await importAesKey(bytes), bytes, wrapped: k.wrappedKey });
      } catch {
        // Cópia inválida (ex.: embrulhada para uma chave antiga): ignora
      }
    }
  }

  async initFolder(folderId) {
    if (!this.isUnlocked) throw keyError('LOCKED');
    const meta = this.folderMeta.get(folderId);
    const bytes = randomKeyBytes();
    const body = { wrappedKey: await rsaWrap(this.me.publicKey, bytes) };
    if (!meta?.isPersonal && this.me.orgPublicKey) body.orgWrappedKey = await rsaWrap(this.me.orgPublicKey, bytes);
    try {
      await this.api.post(`/keys/folders/${folderId}/init`, body);
      this.folderKeys.set(folderId, { key: await importAesKey(bytes), bytes });
      this.folderMeta.set(folderId, { ...meta, initialized: true, via: 'user' });
    } catch (e) {
      if (e.status !== 409) throw e;
      await this.loadFolderKeys();
    }
  }

  async getFolderKeyEntry(folderId) {
    if (!this.isUnlocked) throw keyError('LOCKED');
    if (this.folderKeys.has(folderId)) return this.folderKeys.get(folderId);
    await this.loadFolderKeys();
    if (!this.folderKeys.has(folderId) && this.folderMeta.get(folderId)?.initialized === false) {
      await this.initFolder(folderId);
    }
    const entry = this.folderKeys.get(folderId);
    if (!entry) throw keyError('NO_FOLDER_KEY', 'Você ainda não recebeu a chave desta pasta. Ela é liberada automaticamente quando um membro ou administrador estiver online.');
    return entry;
  }

  // ─── Chaves de credencial ──────────────────────────────────────────────────

  async newCredentialKey(folderId) {
    // Garante a chave atual da pasta (pode ter sido rotacionada por outro cliente)
    await this.loadFolderKeys();
    const folder = await this.getFolderKeyEntry(folderId);
    const bytes = randomKeyBytes();
    return { key: await importAesKey(bytes), bytes, wrappedKey: await aesEncryptBytes(folder.key, bytes) };
  }

  /** Chave da credencial; null se a credencial é legada (sem wrappedKey). */
  async getCredentialKeyEntry(cred) {
    if (!cred.wrappedKey) return null;
    if (this.credKeys.has(cred.id)) return this.credKeys.get(cred.id);

    let bytes = null;
    try {
      let folder = await this.getFolderKeyEntry(cred.folderId);
      try {
        bytes = await aesDecryptBytes(folder.key, cred.wrappedKey);
      } catch {
        // Chave em cache ficou velha (rotação): recarrega e tenta de novo
        this.folderKeys.delete(cred.folderId);
        folder = await this.getFolderKeyEntry(cred.folderId);
        bytes = await aesDecryptBytes(folder.key, cred.wrappedKey);
      }
    } catch (e) {
      // Sem acesso à pasta: tenta a chave do compartilhamento individual
      let shareKey = cred.shareKey;
      if (shareKey === undefined) shareKey = (await this.api.get(`/credentials/${cred.id}`)).shareKey;
      if (!shareKey) throw e;
      bytes = await rsaUnwrap(this.privateKey, shareKey);
    }
    const entry = { key: await importAesKey(bytes), bytes };
    this.credKeys.set(cred.id, entry);
    return entry;
  }

  async wrapCredentialKeyFor(cred, publicKey) {
    const entry = await this.getCredentialKeyEntry(cred);
    if (!entry) throw keyError('LEGACY', 'Credencial ainda não migrada');
    return rsaWrap(publicKey, entry.bytes);
  }

  // ─── Conteúdo ──────────────────────────────────────────────────────────────

  /** Abre um valor cifrado da credencial (v2) ou legado (v0/v1). */
  async decryptValue(cred, value) {
    if (!value) return '';
    if (isV2(value)) {
      const entry = await this.getCredentialKeyEntry(cred);
      if (!entry) throw keyError('LEGACY');
      return aesDecryptString(entry.key, value);
    }
    return this.openLegacy(value);
  }

  // v1 só abre com a KEK de quem criou; para os demais vira um erro explicável
  async openLegacy(value) {
    try {
      return await legacyDecrypt(value, this.kek);
    } catch (e) {
      if (e.message === 'locked') throw keyError('LOCKED');
      throw keyError('LEGACY');
    }
  }

  /** Campo personalizado: só os tipos secretos são cifrados. */
  async decryptField(cred, field) {
    if (!SECRET_FIELD_TYPES.includes(field.fieldType) || !isV2(field.value)) return field.value;
    return this.decryptValue(cred, field.value);
  }

  /** Notas: v2 cifradas; texto puro nas credenciais antigas. */
  async decryptNotes(cred) {
    if (!cred.notes || !isV2(cred.notes)) return cred.notes || '';
    return this.decryptValue(cred, cred.notes);
  }

  async decryptCustomFields(cred, fields = []) {
    return Promise.all(fields.map(async f => ({ ...f, value: await this.decryptField(cred, f) })));
  }

  async decryptAttachment(cred, data) {
    if (!isV2(data)) return b64ToBytes(data);
    const entry = await this.getCredentialKeyEntry(cred);
    return aesDecryptBytes(entry.key, data);
  }

  async encryptAttachmentWith(key, base64Data) {
    return aesEncryptBytes(key, b64ToBytes(base64Data));
  }

  /**
   * Monta o corpo para criar/editar uma credencial.
   * - nova: gera a chave da credencial (vai em wrappedKey)
   * - existente v2: reutiliza a chave
   * - existente legada: migra (chave nova + senha re-cifrada; exige a senha em claro)
   * `password` undefined = senha não mudou.
   */
  async buildCredentialPayload({ existing, folderId, password, customFields = [], notes }) {
    let entry;
    let wrappedKey;
    if (!existing) {
      entry = await this.newCredentialKey(folderId);
      wrappedKey = entry.wrappedKey;
    } else if (existing.wrappedKey) {
      entry = await this.getCredentialKeyEntry(existing);
    } else {
      entry = await this.newCredentialKey(existing.folderId);
      wrappedKey = entry.wrappedKey;
      if (password === undefined) {
        const detail = await this.api.get(`/credentials/${existing.id}`);
        password = await this.openLegacy(detail.encryptedPass);
      }
    }

    const payload = {
      customFields: await Promise.all(customFields.map(async f => ({
        name: f.name,
        fieldType: f.fieldType || 'text',
        value: SECRET_FIELD_TYPES.includes(f.fieldType) && !isV2(f.value)
          ? await aesEncryptString(entry.key, f.value)
          : f.value,
      }))),
    };
    if (password !== undefined) payload.encryptedPass = await aesEncryptString(entry.key, password);
    // Migração de legada sem notas informadas: re-cifra as notas atuais
    if (notes === undefined && wrappedKey && existing?.notes && !isV2(existing.notes)) notes = existing.notes;
    if (notes !== undefined) payload.notes = notes ? (isV2(notes) ? notes : await aesEncryptString(entry.key, notes)) : '';
    if (wrappedKey) payload.wrappedKey = wrappedKey;
    return { payload, key: entry.key, onSaved: (id) => this.credKeys.set(id, { key: entry.key, bytes: entry.bytes }) };
  }

  // ─── Distribuição de chaves ────────────────────────────────────────────────

  /**
   * Gera chaves de pastas novas e entrega cópias para quem ganhou acesso.
   * Roda em todo cliente desbloqueado; o servidor diz o que falta.
   */
  async sync() {
    if (!this.isUnlocked) return { created: 0, rotated: 0 };
    let pending = await this.api.get('/keys/pending');

    let initialized = 0;
    for (const f of pending.uninitialized || []) {
      this.folderMeta.set(f.id, { initialized: false, isPersonal: f.isPersonal, via: null });
      try { await this.initFolder(f.id); initialized++; } catch { /* outro cliente pode ter iniciado */ }
    }
    // Pasta nova: já entrega as cópias aos membros nesta mesma rodada
    if (initialized) pending = await this.api.get('/keys/pending');
    if (pending.folderGrants?.length || pending.shareGrants?.length || pending.rotations?.length) await this.loadFolderKeys();

    // Rotação: chave nova para a pasta; as chaves das credenciais não mudam,
    // só são re-embrulhadas (por isso o conteúdo não precisa ser re-cifrado)
    let rotated = 0;
    for (const r of pending.rotations || []) {
      const old = this.folderKeys.get(r.folderId);
      if (!old) continue;
      try {
        const bytes = randomKeyBytes();
        const key = await importAesKey(bytes);
        const credentialKeys = [];
        for (const c of r.credentials) {
          const credBytes = await aesDecryptBytes(old.key, c.wrappedKey);
          credentialKeys.push({ id: c.id, wrappedKey: await aesEncryptBytes(key, credBytes) });
        }
        const folderKeys = [];
        for (const t of r.targets) folderKeys.push({ holder: t.holder, wrappedKey: await rsaWrap(t.publicKey, bytes) });
        await this.api.post(`/keys/folders/${r.folderId}/rotate`, { credentialKeys, folderKeys });
        this.folderKeys.set(r.folderId, { key, bytes });
        rotated++;
      } catch { /* outro cliente rodou antes ou a pasta mudou: tenta no próximo sync */ }
    }

    const folderKeys = [];
    for (const g of pending.folderGrants || []) {
      const entry = this.folderKeys.get(g.folderId);
      if (!entry) continue;
      for (const t of g.targets) {
        try { folderKeys.push({ folderId: g.folderId, holder: t.holder, wrappedKey: await rsaWrap(t.publicKey, entry.bytes) }); } catch { /* chave pública inválida */ }
      }
    }

    const orgKeys = [];
    if (this.orgPrivateKey && pending.orgGrants?.length) {
      const pkcs8 = b64ToBytes(await exportPrivateKey(this.orgPrivateKey));
      for (const t of pending.orgGrants) {
        try { orgKeys.push({ userId: t.userId, wrappedKey: await hybridSeal(t.publicKey, pkcs8) }); } catch { /* */ }
      }
    }

    const shareKeys = [];
    for (const s of pending.shareGrants || []) {
      const entry = this.folderKeys.get(s.folderId);
      if (!entry) continue;
      try {
        const credBytes = await aesDecryptBytes(entry.key, s.credentialWrappedKey);
        shareKeys.push({ shareId: s.shareId, wrappedKey: await rsaWrap(s.publicKey, credBytes) });
      } catch { /* */ }
    }

    if (!folderKeys.length && !orgKeys.length && !shareKeys.length) return { created: 0, rotated };
    const result = await this.api.post('/keys/grants', { folderKeys, orgKeys, shareKeys });
    return { ...result, rotated };
  }

  // ─── Migração do formato legado ────────────────────────────────────────────

  /**
   * Re-cifra no formato novo as credenciais legadas que este usuário consegue
   * abrir (v0, ou v1 criadas por ele). As demais ficam para quem as criou.
   * Retorna quantas foram migradas.
   */
  async migrateLegacy(credentials) {
    if (!this.isUnlocked) return 0;
    let migrated = 0;
    // Credenciais já no formato novo, mas com notas ainda em texto puro
    for (const c of credentials.filter(c => c.wrappedKey && c.notes && !isV2(c.notes) && !this.migrationSkipped.has(c.id))) {
      try {
        const entry = await this.getCredentialKeyEntry(c);
        await this.api.put(`/credentials/${c.id}`, { notes: await aesEncryptString(entry.key, c.notes) });
        migrated++;
      } catch { this.migrationSkipped.add(c.id); }
    }

    const legacy = credentials.filter(c => !c.wrappedKey && !this.migrationSkipped.has(c.id));
    if (legacy.length) await this.loadFolderKeys();
    for (const c of legacy) {
      // Sem a chave da pasta não dá para migrar; tenta de novo quando ela chegar
      if (!this.folderKeys.has(c.folderId)) continue;
      try {
        const detail = await this.api.get(`/credentials/${c.id}`);
        if (detail.wrappedKey) continue;
        const password = await legacyDecrypt(detail.encryptedPass, this.kek);
        const { payload, key } = await this.buildCredentialPayload({
          existing: detail, password, customFields: detail.customFields || [],
        });
        await this.api.put(`/credentials/${c.id}`, payload);
        this.credKeys.delete(c.id);

        const history = await this.api.get(`/credentials/${c.id}/history`).catch(() => []);
        for (const h of history) {
          if (isV2(h.encryptedPass)) continue;
          try {
            const plain = await legacyDecrypt(h.encryptedPass, this.kek);
            await this.api.put(`/credentials/${c.id}/history/${h.id}`, { encryptedPass: await aesEncryptString(key, plain) });
          } catch { /* versão de outra pessoa: fica como está */ }
        }

        for (const att of detail.attachments || []) {
          try {
            const { data } = await this.api.get(`/attachments/${c.id}/${att.id}/download`);
            if (isV2(data)) continue;
            await this.api.put(`/attachments/${c.id}/${att.id}`, { data: await this.encryptAttachmentWith(key, data) });
          } catch { /* */ }
        }
        migrated++;
      } catch {
        // Sem permissão de edição ou v1 de outra pessoa: não insiste nesta sessão
        this.migrationSkipped.add(c.id);
      }
    }
    return migrated;
  }
}
