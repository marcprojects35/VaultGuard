import { logger } from '../utils/logger.js';

export const errorHandler = (err, req, res, next) => {
  logger.error(err.message, { stack: err.stack, url: req.url, method: req.method });

  if (err.code === 'P2002') {
    return res.status(409).json({ error: 'Record already exists' });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found' });
  }
  // Tipo errado num campo (ex.: número onde se espera texto): erro do cliente, não do servidor
  if (err.name === 'PrismaClientValidationError' || err.code === 'P2023') {
    return res.status(400).json({ error: 'Dados inválidos' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Requisição grande demais' });
  }

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message
  });
};
