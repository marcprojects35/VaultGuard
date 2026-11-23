// Prepara o banco para a aplicação rodar com o mínimo de privilégio e imprime a
// URL de conexão do papel restrito. Roda como dono do banco, a cada inicialização.
//
// - vaultguard_app: sem superusuário, sem criar tabelas e sem ignorar RLS;
// - RLS ligado e forçado em todas as tabelas;
// - AuditLog só aceita leitura e inclusão; apagar exige a rotina de retenção.
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const ROLE = 'vaultguard_app';
const ownerUrl = new URL(process.env.DATABASE_URL);
const password = createHash('sha256').update(`${decodeURIComponent(ownerUrl.password)}|${ROLE}`).digest('hex');
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const run = (sql) => db.$executeRawUnsafe(sql);

await run(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE ${ROLE} LOGIN; END IF;
END $$`);
await run(`ALTER ROLE ${ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 50 PASSWORD '${password}'`);
await run('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
await run(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);

const tables = await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
for (const { tablename } of tables) {
  const t = `"${tablename}"`;
  await run(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO ${ROLE}`);
  await run(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
  await run(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);
  await run(`DROP POLICY IF EXISTS vg_app ON ${t}`);
  if (tablename === 'AuditLog' || tablename === 'SystemSettings') continue;
  await run(`CREATE POLICY vg_app ON ${t} FOR ALL TO ${ROLE} USING (true) WITH CHECK (true)`);
}
await run(`REVOKE ALL ON "_prisma_migrations" FROM ${ROLE}`);

// Auditoria: imutável para a aplicação. Só a rotina de retenção apaga, dentro da própria transação
await run(`REVOKE UPDATE, TRUNCATE ON "AuditLog" FROM ${ROLE}`);
for (const p of ['vg_audit_read', 'vg_audit_add', 'vg_audit_purge']) await run(`DROP POLICY IF EXISTS ${p} ON "AuditLog"`);
await run(`CREATE POLICY vg_audit_read ON "AuditLog" FOR SELECT TO ${ROLE} USING (true)`);
await run(`CREATE POLICY vg_audit_add ON "AuditLog" FOR INSERT TO ${ROLE} WITH CHECK (true)`);
await run(`CREATE POLICY vg_audit_purge ON "AuditLog" FOR DELETE TO ${ROLE} USING (current_setting('app.audit_purge', true) = 'on')`);

// Configurações: existe uma única linha
await run(`DROP POLICY IF EXISTS vg_settings ON "SystemSettings"`);
await run(`CREATE POLICY vg_settings ON "SystemSettings" FOR ALL TO ${ROLE} USING (id = 'singleton') WITH CHECK (id = 'singleton')`);

await db.$disconnect();
const appUrl = new URL(ownerUrl);
appUrl.username = ROLE;
appUrl.password = password;
process.stdout.write(appUrl.toString());
