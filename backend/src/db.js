// Conexão única com o banco, compartilhada por todo o backend.
//
// Lixeira: senhas e pastas excluídas ganham deletedAt e somem de todas as
// consultas automaticamente. Para enxergá-las (lixeira, chaves de criptografia),
// a consulta precisa citar deletedAt no where — ex.: { deletedAt: { not: null } }
// ou WITH_DELETED, que traz as duas.
import { PrismaClient } from '@prisma/client';

const SOFT_DELETE_MODELS = new Set(['Credential', 'Folder']);
const READ_OPERATIONS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow',
  'count', 'aggregate', 'groupBy', 'updateMany',
]);

/** Inclui itens da lixeira na consulta: where: { ...WITH_DELETED, ... } */
export const WITH_DELETED = { deletedAt: undefined };

const base = new PrismaClient();

export const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (SOFT_DELETE_MODELS.has(model) && READ_OPERATIONS.has(operation)) {
          const where = args?.where || {};
          if (!Object.prototype.hasOwnProperty.call(where, 'deletedAt')) {
            args = { ...args, where: { ...where, deletedAt: null } };
          }
        }
        return query(args);
      },
    },
  },
});

export default prisma;
