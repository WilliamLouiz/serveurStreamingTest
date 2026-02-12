// routes/commentRoutes.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const pool = require('../config/database');

// GET - Récupérer tous les commentaires d'un stagiaire (pour Accueil stagiaire)
router.get('/stagiaire/:stagiaireId', authenticate, async (req, res) => {
  try {
    const { stagiaireId } = req.params;
    const user = req.user;

    // Vérifier les droits d'accès
    // - Le stagiaire peut voir ses propres commentaires
    // - Les formateurs peuvent voir les commentaires de leurs stagiaires
    // - Les admins peuvent tout voir
    if (user.role === 'stagiaire' && user.id !== parseInt(stagiaireId)) {
      return res.status(403).json({
        success: false,
        error: 'Accès non autorisé - Vous ne pouvez voir que vos propres commentaires'
      });
    }

    const query = `
      SELECT 
        c.id,
        c.commentaire,
        c.created_at,
        c.updated_at,
        c.is_edited,
        u.id as formateur_id,
        u.nom as formateur_nom,
        u.prenom as formateur_prenom,
        u.email as formateur_email
      FROM comments c
      JOIN users u ON c.formateur_id = u.id
      WHERE c.stagiaire_id = $1
      ORDER BY c.created_at DESC
    `;

    const { rows } = await pool.query(query, [stagiaireId]);

    // Formater les commentaires
    const comments = rows.map(row => ({
      id: row.id,
      text: row.commentaire,
      author: `${row.formateur_prenom} ${row.formateur_nom}`,
      author_id: row.formateur_id,
      author_email: row.formateur_email,
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_edited: row.is_edited,
      formatted_date: new Date(row.created_at).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    }));

    res.json({
      success: true,
      comments: comments,
      count: comments.length
    });

  } catch (error) {
    console.error('Erreur récupération commentaires:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des commentaires'
    });
  }
});

// GET - Récupérer tous les commentaires pour un formateur (pour voirVideo)
router.get('/formateur/all', authenticate, async (req, res) => {
  try {
    const user = req.user;

    // Seuls les formateurs et admins peuvent voir tous les commentaires
    if (user.role === 'stagiaire') {
      return res.status(403).json({
        success: false,
        error: 'Accès non autorisé'
      });
    }

    let query = `
      SELECT 
        c.id,
        c.commentaire,
        c.created_at,
        c.updated_at,
        c.is_edited,
        c.stagiaire_id,
        f.id as formateur_id,
        f.nom as formateur_nom,
        f.prenom as formateur_prenom,
        s.nom as stagiaire_nom,
        s.prenom as stagiaire_prenom,
        s.stagiaire_id as stagiaire_identifiant
      FROM comments c
      JOIN users f ON c.formateur_id = f.id
      JOIN users s ON c.stagiaire_id = s.id
    `;

    // Si c'est un formateur, on filtre seulement ses stagiaires
    if (user.role === 'formateur') {
      query += `
        WHERE c.stagiaire_id IN (
          SELECT stagiaire_id 
          FROM encadrements 
          WHERE formateur_id = $1
        )
      `;
    }

    query += ` ORDER BY c.created_at DESC`;

    const params = user.role === 'formateur' ? [user.id] : [];
    const { rows } = await pool.query(query, params);

    // Grouper les commentaires par stagiaire
    const commentsByStagiaire = rows.reduce((acc, row) => {
      const stagiaireKey = row.stagiaire_id;
      if (!acc[stagiaireKey]) {
        acc[stagiaireKey] = {
          stagiaire_id: row.stagiaire_id,
          stagiaire_nom: `${row.stagiaire_prenom} ${row.stagiaire_nom}`,
          stagiaire_identifiant: row.stagiaire_identifiant,
          comments: []
        };
      }
      
      acc[stagiaireKey].comments.push({
        id: row.id,
        text: row.commentaire,
        author: `${row.formateur_prenom} ${row.formateur_nom}`,
        author_id: row.formateur_id,
        created_at: row.created_at,
        formatted_date: new Date(row.created_at).toLocaleDateString('fr-FR', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      });
      
      return acc;
    }, {});

    res.json({
      success: true,
      comments_by_stagiaire: Object.values(commentsByStagiaire),
      total_comments: rows.length
    });

  } catch (error) {
    console.error('Erreur récupération tous les commentaires:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des commentaires'
    });
  }
});

