const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.PG_HOST,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  port: process.env.PG_PORT || 5432,
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20, // Nombre maximum de connexions dans le pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test de la connexion
pool.connect((err, client, release) => {
  if (err) {
    console.error(' Erreur de connexion à PostgreSQL:', err.message);
  } else {
    console.log('Connecté à PostgreSQL');
    release();
  }
});

// Gestion des erreurs
pool.on('error', (err) => {
  console.error(' Erreur PostgreSQL:', err.message);
});

module.exports = pool;