const pool = require('../config/database');

class Task {
  // Récupérer toutes les tâches actives
  static async getAllActive() {
    const result = await pool.query(`
      SELECT 
        t.*,
        u.nom as creator_nom,
        u.prenom as creator_prenom
      FROM tasks t
      LEFT JOIN users u ON t.created_by = u.id
      WHERE t.is_active = true
      ORDER BY t.created_at DESC
    `);
    return result.rows;
  }

  // Récupérer toutes les tâches (admin)
  static async getAll() {
    const result = await pool.query(`
      SELECT 
        t.*,
        u1.nom as creator_nom,
        u1.prenom as creator_prenom,
        u2.nom as updater_nom,
        u2.prenom as updater_prenom
      FROM tasks t
      LEFT JOIN users u1 ON t.created_by = u1.id
      LEFT JOIN users u2 ON t.updated_by = u2.id
      ORDER BY t.created_at DESC
    `);
    return result.rows;
  }

  // Récupérer une tâche par ID
  static async getById(id) {
    const result = await pool.query(`
      SELECT 
        t.*,
        u.nom as creator_nom,
        u.prenom as creator_prenom
      FROM tasks t
      LEFT JOIN users u ON t.created_by = u.id
      WHERE t.id = $1
    `, [id]);
    return result.rows[0];
  }

  // Créer une tâche
  static async create(taskData, userId) {
    const { title, description, max_score = 5 } = taskData;
    
    const result = await pool.query(`
      INSERT INTO tasks (title, description, max_score, created_by)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [title, description, max_score, userId]);
    
    return result.rows[0];
  }

  // Mettre à jour une tâche
  static async update(id, taskData, userId) {
    const { title, description, max_score, is_active } = taskData;
    
    const result = await pool.query(`
      UPDATE tasks 
      SET title = COALESCE($1, title),
          description = COALESCE($2, description),
          max_score = COALESCE($3, max_score),
          is_active = COALESCE($4, is_active),
          updated_at = CURRENT_TIMESTAMP,
          updated_by = $5
      WHERE id = $6
      RETURNING *
    `, [title, description, max_score, is_active, userId, id]);
    
    return result.rows[0];
  }

  // Supprimer une tâche (soft delete)
  static async delete(id) {
    const result = await pool.query(`
      UPDATE tasks 
      SET is_active = false 
      WHERE id = $1 
      RETURNING id
    `, [id]);
    return result.rows[0];
  }

  // Supprimer définitivement une tâche (hard delete)
  static async hardDelete(id) {
    const result = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING id', [id]);
    return result.rows[0];
  }

  // Compter le nombre de tâches actives
  static async countActive() {
    const result = await pool.query('SELECT COUNT(*) FROM tasks WHERE is_active = true');
    return parseInt(result.rows[0].count);
  }
}

module.exports = Task;