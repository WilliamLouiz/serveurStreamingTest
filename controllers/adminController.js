const User = require('../models/User');
const EmailService = require('../services/emailService');
const jwt = require('jsonwebtoken');
const { ROLES, ACCOUNT_STATUS } = require('../config/constants');

exports.getPendingUsers = async (req, res) => {
  try {
    const users = await User.getPendingAccounts();
    
    res.json({
      success: true,
      users,
      count: users.length
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des utilisateurs en attente:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des utilisateurs'
    });
  }
};

exports.validateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { sendEmail = true } = req.body;
    
    // Valider le compte
    const user = await User.validateAccount(userId, req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Utilisateur non trouvé'
      });
    }
    
    // Générer un token de validation pour l'email
    let validationToken = null;
    if (sendEmail) {
      validationToken = jwt.sign(
        { email: user.email, userId: user.id, type: 'validation' },
        process.env.VERIFICATION_SECRET || process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );
      
      // Envoyer l'email de validation
      await EmailService.sendAccountValidatedEmail(user, validationToken);
    }
    
    res.json({
      success: true,
      message: 'Compte validé avec succès',
      user,
      email_sent: sendEmail,
      validation_token: sendEmail ? validationToken : null
    });
    
  } catch (error) {
    console.error('Erreur lors de la validation de l\'utilisateur:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la validation de l\'utilisateur'
    });
  }
};

exports.rejectUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason, sendEmail = true } = req.body;
    
    // Rejeter le compte
    const user = await User.rejectAccount(userId, reason, req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Utilisateur non trouvé'
      });
    }
    
    // Envoyer l'email de rejet si demandé
    if (sendEmail && reason) {
      await EmailService.sendAccountRejectedEmail(user, reason);
    }
    
    res.json({
      success: true,
      message: 'Compte rejeté avec succès',
      user,
      email_sent: sendEmail && reason
    });
    
  } catch (error) {
    console.error('Erreur lors du rejet de l\'utilisateur:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors du rejet de l\'utilisateur'
    });
  }
};

exports.suspendUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    
    // Suspendre le compte
    const result = await require('../config/database').query(
      `UPDATE users 
       SET status = 'suspended', 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 AND role != 'admin'
       RETURNING id, email, nom, prenom`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Utilisateur non trouvé ou non autorisé'
      });
    }
    
    res.json({
      success: true,
      message: 'Compte suspendu avec succès',
      user: result.rows[0]
    });
    
  } catch (error) {
    console.error('Erreur lors de la suspension de l\'utilisateur:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la suspension de l\'utilisateur'
    });
  }
};

exports.activateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Réactiver le compte
    const result = await require('../config/database').query(
      `UPDATE users 
       SET status = 'validated', 
           is_validated = true,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 AND role != 'admin'
       RETURNING id, email, nom, prenom`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Utilisateur non trouvé ou non autorisé'
      });
    }
    
    res.json({
      success: true,
      message: 'Compte réactivé avec succès',
      user: result.rows[0]
    });
    
  } catch (error) {
    console.error('Erreur lors de la réactivation de l\'utilisateur:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la réactivation de l\'utilisateur'
    });
  }
};

exports.getUserStats = async (req, res) => {
  try {
    const stats = await User.countByStatus();
    
    // Récupérer le nombre total d'utilisateurs
    const totalResult = await require('../config/database').query(
      "SELECT COUNT(*) as total FROM users WHERE role != 'admin'"
    );
    
    const total = parseInt(totalResult.rows[0].total);
    
    res.json({
      success: true,
      stats: {
        by_status: stats,
        total,
        pending: stats.find(s => s.status === 'pending')?.count || 0,
        validated: stats.find(s => s.status === 'validated')?.count || 0,
        rejected: stats.find(s => s.status === 'rejected')?.count || 0,
        suspended: stats.find(s => s.status === 'suspended')?.count || 0
      }
    });
    
  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des statistiques'
    });
  }
};