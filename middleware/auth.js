const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Session = require('../models/Session');
const { ROLES } = require('../config/constants');

exports.authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token d\'authentification requis' });
    }

    // Vérifier dans la base de données si la session est active
    const session = await Session.findByToken(token);
    if (!session) {
      return res.status(401).json({ error: 'Session expirée ou invalide' });
    }

    // Vérifier le token JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Récupérer l'utilisateur
    const user = await User.findById(decoded.userId);
    if (!user) {
      await Session.deactivate(token);
      return res.status(401).json({ error: 'Utilisateur non trouvé' });
    }

    req.user = user;
    req.token = token;
    req.session = session;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      // Désactiver la session expirée
      const token = req.header('Authorization')?.replace('Bearer ', '');
      if (token) {
        await Session.deactivate(token);
      }
      return res.status(401).json({ error: 'Token expiré' });
    }
    res.status(401).json({ error: 'Token invalide' });
  }
};

exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Accès refusé. Rôle insuffisant.' 
      });
    }
    next();
  };
};

exports.isOwnerOrAdmin = async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id || req.body.userId || 0);
    
    if (req.user.role === ROLES.ADMIN || req.user.id === userId) {
      return next();
    }
    
    return res.status(403).json({ 
      error: 'Accès refusé. Vous ne pouvez modifier que votre propre compte.' 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.refreshSession = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token || !req.session) {
      return next();
    }

    // Vérifier si la session expire bientôt (dans les 30 minutes)
    const sessionExpiry = new Date(req.session.expires_at);
    const now = new Date();
    const timeUntilExpiry = sessionExpiry - now;
    const thirtyMinutes = 30 * 60 * 1000; // 30 minutes en millisecondes

    if (timeUntilExpiry < thirtyMinutes && timeUntilExpiry > 0) {
      // Rafraîchir la session
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 7); // 7 jours
      
      await pool.query(
        'UPDATE user_sessions SET expires_at = $1 WHERE token = $2',
        [newExpiresAt, token]
      );
      
      // Rafraîchir le token JWT si nécessaire
      const newToken = jwt.sign(
        { userId: req.user.id, email: req.user.email, role: req.user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );
      
      // Mettre à jour le token dans la session
      await pool.query(
        'UPDATE user_sessions SET token = $1 WHERE id = $2',
        [newToken, req.session.id]
      );
      
      // Ajouter le nouveau token à la réponse
      res.set('X-New-Token', newToken);
    }
    
    next();
  } catch (error) {
    console.error('Erreur lors du rafraîchissement de session:', error);
    next();
  }
};