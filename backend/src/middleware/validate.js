// middleware/validate.js
import { validationResult } from 'express-validator';

// Nome dos campos na mensagem mostrada ao usuário
const FIELD_LABELS = {
  name: 'nome', label: 'nome', title: 'título', email: 'e-mail', password: 'senha', newPassword: 'nova senha',
  currentPassword: 'senha atual', username: 'login', firstName: 'nome', lastName: 'sobrenome', role: 'cargo',
  userId: 'usuário', userIds: 'usuários', folderId: 'pasta', encryptedPass: 'senha', wrappedKey: 'chave de criptografia',
  accept: 'resposta', direction: 'direção', token: 'código', login: 'usuário',
};

export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const list = errors.array();
    const fields = [...new Set(list.map(e => FIELD_LABELS[e.path] || e.path))];
    // Mensagem do próprio validador quando ela já é em português (ex.: "Classificação inválida")
    const custom = list.find(e => e.msg && e.msg !== 'Invalid value')?.msg;
    return res.status(400).json({
      error: custom || `Verifique ${fields.length > 1 ? 'os campos' : 'o campo'}: ${fields.join(', ')}`,
      errors: list,
    });
  }
  next();
};
