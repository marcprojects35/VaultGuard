import { Router } from 'express';
import { body } from 'express-validator';
import * as authController from '../controllers/auth.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.post('/login',
  [
    body('login').notEmpty().trim(),
    body('password').notEmpty(),
  ],
  validate,
  authController.login
);

router.post('/logout', authenticate, authController.logout);
router.post('/refresh', authController.refresh);
router.get('/me', authenticate, authController.me);

router.post('/2fa/setup', authenticate, authController.setup2FA);
router.post('/2fa/verify', authenticate, authController.verify2FA);
router.post('/2fa/disable', authenticate, authController.disable2FA);
router.post('/2fa/validate',
  [body('token').notEmpty(), body('tempToken').notEmpty()],
  validate,
  authController.validate2FA
);

router.post('/change-password', authenticate,
  [
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 8 }),
  ],
  validate,
  authController.changePassword
);

export default router;
