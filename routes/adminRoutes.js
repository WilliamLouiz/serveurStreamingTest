const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');

// Toutes les routes nécessitent une authentification et le rôle admin
router.use(authenticate);
router.use(authorize(ROLES.ADMIN));

// Gestion des utilisateurs en attente
router.get('/users/pending', adminController.getPendingUsers);
router.get('/users/stats', adminController.getUserStats);

// Actions sur les utilisateurs
router.post('/users/:userId/validate', adminController.validateUser);
router.post('/users/:userId/reject', adminController.rejectUser);
router.post('/users/:userId/suspend', adminController.suspendUser);
router.post('/users/:userId/activate', adminController.activateUser);

module.exports = router;