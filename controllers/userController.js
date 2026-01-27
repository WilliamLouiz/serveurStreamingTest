const User = require('../models/User');
const { ROLES } = require('../config/constants');

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.getAll();
    res.json({
      success: true,
      users,
      count: users.length
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des utilisateurs:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la récupération des utilisateurs' 
    });
  }
};

exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'Utilisateur non trouvé' 
      });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Erreur lors de la récupération de l\'utilisateur:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la récupération de l\'utilisateur' 
    });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const { nom, prenom, email, role } = req.body;
    
    // Vérifier que l'admin ne peut pas changer son propre rôle
    if (req.user.id === parseInt(req.params.id) && role && role !== req.user.role) {
      return res.status(400).json({ 
        success: false, 
        error: 'Vous ne pouvez pas changer votre propre rôle' 
      });
    }

    const updated = await User.update(req.params.id, {
      nom,
      prenom,
      email,
      role: role || req.user.role
    });

    if (!updated) {
      return res.status(404).json({ 
        success: false, 
        error: 'Utilisateur non trouvé' 
      });
    }

    const user = await User.findById(req.params.id);

    res.json({
      success: true,
      message: 'Utilisateur mis à jour avec succès',
      user
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour de l\'utilisateur:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la mise à jour de l\'utilisateur' 
    });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    // Empêcher la suppression de soi-même
    if (req.user.id === parseInt(req.params.id)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Vous ne pouvez pas supprimer votre propre compte' 
      });
    }

    const deleted = await User.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ 
        success: false, 
        error: 'Utilisateur non trouvé' 
      });
    }

    res.json({
      success: true,
      message: 'Utilisateur supprimé avec succès'
    });
  } catch (error) {
    console.error('Erreur lors de la suppression de l\'utilisateur:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la suppression de l\'utilisateur' 
    });
  }
};