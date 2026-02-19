const express = require("express");
const router = express.Router();

const { authenticate, authorize } = require("../middleware/auth");
const pool = require("../config/database");
const { ROLES } = require("../config/constants");
const { createNotification } = require("../services/notificationService");

/**
 * Fonction utilitaire pour obtenir l'ID utilisateur depuis stagiaire_id
 */
async function getUserIdFromStagiaireIdentifier(identifier) {
  if (isNaN(identifier)) {
    // C'est un identifiant texte comme "VR7574"
    const result = await pool.query(
      'SELECT id FROM users WHERE stagiaire_id = $1',
      [identifier]
    );
    return result.rows[0]?.id || null;
  }
  // C'est déjà un ID numérique
  return parseInt(identifier);
}

/**
 * Fonction utilitaire pour obtenir l'identifiant stagiaire depuis user_id
 */
async function getStagiaireIdentifierFromUserId(userId) {
  const result = await pool.query(
    'SELECT stagiaire_id FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0]?.stagiaire_id || null;
}

/**
 * Créer/modifier un encadrement (admin seulement)
 */
router.post(
  "/",
  authenticate,
  authorize(ROLES.ADMIN),
  async (req, res) => {
    try {
      const { formateur_id, stagiaire_id, description } = req.body;

      // Vérifier que le stagiaire existe
      const stagiaireCheck = await pool.query(
        `SELECT id, role FROM users WHERE id = $1`,
        [stagiaire_id]
      );

      if (stagiaireCheck.rowCount === 0) {
        return res.status(404).json({
          success: false,
          error: "Stagiaire non trouvé"
        });
      }

      if (stagiaireCheck.rows[0].role !== "stagiaire") {
        return res.status(400).json({
          success: false,
          error: "L'utilisateur doit être un stagiaire"
        });
      }

      // Supprimer ancien encadrement
      await pool.query(
        `DELETE FROM encadrements WHERE stagiaire_id = $1`,
        [stagiaire_id]
      );

      // Créer nouveau
      await pool.query(
        `INSERT INTO encadrements(formateur_id, stagiaire_id, description)
         VALUES($1, $2, $3)`,
        [formateur_id, stagiaire_id, description]
      );

      // Notifications
      await createNotification({
        user_id: formateur_id,
        titre: "Encadrement mis à jour",
        description: `Un stagiaire vous a été assigné`,
        type: "encadrement_update"
      });

      await createNotification({
        user_id: stagiaire_id,
        titre: "Formateur assigné",
        description: `Votre formateur a été modifié`,
        type: "encadrement_assigned"
      });

      res.json({
        success: true,
        message: "Encadrement mis à jour avec succès"
      });

    } catch (error) {
      console.error("Erreur encadrement:", error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/**
 * Supprimer un encadrement (admin seulement)
 */
router.delete(
  "/:id",
  authenticate,
  authorize(ROLES.ADMIN),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Récupérer l'encadrement avant suppression pour les notifications
      const encadrement = await pool.query(
        `SELECT formateur_id, stagiaire_id FROM encadrements WHERE id = $1`,
        [id]
      );

      if (encadrement.rowCount === 0) {
        return res.status(404).json({
          success: false,
          error: "Encadrement non trouvé"
        });
      }

      const { formateur_id, stagiaire_id } = encadrement.rows[0];

      // Supprimer l'encadrement
      await pool.query(
        `DELETE FROM encadrements WHERE id = $1`,
        [id]
      );

      // Notifications
      await createNotification({
        user_id: formateur_id,
        titre: "Encadrement supprimé",
        description: `Un stagiaire a été retiré de votre encadrement`,
        type: 'encadrement_removed'
      });

      await createNotification({
        user_id: stagiaire_id,
        titre: "Formateur retiré",
        description: `Votre formateur assigné a été retiré`,
        type: 'encadrement_removed'
      });

      res.json({ 
        success: true,
        message: "Encadrement supprimé avec succès" 
      });

    } catch (error) {
      console.error('Erreur suppression encadrement:', error);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }
);

/**
 * Liste des stagiaires d'un formateur
 */
router.get(
  "/formateur/:formateurId",
  authenticate,
  async (req, res) => {
    try {
      const { formateurId } = req.params;

      const result = await pool.query(
        `SELECT 
          e.id as encadrement_id,
          e.description,
          e.created_at,
          e.updated_at,
          u.id as stagiaire_id,
          u.nom,
          u.prenom,
          u.email,
          u.stagiaire_id as identifiant_stagiaire,
          u.status
         FROM encadrements e
         JOIN users u ON e.stagiaire_id = u.id
         WHERE e.formateur_id = $1 AND u.role = 'stagiaire'
         ORDER BY u.nom, u.prenom`,
        [formateurId]
      );

      res.json({
        success: true,
        stagiaires: result.rows,
        count: result.rowCount
      });

    } catch (error) {
      console.error('Erreur récupération stagiaires:', error);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }
);

/**
 * Liste des formateurs disponibles (sans encadrement pour un stagiaire spécifique)
 */
router.get(
  "/formateurs/disponibles",
  authenticate,
  authorize([ROLES.ADMIN, ROLES.FORMATEUR]),
  async (req, res) => {
    try {
      const { stagiaire_id } = req.query;

      let query = `
        SELECT 
          u.id,
          u.nom,
          u.prenom,
          u.email,
          COUNT(e2.id) as nombre_stagiaires
        FROM users u
        LEFT JOIN encadrements e2 ON u.id = e2.formateur_id
        WHERE u.role = 'formateur' 
          AND u.status = 'validated'
      `;

      if (stagiaire_id) {
        query += `
          AND u.id NOT IN (
            SELECT formateur_id 
            FROM encadrements 
            WHERE stagiaire_id = $1
          )
        `;
        const result = await pool.query(query, [stagiaire_id]);
        res.json({ 
          success: true,
          formateurs: result.rows 
        });
      } else {
        const result = await pool.query(query);
        res.json({ 
          success: true,
          formateurs: result.rows 
        });
      }

    } catch (error) {
      console.error('Erreur récupération formateurs:', error);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }
);

//Récupérer tous les encadrements (admin seulement)

router.get(
  "/",
  authenticate,
  authorize(ROLES.ADMIN),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT 
          e.id,
          e.description,
          e.created_at,
          e.updated_at,
          f.id as formateur_id,
          f.nom as formateur_nom,
          f.prenom as formateur_prenom,
          f.email as formateur_email,
          s.id as stagiaire_id,
          s.nom as stagiaire_nom,
          s.prenom as stagiaire_prenom,
          s.email as stagiaire_email,
          s.stagiaire_id as identifiant_stagiaire
         FROM encadrements e
         JOIN users f ON e.formateur_id = f.id
         JOIN users s ON e.stagiaire_id = s.id
         ORDER BY e.created_at DESC`
      );

      res.json({
        success: true,
        encadrements: result.rows,
        count: result.rowCount
      });

    } catch (error) {
      console.error('Erreur récupération encadrements:', error);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }
);

/**
 * Récupérer le formateur d'un stagiaire
 */
router.get(
  "/stagiaire/:stagiaireId/formateur",
  authenticate,
  async (req, res) => {
    try {
      const { stagiaireId } = req.params;

      const result = await pool.query(
        `SELECT 
          u.id,
          u.nom,
          u.prenom,
          u.email,
          e.description,
          e.created_at
         FROM users u
         JOIN encadrements e ON u.id = e.formateur_id
         WHERE e.stagiaire_id = $1`,
        [stagiaireId]
      );

      if (result.rowCount === 0) {
        return res.json({
          success: true,
          has_formateur: false,
          formateur: null
        });
      }

      res.json({
        success: true,
        has_formateur: true,
        formateur: result.rows[0]
      });

    } catch (error) {
      console.error('Erreur récupération formateur:', error);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }
);

/**
 * Récupérer l'identifiant stagiaire (VRXXXX) pour un stagiaire
 */
router.get(
  "/recherche/stagiaire/:identifiant",
  authenticate,
  authorize(ROLES.ADMIN),
  async (req, res) => {
    try {
      const { identifiant } = req.params;
      
      const result = await pool.query(
        `SELECT 
          id,
          nom,
          prenom,
          email,
          stagiaire_id,
          status,
          created_at
         FROM users 
         WHERE stagiaire_id ILIKE $1 
           AND role = 'stagiaire'
         LIMIT 10`,
        [`%${identifiant}%`]
      );
      
      res.json({
        success: true,
        stagiaires: result.rows
      });
    } catch (error) {
      console.error('Erreur recherche stagiaire:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// pour vérifier si un formateur enncadre un stagiaire

router.post(
  "/verification",
  authenticate,
  async (req, res) => {
    try {
      const { formateur_id, stagiaire_id } = req.body;

      // Vérifier que le formateur connecté est bien celui qui fait la requête
      if (req.user.id !== parseInt(formateur_id) && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: "Non autorisé"
        });
      }

      const result = await pool.query(
        `SELECT id FROM encadrements 
         WHERE formateur_id = $1 AND stagiaire_id = $2`,
        [formateur_id, stagiaire_id]
      );

      res.json({
        success: true,
        is_encadrant: result.rowCount > 0
      });

    } catch (error) {
      console.error('Erreur vérification encadrement:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// pour récupérer les stagiaires d'un formateur
router.get('/mes-stagiaires', authenticate, async (req, res) => {
  try {
    const formateurId = req.user.id;

    const result = await pool.query(`
      SELECT 
        u.id,
        u.nom,
        u.prenom,
        u.email,
        u.stagiaire_id,
        u.status,
        n.note
      FROM users u
      JOIN encadrements e ON u.id = e.stagiaire_id
      LEFT JOIN notes n ON u.id = n.stagiaire_id
      WHERE e.formateur_id = $1 AND u.role = 'stagiaire'
      ORDER BY u.nom, u.prenom
    `, [formateurId]);

    res.json({
      success: true,
      stagiaires: result.rows
    });

  } catch (error) {
    console.error('Erreur récupération stagiaires du formateur:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;