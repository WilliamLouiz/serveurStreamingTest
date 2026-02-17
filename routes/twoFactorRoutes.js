// routes/twoFactorRoutes.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const pool = require('../config/database');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Configuration email (utilisez votre config existante)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Générer un code à 6 chiffres
const generateSixDigitCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// GET - Vérifier le statut 2FA de l'utilisateur
router.get('/status', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT is_enabled, created_at, updated_at 
       FROM user_2fa 
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      // Créer une entrée par défaut si elle n'existe pas
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

    // Vérifier si des codes de secours existent
    const backupCodes = result.rows[0].backup_codes || [];
    
    res.json({
      success: true,
      is_enabled: result.rows[0].is_enabled,
      has_backup_codes: backupCodes.length > 0,
      created_at: result.rows[0].created_at,
      updated_at: result.rows[0].updated_at
    });

  } catch (error) {
    console.error('Erreur vérification statut 2FA:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la vérification du statut 2FA'
    });
  }
});

// POST - Activer/Désactiver 2FA
router.post('/toggle', authenticate, async (req, res) => {
  try {
    const { enabled } = req.body;
    const userId = req.user.id;

    // Vérifier si l'utilisateur existe
    const userResult = await pool.query(
      `SELECT email, nom, prenom FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Utilisateur non trouvé'
      });
    }

    // Mettre à jour ou insérer le statut 2FA
    await pool.query(
      `INSERT INTO user_2fa (user_id, is_enabled, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) 
       DO UPDATE SET is_enabled = $2, updated_at = CURRENT_TIMESTAMP`,
      [userId, enabled]
    );

    // Si activation, générer des codes de secours
    let backupCodes = [];
    if (enabled) {
      // Générer 8 codes de secours
      for (let i = 0; i < 8; i++) {
        backupCodes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
      }

      await pool.query(
        `UPDATE user_2fa SET backup_codes = $2 WHERE user_id = $1`,
        [userId, backupCodes]
      );

      // Envoyer un email de confirmation
      try {
        await transporter.sendMail({
          from: '"Plateforme VR" <noreply@votreplateforme.com>',
          to: userResult.rows[0].email,
          subject: 'Authentification à deux facteurs activée',
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
                .codes { background: white; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0; }
                .code { font-family: monospace; font-size: 18px; font-weight: bold; color: #4F46E5; padding: 8px 16px; background: #eef2ff; border-radius: 4px; display: inline-block; margin: 4px; }
                .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1> 2FA Activée</h1>
                </div>
                <div class="content">
                  <h2>Bonjour ${userResult.rows[0].prenom} ${userResult.rows[0].nom},</h2>
                  <p>L'authentification à deux facteurs a été activée sur votre compte.</p>
                  
                  <div class="warning">
                    <p><strong> IMPORTANT - Codes de secours :</strong></p>
                    <p>Conservez précieusement ces codes. Ils vous permettront de vous connecter si vous perdez l'accès à votre email.</p>
                  </div>
                  
                  <div class="codes">
                    <p style="margin-bottom: 15px;"><strong>Vos codes de secours :</strong></p>
                    ${backupCodes.map(code => `<span class="code">${code}</span>`).join(' ')}
                  </div>
                  
                  <p>À chaque connexion, un code à 6 chiffres vous sera envoyé par email.</p>
                  <p>Si vous n'êtes pas à l'origine de cette action, veuillez contacter immédiatement l'administrateur.</p>
                  
                  <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
                  <p style="color: #6b7280; font-size: 12px; text-align: center;">
                    Cet email a été envoyé automatiquement, merci de ne pas y répondre.
                  </p>
                </div>
              </div>
            </body>
            </html>
          `
        });
      } catch (emailError) {
        console.error('Erreur envoi email 2FA:', emailError);
      }
    }

    res.json({
      success: true,
      message: enabled ? '2FA activée avec succès' : '2FA désactivée avec succès',
      is_enabled: enabled,
      backup_codes: enabled ? backupCodes : null
    });

  } catch (error) {
    console.error('Erreur activation/désactivation 2FA:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la modification du statut 2FA'
    });
  }
});

