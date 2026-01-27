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

  async sendAccountValidatedEmail(user, token) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-account?token=${token}`;
    
    return await this.sendEmail('account_validated', user.email, {
      nom: user.nom,
      prenom: user.prenom,
      login_url: verificationUrl,
      admin_name: 'Administrateur'
    }, user.id);
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
}

module.exports = new EmailService();