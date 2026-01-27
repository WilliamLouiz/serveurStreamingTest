const pool = require('../config/database');

class Channel {
  static async create(channelData) {
    const { name, description, created_by } = channelData;
    
    const result = await pool.query(
      'INSERT INTO channels (name, description, created_by) VALUES ($1, $2, $3) RETURNING id',
      [name, description, created_by]
    );
    
    return result.rows[0].id;
  }

  static async findById(id) {
    const result = await pool.query(
      `SELECT c.*, u.nom, u.prenom 
       FROM channels c 
       LEFT JOIN users u ON c.created_by = u.id 
       WHERE c.id = $1`,
      [id]
    );
    return result.rows[0];
  }

  static async getAll() {
    const result = await pool.query(
      `SELECT c.*, u.nom, u.prenom, 
              (SELECT COUNT(*) FROM channel_subscriptions WHERE channel_id = c.id) as subscribers_count
       FROM channels c 
       LEFT JOIN users u ON c.created_by = u.id 
       ORDER BY c.created_at DESC`
    );
    return result.rows;
  }

  static async update(id, channelData) {
    const { name, description } = channelData;
    const result = await pool.query(
      `UPDATE channels 
       SET name = $1, description = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $3 
       RETURNING id`,
      [name, description, id]
    );
    return result.rows.length > 0;
  }

  static async delete(id) {
    const result = await pool.query(
      'DELETE FROM channels WHERE id = $1 RETURNING id',
      [id]
    );
    return result.rows.length > 0;
  }

  static async subscribe(userId, channelId) {
    try {
      const result = await pool.query(
        `INSERT INTO channel_subscriptions (user_id, channel_id) 
         VALUES ($1, $2) 
         ON CONFLICT (user_id, channel_id) DO NOTHING 
         RETURNING id`,
        [userId, channelId]
      );
      return result.rows[0]?.id;
    } catch (error) {
      console.error('Error subscribing:', error);
      throw error;
    }
  }

  static async unsubscribe(userId, channelId) {
    const result = await pool.query(
      'DELETE FROM channel_subscriptions WHERE user_id = $1 AND channel_id = $2 RETURNING id',
      [userId, channelId]
    );
    return result.rows.length > 0;
  }

  static async getUserSubscriptions(userId) {
    const result = await pool.query(
      `SELECT c.*, u.nom, u.prenom 
       FROM channels c 
       LEFT JOIN users u ON c.created_by = u.id 
       WHERE c.id IN (SELECT channel_id FROM channel_subscriptions WHERE user_id = $1)`,
      [userId]
    );
    return result.rows;
  }

  static async isSubscribed(userId, channelId) {
    const result = await pool.query(
      'SELECT id FROM channel_subscriptions WHERE user_id = $1 AND channel_id = $2',
      [userId, channelId]
    );
    return result.rows.length > 0;
  }

  static async getPopularChannels(limit = 10) {
    const result = await pool.query(
      `SELECT c.*, u.nom, u.prenom, 
              COUNT(cs.id) as subscribers_count
       FROM channels c 
       LEFT JOIN users u ON c.created_by = u.id 
       LEFT JOIN channel_subscriptions cs ON c.id = cs.channel_id
       GROUP BY c.id, u.id
       ORDER BY subscribers_count DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }
}

module.exports = Channel;