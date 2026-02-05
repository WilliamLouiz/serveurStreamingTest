const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ROLES, ACCOUNT_STATUS } = require('../config/constants');

class User {

  // Méthode pour générer un ID stagiaire unique
  static async generateStagiaireId() {
    const prefix = 'VR';
    const randomNumber = Math.floor(1000 + Math.random() * 9000); // 4 chiffres
    const id = `${prefix}${randomNumber}`;

    // Vérifier si l'ID existe déjà
    const result = await pool.query(
      'SELECT id FROM users WHERE stagiaire_id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return id;
    } else {
      // Si l'ID existe, régénérer
      return await this.generateStagiaireId();
    }
  }

  static async create(userData) {
    const { nom, prenom, email, password, role } = userData;
    const hashedPassword = await bcrypt.hash(password, 10);

    // Déterminer si le compte doit être validé automatiquement
    const isAdmin = role === ROLES.ADMIN;
    const isFormateur = role === ROLES.FORMATEUR;
    const isStagiaire = role === ROLES.STAGIAIRE;
    const is_validated = isAdmin; // Admin est validé automatiquement

    // Générer un identifiant pour les stagiaires
    let stagiaire_id = null;
    if (isStagiaire) {
      stagiaire_id = await this.generateStagiaireId();
    }

    // Générer un token de validation si pas admin
    let validation_token = null;
    let token_expires_at = null;

    if (!isAdmin) {
      validation_token = jwt.sign(
        { email, type: 'validation' },
        process.env.VERIFICATION_SECRET || process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );
      token_expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    }

    const result = await pool.query(
      `INSERT INTO users 
       (nom, prenom, email, password, role, stagiaire_id, is_validated, validation_token, token_expires_at, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING id, is_validated, validation_token, stagiaire_id`,
      [
        nom,
        prenom,
        email,
        hashedPassword,
        role,
        stagiaire_id,
        is_validated,
        validation_token,
        token_expires_at,
        isAdmin ? ACCOUNT_STATUS.VALIDATED : ACCOUNT_STATUS.PENDING
      ]
    );

    return result.rows[0];
  }

  // Méthode pour trouver un stagiaire par son identifiant
  static async findByStagiaireId(stagiaireId) {
    const result = await pool.query(
      `SELECT id, nom, prenom, email, role, is_validated, status, 
              validated_at, created_at, stagiaire_id
       FROM users 
       WHERE stagiaire_id = $1 AND role = 'stagiaire'`,
      [stagiaireId]
    );
    return result.rows[0];
  }

  static async findByEmail(email) {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(
      `SELECT id, nom, prenom, email, password, role, is_validated, status, 
            validated_at, created_at, validation_token, token_expires_at
     FROM users WHERE id = $1`,
      [id]
    );
    return result.rows[0];
  }

  static async update(id, userData) {
    const { nom, prenom, email, role, is_validated, status } = userData;

    const query = `
      UPDATE users 
      SET nom = $1, prenom = $2, email = $3, role = $4, 
          is_validated = COALESCE($5, is_validated),
          status = COALESCE($6, status),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $7 
      RETURNING id`;

    const result = await pool.query(query, [
      nom, prenom, email, role, is_validated, status, id
    ]);

    return result.rows.length > 0;
  }

  static async validateAccount(userId, validatedBy = null) {
    const result = await pool.query(
      `UPDATE users 
       SET is_validated = true, 
           status = 'validated',
           validated_at = CURRENT_TIMESTAMP,
           validated_by = $2,
           validation_token = NULL,
           token_expires_at = NULL
       WHERE id = $1 
       RETURNING id, email, nom, prenom, role`,
      [userId, validatedBy]
    );

    return result.rows[0];
  }

  static async rejectAccount(userId, reason, rejectedBy = null) {
    const result = await pool.query(
      `UPDATE users 
       SET is_validated = false, 
           status = 'rejected',
           validation_token = NULL,
           token_expires_at = NULL
       WHERE id = $1 
       RETURNING id, email, nom, prenom`,
      [userId]
    );

    // Vous pouvez stocker la raison dans une table séparée si besoin
    return result.rows[0];
  }

  static async findByValidationToken(token) {
    const result = await pool.query(
      `SELECT id, email, nom, prenom, role, token_expires_at 
       FROM users 
       WHERE validation_token = $1 AND token_expires_at > NOW()`,
      [token]
    );
    return result.rows[0];
  }

