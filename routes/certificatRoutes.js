const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const pool = require('../config/database');
const { ROLES } = require('../config/constants');

/**
 * Valider le certificat d'un stagiaire (admin ou formateur encadreur)
 */
router.post('/valider-replay/:replayId', authenticate, async (req, res) => {
  try {
    const { replayId } = req.params;
    const user = req.user;

    // Vérifier que l'utilisateur est admin ou formateur
    if (user.role !== ROLES.ADMIN && user.role !== ROLES.FORMATEUR) {
      return res.status(403).json({
        success: false,
        error: 'Accès non autorisé'
      });
    }

    // Récupérer le replay et le stagiaire associé
    const replayResult = await pool.query(`
      SELECT sr.*, u.id as stagiaire_user_id, u.role
      FROM streams_replay sr
      LEFT JOIN users u ON sr.stagiaire_id = u.stagiaire_id
      WHERE sr.id = $1
    `, [replayId]);

    if (replayResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Replay non trouvé'
      });
    }

    const replay = replayResult.rows[0];

    // Vérifier que le replay a une note
    if (!replay.note) {
      return res.status(400).json({
        success: false,
        error: 'Ce replay doit avoir une note pour valider le certificat'
      });
    }

    // Si c'est un formateur, vérifier qu'il encadre ce stagiaire
    if (user.role === ROLES.FORMATEUR) {
      if (!replay.stagiaire_user_id) {
        return res.status(403).json({
          success: false,
          error: 'Impossible de vérifier les droits'
        });
      }

      const encadrementCheck = await pool.query(
        `SELECT id FROM encadrements 
         WHERE formateur_id = $1 AND stagiaire_id = $2`,
        [user.id, replay.stagiaire_user_id]
      );

      if (encadrementCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          error: 'Vous ne pouvez valider que les certificats de vos stagiaires encadrés'
        });
      }
    }

    // Mettre à jour le statut de validation du certificat pour CE REPLAY
    await pool.query(
      'UPDATE streams_replay SET certificat_valide = true WHERE id = $1',
      [replayId]
    );

    // Récupérer le replay mis à jour
    const updatedReplay = await pool.query(
      `SELECT sr.*, u.nom, u.prenom, u.stagiaire_id 
       FROM streams_replay sr
       LEFT JOIN users u ON sr.stagiaire_id = u.stagiaire_id
       WHERE sr.id = $1`,
      [replayId]
    );

    res.json({
      success: true,
      message: 'Certificat du replay validé avec succès',
      replay: updatedReplay.rows[0]
    });

  } catch (error) {
    console.error('Erreur validation certificat:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Vérifier le statut du certificat d'un stagiaire
 */
router.get('/statut/:stagiaireId', authenticate, async (req, res) => {
  try {
    const { stagiaireId } = req.params;

    const result = await pool.query(
      'SELECT certificat_valide FROM users WHERE id = $1',
      [stagiaireId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Stagiaire non trouvé'
      });
    }

    res.json({
      success: true,
      certificat_valide: result.rows[0].certificat_valide
    });

  } catch (error) {
    console.error('Erreur vérification certificat:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Liste des stagiaires avec leur statut de certificat (pour admin/formateur)
 */
router.get('/stagiaires', authenticate, authorize([ROLES.ADMIN, ROLES.FORMATEUR]), async (req, res) => {
  try {
    const user = req.user;
    let query = `
      SELECT 
        u.id,
        u.nom,
        u.prenom,
        u.email,
        u.stagiaire_id,
        u.certificat_valide,
        u.note
      FROM users u
      WHERE u.role = 'stagiaire'
    `;

    // Si c'est un formateur, filtrer uniquement ses stagiaires encadrés
    if (user.role === ROLES.FORMATEUR) {
      query = `
        SELECT 
          u.id,
          u.nom,
          u.prenom,
          u.email,
          u.stagiaire_id,
          u.certificat_valide,
          u.note
        FROM users u
        JOIN encadrements e ON u.id = e.stagiaire_id
        WHERE u.role = 'stagiaire' 
          AND e.formateur_id = $1
      `;
      const result = await pool.query(query, [user.id]);
      return res.json({
        success: true,
        stagiaires: result.rows
      });
    }

    // Admin voit tous les stagiaires
    const result = await pool.query(query);
    res.json({
      success: true,
      stagiaires: result.rows
    });

  } catch (error) {
    console.error('Erreur récupération stagiaires:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;