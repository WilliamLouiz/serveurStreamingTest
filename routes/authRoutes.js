const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { validateRegister, validateLogin } = require('../middleware/validation');
const { authenticate } = require('../middleware/auth');

// Routes publiques
router.post('/register', validateRegister, authController.register);
router.post('/login', validateLogin, authController.login);
router.post('/verify-account', authController.verifyAccount);
router.post('/resend-validation', authController.resendValidationEmail);

// Routes protégées
router.get('/profile', authenticate, authController.getProfile);
router.put('/profile', authenticate, authController.updateProfile);
router.post('/logout', authenticate, authController.logout);

// ROUTES POUR MOT DE PASSE OUBLIÉ
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.get('/verify-reset-token/:token', authController.verifyResetToken);

//route des 2fa
router.post('/2fa/verify', authController.verifyTwoFactorCode);
router.post('/2fa/resend', authController.resendTwoFactorCode);

//route 2fa protégé (nécéssitant une authentification zandry vo miditra)
router.get('/2fa/status', authenticate, authController.getTwoFactorStatus);
router.post('/2fa/toggle', authenticate, authController.toggleTwoFactor);
router.post('/2fa/backup-codes', authenticate, authController.generateBackupCodes);

module.exports = router;