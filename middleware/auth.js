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