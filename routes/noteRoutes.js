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
            
            // Détecter si la note est sur 5 ou sur 20
            let noteSur20;
            let noteValue;
            let isNoteSur5 = false;

            // Si la note est <= 5, c'est probablement une note sur 5 (étoiles)
            if (note <= 5) {
                // C'est une note sur 5 (de MultiStream.js)
                isNoteSur5 = true;
                noteValue = note;
                noteSur20 = note * 4; // Convertir en note sur 20
                
                // Validation pour note sur 5
                if (note < 1 || note > 5) {
                    return res.status(400).json({
                        success: false,
                        error: "La note doit être entre 1 et 5"
                    });
                }
            } else {
                // C'est une note sur 20 (de SeulStream.js)
                noteSur20 = note;
                noteValue = note / 4; // Convertir en note sur 5 pour le commentaire
                
                // Validation pour note sur 20
                if (note < 0 || note > 20) {
                    return res.status(400).json({
                        success: false,
                        error: "La note doit être entre 0 et 20"
                    });
                }
            }

            // Vérifier encadrement
            const check = await pool.query(
                `SELECT id FROM encadrements
                WHERE formateur_id = $1 AND stagiaire_id = $2`,
                [formateur_id, stagiaire_id]
            );

            if (check.rowCount === 0) {
                return res.status(403).json({
                success: false,
                error: "Vous ne pouvez noter que vos propres stagiaires encadrés"
                });
            }

            // Vérifier si une note existe déjà
            const existingNote = await pool.query(
                `SELECT id FROM notes
                 WHERE formateur_id = $1 AND stagiaire_id = $2`,
                [formateur_id, stagiaire_id]
            );

            let result;
            let commentaireFinal;

            // Générer le commentaire en fonction du type de note
            if (isNoteSur5) {
                commentaireFinal = commentaire || `Note: ${noteValue}/5 (${noteSur20}/20)`;
            } else {
                commentaireFinal = commentaire || `Note: ${noteSur20}/20 (${(noteSur20/4).toFixed(1)}/5)`;
            }

            if (existingNote.rowCount > 0) {
                // Mettre à jour la note existante
                result = await pool.query(
                    `UPDATE notes
                     SET note = $3, commentaire = $4, updated_at = CURRENT_TIMESTAMP
                     WHERE formateur_id = $1 AND stagiaire_id = $2
                     RETURNING id, note, created_at, updated_at`,
                    [formateur_id, stagiaire_id, noteSur20, commentaireFinal]
                );
            } else {
                // Créer une nouvelle note
                result = await pool.query(
                    `INSERT INTO notes
                     (formateur_id, stagiaire_id, note, commentaire)
                     VALUES ($1, $2, $3, $4)
                     RETURNING id, note, created_at`,
                    [formateur_id, stagiaire_id, noteSur20, commentaireFinal]
                );
            }

            res.json({
                success: true,
                message: existingNote.rowCount > 0 ? "Note mise à jour" : "Note ajoutée",
                note: {
                    id: result.rows[0].id,
                    note: noteSur20, // Toujours stocker sur 20
                    note_sur_5: (noteSur20 / 4).toFixed(1),
                    note_originale: isNoteSur5 ? noteValue : noteSur20, // Note originale
                    type_note: isNoteSur5 ? 'sur5' : 'sur20',
                    created_at: result.rows[0].created_at,
                    updated_at: result.rows[0].updated_at || result.rows[0].created_at
                }
            });

        } catch (error) {
            console.error('Erreur gestion note:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
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
                `SELECT 
                    n.*, 
                    u.nom as formateur_nom,
                    u.prenom as formateur_prenom,
                    ROUND(n.note / 4, 1) as note_sur_5
                 FROM notes n
                 JOIN users u ON u.id = n.formateur_id
                 WHERE n.stagiaire_id = $1
                 ORDER BY n.created_at DESC`,
                [id]
            );

            res.json({
                success: true,
                notes: result.rows
            });

        } catch (error) {
            console.error('Erreur récupération notes:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

/**
 * Récupérer la note d'un formateur pour un stagiaire
 */
router.get(
    "/stagiaire/:id/formateur/:formateur_id",
    authenticate,
    async (req, res) => {
        try {
            const { id, formateur_id } = req.params;

            const result = await pool.query(
                `SELECT 
                    n.*,
                    ROUND(n.note / 4, 1) as note_sur_5
                 FROM notes n
                 WHERE n.stagiaire_id = $1 AND n.formateur_id = $2
                 ORDER BY n.created_at DESC
                 LIMIT 1`,
                [id, formateur_id]
            );

            if (result.rowCount === 0) {
                return res.json({
                    success: true,
                    has_note: false,
                    note: null
                });
            }

            res.json({
                success: true,
                has_note: true,
                note: result.rows[0]
            });

        } catch (error) {
            console.error('Erreur récupération note:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);

module.exports = router;
