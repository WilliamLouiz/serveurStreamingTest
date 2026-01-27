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
    await client.query(`
      SELECT 'CREATE DATABASE ${process.env.PG_DATABASE}'
      WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${process.env.PG_DATABASE}')
    `);
    
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
  database: process.env.PG_DATABASE,
  port: process.env.PG_PORT || 5432,
});

async function createTables() {
  const client = await appPool.connect();
  try {
    console.log(' Création des tables...');
    
    // Table users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(100) NOT NULL,
        prenom VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'formateur', 'stagiaire')),
        is_validated BOOLEAN DEFAULT false,
        validation_token VARCHAR(255),
        token_expires_at TIMESTAMP,
        validated_at TIMESTAMP,
        validated_by INTEGER REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'validated', 'rejected', 'suspended')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

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

    // Insérer les templates d'email par défaut
    await client.query(`
      INSERT INTO email_templates (template_name, subject, html_content) 
      VALUES 
      (
        'account_validated',
        'Votre compte a été validé !',
        '<h1>Félicitations {{nom}} {{prenom}} !</h1>
        <p>Votre compte sur notre plateforme de streaming a été validé par l''administrateur.</p>
        <p>Vous pouvez maintenant vous connecter et accéder à toutes les fonctionnalités.</p>
        <p>Pour vous connecter, cliquez sur le lien suivant :</p>
        <p><a href="{{login_url}}">Se connecter</a></p>
        <p>Si vous n''avez pas créé de compte, veuillez ignorer cet email.</p>
        <br>
        <p>Cordialement,<br>L''équipe de la plateforme</p>'
      ),
      (
        'account_created',
        'Nouveau compte en attente de validation',
        '<h1>Nouvelle inscription</h1>
        <p>Un nouvel utilisateur s''est inscrit et attend votre validation :</p>
        <ul>
          <li><strong>Nom :</strong> {{nom}}</li>
          <li><strong>Prénom :</strong> {{prenom}}</li>
          <li><strong>Email :</strong> {{email}}</li>
          <li><strong>Rôle :</strong> {{role}}</li>
          <li><strong>Date d''inscription :</strong> {{created_at}}</li>
        </ul>
        <p>Pour valider ou rejeter ce compte, connectez-vous à l''administration.</p>
        <p><a href="{{admin_url}}">Accéder à l''administration</a></p>'
      ),
      (
        'account_rejected',
        'Votre compte a été rejeté',
        '<h1>Notification concernant votre compte</h1>
        <p>Bonjour {{nom}} {{prenom}},</p>
        <p>Votre demande de création de compte sur notre plateforme de streaming a été rejetée.</p>
        <p>Raison : {{rejection_reason}}</p>
        <p>Si vous pensez qu''il s''agit d''une erreur, veuillez contacter l''administrateur.</p>
        <br>
        <p>Cordialement,<br>L''équipe de la plateforme</p>'
      )
      ON CONFLICT (template_name) DO NOTHING
    `);
    
    // Créer un index pour améliorer les performances
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_channels_created_by ON channels(created_by);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON channel_subscriptions(user_id);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_channel ON channel_subscriptions(channel_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_channel ON streaming_sessions(channel_id);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
    `);

    // Créer un utilisateur admin par défaut
    const adminPassword = await require('bcryptjs').hash('admin123', 10);
    await client.query(`
      INSERT INTO users (nom, prenom, email, password, role)
      VALUES ('William', 'NJ', 'njatomiarintsoawilliam@gmail.com', $1, 'admin')
      ON CONFLICT (email) DO NOTHING
    `, [adminPassword]);
    
    console.log(' Tables créées avec succès!');
    console.log(' Compte admin créé: njatomiarintsoawilliam@gmail.com / admin123');
    
  } catch (error) {
    console.error(' Erreur lors de la création des tables:', error);
  } finally {
    client.release();
    await appPool.end();
  }
}

// Exécuter l'initialisation
async function main() {
  await initializeDatabase();
  await createTables();
  console.log(' Initialisation terminée!');
  process.exit(0);
}

main().catch(console.error);