const pool = require('../config/database');

class Session {
  static async create(userId, token, expiresAt) {
    const result = await pool.query(
      `INSERT INTO user_sessions (user_id, token, expires_at) 
       VALUES ($1, $2, $3) 
       RETURNING id`,
      [userId, token, expiresAt]
    );
    return result.rows[0].id;
  }

  static async findByToken(token) {
    const result = await pool.query(
      `SELECT us.*, u.email, u.role 
       FROM user_sessions us 
       JOIN users u ON us.user_id = u.id 
       WHERE us.token = $1 AND us.is_active = true AND us.expires_at > NOW()`,
      [token]
    );
    return result.rows[0];
  }

  static async deactivate(token) {
    const result = await pool.query(
      'UPDATE user_sessions SET is_active = false WHERE token = $1 RETURNING id',
      [token]
    );
    return result.rows.length > 0;
  }

  static async deactivateAllUserSessions(userId) {
      const result = await pool.query(
      `UPDATE user_sessions 
       SET is_active = false 
       WHERE user_id = $1 AND is_active = true`,
      [userId]
    );
    
    // Retourne le nombre de sessions désactivées
    return result.rowCount;
  }

  static async cleanupExpired() {
    const result = await pool.query(
      `DELETE FROM user_sessions 
       WHERE expires_at < NOW() - INTERVAL '7 days'`,
    );
    return result.rowCount;
  }
}

module.exports = Session;