// POST - Envoyer un code 2FA par email (lors de la connexion)
router.post('/send-code', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email requis'
      });
    }

    // Récupérer l'utilisateur et vérifier si 2FA est activé
    const userResult = await pool.query(
      `SELECT u.id, u.email, u.nom, u.prenom, u2.is_enabled 
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
      return res.json({
        success: true,
        requires_2fa: false,
        message: '2FA non activé pour cet utilisateur'
      });
    }

    // Supprimer les anciens codes non utilisés
    await pool.query(
      `DELETE FROM user_2fa_codes 
       WHERE user_id = $1 AND (used_at IS NULL AND expires_at < NOW())`,
      [user.id]
    );

    // Générer un nouveau code
    const code = generateSixDigitCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Sauvegarder le code
    await pool.query(
      `INSERT INTO user_2fa_codes (user_id, code, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, code, expiresAt]
    );

    // Envoyer le code par email
    try {
      await transporter.sendMail({
        from: '"Plateforme VR" <noreply@votreplateforme.com>',
        to: user.email,
        subject: ' Code de vérification - Authentification à deux facteurs',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
              .code-container { text-align: center; margin: 30px 0; }
              .code { font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #4F46E5; background: white; padding: 20px; border-radius: 8px; border: 2px solid #e5e7eb; display: inline-block; }
              .expires { background: #eef2ff; padding: 15px; border-radius: 8px; margin: 20px 0; }
              .warning { color: #6b7280; font-size: 14px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1> Code de vérification</h1>
              </div>
              <div class="content">
                <h2>Bonjour ${user.prenom} ${user.nom},</h2>
                <p>Voici votre code de vérification pour l'authentification à deux facteurs :</p>
                
                <div class="code-container">
                  <div class="code">${code}</div>
                </div>
                
                <div class="expires">
                  <p style="margin: 0;"><strong>⏰ Ce code expirera dans 10 minutes.</strong></p>
                </div>
                
                <p class="warning">
                  Si vous n'êtes pas à l'origine de cette demande, veuillez ignorer cet email et contacter l'administrateur.
                </p>
                
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
                <p style="color: #6b7280; font-size: 12px; text-align: center;">
                  Cet email a été envoyé automatiquement, merci de ne pas y répondre.
                </p>
              </div>
            </div>
          </body>
          </html>
        `
      });
    } catch (emailError) {
      console.error('Erreur envoi email 2FA:', emailError);
      return res.status(500).json({
        success: false,
        error: 'Erreur lors de l\'envoi du code de vérification'
      });
    }

    res.json({
      success: true,
      requires_2fa: true,
      message: 'Code de vérification envoyé par email',
      expires_in: 600 // 10 minutes en secondes
    });

  } catch (error) {
    console.error('Erreur envoi code 2FA:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de l\'envoi du code de vérification'
    });
  }
});

// POST - Vérifier le code 2FA
router.post('/verify-code', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        error: 'Email et code requis'
      });
    }

    // Récupérer l'utilisateur
    const userResult = await pool.query(
      `SELECT id FROM users WHERE email = $1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Utilisateur non trouvé'
      });
    }

    const userId = userResult.rows[0].id;

    // Vérifier d'abord les codes de secours
    const backupResult = await pool.query(
      `SELECT backup_codes FROM user_2fa WHERE user_id = $1`,
      [userId]
    );

    if (backupResult.rows.length > 0 && backupResult.rows[0].backup_codes) {
      const backupCodes = backupResult.rows[0].backup_codes;
      const codeIndex = backupCodes.indexOf(code.toUpperCase());
      
      if (codeIndex !== -1) {
        // Code de secours valide - le supprimer
        backupCodes.splice(codeIndex, 1);
        await pool.query(
          `UPDATE user_2fa SET backup_codes = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
          [userId, backupCodes]
        );

        return res.json({
          success: true,
          verified: true,
          used_backup_code: true,
          remaining_codes: backupCodes.length
        });
      }
    }

    // Vérifier le code normal
    const codeResult = await pool.query(
      `SELECT * FROM user_2fa_codes 
       WHERE user_id = $1 
         AND code = $2 
         AND used_at IS NULL 
         AND expires_at > NOW()
       ORDER BY created_at DESC 
       LIMIT 1`,
      [userId, code]
    );

    if (codeResult.rows.length === 0) {
      return res.json({
        success: false,
        verified: false,
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
      [userId]
    );

    res.json({
      success: true,
      verified: true,
      used_backup_code: false
    });

  } catch (error) {
    console.error('Erreur vérification code 2FA:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la vérification du code'
    });
  }
});

// POST - Générer de nouveaux codes de secours
router.post('/generate-backup-codes', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Vérifier si 2FA est activé
    const twoFactorResult = await pool.query(
      `SELECT is_enabled FROM user_2fa WHERE user_id = $1`,
      [userId]
    );

    if (twoFactorResult.rows.length === 0 || !twoFactorResult.rows[0].is_enabled) {
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

    // Récupérer l'email de l'utilisateur pour l'envoi
    const userResult = await pool.query(
      `SELECT email, nom, prenom FROM users WHERE id = $1`,
      [userId]
    );

    // Envoyer les nouveaux codes par email
    try {
      await transporter.sendMail({
        from: '"Plateforme VR" <noreply@iffen.fr>',
        to: userResult.rows[0].email,
        subject: ' Nouveaux codes de secours 2FA',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #10B981; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
              .codes { background: white; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0; }
              .code { font-family: monospace; font-size: 18px; font-weight: bold; color: #10B981; padding: 8px 16px; background: #e7f5e7; border-radius: 4px; display: inline-block; margin: 4px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1> Nouveaux codes de secours</h1>
              </div>
              <div class="content">
                <h2>Bonjour ${userResult.rows[0].prenom} ${userResult.rows[0].nom},</h2>
                <p>De nouveaux codes de secours ont été générés pour votre compte.</p>
                
                <div class="codes">
                  <p style="margin-bottom: 15px;"><strong>Vos nouveaux codes de secours :</strong></p>
                  ${backupCodes.map(code => `<span class="code">${code}</span>`).join(' ')}
                </div>
                
                <p><strong> Les anciens codes ne sont plus valides.</strong></p>
                <p>Conservez ces codes dans un endroit sécurisé.</p>
              </div>
            </div>
          </body>
          </html>
        `
      });
    } catch (emailError) {
      console.error('Erreur envoi email codes secours:', emailError);
    }

    res.json({
      success: true,
      message: 'Nouveaux codes de secours générés avec succès',
      backup_codes: backupCodes
    });

  } catch (error) {
    console.error('Erreur génération codes secours:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la génération des codes de secours'
    });
  }
});

// DELETE - Désactiver 2FA (force désactivation)
router.post('/force-disable', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    // Vérifier si l'utilisateur est admin ou propriétaire du compte
    if (req.user.role !== 'admin' && req.user.id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Accès non autorisé'
      });
    }

    await pool.query(
      `UPDATE user_2fa 
       SET is_enabled = false, backup_codes = NULL, updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $1`,
      [userId]
    );

    // Supprimer tous les codes non utilisés
    await pool.query(
      `DELETE FROM user_2fa_codes WHERE user_id = $1 AND used_at IS NULL`,
      [userId]
    );

    res.json({
      success: true,
      message: '2FA désactivé avec succès'
    });

  } catch (error) {
    console.error('Erreur désactivation forcée 2FA:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la désactivation du 2FA'
    });
  }
});

module.exports = router;