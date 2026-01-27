const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Session = require('../models/Session');
const EmailService = require('../services/emailService');
const { ROLES, ACCOUNT_STATUS } = require('../config/constants');

exports.register = async (req, res) => {
  try {
    const { nom, prenom, email, password, role } = req.body;
    
    // Vérifier si l'utilisateur existe déjà
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Cet email est déjà utilisé'
      });
    }
    
    // Créer l'utilisateur
    const newUser = await User.create({
      nom,
      prenom,
      email,
      password,
      role
    });
    
    // Si c'est un admin, le compte est automatiquement validé
    if (role === ROLES.ADMIN) {
      // Générer le token JWT pour l'admin
      const token = jwt.sign(
        { userId: newUser.id, email, role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
      );
      
      // Créer la session
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      await Session.create(newUser.id, token, expiresAt);
      
      return res.status(201).json({
        success: true,
        message: 'Compte admin créé avec succès',
        user: {
          id: newUser.id,
          nom,
          prenom,
          email,
          role,
          is_validated: true
        },
        token,
        expiresAt
      });
    }
    
    // Pour les non-admins, envoyer une notification à l'admin
    // Récupérer l'email de l'admin (premier admin trouvé)
    const adminResult = await require('../config/database').query(
      "SELECT email FROM users WHERE role = 'admin' LIMIT 1"
    );
    
    if (adminResult.rows.length > 0) {
      await EmailService.sendAccountCreatedNotification(
        { ...newUser, nom, prenom, email, role },
        adminResult.rows[0].email
      );
    }
    
    res.status(201).json({
      success: true,
      message: 'Compte créé avec succès. En attente de validation par l\'administrateur.',
      user: {
        id: newUser.id,
        nom,
        prenom,
        email,
        role,
        is_validated: false,
        status: ACCOUNT_STATUS.PENDING
      },
      requires_validation: true
    });
    
  } catch (error) {
    console.error('Erreur lors de l\'inscription:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de l\'inscription' 
    });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Trouver l'utilisateur
    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Email ou mot de passe incorrect' 
      });
    }

    // Vérifier le mot de passe
    const isPasswordValid = await User.comparePassword(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        error: 'Email ou mot de passe incorrect' 
      });
    }

    // Vérifier si le compte est validé
    if (!user.is_validated && user.role !== ROLES.ADMIN) {
      return res.status(403).json({
        success: false,
        error: 'Votre compte n\'est pas encore validé par l\'administrateur.',
        requires_validation: true,
        status: user.status
      });
    }

    // Vérifier le statut du compte
    if (user.status === ACCOUNT_STATUS.REJECTED) {
      return res.status(403).json({
        success: false,
        error: 'Votre compte a été rejeté.'
      });
    }

    if (user.status === ACCOUNT_STATUS.SUSPENDED) {
      return res.status(403).json({
        success: false,
        error: 'Votre compte a été suspendu.'
      });
    }

    // Générer le token JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // Calculer la date d'expiration
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Désactiver les anciennes sessions de l'utilisateur
    await Session.deactivateAllUserSessions(user.id);

    // Créer une nouvelle session
    await Session.create(user.id, token, expiresAt);

    // Ne pas renvoyer le mot de passe
    delete user.password;

    res.json({
      success: true,
      message: 'Connexion réussie',
      user: {
        id: user.id,
        nom: user.nom,
        prenom: user.prenom,
        email: user.email,
        role: user.role,
        is_validated: user.is_validated,
        status: user.status,
        created_at: user.created_at
      },
      token,
      expiresAt
    });
  } catch (error) {
    console.error('Erreur lors de la connexion:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la connexion' 
    });
  }
};

// ... autres méthodes existantes ...

exports.verifyAccount = async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Token de validation requis'
      });
    }
    
    // Vérifier le token
    const user = await User.findByValidationToken(token);
    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Token invalide ou expiré'
      });
    }
    
    // Valider le compte
    await User.validateAccount(user.id);
    
    // Marquer le token comme utilisé
    await User.markTokenAsUsed(token);
    
    res.json({
      success: true,
      message: 'Compte validé avec succès! Vous pouvez maintenant vous connecter.',
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom
      }
    });
    
  } catch (error) {
    console.error('Erreur lors de la validation du compte:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la validation du compte'
    });
  }
};

exports.resendValidationEmail = async (req, res) => {
  try {
    const { email } = req.body;
    
    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Utilisateur non trouvé'
      });
    }
    
    if (user.is_validated) {
      return res.status(400).json({
        success: false,
        error: 'Le compte est déjà validé'
      });
    }
    
    // Générer un nouveau token
    const validationToken = jwt.sign(
      { email: user.email, userId: user.id, type: 'validation' },
      process.env.VERIFICATION_SECRET || process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // Mettre à jour le token dans la base
    await require('../config/database').query(
      `UPDATE users 
       SET validation_token = $1, 
           token_expires_at = NOW() + INTERVAL '24 hours'
       WHERE id = $2`,
      [validationToken, user.id]
    );
    
    // Envoyer l'email de validation
    await EmailService.sendAccountValidatedEmail(user, validationToken);
    
    res.json({
      success: true,
      message: 'Email de validation renvoyé avec succès'
    });
    
  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'email de validation:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de l\'envoi de l\'email'
    });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
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
    console.error('Erreur lors de la récupération du profil:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la récupération du profil' 
    });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { nom, prenom, email } = req.body;
    
    const updated = await User.update(req.user.id, {
      nom,
      prenom,
      email,
      role: req.user.role // Garder le rôle original
    });

    if (!updated) {
      return res.status(404).json({ 
        success: false, 
        error: 'Utilisateur non trouvé' 
      });
    }

    const user = await User.findById(req.user.id);

    res.json({
      success: true,
      message: 'Profil mis à jour avec succès',
      user
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du profil:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la mise à jour du profil' 
    });
  }
};

exports.logout = async (req, res) => {
  try {
    const token = req.token;
    
    if (token) {
      await Session.deactivate(token);
    }

    res.json({
      success: true,
      message: 'Déconnexion réussie'
    });
  } catch (error) {
    console.error('Erreur lors de la déconnexion:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la déconnexion' 
    });
  }
};