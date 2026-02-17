const nodemailer = require('nodemailer');
const pool = require('../config/database');
require('dotenv').config();

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_PORT == 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  async getTemplate(templateName) {
    const result = await pool.query(
      'SELECT subject, html_content FROM email_templates WHERE template_name = $1',
      [templateName]
    );
    return result.rows[0];
  }

  async logEmail(userId, templateName, recipientEmail, subject, status, errorMessage = null) {
    await pool.query(
      `INSERT INTO email_logs 
       (user_id, template_name, recipient_email, subject, status, error_message) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, templateName, recipientEmail, subject, status, errorMessage]
    );
  }

  //Envoie un email personnalisé (sans template)
  async sendCustomEmail(recipientEmail, subject, htmlContent, userId = null) {
    try {
      // Configurer l'email
      const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: recipientEmail,
        subject: subject,
        html: htmlContent
      };

      // Envoyer l'email
      const info = await this.transporter.sendMail(mailOptions);

      // Logger le succès
      await this.logEmail(userId, 'custom', recipientEmail, subject, 'sent');

      console.log(`Email personnalisé envoyé à ${recipientEmail}: ${info.messageId}`);
      return { success: true, messageId: info.messageId };

    } catch (error) {
      console.error(` Erreur lors de l'envoi d'email personnalisé à ${recipientEmail}:`, error.message);

      // Logger l'erreur
      await this.logEmail(
        userId,
        'custom',
        recipientEmail,
        subject,
        'failed',
        error.message
      );

      return { success: false, error: error.message };
    }
  }
// Envoie un email avec un template existant

  async sendEmail(templateName, recipientEmail, variables = {}, userId = null) {
    try {
      // Récupérer le template
      const template = await this.getTemplate(templateName);
      if (!template) {
        throw new Error(`Template ${templateName} non trouvé`);
      }

      // Remplacer les variables dans le template
      let htmlContent = template.html_content;
      let subject = template.subject;

      for (const [key, value] of Object.entries(variables)) {
        const placeholder = `{{${key}}}`;
        htmlContent = htmlContent.replace(new RegExp(placeholder, 'g'), value);
        subject = subject.replace(new RegExp(placeholder, 'g'), value);
      }

      // Configurer l'email
      const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: recipientEmail,
        subject: subject,
        html: htmlContent
      };

      // Envoyer l'email
      const info = await this.transporter.sendMail(mailOptions);

      // Logger le succès
      await this.logEmail(userId, templateName, recipientEmail, subject, 'sent');

      console.log(` Email envoyé à ${recipientEmail}: ${info.messageId}`);
      return { success: true, messageId: info.messageId };

    } catch (error) {
      console.error(` Erreur lors de l'envoi d'email à ${recipientEmail}:`, error.message);

      // Logger l'erreur
      await this.logEmail(
        userId,
        templateName,
        recipientEmail,
        subject || templateName,
        'failed',
        error.message
      );

      return { success: false, error: error.message };
    }
  }
  // ENVOI D'EMAIL DE VALIDATION POUR FORMATEUR
  async sendFormateurValidatedEmail(user, token) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-account?token=${token}`;
    const subject = 'Votre compte a été validé !';
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Compte validé</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #10B981; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .button { display: inline-block; padding: 12px 24px; background: #10B981; color: white; text-decoration: none; border-radius: 4px; }
          .footer { margin-top: 30px; font-size: 12px; color: #6b7280; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Félicitations !</h1>
          </div>
          <div class="content">
            <h2>Félicitations ${user.prenom} ${user.nom} !</h2>
            <p>Votre compte sur notre plateforme de streaming a été validé par l'administrateur.</p>
            
            <p>Vous pouvez maintenant vous connecter et accéder à toutes les fonctionnalités.</p>
            
            <p style="text-align: center; margin: 30px 0;">
              <a href="${verificationUrl}" class="button">Vérifier</a>
            </p>
            
            <p style="color: #6b7280; font-size: 14px;">
              Si vous n'avez pas créé de compte, veuillez ignorer cet email.
            </p>
            
            <p style="margin-top: 25px;">
              <strong>Conservez bien vos informations de connexion.</strong>
            </p>
            
            <p style="margin-top: 30px;">
              Cordialement,<br>
              L'équipe de la plateforme
            </p>
          </div>
          <div class="footer">
            <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendCustomEmail(user.email, subject, htmlContent, user.id);
  }
  // ENVOI D'EMAIL DE VALIDATION POUR STAGIAIRE

  async sendStagiaireValidatedEmail(user, token, stagiaireId) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-account?token=${token}`;
    const subject = 'Votre compte a été validé !';
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Compte validé</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #10B981; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .identifier-box { background: #eef2ff; border-left: 4px solid #4F46E5; padding: 20px; margin: 20px 0; border-radius: 4px; }
          .identifier { font-family: monospace; font-size: 24px; font-weight: bold; color: #4F46E5; background: white; padding: 12px 24px; border-radius: 8px; display: inline-block; letter-spacing: 2px; }
          .button { display: inline-block; padding: 12px 24px; background: #10B981; color: white; text-decoration: none; border-radius: 4px; }
          .footer { margin-top: 30px; font-size: 12px; color: #6b7280; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Félicitations !</h1>
          </div>
          <div class="content">
            <h2>Félicitations ${user.prenom} ${user.nom} !</h2>
            <p>Votre compte sur notre plateforme de streaming a été validé par l'administrateur.</p>
            
            <div class="identifier-box">
              <p style="margin-bottom: 10px;"><strong>Votre identifiant unique :</strong></p>
              <div style="text-align: center;">
                <span class="identifier">${stagiaireId}</span>
              </div>
              <p style="margin-top: 15px; margin-bottom: 0;">
                Cet identifiant sera utilisé pour vous connecter au casque VR.
              </p>
            </div>
            
            <p>Vous pouvez maintenant vous connecter et accéder à toutes les fonctionnalités.</p>
            
            <p style="text-align: center; margin: 30px 0;">
              <a href="${verificationUrl}" class="button">Vérifier</a>
            </p>
            
            <p style="color: #6b7280; font-size: 14px;">
              Si vous n'avez pas créé de compte, veuillez ignorer cet email.
            </p>
            
            <p style="margin-top: 25px;">
              <strong>Conservez bien votre identifiant et vos informations de connexion.</strong>
            </p>
            
            <p style="margin-top: 30px;">
              Cordialement,<br>
              L'équipe de la plateforme
            </p>
          </div>
          <div class="footer">
            <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendCustomEmail(user.email, subject, htmlContent, user.id);
  }

  //Envoie un email de code 2FA
  async send2FACode(user, code) {
    const subject = ' Code de vérification - Authentification à deux facteurs';
    
    const htmlContent = `
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
          .footer { margin-top: 30px; font-size: 12px; color: #6b7280; text-align: center; }
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
            
            <p style="color: #6b7280; font-size: 14px;">
              Si vous n'êtes pas à l'origine de cette demande, veuillez contacter l'administrateur.
            </p>
          </div>
          <div class="footer">
            <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
            <p>© ${new Date().getFullYear()} Plateforme VR - Tous droits réservés</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendCustomEmail(user.email, subject, htmlContent, user.id);
  }

 // Envoie un email de confirmation d'activation 2FA avec codes de secours

 async send2FAEnabledConfirmation(user, backupCodes) {
    const subject = ' Authentification à deux facteurs activée';
    
    const codesHtml = backupCodes.map(code => 
      `<span style="font-family: monospace; font-size: 16px; font-weight: bold; color: #4F46E5; background: #eef2ff; padding: 8px 16px; border-radius: 4px; margin: 4px; display: inline-block;">${code}</span>`
    ).join(' ');

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #10B981; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .warning { background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 20px; margin: 20px 0; border-radius: 4px; }
          .codes { background: white; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0; }
          .code { font-family: monospace; font-size: 16px; font-weight: bold; color: #4F46E5; background: #eef2ff; padding: 8px 16px; border-radius: 4px; margin: 4px; display: inline-block; }
          .footer { margin-top: 30px; font-size: 12px; color: #6b7280; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1> 2FA Activée</h1>
          </div>
          <div class="content">
            <h2>Bonjour ${user.prenom} ${user.nom},</h2>
            <p>L'authentification à deux facteurs a été activée sur votre compte.</p>
            
            <div class="warning">
              <h3 style="color: #92400E; margin-top: 0;"> IMPORTANT - Codes de secours</h3>
              <p>Conservez précieusement ces codes. Ils vous permettront de vous connecter si vous perdez l'accès à votre email.</p>
            </div>
            
            <div class="codes">
              <p style="margin-bottom: 15px;"><strong>Vos codes de secours :</strong></p>
              <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;">
                ${codesHtml}
              </div>
              <p style="margin-top: 15px; color: #6b7280; font-size: 14px;">
                <strong>Chaque code ne peut être utilisé qu'une seule fois.</strong>
              </p>
            </div>
            
            <p>Si vous n'êtes pas à l'origine de cette action, veuillez contacter immédiatement l'administrateur.</p>
          </div>
          <div class="footer">
            <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendCustomEmail(user.email, subject, htmlContent, user.id);
  }

  //Envoie un email avec nouveaux codes de secours

  async sendNewBackupCodes(user, backupCodes) {
    const subject = ' Nouveaux codes de secours 2FA';
    
    const codesHtml = backupCodes.map(code => 
      `<span style="font-family: monospace; font-size: 16px; font-weight: bold; color: #4F46E5; background: #eef2ff; padding: 8px 16px; border-radius: 4px; margin: 4px; display: inline-block;">${code}</span>`
    ).join(' ');

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #F59E0B; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .codes { background: white; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0; }
          .footer { margin-top: 30px; font-size: 12px; color: #6b7280; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Nouveaux codes de secours</h1>
          </div>
          <div class="content">
            <h2>Bonjour ${user.prenom} ${user.nom},</h2>
            <p>De nouveaux codes de secours ont été générés pour votre compte.</p>
            
            <div class="codes">
              <p style="margin-bottom: 15px;"><strong>Vos nouveaux codes de secours :</strong></p>
              <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;">
                ${codesHtml}
              </div>
            </div>
            
            <p><strong> Les anciens codes ne sont plus valides.</strong></p>
            <p>Conservez ces codes dans un endroit sécurisé.</p>
          </div>
          <div class="footer">
            <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendCustomEmail(user.email, subject, htmlContent, user.id);
  }

  async sendAccountValidatedEmail(user, token, stagiaireId = null) {
    // Si c'est un stagiaire et qu'on a un identifiant, utiliser le template stagiaire
    if (user.role === 'stagiaire' && stagiaireId) {
      return await this.sendStagiaireValidatedEmail(user, token, stagiaireId);
    } 
    // Sinon, utiliser le template formateur (pour formateurs et admins)
    else {
      return await this.sendFormateurValidatedEmail(user, token);
    }
  }

  async sendAccountCreatedNotification(user, adminEmail) {
    return await this.sendEmail('account_created', adminEmail, {
      nom: user.nom,
      prenom: user.prenom,
      email: user.email,
      role: user.role,
      created_at: new Date(user.created_at).toLocaleDateString('fr-FR'),
      admin_url: `${process.env.FRONTEND_URL}/admin/users`
    }, user.id);
  }

  async sendAccountRejectedEmail(user, reason) {
    return await this.sendEmail('account_rejected', user.email, {
      nom: user.nom,
      prenom: user.prenom,
      rejection_reason: reason || 'Non spécifiée'
    }, user.id);
  }

  async sendAccountValidatedEmail(user, token, stagiaireId = null) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-account?token=${token}`;

    // Préparer les variables pour le template
    const variables = {
      nom: user.nom,
      prenom: user.prenom,
      login_url: verificationUrl,
      admin_name: 'Administrateur'
    };

    // Ajouter l'identifiant stagiaire si présent
    if (stagiaireId) {
      variables.stagiaire_id = stagiaireId;
    }

    return await this.sendEmail('account_validated', user.email, variables, user.id);
  }

  async sendPasswordResetEmail(user, resetToken) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    return await this.sendEmail('password_reset', user.email, {
      nom: user.nom,
      prenom: user.prenom,
      reset_url: resetUrl
    }, user.id);
  }

}

module.exports = new EmailService();