  static async markTokenAsUsed(token) {
    await pool.query(
      `UPDATE users 
       SET validation_token = NULL, token_expires_at = NULL 
       WHERE validation_token = $1`,
      [token]
    );
  }

  static async getPendingAccounts() {
    const result = await pool.query(
      `SELECT id, nom, prenom, email, role, created_at 
       FROM users 
       WHERE status = 'pending' AND role != 'admin'
       ORDER BY created_at DESC`
    );
    return result.rows;
  }

  static async getValidatedAccounts() {
    const result = await pool.query(
      `SELECT id, nom, prenom, email, role, validated_at, created_at 
       FROM users 
       WHERE status = 'validated' AND is_validated = true
       ORDER BY validated_at DESC`
    );
    return result.rows;
  }

  static async delete(id) {
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [id]
    );
    return result.rows.length > 0;
  }

  static async getAllStagiaire() {
    const result = await pool.query(
      `SELECT id, nom, prenom, email, stagiaire_id, role, is_validated, status, 
              validated_at, created_at 
       FROM users 
       WHERE role = 'stagiaire'
       ORDER BY created_at DESC`
    );
    return result.rows;
  }

  static async getAllFormateur() {
    const result = await pool.query(
      `SELECT id, nom, prenom, email, role, is_validated, status, 
              validated_at, created_at 
       FROM users 
       WHERE role = 'formateur'
       ORDER BY created_at DESC`
    );
    return result.rows;
  }

  static async comparePassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }

  static async search(query, limit = 10) {
    const result = await pool.query(
      `SELECT id, nom, prenom, email, role, is_validated, status, created_at 
       FROM users 
       WHERE (nom ILIKE $1 OR prenom ILIKE $1 OR email ILIKE $1) 
         AND role != 'admin'
       ORDER BY created_at DESC 
       LIMIT $2`,
      [`%${query}%`, limit]
    );
    return result.rows;
  }

  static async countByStatus() {
    const result = await pool.query(`
      SELECT 
        status,
        COUNT(*) as count
      FROM users 
      WHERE role != 'admin'
      GROUP BY status
    `);
    return result.rows;
  }

  static async findByResetToken(tokenHash) {
    const result = await pool.query(
      `SELECT id, email, nom, prenom, reset_password_expires 
       FROM users 
       WHERE reset_password_token = $1 AND reset_password_expires > NOW()`,
      [tokenHash]
    );
    return result.rows[0];
  }

  // Méthode pour mettre à jour le token de réinitialisation
  static async updateResetToken(userId, tokenHash, expiresAt) {
    const result = await pool.query(
      `UPDATE users 
       SET reset_password_token = $1, 
           reset_password_expires = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 
       RETURNING id, email, nom, prenom`,
      [tokenHash, expiresAt, userId]
    );
    return result.rows[0];
  }

  //méthode pour trouver un utilisateur par token de réinitialisation
  static async findByResetToken(tokenHash) {
    const result = await pool.query(
      `SELECT id, email, nom, prenom, reset_password_expires 
     FROM users 
     WHERE reset_password_token = $1 AND reset_password_expires > NOW()`,
      [tokenHash]
    );
    return result.rows[0];
  }

  // Méthode pour mettre à jour le token de réinitialisation
  static async updateResetToken(userId, tokenHash, expiresAt) {
    const result = await pool.query(
      `UPDATE users 
     SET reset_password_token = $1, 
         reset_password_expires = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $3 
     RETURNING id, email, nom, prenom`,
      [tokenHash, expiresAt, userId]
    );
    return result.rows[0];
  }

  // Méthode pour réinitialiser le mot de passe
  static async resetPassword(userId, newPassword) {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const result = await pool.query(
      `UPDATE users 
     SET password = $1, 
         reset_password_token = NULL,
         reset_password_expires = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 
     RETURNING id, email, nom, prenom`,
      [hashedPassword, userId]
    );
    return result.rows[0];
  }

  // Méthode pour vérifier si l'email existe
  static async emailExists(email) {
    const result = await pool.query(
      'SELECT id, email, nom, prenom FROM users WHERE email = $1',
      [email]
    );
    return result.rows[0];
  }

}

module.exports = User;