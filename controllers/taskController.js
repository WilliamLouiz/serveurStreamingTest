const Task = require('../models/Task');
const TaskEvaluation = require('../models/TaskEvaluation');
const pool = require('../config/database');
const { createNotification } = require('../services/notificationService');

// Gestion des tâches (admin uniquement)
const taskController = {
  // Récupérer toutes les tâches
  async getAllTasks(req, res) {
    try {
      const tasks = await Task.getAll();
      res.json({
        success: true,
        tasks
      });
    } catch (error) {
      console.error('Erreur récupération tâches:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Récupérer les tâches actives
  async getActiveTasks(req, res) {
    try {
      const tasks = await Task.getAllActive();
      res.json({
        success: true,
        tasks
      });
    } catch (error) {
      console.error('Erreur récupération tâches actives:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Récupérer une tâche par ID
  async getTaskById(req, res) {
    try {
      const { id } = req.params;
      const task = await Task.getById(id);

      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Tâche non trouvée'
        });
      }

      res.json({
        success: true,
        task
      });
    } catch (error) {
      console.error('Erreur récupération tâche:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Créer une tâche
  async createTask(req, res) {
    try {
      const { title, description, max_score } = req.body;
      const userId = req.user.id;

      // Validation améliorée
      if (!title) {
        return res.status(400).json({
          success: false,
          error: 'Le titre est requis'
        });
      }

      // Nettoyer le titre (enlever les espaces au début/fin)
      const cleanedTitle = title.trim();

      if (cleanedTitle.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Le titre ne peut pas être vide'
        });
      }

      if (cleanedTitle.length < 2) { // Passer à 2 caractères minimum
        return res.status(400).json({
          success: false,
          error: 'Le titre doit contenir au moins 2 caractères'
        });
      }

      const task = await Task.create({
        title: cleanedTitle,
        description: description ? description.trim() : null,
        max_score: max_score || 5
      }, userId);

      // Notifier les formateurs
      const formateurs = await pool.query(
        'SELECT id FROM users WHERE role = $1 AND status = $2',
        ['formateur', 'validated']
      );

      for (const formateur of formateurs.rows) {
        await createNotification({
          user_id: formateur.id,
          titre: 'Nouvelle tâche d\'évaluation',
          description: `Une nouvelle tâche "${title}" a été créée pour évaluer les stagiaires`,
          type: 'task_created',
          metadata: { task_id: task.id }
        });
      }

      res.status(201).json({
        success: true,
        message: 'Tâche créée avec succès',
        task
      });
    } catch (error) {
      console.error('Erreur création tâche:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Mettre à jour une tâche
  async updateTask(req, res) {
    try {
      const { id } = req.params;
      const { title, description, max_score, is_active } = req.body;
      const userId = req.user.id;

      const task = await Task.update(id, { title, description, max_score, is_active }, userId);

      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Tâche non trouvée'
        });
      }

      res.json({
        success: true,
        message: 'Tâche mise à jour avec succès',
        task
      });
    } catch (error) {
      console.error('Erreur mise à jour tâche:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Supprimer une tâche (soft delete)
  async deleteTask(req, res) {
    try {
      const { id } = req.params;

      const task = await Task.delete(id);

      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Tâche non trouvée'
        });
      }

      res.json({
        success: true,
        message: 'Tâche désactivée avec succès'
      });
    } catch (error) {
      console.error('Erreur suppression tâche:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Supprimer définitivement une tâche
  async hardDeleteTask(req, res) {
    try {
      const { id } = req.params;

      // Vérifier si des évaluations existent
      const evaluations = await pool.query(
        'SELECT id FROM task_evaluations WHERE task_id = $1 LIMIT 1',
        [id]
      );

      if (evaluations.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Impossible de supprimer cette tâche car des évaluations existent'
        });
      }

      const task = await Task.hardDelete(id);

      if (!task) {
        return res.status(404).json({
          success: false,
          error: 'Tâche non trouvée'
        });
      }

      res.json({
        success: true,
        message: 'Tâche supprimée définitivement'
      });
    } catch (error) {
      console.error('Erreur suppression définitive tâche:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Évaluations (formateurs)
  async evaluateTask(req, res) {
    try {
      const { task_id, stagiaire_id, replay_id, score, comment } = req.body;
      const formateur_id = req.user.id;

      // Validations
      if (!task_id || !stagiaire_id || !replay_id || !score) {
        return res.status(400).json({
          success: false,
          error: 'Tous les champs requis doivent être fournis'
        });
      }

      if (score < 1 || score > 5) {
        return res.status(400).json({
          success: false,
          error: 'La note doit être entre 1 et 5'
        });
      }

      // Vérifier que le formateur encadre ce stagiaire
      const encadrement = await pool.query(
        `SELECT id FROM encadrements 
         WHERE formateur_id = $1 AND stagiaire_id = $2`,
        [formateur_id, stagiaire_id]
      );

      if (encadrement.rows.length === 0) {
        return res.status(403).json({
          success: false,
          error: 'Vous ne pouvez évaluer que vos stagiaires encadrés'
        });
      }

      // Vérifier que le replay appartient bien au stagiaire
      const replayCheck = await pool.query(
        `SELECT id FROM streams_replay 
         WHERE id = $1 AND user_id = $2`,
        [replay_id, stagiaire_id]
      );

      if (replayCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Ce replay n\'appartient pas à ce stagiaire'
        });
      }

      // Créer ou mettre à jour l'évaluation
      const evaluation = await TaskEvaluation.upsert({
        task_id,
        formateur_id,
        stagiaire_id,
        replay_id,
        score,
        comment
      });

      // Vérifier si toutes les tâches sont évaluées
      const completionStatus = await TaskEvaluation.getCompletionStatus(
        replay_id, formateur_id, stagiaire_id
      );

      // Si toutes les tâches sont évaluées, calculer la moyenne et mettre à jour la note du replay
      if (completionStatus.is_complete) {
        const average = await TaskEvaluation.calculateAverageForReplay(replay_id);

        if (average) {
          // Mettre à jour la note du replay
          await pool.query(
            'UPDATE streams_replay SET note = $1 WHERE id = $2',
            [average.average_on_20, replay_id]
          );

          // Notifier le stagiaire
          await createNotification({
            user_id: stagiaire_id,
            titre: 'Évaluation complète',
            description: `Toutes les tâches ont été évaluées pour votre replay. Note moyenne: ${average.average_on_20}/20`,
            type: 'evaluation_complete',
            metadata: { replay_id, average: average.average_on_20 }
          });
        }
      }

      res.json({
        success: true,
        message: 'Évaluation enregistrée avec succès',
        evaluation,
        completion_status: completionStatus
      });

    } catch (error) {
      console.error('Erreur évaluation tâche:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Récupérer les évaluations pour un replay
  async getEvaluationsByReplay(req, res) {
    try {
      const { replayId } = req.params;
      const user = req.user;

      // Vérifier les droits d'accès
      const replay = await pool.query(
        `SELECT sr.*, u.id as stagiaire_user_id 
         FROM streams_replay sr
         JOIN users u ON sr.user_id = u.id
         WHERE sr.id = $1`,
        [replayId]
      );

      if (replay.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Replay non trouvé'
        });
      }

      const replayData = replay.rows[0];

      // Vérifier les permissions
      if (user.role === 'stagiaire' && user.id !== replayData.user_id) {
        return res.status(403).json({
          success: false,
          error: 'Accès non autorisé'
        });
      }

      let formateurId = null;
      if (user.role === 'formateur') {
        formateurId = user.id;
      }

      const evaluations = await TaskEvaluation.getByReplay(replayId, formateurId);
      const average = await TaskEvaluation.calculateAverageForReplay(replayId);

      res.json({
        success: true,
        evaluations,
        average,
        replay_info: {
          id: replayData.id,
          stagiaire_id: replayData.stagiaire_id,
          created_at: replayData.created_at
        }
      });

    } catch (error) {
      console.error('Erreur récupération évaluations:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Récupérer les évaluations pour un stagiaire
  async getEvaluationsByStagiaire(req, res) {
    try {
      const { stagiaireId } = req.params;
      const user = req.user;

      // Vérifier les droits d'accès
      if (user.role === 'stagiaire' && user.id !== parseInt(stagiaireId)) {
        return res.status(403).json({
          success: false,
          error: 'Accès non autorisé'
        });
      }

      let formateurId = null;
      if (user.role === 'formateur') {
        formateurId = user.id;
      }

      const evaluations = await TaskEvaluation.getByStagiaire(stagiaireId, formateurId);

      // Grouper par replay
      const byReplay = evaluations.reduce((acc, eval) => {
        if (!acc[eval.replay_id]) {
          acc[eval.replay_id] = {
            replay_id: eval.replay_id,
            replay_date: eval.replay_date,
            file_path: eval.file_path,
            evaluations: [],
            average: null
          };
        }
        acc[eval.replay_id].evaluations.push(eval);
        return acc;
      }, {});

      // Calculer les moyennes pour chaque replay
      for (const replayId in byReplay) {
        const average = await TaskEvaluation.calculateAverageForReplay(replayId);
        byReplay[replayId].average = average;
      }

      res.json({
        success: true,
        evaluations_by_replay: Object.values(byReplay),
        total_evaluations: evaluations.length
      });

    } catch (error) {
      console.error('Erreur récupération évaluations stagiaire:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Supprimer une évaluation
  async deleteEvaluation(req, res) {
    try {
      const { id } = req.params;
      const formateurId = req.user.id;

      const deleted = await TaskEvaluation.delete(id, formateurId);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Évaluation non trouvée ou vous n\'êtes pas autorisé à la supprimer'
        });
      }

      res.json({
        success: true,
        message: 'Évaluation supprimée avec succès'
      });

    } catch (error) {
      console.error('Erreur suppression évaluation:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },

  // Obtenir le statut d'évaluation pour un replay
  async getEvaluationStatus(req, res) {
    try {
      const { replayId, stagiaireId } = req.params;
      const formateurId = req.user.id;

      const status = await TaskEvaluation.getCompletionStatus(
        replayId, formateurId, stagiaireId
      );

      // Récupérer les tâches non évaluées
      if (!status.is_complete) {
        const unevaluatedTasks = await pool.query(`
          SELECT t.*
          FROM tasks t
          WHERE t.is_active = true
            AND t.id NOT IN (
              SELECT task_id 
              FROM task_evaluations 
              WHERE replay_id = $1 AND formateur_id = $2 AND stagiaire_id = $3
            )
          ORDER BY t.title
        `, [replayId, formateurId, stagiaireId]);

        status.unevaluated_tasks = unevaluatedTasks.rows;
      }

      res.json({
        success: true,
        status
      });

    } catch (error) {
      console.error('Erreur récupération statut évaluation:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
};

module.exports = taskController;