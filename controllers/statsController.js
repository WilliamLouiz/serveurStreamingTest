const pool = require('../config/database');

class StatsController {
  constructor() {
    this.getAdminStats = this.getAdminStats.bind(this);
  }
  /**
   * Récupérer toutes les statistiques pour le dashboard admin
   */
  async getAdminStats(req, res) {
    try {
      // Statistiques générales
      const totalStats = await this.getTotalStats();
      
      // Statistiques des 6 derniers jours
      const dailyStats = await this.getDailyStats(6);
      
      // Taux de validation des utilisateurs
      const validationRates = await this.getValidationRates();
      
      // Taux d'encadrement et notation
      const rates = await this.getRates();
      
      // Répartition des certificats
      const certificatStats = await this.getCertificatStats();

      res.json({
        success: true,
        data: {
          totals: totalStats,
          daily: dailyStats,
          validation_rates: validationRates,
          rates: rates,
          certificats: certificatStats
        }
      });

    } catch (error) {
      console.error('Erreur récupération stats:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Statistiques totales
   */
  async getTotalStats() {
    // Total formateurs
    const formateurs = await pool.query(
      `SELECT COUNT(*) as total FROM users WHERE role = 'formateur'`
    );

    // Total stagiaires
    const stagiaires = await pool.query(
      `SELECT COUNT(*) as total FROM users WHERE role = 'stagiaire'`
    );

    // Stagiaires encadrés (avec formateur assigné)
    const stagiairesEncadres = await pool.query(
      `SELECT COUNT(DISTINCT stagiaire_id) as total FROM encadrements`
    );

    // Stagiaires sans formateur
    const stagiairesSansFormateur = await pool.query(
      `SELECT COUNT(*) as total FROM users u 
       WHERE u.role = 'stagiaire' 
       AND NOT EXISTS (SELECT 1 FROM encadrements e WHERE e.stagiaire_id = u.id)`
    );

    // Replays notés (avec note non nulle)
    const replaysNotes = await pool.query(
      `SELECT COUNT(*) as total FROM streams_replay WHERE note IS NOT NULL`
    );

    // Total replays
    const totalReplays = await pool.query(
      `SELECT COUNT(*) as total FROM streams_replay`
    );

    // Replays certifiés
    const replaysCertifies = await pool.query(
      `SELECT COUNT(*) as total FROM streams_replay WHERE certificat_valide = true`
    );

    return {
      formateurs: parseInt(formateurs.rows[0].total),
      stagiaires: parseInt(stagiaires.rows[0].total),
      stagiaires_encadres: parseInt(stagiairesEncadres.rows[0].total),
      stagiaires_sans_formateur: parseInt(stagiairesSansFormateur.rows[0].total),
      replays_notes: parseInt(replaysNotes.rows[0].total),
      total_replays: parseInt(totalReplays.rows[0].total),
      replays_certifies: parseInt(replaysCertifies.rows[0].total)
    };
  }

  /**
   * Statistiques quotidiennes (derniers jours)
   */
  async getDailyStats(days = 6) {
    const result = await pool.query(`
      WITH dates AS (
        SELECT generate_series(
          CURRENT_DATE - ($1::int - 1),
          CURRENT_DATE,
          '1 day'::interval
        )::date as date
      )
      SELECT 
        d.date,
        COALESCE(COUNT(DISTINCT u.id), 0) as new_users,
        COALESCE(COUNT(DISTINCT CASE WHEN u.role = 'stagiaire' THEN u.id END), 0) as new_stagiaires,
        COALESCE(COUNT(DISTINCT CASE WHEN u.role = 'formateur' THEN u.id END), 0) as new_formateurs,
        COALESCE(COUNT(DISTINCT sr.id), 0) as new_replays
      FROM dates d
      LEFT JOIN users u ON DATE(u.created_at) = d.date
      LEFT JOIN streams_replay sr ON DATE(sr.created_at) = d.date
      GROUP BY d.date
      ORDER BY d.date ASC
    `, [days]);

    return result.rows.map(row => ({
      date: row.date,
      jour: new Date(row.date).toLocaleDateString('fr-FR', { weekday: 'short' }),
      new_users: parseInt(row.new_users),
      new_stagiaires: parseInt(row.new_stagiaires),
      new_formateurs: parseInt(row.new_formateurs),
      new_replays: parseInt(row.new_replays),
      total_utilisateurs: parseInt(row.new_users)
    }));
  }

  /**
   * Taux de validation des utilisateurs
   */
  async getValidationRates() {
    // Formateurs validés
    const formateursValides = await pool.query(
      `SELECT COUNT(*) as total FROM users 
       WHERE role = 'formateur' AND status = 'validated'`
    );

    // Formateurs en attente
    const formateursEnAttente = await pool.query(
      `SELECT COUNT(*) as total FROM users 
       WHERE role = 'formateur' AND status = 'pending'`
    );

    // Formateurs rejetés/suspendus
    const formateursRejetes = await pool.query(
      `SELECT COUNT(*) as total FROM users 
       WHERE role = 'formateur' AND status IN ('rejected', 'suspended')`
    );

    // Stagiaires validés
    const stagiairesValides = await pool.query(
      `SELECT COUNT(*) as total FROM users 
       WHERE role = 'stagiaire' AND status = 'validated'`
    );

    // Stagiaires en attente
    const stagiairesEnAttente = await pool.query(
      `SELECT COUNT(*) as total FROM users 
       WHERE role = 'stagiaire' AND status = 'pending'`
    );

    // Stagiaires rejetés/suspendus
    const stagiairesRejetes = await pool.query(
      `SELECT COUNT(*) as total FROM users 
       WHERE role = 'stagiaire' AND status IN ('rejected', 'suspended')`
    );

    const totalFormateurs = parseInt(formateursValides.rows[0].total) + 
                           parseInt(formateursEnAttente.rows[0].total) + 
                           parseInt(formateursRejetes.rows[0].total);

    const totalStagiaires = parseInt(stagiairesValides.rows[0].total) + 
                           parseInt(stagiairesEnAttente.rows[0].total) + 
                           parseInt(stagiairesRejetes.rows[0].total);

    return {
      formateurs: {
        valides: parseInt(formateursValides.rows[0].total),
        en_attente: parseInt(formateursEnAttente.rows[0].total),
        rejetes: parseInt(formateursRejetes.rows[0].total),
        total: totalFormateurs,
        taux_validation: totalFormateurs > 0 
          ? Math.round((parseInt(formateursValides.rows[0].total) / totalFormateurs) * 100) 
          : 0,
        taux_rejet: totalFormateurs > 0 
          ? Math.round((parseInt(formateursRejetes.rows[0].total) / totalFormateurs) * 100) 
          : 0
      },
      stagiaires: {
        valides: parseInt(stagiairesValides.rows[0].total),
        en_attente: parseInt(stagiairesEnAttente.rows[0].total),
        rejetes: parseInt(stagiairesRejetes.rows[0].total),
        total: totalStagiaires,
        taux_validation: totalStagiaires > 0 
          ? Math.round((parseInt(stagiairesValides.rows[0].total) / totalStagiaires) * 100) 
          : 0,
        taux_rejet: totalStagiaires > 0 
          ? Math.round((parseInt(stagiairesRejetes.rows[0].total) / totalStagiaires) * 100) 
          : 0
      },
      utilisateurs_rejetes: parseInt(formateursRejetes.rows[0].total) + parseInt(stagiairesRejetes.rows[0].total)
    };
  }

  /**
   * Taux d'encadrement, notation et certification
   */
  async getRates() {
    const totalStagiaires = await pool.query(
      `SELECT COUNT(*) as total FROM users WHERE role = 'stagiaire'`
    );
    const total = parseInt(totalStagiaires.rows[0].total);

    // Taux d'encadrement
    const stagiairesEncadres = await pool.query(
      `SELECT COUNT(DISTINCT stagiaire_id) as total FROM encadrements`
    );
    const encadres = parseInt(stagiairesEncadres.rows[0].total);

    // Taux de notation (stagiaires avec au moins un replay noté)
    const stagiairesNotes = await pool.query(
      `SELECT COUNT(DISTINCT user_id) as total FROM streams_replay WHERE note IS NOT NULL`
    );
    const notes = parseInt(stagiairesNotes.rows[0].total);

    // Taux de certification
    const stagiairesCertifies = await pool.query(
      `SELECT COUNT(DISTINCT user_id) as total FROM streams_replay WHERE certificat_valide = true`
    );
    const certifies = parseInt(stagiairesCertifies.rows[0].total);

    // Replays notés (avec note non nulle)
    const replaysNotes = await pool.query(
      `SELECT COUNT(*) as total FROM streams_replay WHERE note IS NOT NULL`
    );
    const totalReplayNote = parseInt(replaysNotes.rows[0].total);
    // Total replays
    const totalReplays = await pool.query(
      `SELECT COUNT(*) as total FROM streams_replay`
    );
    const totalReplay = parseInt(totalReplays.rows[0].total);

    // Replays certifiés
    const replaysCertifies = await pool.query(
      `SELECT COUNT(*) as total FROM streams_replay WHERE certificat_valide = true`
    );

    return {
      total_stagiaires: total,
      taux_encadrement: total > 0 ? Math.round((encadres / total) * 100) : 0,
      taux_notation: total > 0 ? Math.round((totalReplayNote / totalReplay) * 100) : 0,
      taux_certification: total > 0 ? Math.round((certifies / totalReplay) * 100) : 0,
      encadres,
      notes,
      certifies
    };
  }

  /**
   * Statistiques des certificats par niveau
   */
  async getCertificatStats() {
    const result = await pool.query(`
      SELECT 
        COALESCE(note, 0) as note,
        COUNT(*) as count,
        CASE 
          WHEN note >= 16 THEN 'Avancé'
          WHEN note >= 12 THEN 'Intermédiaire'
          WHEN note >= 8 THEN 'Débutant'
          ELSE 'Non classé'
        END as niveau
      FROM streams_replay
      WHERE note IS NOT NULL
      GROUP BY note
    `);

    const niveaux = {
      'Débutant': 0,
      'Intermédiaire': 0,
      'Avancé': 0,
      'Non classé': 0
    };

    result.rows.forEach(row => {
      niveaux[row.niveau] += parseInt(row.count);
    });

    return [
      { label: 'Débutant', count: niveaux['Débutant'], color: '#4FC3F7' },
      { label: 'Intermédiaire', count: niveaux['Intermédiaire'], color: '#7C6FFF' },
      { label: 'Avancé', count: niveaux['Avancé'], color: '#FF6B9D' }
    ];
  }
}

module.exports = new StatsController();