const pool = require('../config/database');

class TaskEvaluation {
  // Créer ou mettre à jour une évaluation
  static async upsert(evaluationData) {
    const { task_id, formateur_id, stagiaire_id, replay_id, score, comment } = evaluationData;
    
    const result = await pool.query(`
      INSERT INTO task_evaluations (task_id, formateur_id, stagiaire_id, replay_id, score, comment)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (task_id, stagiaire_id, replay_id) 
      DO UPDATE SET 
        score = EXCLUDED.score,
        comment = EXCLUDED.comment,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [task_id, formateur_id, stagiaire_id, replay_id, score, comment]);
    
    return result.rows[0];
  }

  // Récupérer les évaluations pour un replay
  static async getByReplay(replayId, formateurId = null) {
    let query = `
      SELECT 
        te.*,
        t.title as task_title,
        t.description as task_description,
        t.max_score,
        u.nom as formateur_nom,
        u.prenom as formateur_prenom
      FROM task_evaluations te
      JOIN tasks t ON te.task_id = t.id
      JOIN users u ON te.formateur_id = u.id
      WHERE te.replay_id = $1
    `;
    
    const params = [replayId];
    
    if (formateurId) {
      query += ` AND te.formateur_id = $2`;
      params.push(formateurId);
    }
    
    query += ` ORDER BY t.title`;
    
    const result = await pool.query(query, params);
    return result.rows;
  }

  // Récupérer les évaluations pour un stagiaire
  static async getByStagiaire(stagiaireId, formateurId = null) {
    let query = `
      SELECT 
        te.*,
        t.title as task_title,
        t.description as task_description,
        t.max_score,
        sr.file_path,
        sr.created_at as replay_date,
        u.nom as formateur_nom,
        u.prenom as formateur_prenom
      FROM task_evaluations te
      JOIN tasks t ON te.task_id = t.id
      JOIN streams_replay sr ON te.replay_id = sr.id
      JOIN users u ON te.formateur_id = u.id
      WHERE te.stagiaire_id = $1
    `;
    
    const params = [stagiaireId];
    
    if (formateurId) {
      query += ` AND te.formateur_id = $2`;
      params.push(formateurId);
    }
    
    query += ` ORDER BY sr.created_at DESC, t.title`;
    
    const result = await pool.query(query, params);
    return result.rows;
  }

  // Calculer la moyenne des notes pour un replay (sur 20)
  static async calculateAverageForReplay(replayId) {
    const tasksCount = await pool.query('SELECT COUNT(*) FROM tasks WHERE is_active = true');
    const nbTasks = parseInt(tasksCount.rows[0].count);
    
    if (nbTasks === 0) return null;
    
    const result = await pool.query(`
      SELECT 
        COALESCE(SUM(score), 0) as total_score,
        COUNT(*) as evaluated_tasks
      FROM task_evaluations
      WHERE replay_id = $1
    `, [replayId]);
    
    const totalScore = parseInt(result.rows[0].total_score);
    const evaluatedTasks = parseInt(result.rows[0].evaluated_tasks);
    
    if (evaluatedTasks === 0) return null;
    
    // Calcul proportionnel : (somme des scores / (nbTasks * 5)) * 20
    const maxPossibleTotal = nbTasks * 5;
    const averageOn20 = (totalScore / maxPossibleTotal) * 20;
    
    return {
      average_on_20: Math.round(averageOn20 * 10) / 10,
      evaluated_tasks: evaluatedTasks,
      total_tasks: nbTasks,
      completion_percentage: Math.round((evaluatedTasks / nbTasks) * 100)
    };
  }

  // Supprimer une évaluation
  static async delete(id, formateurId) {
    const result = await pool.query(
      'DELETE FROM task_evaluations WHERE id = $1 AND formateur_id = $2 RETURNING id',
      [id, formateurId]
    );
    return result.rows[0];
  }

  // Vérifier si un formateur a déjà évalué toutes les tâches pour un replay
  static async getCompletionStatus(replayId, formateurId, stagiaireId) {
    const tasksResult = await pool.query(
      'SELECT COUNT(*) FROM tasks WHERE is_active = true'
    );
    const totalTasks = parseInt(tasksResult.rows[0].count);
    
    const evaluatedResult = await pool.query(`
      SELECT COUNT(*) 
      FROM task_evaluations 
      WHERE replay_id = $1 AND formateur_id = $2 AND stagiaire_id = $3
    `, [replayId, formateurId, stagiaireId]);
    
    const evaluatedTasks = parseInt(evaluatedResult.rows[0].count);
    
    return {
      total_tasks: totalTasks,
      evaluated_tasks: evaluatedTasks,
      is_complete: evaluatedTasks >= totalTasks,
      remaining_tasks: totalTasks - evaluatedTasks
    };
  }
}

module.exports = TaskEvaluation;