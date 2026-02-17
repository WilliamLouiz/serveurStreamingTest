const User = require('../models/User');
const { ROLES } = require('../config/constants');

exports.getAllStagiaire = async (req, res) => {
  try {
    const users = await User.getAllStagiaire();
    res.json({
      success: true,
      users,
      count: users.length
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des Stagiaires:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la récupération des Stagiaires' 
    });
  }
};

exports.getAllFormateur = async (req, res) => {
  try {
    const users = await User.getAllFormateur();
    res.json({
      success: true,
      users,
      count: users.length
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des Formateurs:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la récupération des Formateurs' 
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
    const userId = req.params.id;
    
    // Récupérer l'utilisateur existant pour conserver les données non modifiées
    const existingUser = await User.findById(userId);
    
    if (!existingUser) {
      return res.status(404).json({ 
        success: false, 
        error: 'Utilisateur non trouvé' 
      });
    }

    // Fusionner les données existantes avec les nouvelles données
    // Garder les valeurs existantes si les champs ne sont pas fournis
    const { nom, prenom, email, role, currentPassword, newPassword } = req.body;

    //  Ne pas écraser avec des valeurs undefined ou null
    const updateData = {
      nom: nom !== undefined ? nom : existingUser.nom,
      prenom: prenom !== undefined ? prenom : existingUser.prenom,
      email: email !== undefined ? email : existingUser.email,
      role: role !== undefined ? role : existingUser.role,
      is_validated: existingUser.is_validated,
      status: existingUser.status
    };

    // Vérifier que l'admin ne peut pas changer son propre rôle
    if (req.user.id === parseInt(userId) && role && role !== req.user.role) {
      return res.status(400).json({ 
        success: false, 
        error: 'Vous ne pouvez pas changer votre propre rôle' 
      });
    }

    // Si c'est une demande de changement de mot de passe
    if (currentPassword && newPassword) {
      const isPasswordValid = await User.comparePassword(currentPassword, existingUser.password);
      
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          error: 'Mot de passe actuel incorrect'
        });
      }

      // Mettre à jour le mot de passe
      const passwordUpdated = await User.updatePassword(userId, newPassword);
      
      if (!passwordUpdated) {
        return res.status(500).json({
          success: false,
          error: 'Erreur lors de la mise à jour du mot de passe'
        });
      }

      // Récupérer l'utilisateur mis à jour
      const updatedUser = await User.findById(userId);
      
      // Ne pas renvoyer le mot de passe
      delete updatedUser.password;

      return res.json({
        success: true,
        message: 'Mot de passe mis à jour avec succès',
        user: updatedUser
      });
    }

    // Mise à jour normale du profil
    const updated = await User.update(userId, updateData);

    if (!updated) {
      return res.status(404).json({ 
        success: false, 
        error: 'Utilisateur non trouvé' 
      });
    }

    // Récupérer l'utilisateur mis à jour
    const updatedUser = await User.findById(userId);
    
    // Ne pas renvoyer le mot de passe
    delete updatedUser.password;

    res.json({
      success: true,
      message: 'Utilisateur mis à jour avec succès',
      user: updatedUser
    });

  } catch (error) {
    console.error('Erreur lors de la mise à jour de l\'utilisateur:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la mise à jour de l\'utilisateur',
      details: error.message
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