// POST - Ajouter un commentaire (depuis seulStream)
router.post('/', authenticate, async (req, res) => {
  try {
    const { stagiaire_id, commentaire } = req.body;
    const formateur_id = req.user.id;

    // Validation
    if (!stagiaire_id || !commentaire) {
      return res.status(400).json({
        success: false,
        error: 'stagiaire_id et commentaire sont requis'
      });
    }

    if (commentaire.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Le commentaire doit contenir au moins 2 caractères'
      });
    }

    // Vérifier que le formateur encadre bien ce stagiaire
    if (req.user.role === 'formateur') {
      const encadrementCheck = await pool.query(
        `SELECT id FROM encadrements 
         WHERE formateur_id = $1 AND stagiaire_id = $2`,
        [formateur_id, stagiaire_id]
      );

      if (encadrementCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          error: 'Vous ne pouvez commenter que vos propres stagiaires'
        });
      }
    }

    // Insérer le commentaire
    const { rows } = await pool.query(
      `INSERT INTO comments (formateur_id, stagiaire_id, commentaire) 
       VALUES ($1, $2, $3) 
       RETURNING id, commentaire, created_at`,
      [formateur_id, stagiaire_id, commentaire.trim()]
    );

    // Récupérer les infos du formateur
    const userInfo = await pool.query(
      `SELECT nom, prenom FROM users WHERE id = $1`,
      [formateur_id]
    );

    const newComment = {
      id: rows[0].id,
      text: rows[0].commentaire,
      author: `${userInfo.rows[0].prenom} ${userInfo.rows[0].nom}`,
      author_id: formateur_id,
      created_at: rows[0].created_at,
      formatted_date: new Date(rows[0].created_at).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    };

    res.status(201).json({
      success: true,
      message: 'Commentaire ajouté avec succès',
      comment: newComment
    });

  } catch (error) {
    console.error('Erreur ajout commentaire:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de l\'ajout du commentaire'
    });
  }
});

// PUT - Modifier un commentaire
router.put('/:commentId', authenticate, async (req, res) => {
  try {
    const { commentId } = req.params;
    const { commentaire } = req.body;
    const userId = req.user.id;

    if (!commentaire || commentaire.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Le commentaire doit contenir au moins 2 caractères'
      });
    }

    // Vérifier que l'utilisateur est l'auteur du commentaire
    const commentCheck = await pool.query(
      `SELECT formateur_id FROM comments WHERE id = $1`,
      [commentId]
    );

    if (commentCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Commentaire non trouvé'
      });
    }

    if (commentCheck.rows[0].formateur_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Vous ne pouvez modifier que vos propres commentaires'
      });
    }

    // Mettre à jour le commentaire
    const { rows } = await pool.query(
      `UPDATE comments 
       SET commentaire = $1, updated_at = CURRENT_TIMESTAMP, is_edited = true 
       WHERE id = $2 
       RETURNING id, commentaire, updated_at, is_edited`,
      [commentaire.trim(), commentId]
    );

    res.json({
      success: true,
      message: 'Commentaire modifié avec succès',
      comment: rows[0]
    });

  } catch (error) {
    console.error('Erreur modification commentaire:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la modification du commentaire'
    });
  }
});

// DELETE - Supprimer un commentaire
router.delete('/:commentId', authenticate, async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user.id;

    // Vérifier que l'utilisateur est l'auteur du commentaire ou admin
    const commentCheck = await pool.query(
      `SELECT formateur_id FROM comments WHERE id = $1`,
      [commentId]
    );

    if (commentCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Commentaire non trouvé'
      });
    }

    if (commentCheck.rows[0].formateur_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Vous ne pouvez supprimer que vos propres commentaires'
      });
    }

    await pool.query(`DELETE FROM comments WHERE id = $1`, [commentId]);

    res.json({
      success: true,
      message: 'Commentaire supprimé avec succès'
    });

  } catch (error) {
    console.error('Erreur suppression commentaire:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la suppression du commentaire'
    });
  }
});

module.exports = router;