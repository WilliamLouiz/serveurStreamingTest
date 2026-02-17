const { Pool } = require('pg');
require('dotenv').config();

const initPool = new Pool({
  host: process.env.PG_HOST,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT || 5432,
  database: 'postgres', // Base de données par défaut pour créer notre DB
});

async function initializeDatabase() {
  let client;
  try {
    client = await initPool.connect();

    // 1. Créer la base de données si elle n'existe pas
    console.log('Création de la base de données...');
    const dbName = process.env.PG_DATABASE || 'Streaming';
    
    // Correction: utiliser une requête paramétrée
    await client.query(`
      SELECT 'CREATE DATABASE "${dbName}"'
      WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = $1)
    `, [dbName]);

    console.log(' Base de données prête');

  } catch (error) {
    console.error(' Erreur lors de l\'initialisation:', error.message);
  } finally {
    if (client) client.release();
    await initPool.end();
  }
}

// Créer un pool pour notre base de données
const appPool = new Pool({
  host: process.env.PG_HOST,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE || 'Streaming',
  port: process.env.PG_PORT || 5432,
});

async function createTables() {
  const client = await appPool.connect();
  try {
    console.log(' Création des tables...');

    // Table users - Mise à jour avec toutes les colonnes
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(100) NOT NULL,
        prenom VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'formateur', 'stagiaire')),
        stagiaire_id VARCHAR(50) UNIQUE,
        is_validated BOOLEAN DEFAULT false,
        validation_token VARCHAR(255),
        token_expires_at TIMESTAMP,
        validated_at TIMESTAMP,
        validated_by INTEGER REFERENCES users(id),
        reset_password_token VARCHAR(255),
        reset_password_expires TIMESTAMP,
        certificat_valide BOOLEAN DEFAULT false,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'validated', 'rejected', 'suspended')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Table email_templates - Correction du format
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id SERIAL PRIMARY KEY,
        template_name VARCHAR(100) UNIQUE NOT NULL,
        subject VARCHAR(255) NOT NULL,
        html_content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Table email_logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        template_name VARCHAR(100),
        recipient_email VARCHAR(255) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) NOT NULL,
        error_message TEXT
      )
    `);

    // Table channels
    await client.query(`
      CREATE TABLE IF NOT EXISTS channels (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Table channel_subscriptions
    await client.query(`
      CREATE TABLE IF NOT EXISTS channel_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
        subscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, channel_id)
      )
    `);

    // Table streaming_sessions
    await client.query(`
      CREATE TABLE IF NOT EXISTS streaming_sessions (
        id SERIAL PRIMARY KEY,
        channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMP,
        viewer_count INTEGER DEFAULT 0,
        total_frames INTEGER DEFAULT 0,
        avg_frame_size INTEGER DEFAULT 0
      )
    `);

    // Table user_sessions
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        is_active BOOLEAN DEFAULT true
      )
    `);

    // Table encadrements
    await client.query(`
      CREATE TABLE IF NOT EXISTS encadrements (
        id SERIAL PRIMARY KEY,
        formateur_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stagiaire_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        description TEXT,
        updated_at TIMESTAMP,
        UNIQUE(formateur_id, stagiaire_id)
      )
    `);

    // Table notes
    await client.query(`
      CREATE TABLE IF NOT EXISTS notes (
          id SERIAL PRIMARY KEY,
          formateur_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          stagiaire_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          note INTEGER NOT NULL, -- Note sur 20 (stockée comme 4-20)
          commentaire TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          
          CONSTRAINT fk_formateur FOREIGN KEY (formateur_id) REFERENCES users(id) ON DELETE CASCADE,
          CONSTRAINT fk_stagiaire FOREIGN KEY (stagiaire_id) REFERENCES users(id) ON DELETE CASCADE,
          CONSTRAINT check_note_range CHECK (note >= 1 AND note <= 20)
      )
    `);

    // CORRECTION: Table notifications - version corrigée
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,  -- Changé de VARCHAR(50) à INTEGER
        titre VARCHAR(255) NOT NULL,
        description TEXT,
        type VARCHAR(50),
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metadata JSONB DEFAULT '{}'::jsonb,
        read_at TIMESTAMP,
        user_identifier VARCHAR(50)  -- Pour stocker l'identifiant texte (ex: VR7574)
      )
    `);

    // Table streams_replay
    await client.query(`
      CREATE TABLE IF NOT EXISTS streams_replay (
        id SERIAL PRIMARY KEY,
        stagiaire_id VARCHAR(50) NOT NULL,
        channel_id VARCHAR(100) NOT NULL,
        file_path TEXT NOT NULL,
        duration INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        note INTEGER CHECK (note >= 0 AND note <= 20),
        certificat_valide BOOLEAN DEFAULT false
      )
    `);

    // Insérer les templates d'email par défaut 
    await client.query(`
      INSERT INTO email_templates (template_name, subject, html_content) 
      VALUES 
      (
        'account_validated',
        'Votre compte a été validé !',
        '<h1>Félicitations {{nom}} {{prenom}} !</h1>
        <p>Votre compte sur notre plateforme de streaming a été validé par l''administrateur.</p>
        {{#if stagiaire_id}}
        <p><strong>Votre identifiant unique :</strong> {{stagiaire_id}}</p>
        <p>Cet identifiant sera utilisé pour vous connecter au casque VR.</p>
        {{/if}}
        <p>Vous pouvez maintenant vous connecter et accéder à toutes les fonctionnalités.</p>
        <p>Pour vous connecter, cliquez sur le lien suivant :</p>
        <p><a href="{{login_url}}">Vérifier</a></p>
        <p>Si vous n''avez pas créé de compte, veuillez ignorer cet email.</p>
        <br>
        <strong>Conservez bien votre identifiant et vos informations de connexion.</strong><br>
        <p>Cordialement,<br>L''équipe de la plateforme</p>'
      ),
      (
        'account_created',
        'Nouveau compte en attente de validation',
        '<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Nouvel utilisateur en attente</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background-color: #2196F3; color: white; padding: 20px; text-align: center; }
                .content { padding: 20px; background-color: #f9f9f9; }
                .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
                .button { display: inline-block; padding: 12px 24px; background-color: #2196F3; color: white; text-decoration: none; border-radius: 4px; }
                .info-box { background-color: #e7f3fe; border-left: 4px solid #2196F3; padding: 15px; margin: 20px 0; }
                ul { padding-left: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Nouvelle inscription</h1>
                </div>
                <div class="content">
                    <h2>Administrateur,</h2>
                    <p>Un nouvel utilisateur s''est inscrit et attend votre validation :</p>
                    
                    <div class="info-box">
                        <ul>
                            <li><strong>Nom :</strong> {{nom}}</li>
                            <li><strong>Prénom :</strong> {{prenom}}</li>
                            <li><strong>Email :</strong> {{email}}</li>
                            <li><strong>Rôle :</strong> {{role}}</li>
                            <li><strong>Date d''inscription :</strong> {{created_at}}</li>
                        </ul>
                    </div>
                    
                    <p>Pour valider ou rejeter ce compte, connectez-vous à l''administration :</p>
                    
                    <p style="text-align: center; margin: 30px 0;">
                        <a href="{{admin_url}}" class="button">Accéder à l''administration</a>
                    </p>
                </div>
                <div class="footer">
                    <p>Cordialement,<br>L''équipe de la plateforme</p>
                </div>
            </div>
        </body>
        </html>'
      ),
      (
        'account_rejected',
        'Votre compte a été rejeté',
        '<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Compte rejeté</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background-color: #f44336; color: white; padding: 20px; text-align: center; }
                .content { padding: 20px; background-color: #f9f9f9; }
                .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
                .alert { background-color: #f8d7da; border-left: 4px solid #f44336; padding: 15px; margin: 20px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Notification importante</h1>
                </div>
                <div class="content">
                    <h2>Bonjour {{nom}} {{prenom}},</h2>
                    <p>Votre demande de création de compte sur notre plateforme de streaming VR a été examinée.</p>
                    
                    <div class="alert">
                        <h3>Décision : Compte rejeté</h3>
                        <p><strong>Raison :</strong> {{rejection_reason}}</p>
                    </div>
                    
                    <p>Si vous pensez qu''il s''agit d''une erreur, vous pouvez contacter l''administrateur à l''adresse suivante :</p>
                    <p><a href="mailto:{{admin_email}}">{{admin_email}}</a></p>
                </div>
                <div class="footer">
                    <p>Cordialement,<br>L''équipe de la plateforme</p>
                </div>
            </div>
        </body>
        </html>'
      ),
      (
        'password_reset',
        'Réinitialisation de votre mot de passe',
        '<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Réinitialisation de mot de passe</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background-color: #FF9800; color: white; padding: 20px; text-align: center; }
                .content { padding: 20px; background-color: #f9f9f9; }
                .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
                .button { display: inline-block; padding: 12px 24px; background-color: #FF9800; color: white; text-decoration: none; border-radius: 4px; }
                .warning { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Réinitialisation de mot de passe</h1>
                </div>
                <div class="content">
                    <h2>Bonjour {{nom}} {{prenom}},</h2>
                    <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
                    
                    <p style="text-align: center; margin: 30px 0;">
                        <a href="{{reset_url}}" class="button">Réinitialiser mon mot de passe</a>
                    </p>
                    
                    <div class="warning">
                        <p><strong>Ce lien expirera dans 1 heure.</strong></p>
                        <p>Si vous n''avez pas demandé cette réinitialisation, veuillez ignorer cet email.</p>
                    </div>
                </div>
                <div class="footer">
                    <p>Cordialement,<br>L''équipe de la plateforme</p>
                </div>
            </div>
        </body>
        </html>'
      ),
      (
        'password_changed',
        'Votre mot de passe a été modifié',
        '<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Mot de passe modifié</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
                .content { padding: 20px; background-color: #f9f9f9; }
                .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
                .info { background-color: #e7f3fe; border-left: 4px solid #2196F3; padding: 15px; margin: 20px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Mot de passe modifié</h1>
                </div>
                <div class="content">
                    <h2>Bonjour {{nom}} {{prenom}},</h2>
                    <p>Votre mot de passe a été modifié avec succès.</p>
                    
                    <div class="info">
                        <p><strong>Informations de sécurité :</strong></p>
                        <p>Si vous n''avez pas effectué cette modification, veuillez contacter immédiatement l''administrateur.</p>
                    </div>
                    
                    <p>Vous pouvez maintenant utiliser vos nouvelles informations pour vous connecter à la plateforme.</p>
                </div>
                <div class="footer">
                    <p>Cordialement,<br>L''équipe de la plateforme</p>
                </div>
            </div>
        </body>
        </html>'
      )
      ON CONFLICT (template_name) DO NOTHING
    `);

    // Table active_channels pour stocker les canaux actifs en temps réel
    await client.query(`
      CREATE TABLE IF NOT EXISTS active_channels (
        id SERIAL PRIMARY KEY,
        channel_id VARCHAR(100) NOT NULL UNIQUE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        stagiaire_id VARCHAR(50),
        connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_ping TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected')),
        metadata JSONB DEFAULT '{}'::jsonb,
        CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id SERIAL PRIMARY KEY,
        formateur_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stagiaire_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        commentaire TEXT NOT NULL,
        replay_id INTEGER REFERENCES streams_replay(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_edited BOOLEAN DEFAULT false,
        
        CONSTRAINT fk_formateur_comment FOREIGN KEY (formateur_id) REFERENCES users(id),
        CONSTRAINT fk_stagiaire_comment FOREIGN KEY (stagiaire_id) REFERENCES users(id)
      )
    `);

    // Table user_2fa - Authentification à deux facteurs
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_2fa (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_enabled BOOLEAN DEFAULT false,
        secret_key VARCHAR(255), 
        backup_codes TEXT[], 
        last_used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      )
    `);

    // Table user_2fa_codes - Codes temporaires pour 2FA par email
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_2fa_codes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code VARCHAR(6) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Créer tous les index nécessaires
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_stagiaire_id ON users(stagiaire_id);
      CREATE INDEX IF NOT EXISTS idx_channels_created_by ON channels(created_by);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON channel_subscriptions(user_id);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_channel ON channel_subscriptions(channel_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_channel ON streaming_sessions(channel_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_encadrements_formateur ON encadrements(formateur_id);
      CREATE INDEX IF NOT EXISTS idx_encadrements_stagiaire ON encadrements(stagiaire_id);
      CREATE INDEX IF NOT EXISTS idx_notes_formateur ON notes(formateur_id);
      CREATE INDEX IF NOT EXISTS idx_notes_stagiaire ON notes(stagiaire_id);
      CREATE INDEX IF NOT EXISTS idx_notes_combined ON notes(formateur_id, stagiaire_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_user_identifier ON notifications(user_identifier);
      CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
      CREATE INDEX IF NOT EXISTS idx_streams_replay_stagiaire ON streams_replay(stagiaire_id);
      CREATE INDEX IF NOT EXISTS idx_streams_replay_channel ON streams_replay(channel_id);
      CREATE INDEX IF NOT EXISTS idx_comments_formateur ON comments(formateur_id);
      CREATE INDEX IF NOT EXISTS idx_comments_stagiaire ON comments(stagiaire_id);
      CREATE INDEX IF NOT EXISTS idx_comments_replay ON comments(replay_id);
      CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_user_2fa_user_id ON user_2fa(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_2fa_codes_user_id ON user_2fa_codes(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_2fa_codes_code ON user_2fa_codes(code);
      CREATE INDEX IF NOT EXISTS idx_user_2fa_codes_expires ON user_2fa_codes(expires_at);
    `);

    // Créer un utilisateur admin par défaut
    const adminPassword = await require('bcryptjs').hash('admin123', 10);
    await client.query(`
      INSERT INTO users (nom, prenom, email, password, role, status, is_validated)
      VALUES ('Admin', 'System', 'admin@streaming.com', $1, 'admin', 'validated', true)
      ON CONFLICT (email) DO NOTHING
    `, [adminPassword]);

    // Créer aussi l'admin spécifié
    await client.query(`
      INSERT INTO users (nom, prenom, email, password, role, status, is_validated)
      VALUES ('William', 'NJ', 'njatomiarintsoawilliam@gmail.com', $1, 'admin', 'validated', true)
      ON CONFLICT (email) DO NOTHING
    `, [adminPassword]);

    console.log(' Tables créées avec succès!');
    console.log(' Comptes admin créés:');
    console.log('   - admin@streaming.com / admin123');
    console.log('   - njatomiarintsoawilliam@gmail.com / admin123');

  } catch (error) {
    console.error(' Erreur lors de la création des tables:', error);
    console.error(' Détail:', error.message);
  } finally {
    client.release();
    await appPool.end();
  }
}

// Exécuter l'initialisation
async function main() {
  console.log('===== DÉBUT INITIALISATION BASE DE DONNÉES =====');
  await initializeDatabase();
  await createTables();
  console.log('===== INITIALISATION TERMINÉE AVEC SUCCÈS =====');
  process.exit(0);
}

main().catch(error => {
  console.error(' Erreur fatale:', error);
  process.exit(1);
});