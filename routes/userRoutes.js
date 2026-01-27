const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate, authorize, isOwnerOrAdmin } = require('../middleware/auth');
const { ROLES } = require('../config/constants');

// Toutes les routes nécessitent une authentification
router.use(authenticate);

// Récupérer tous les utilisateurs (Admin uniquement)
router.get('/', authorize(ROLES.ADMIN), userController.getAllUsers);

// Récupérer un utilisateur spécifique
router.get('/:id', isOwnerOrAdmin, userController.getUserById);

// Mettre à jour un utilisateur (propriétaire ou admin)
router.put('/:id', isOwnerOrAdmin, userController.updateUser);

// Supprimer un utilisateur (Admin uniquement)
router.delete('/:id', authorize(ROLES.ADMIN), userController.deleteUser);

// Rechercher des utilisateurs
router.get('/search', authorize(ROLES.ADMIN), async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    const users = await require('../models/User').search(q, limit);
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;