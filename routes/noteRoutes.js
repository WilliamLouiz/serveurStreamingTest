const express = require("express");
const router = express.Router();

const { authenticate, authorize } = require("../middleware/auth");
const pool = require("../config/database");
const { ROLES } = require("../config/constants");

//Ajouter une note (formateur seulement)
 
router.post(
  "/",
  authenticate,
  authorize(ROLES.FORMATEUR),
  async (req, res) => {
    try {
      const { stagiaire_id, note, commentaire } = req.body;
      const formateur_id = req.user.id;

      // Vérifier encadrement
      const check = await pool.query(
        `SELECT 1 FROM encadrements
         WHERE formateur_id=$1 AND stagiaire_id=$2`,
        [formateur_id, stagiaire_id]
      );

      if (check.rowCount === 0) {
        return res.status(403).json({
          error: "Ce stagiaire n'est pas sous votre encadrement"
        });
      }

      // Insérer note
      await pool.query(
        `INSERT INTO notes
         (formateur_id, stagiaire_id, note, commentaire)
         VALUES ($1,$2,$3,$4)`,
        [formateur_id, stagiaire_id, note, commentaire]
      );

      res.json({ message: "Note ajoutée avec succès" });

    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * Voir notes d'un stagiaire
 */
router.get(
  "/stagiaire/:id",
  authenticate,
  async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `SELECT n.*, u.name AS formateur
         FROM notes n
         JOIN users u ON u.id = n.formateur_id
         WHERE n.stagiaire_id=$1`,
        [id]
      );

      res.json(result.rows);

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

module.exports = router;
