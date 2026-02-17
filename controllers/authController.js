const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Session = require('../models/Session');
const EmailService = require('../services/emailService');
const { ROLES, ACCOUNT_STATUS } = require('../config/constants');
const NotificationService = require('../services/notificationService');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');


// FONCTIONS UTILITAIRES POUR 2FA

const generateSixDigitCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Envoie un code de vérification 2FA par email
 */
const sendTwoFactorCodeEmail = async (user, code) => {
  return await EmailService.send2FACode(user, code);
};
/**
 * Vérifie si l'utilisateur a activé le 2FA
 */
const isTwoFactorEnabled = async (userId) => {
  const result = await pool.query(
    `SELECT is_enabled FROM user_2fa WHERE user_id = $1`,
    [userId]
  );
  return result.rows.length > 0 && result.rows[0].is_enabled;
};

/**
 * Nettoie les anciens codes 2FA
 */
const cleanupExpired2FACodes = async (userId) => {
  await pool.query(
    `DELETE FROM user_2fa_codes 
     WHERE user_id = $1 AND used_at IS NULL AND expires_at < NOW()`,
    [userId]
  );
};

/**
 * Crée un nouveau code 2FA
 */
const createTwoFactorCode = async (userId) => {
  await cleanupExpired2FACodes(userId);

  const code = generateSixDigitCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await pool.query(
    `INSERT INTO user_2fa_codes (user_id, code, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, code, expiresAt]
  );

  return { code, expiresAt };
};

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
    console.log(' Nouvel utilisateur créé:', newUser);

    // Construire l'objet utilisateur complet pour la notification
    const userForNotification = {
      id: newUser.id,
      nom: nom,
      prenom: prenom,
      email: email,
      role: role
    };

    if (role !== ROLES.ADMIN) {
      // Pour les non-admins, envoyer une notification à l'admin
      console.log('Envoi notification admin pour nouvel utilisateur');
      await NotificationService.notifyAdminNewUser(userForNotification);
    }

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

    //vérification 2fa
    const twoFactorEnabled = await isTwoFactorEnabled(user.id);

    if (twoFactorEnabled) {
      // Nettoyer les anciens codes
      await cleanupExpired2FACodes(user.id);

      // Créer un nouveau code
      const { code, expiresAt } = await createTwoFactorCode(user.id);

      // Envoyer le code par email
      try {
        await sendTwoFactorCodeEmail(user, code);
        console.log(` Code 2FA envoyé à ${user.email}`);
      } catch (emailError) {
        console.error(' Erreur envoi email 2FA:', emailError);
      }

      // Retourner que 2FA est requis (pas de token)
      return res.json({
        success: true,
        requires_2fa: true,
        message: 'Code de vérification envoyé par email',
        email: user.email,
        user_id: user.id,
        expires_in: 600 // 10 minutes en secondes
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
    // await Session.deactivateAllUserSessions(user.id);

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

exports.verifyTwoFactorCode = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        error: 'Email et code requis'
      });
    }

    // Récupérer l'utilisateur avec ses informations 2FA
    const userResult = await pool.query(
      `SELECT u.*, u2.is_enabled, u2.backup_codes 
       FROM users u
       LEFT JOIN user_2fa u2 ON u.id = u2.user_id
       WHERE u.email = $1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Utilisateur non trouvé'
      });
    }

    const user = userResult.rows[0];

    // Vérifier si 2FA est activé
    if (!user.is_enabled) {
      return res.status(400).json({
        success: false,
        error: '2FA n\'est pas activé sur ce compte'
      });
    }

    // 1. VÉRIFIER LES CODES DE SECOURS
    if (user.backup_codes && user.backup_codes.length > 0) {
      const backupCodes = user.backup_codes;
      const codeIndex = backupCodes.indexOf(code.toUpperCase());

      if (codeIndex !== -1) {
        // Code de secours valide - le supprimer
        backupCodes.splice(codeIndex, 1);
        await pool.query(
          `UPDATE user_2fa 
           SET backup_codes = $2, last_used_at = CURRENT_TIMESTAMP 
           WHERE user_id = $1`,
          [user.id, backupCodes]
        );

        //  Générer le token JWT
        const token = jwt.sign(
          { userId: user.id, email: user.email, role: user.role },
          process.env.JWT_SECRET,
          { expiresIn: process.env.JWT_EXPIRES_IN }
        );

        // Créer la session
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        await Session.create(user.id, token, expiresAt);

        delete user.password;
        delete user.backup_codes;

        return res.json({
          success: true,
          message: 'Authentification réussie (code de secours)',
          token,
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
          used_backup_code: true,
          remaining_codes: backupCodes.length
        });
      }
    }

    // 2. VÉRIFIER LE CODE NORMAL
    const codeResult = await pool.query(
      `SELECT * FROM user_2fa_codes 
       WHERE user_id = $1 
         AND code = $2 
         AND used_at IS NULL 
         AND expires_at > NOW()
       ORDER BY created_at DESC 
       LIMIT 1`,
      [user.id, code]
    );

    if (codeResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Code invalide ou expiré'
      });
    }

    // Marquer le code comme utilisé
    await pool.query(
      `UPDATE user_2fa_codes 
       SET used_at = CURRENT_TIMESTAMP 
       WHERE id = $1`,
      [codeResult.rows[0].id]
    );

    // Mettre à jour last_used_at dans user_2fa
    await pool.query(
      `UPDATE user_2fa SET last_used_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
      [user.id]
    );

    //  Générer le token JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // Créer la session
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await Session.create(user.id, token, expiresAt);

    delete user.password;
    delete user.backup_codes;

    res.json({
      success: true,
      message: 'Authentification réussie',
      token,
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
      used_backup_code: false
    });

  } catch (error) {
    console.error(' Erreur vérification code 2FA:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la vérification du code'
    });
  }
};

exports.resendTwoFactorCode = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email requis'
      });
    }

    // Récupérer l'utilisateur
    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Utilisateur non trouvé'
      });
    }

    // Vérifier si 2FA est activé
    const twoFactorEnabled = await isTwoFactorEnabled(user.id);
    if (!twoFactorEnabled) {
      return res.status(400).json({
        success: false,
        error: '2FA n\'est pas activé sur ce compte'
      });
    }

    // Supprimer les anciens codes non utilisés
    await pool.query(
      `DELETE FROM user_2fa_codes 
       WHERE user_id = $1 AND used_at IS NULL`,
      [user.id]
    );

    // Créer un nouveau code
    const { code } = await createTwoFactorCode(user.id);

    // Envoyer le nouveau code par email
    await sendTwoFactorCodeEmail(user, code);

    res.json({
      success: true,
      message: 'Nouveau code envoyé par email',
      expires_in: 600
    });

  } catch (error) {
    console.error(' Erreur renvoi code 2FA:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors du renvoi du code'
    });
  }
};

// GESTION 2FA DANS LE PROFIL
//Récupère le statut 2FA de l'utilisateur
exports.getTwoFactorStatus = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT is_enabled, backup_codes, created_at, updated_at, last_used_at
       FROM user_2fa 
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      // Créer une entrée par défaut
      await pool.query(
        `INSERT INTO user_2fa (user_id, is_enabled) VALUES ($1, false)`,
        [userId]
      );

      return res.json({
        success: true,
        is_enabled: false,
        has_backup_codes: false
      });
    }

    const twoFactor = result.rows[0];
    const backupCodes = twoFactor.backup_codes || [];

    res.json({
      success: true,
      is_enabled: twoFactor.is_enabled,
      has_backup_codes: backupCodes.length > 0,
      backup_codes_count: backupCodes.length,
      created_at: twoFactor.created_at,
      updated_at: twoFactor.updated_at,
      last_used_at: twoFactor.last_used_at
    });

  } catch (error) {
    console.error(' Erreur récupération statut 2FA:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération du statut 2FA'
    });
  }
};

exports.toggleTwoFactor = async (req, res) => {
  try {
    const { enabled } = req.body;
    const userId = req.user.id;

    // Vérifier que enabled est un booléen
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Le paramètre enabled doit être un booléen'
      });
    }

    // Mettre à jour le statut 2FA
    await pool.query(
      `INSERT INTO user_2fa (user_id, is_enabled, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) 
       DO UPDATE SET is_enabled = $2, updated_at = CURRENT_TIMESTAMP`,
      [userId, enabled]
    );

    let backupCodes = [];

    // Si activation, générer des codes de secours
    if (enabled) {
      // Générer 8 codes de secours
      for (let i = 0; i < 8; i++) {
        backupCodes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
      }

      await pool.query(
        `UPDATE user_2fa SET backup_codes = $2 WHERE user_id = $1`,
        [userId, backupCodes]
      );

      // Récupérer l'utilisateur pour l'email
      const user = await User.findById(userId);

      // Envoyer un email de confirmation avec les codes
      await EmailService.send2FAEnabledConfirmation(user, backupCodes);
    }

    res.json({
      success: true,
      message: enabled ? '2FA activée avec succès' : '2FA désactivée avec succès',
      is_enabled: enabled,
      backup_codes: enabled ? backupCodes : null
    });

  } catch (error) {
    console.error(' Erreur activation/désactivation 2FA:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la modification du statut 2FA'
    });
  }
};
//Génère de nouveaux codes de secours
exports.generateBackupCodes = async (req, res) => {
  try {
    const userId = req.user.id;

    // Vérifier si 2FA est activé
    const twoFactorEnabled = await isTwoFactorEnabled(userId);
    if (!twoFactorEnabled) {
      return res.status(400).json({
        success: false,
        error: '2FA n\'est pas activé sur votre compte'
      });
    }

    // Générer 8 nouveaux codes de secours
    const backupCodes = [];
    for (let i = 0; i < 8; i++) {
      backupCodes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }

    // Mettre à jour la base de données
    await pool.query(
      `UPDATE user_2fa 
       SET backup_codes = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $1`,
      [userId, backupCodes]
    );

    // Récupérer l'utilisateur pour l'email
    const user = await User.findById(userId);

    // Envoyer les nouveaux codes par email
    const codesHtml = backupCodes.map(code =>
      `<span style="font-family: monospace; font-size: 16px; font-weight: bold; color: #4F46E5; background: #eef2ff; padding: 8px 16px; border-radius: 4px; margin: 4px; display: inline-block;">${code}</span>`
    ).join(' ');

    await EmailService.sendCustomEmail(
      user.email,
      '🔄 Nouveaux codes de secours 2FA',
      `
      <h2>Nouveaux codes de secours</h2>
      <p>Bonjour ${user.prenom} ${user.nom},</p>
      <p>De nouveaux codes de secours ont été générés pour votre compte.</p>
      
      <div style="background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 20px; margin: 20px 0;">
        <h3 style="color: #92400E; margin-top: 0;"> Vos nouveaux codes :</h3>
        <div style="background: white; padding: 20px; border-radius: 8px;">
          ${codesHtml}
        </div>
        <p style="margin-bottom: 0;"><strong> Les anciens codes ne sont plus valides.</strong></p>
      </div>
      `,
      userId
    );

    res.json({
      success: true,
      message: 'Nouveaux codes de secours générés avec succès',
      backup_codes: backupCodes
    });

  } catch (error) {
    console.error(' Erreur génération codes secours:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la génération des codes de secours'
    });
  }
};

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

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email requis'
      });
    }

    // Vérifier si l'utilisateur existe
    const user = await User.emailExists(email);
    if (!user) {
      // Pour des raisons de sécurité, ne pas révéler si l'email existe ou non
      return res.json({
        success: true,
        message: 'Si un compte existe avec cet email, vous recevrez un lien de réinitialisation'
      });
    }

    // Générer un token de réinitialisation
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

    // Définir l'expiration (1 heure)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    // Sauvegarder le token dans la base de données
    await User.updateResetToken(user.id, tokenHash, expiresAt);

    // Créer l'URL de réinitialisation
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    // Envoyer l'email de réinitialisation
    await EmailService.sendEmail('password_reset', user.email, {
      nom: user.nom,
      prenom: user.prenom,
      reset_url: resetUrl
    }, user.id);

    res.json({
      success: true,
      message: 'Un lien de réinitialisation a été envoyé à votre adresse email'
    });

  } catch (error) {
    console.error('Erreur lors de la demande de réinitialisation:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors du traitement de la demande'
    });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body;

    // Validation
    if (!token || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'Token, nouveau mot de passe et confirmation requis'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: 'Les mots de passe ne correspondent pas'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Le mot de passe doit contenir au moins 6 caractères'
      });
    }

    // Hasher le token pour la comparaison
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Trouver l'utilisateur avec ce token valide
    const user = await User.findByResetToken(tokenHash);
    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Token invalide ou expiré'
      });
    }

    // Mettre à jour le mot de passe
    const updatedUser = await User.resetPassword(user.id, newPassword);

    // Envoyer une notification
    await EmailService.sendEmail('password_changed', user.email, {
      nom: user.nom,
      prenom: user.prenom
    }, user.id);

    res.json({
      success: true,
      message: 'Mot de passe réinitialisé avec succès. Vous pouvez maintenant vous connecter.',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        nom: updatedUser.nom,
        prenom: updatedUser.prenom
      }
    });

  } catch (error) {
    console.error('Erreur lors de la réinitialisation du mot de passe:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la réinitialisation du mot de passe'
    });
  }
};

exports.verifyResetToken = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Token requis'
      });
    }

    // Hasher le token pour la comparaison
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Vérifier si le token est valide
    const user = await User.findByResetToken(tokenHash);
    if (!user) {
      return res.status(400).json({
        success: false,
        valid: false,
        error: 'Token invalide ou expiré'
      });
    }

    res.json({
      success: true,
      valid: true,
      message: 'Token valide',
      user: {
        email: user.email,
        nom: user.nom,
        prenom: user.prenom
      }
    });

  } catch (error) {
    console.error('Erreur lors de la vérification du token:', error);
    res.status(500).json({
      success: false,
      valid: false,
      error: 'Erreur lors de la vérification du token'
    });
  }
};