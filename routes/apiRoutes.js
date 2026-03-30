const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');
const pool = require('../config/database');
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const channelRoutes = require('./channelRoutes');
const adminRoutes = require('./adminRoutes');
const encadrementRoute = require("./encadrementRoutes");
const noteRoute = require("./noteRoutes");
const notificationRoute = require("./notificationRoutes");
const commentRoutes = require("./commentRoutes");
const twoFactorRoutes = require("./twoFactorRoutes");
const certificatRoutes = require('./certificatRoutes');
const statsController = require('../controllers/statsController');
const taskRoutes = require("./taskRoutes");

const path = require('path');
// Utiliser les routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/channels', channelRoutes);
router.use('/admin', adminRoutes);
router.use("/encadrements", encadrementRoute);
router.use("/notes", noteRoute);
router.use("/notifications", notificationRoute);
router.use("/comments", commentRoutes);
router.use("/2fa", twoFactorRoutes);
router.use('/certificats', certificatRoutes);
router.get('/admin/stats', authenticate, authorize(ROLES.ADMIN), statsController.getAdminStats);
router.use("/tasks", taskRoutes);

// route pour vérifier l'identifiant stagiaire
router.post('/verify-stagiaire', async (req, res) => {
  try {
    const { channelId, stagiaireId } = req.body;

    if (!channelId || !stagiaireId) {
      return res.status(400).json({
        success: false,
        error: 'channelId et stagiaireId sont requis'
      });
    }

    // Trouver le stagiaire par son identifiant
    const user = await require('../models/User').findByStagiaireId(stagiaireId);

    if (!user) {
      return res.json({
        success: false,
        error: 'Identifiant stagiaire invalide',
        user: null
      });
    }

    // Vérifier si le compte est validé
    if (!user.is_validated || user.status !== 'validated') {
      return res.json({
        success: false,
        error: 'Compte non validé ou suspendu',
        user: null
      });
    }

    // Retourner les infos du stagiaire
    res.json({
      success: true,
      message: 'Identifiant valide',
      user: {
        id: user.id,
        nom: user.nom,
        prenom: user.prenom,
        stagiaire_id: user.stagiaire_id,
        channelId: channelId // Associer le channelId au stagiaire
      }
    });

  } catch (error) {
    console.error('Erreur vérification stagiaire:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la vérification'
    });
  }
});

// Route pour récupérer un stagiaire par son identifiant VR
router.get('/stagiaire/:stagiaireId', async (req, res) => {
  try {
    const { stagiaireId } = req.params;

    if (!stagiaireId) {
      return res.status(400).json({
        success: false,
        error: 'Identifiant stagiaire requis'
      });
    }

    // Trouver le stagiaire par son identifiant
    const user = await require('../models/User').findByStagiaireId(stagiaireId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Stagiaire non trouvé',
        user: null
      });
    }

    // Ne pas renvoyer le mot de passe
    delete user.password;

    res.json({
      success: true,
      user: {
        id: user.id,
        nom: user.nom,
        prenom: user.prenom,
        email: user.email,
        role: user.role,
        stagiaire_id: user.stagiaire_id,
        is_validated: user.is_validated,
        status: user.status
      }
    });

  } catch (error) {
    console.error('Erreur récupération stagiaire:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération du stagiaire'
    });
  }
});

// Middleware pour rafraîchir automatiquement les tokens
router.use(async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (token && res.get('X-New-Token')) {
    // Renvoyer le nouveau token dans la réponse
    res.json = (function (originalJson) {
      return function (data) {
        if (data && typeof data === 'object') {
          data.newToken = res.get('X-New-Token');
          data.tokenRefreshed = true;
        }
        originalJson.call(this, data);
      };
    })(res.json.bind(res));
  }

  next();
});

router.get('/replay/me', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows } = await pool.query(`
      SELECT file_path, created_at
      FROM streams_replay
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [userId]);

    if (rows.length === 0) {
      return res.json({
        success: false,
        replay: null
      });
    }

    const rawPath = rows[0].file_path;


    const relativePath = rawPath
      .replace(/\\/g, '/')
      .replace(process.cwd(), '');

    const videoUrl = relativePath.startsWith('/recordings')
      ? relativePath
      : '/recordings' + relativePath.split('/recordings')[1];

    res.json({
      success: true,
      replay: {
        videoUrl,
        createdAt: rows[0].created_at
      }
    });

  } catch (err) {
    console.error('Erreur replay:', err);
    res.status(500).json({
      success: false,
      error: 'Erreur récupération replay'
    });
  }
});

// Route pour récupérer tous les replays (formateurs et admin)
router.get('/replays/all', authenticate, async (req, res) => {
  try {
    const user = req.user;

    let query = `
      SELECT 
        sr.*,
        u.nom as stagiaire_nom,
        u.prenom as stagiaire_prenom,
        u.stagiaire_id,
        f.nom as formateur_nom,
        f.prenom as formateur_prenom
      FROM streams_replay sr
      LEFT JOIN users u ON sr.stagiaire_id = u.stagiaire_id
      LEFT JOIN encadrements e ON u.id = e.stagiaire_id
      LEFT JOIN users f ON e.formateur_id = f.id
      WHERE sr.expires_at > NOW()
    `;

    // Si c'est un formateur, seulement ses stagiaires
    if (user.role === 'formateur') {
      query += ` AND e.formateur_id = $1`;
    }
    // Admin voit tout

    query += ` ORDER BY sr.created_at DESC`;

    const params = user.role === 'formateur' ? [user.id] : [];

    const result = await pool.query(query, params);

    // Formatter les URLs vidéo
    const replays = result.rows.map(replay => {
      const rawPath = replay.file_path;
      const relativePath = rawPath
        .replace(/\\/g, '/')
        .replace(process.cwd(), '');

      const videoUrl = relativePath.startsWith('/recordings')
        ? relativePath
        : '/recordings' + relativePath.split('/recordings')[1];

      return {
        id: replay.id,
        video_url: videoUrl,
        stagiaire_id: replay.stagiaire_id,
        stagiaire_name: replay.stagiaire_nom && replay.stagiaire_prenom
          ? `${replay.stagiaire_prenom} ${replay.stagiaire_nom}`
          : `Stagiaire ${replay.stagiaire_id}`,
        formateur_name: replay.formateur_nom && replay.formateur_prenom
          ? `${replay.formateur_prenom} ${replay.formateur_nom}`
          : "Non assigné",
        channel_id: replay.channel_id,
        duration: replay.duration,
        created_at: replay.created_at,
        expires_at: replay.expires_at
      };
    });

    res.json({
      success: true,
      replays: replays
    });

  } catch (error) {
    console.error('Erreur récupération replays:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des vidéos'
    });
  }
});

// Route pour récupérer les replays avec les notes existantes
router.get('/replays/all-with-notes', authenticate, async (req, res) => {
  try {
    const user = req.user;

    let query = `
      SELECT 
        sr.id,
        sr.file_path,
        sr.stagiaire_id,
        sr.channel_id,
        sr.duration,
        sr.created_at,
        sr.expires_at,
        sr.note,
        sr.certificat_valide, 
        sr.user_id,
        u.id as stagiaire_user_id,
        u.nom as stagiaire_nom,
        u.prenom as stagiaire_prenom,
        u.stagiaire_id as stagiaire_identifiant,
        f.nom as formateur_nom,
        f.prenom as formateur_prenom
      FROM streams_replay sr
      LEFT JOIN users u ON sr.stagiaire_id = u.stagiaire_id
      LEFT JOIN encadrements e ON u.id = e.stagiaire_id
      LEFT JOIN users f ON e.formateur_id = f.id
      WHERE sr.expires_at > NOW()
    `;

    let params = [];

    // Si c'est un formateur, seulement ses stagiaires
    if (user.role === 'formateur') {
      query += ` AND e.formateur_id = $1`;
      params = [user.id];
    }
    // Admin voit tout - PAS DE PARAMÈTRES

    query += ` ORDER BY sr.created_at DESC`;
    const result = await pool.query(query, params);

    // Formatter les URLs vidéo
    const replays = result.rows.map(replay => {
      const rawPath = replay.file_path;
      const relativePath = rawPath
        .replace(/\\/g, '/')
        .replace(process.cwd(), '');

      const videoUrl = relativePath.startsWith('/recordings')
        ? relativePath
        : '/recordings' + relativePath.split('/recordings')[1];

      return {
        id: replay.id,
        video_url: videoUrl,
        stagiaire_id: replay.stagiaire_id,
        stagiaire_user_id: replay.stagiaire_user_id,
        stagiaire_name: replay.stagiaire_nom && replay.stagiaire_prenom
          ? `${replay.stagiaire_prenom} ${replay.stagiaire_nom}`
          : `Stagiaire ${replay.stagiaire_id}`,
        formateur_name: replay.formateur_nom && replay.formateur_prenom
          ? `${replay.formateur_prenom} ${replay.formateur_nom}`
          : "Non assigné",
        channel_id: replay.channel_id,
        duration: replay.duration,
        created_at: replay.created_at,
        expires_at: replay.expires_at,
        has_note: !!replay.note,
        note: replay.note,
        certificat_valide: replay.certificat_valide
      };
    });

    res.json({
      success: true,
      replays: replays
    });

  } catch (error) {
    console.error('Erreur récupération replays:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des vidéos'
    });
  }
});

// Pour Mettre à jour la note et le certificat d'un replay
router.patch('/replays/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { note, certificat_valide } = req.body;
    const user = req.user;

    // Vérifier si le replay existe
    const replayCheck = await pool.query(`
      SELECT sr.*, u.id as stagiaire_user_id 
      FROM streams_replay sr
      LEFT JOIN users u ON sr.stagiaire_id = u.stagiaire_id
      WHERE sr.id = $1
    `, [id]);

    if (replayCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Replay non trouvé'
      });
    }

    const replay = replayCheck.rows[0];

    // Vérifier les permissions (admin ou formateur encadreur)
    if (user.role === 'formateur') {
      if (!replay.stagiaire_user_id) {
        return res.status(403).json({
          success: false,
          error: 'Impossible de vérifier les droits'
        });
      }

      const encadrementCheck = await pool.query(`
        SELECT id FROM encadrements 
        WHERE formateur_id = $1 AND stagiaire_id = $2
      `, [user.id, replay.stagiaire_user_id]);

      if (encadrementCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          error: 'Vous n\'êtes pas autorisé à modifier cette vidéo'
        });
      }
    }

    // Construction de la requête de mise à jour
    let updateQuery = 'UPDATE streams_replay SET ';
    const updateValues = [];
    const updateParams = [];
    let paramIndex = 1;

    if (note !== undefined) {
      updateQuery += `note = $${paramIndex}, `;
      updateValues.push(note);
      paramIndex++;
    }
    if (certificat_valide !== undefined) {
      updateQuery += `certificat_valide = $${paramIndex}, `;
      updateValues.push(certificat_valide);
      paramIndex++;
    }

    // Enlever la dernière virgule et ajouter la condition WHERE
    updateQuery = updateQuery.slice(0, -2) + ` WHERE id = $${paramIndex} RETURNING *`;
    updateValues.push(id);

    const result = await pool.query(updateQuery, updateValues);

    res.json({
      success: true,
      message: 'Replay mis à jour avec succès',
      replay: result.rows[0]
    });

  } catch (error) {
    console.error('Erreur mise à jour replay:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la mise à jour du replay'
    });
  }
});

// Route pour supprimer un replay
router.delete('/replays/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Vérifier si le replay existe et récupérer ses informations
    const replayCheck = await pool.query(`
      SELECT sr.*, u.id as stagiaire_user_id 
      FROM streams_replay sr
      LEFT JOIN users u ON sr.stagiaire_id = u.stagiaire_id
      WHERE sr.id = $1
    `, [id]);

    if (replayCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Replay non trouvé'
      });
    }

    const replay = replayCheck.rows[0];

    // Vérifier les permissions
    if (user.role === 'stagiaire') {
      // Un stagiaire ne peut supprimer que ses propres replays
      if (replay.stagiaire_user_id !== user.id) {
        return res.status(403).json({
          success: false,
          error: 'Vous n\'êtes pas autorisé à supprimer cette vidéo'
        });
      }
    } else if (user.role === 'formateur') {
      // Vérifier si le formateur a ce stagiaire dans ses encadrements
      if (replay.stagiaire_user_id) {
        const encadrementCheck = await pool.query(`
          SELECT id FROM encadrements 
          WHERE formateur_id = $1 AND stagiaire_id = $2
        `, [user.id, replay.stagiaire_user_id]);

        if (encadrementCheck.rows.length === 0) {
          return res.status(403).json({
            success: false,
            error: 'Vous n\'êtes pas autorisé à supprimer cette vidéo'
          });
        }
      }
    }
    // Admin a tous les droits, pas de vérification supplémentaire

    // Supprimer le fichier physique (optionnel)
    const fs = require('fs');
    const filePath = replay.file_path;

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (fileError) {
      console.error('Erreur lors de la suppression du fichier:', fileError);
      // On continue même si la suppression du fichier échoue
    }

    // Supprimer l'entrée de la base de données
    await pool.query('DELETE FROM streams_replay WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Vidéo supprimée avec succès'
    });

  } catch (error) {
    console.error('Erreur suppression replay:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la suppression de la vidéo'
    });
  }
});

// Route pour récupérer toutes les vidéos du stagiaire connecté
router.get('/replays/me/all', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows } = await pool.query(`
      SELECT 
        id,
        file_path,
        created_at,
        duration,
        note,
        certificat_valide,
        channel_id
      FROM streams_replay
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [userId]);

    // Formatter les URLs vidéo
    const replays = rows.map(row => {
      const rawPath = row.file_path;
      const relativePath = rawPath
        .replace(/\\/g, '/')
        .replace(process.cwd(), '');

      const videoUrl = relativePath.startsWith('/recordings')
        ? relativePath
        : '/recordings' + relativePath.split('/recordings')[1];

      return {
        id: row.id,
        videoUrl: videoUrl,
        createdAt: row.created_at,
        duration: row.duration,
        note: row.note,
        certificatValide: row.certificat_valide,
        channelId: row.channel_id,
        formattedDate: new Date(row.created_at).toLocaleDateString('fr-FR', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      };
    });

    res.json({
      success: true,
      replays: replays,
      count: replays.length
    });

  } catch (err) {
    console.error('Erreur récupération replays stagiaire:', err);
    res.status(500).json({
      success: false,
      error: 'Erreur récupération des vidéos'
    });
  }
});

// Noter un stream en direct (crée ou met à jour l'entrée live dans streams_replay)
router.post('/streams/:channelId/rate-live', authenticate, async (req, res) => {
  try {
    const { channelId } = req.params;
    const { stagiaire_user_id, note_sur_20, note_sur_5 } = req.body;
    const formateur_id = req.user.id;

    // Vérifier que le formateur encadre bien ce stagiaire
    const encadrementCheck = await pool.query(
      `SELECT id FROM encadrements 
       WHERE formateur_id = $1 AND stagiaire_id = $2`,
      [formateur_id, stagiaire_user_id]
    );

    if (encadrementCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Vous ne pouvez noter que vos stagiaires encadrés'
      });
    }

    // Chercher l'entrée dans streams_replay (même sans fichier)
    const existing = await pool.query(
      `SELECT id, certificat_valide FROM streams_replay 
       WHERE channel_id = $1`,
      [channelId]
    );

    let replayId;
    let certificatActuel = false;

    if (existing.rows.length > 0) {
      // Mettre à jour l'entrée existante
      replayId = existing.rows[0].id;
      certificatActuel = existing.rows[0].certificat_valide;

      await pool.query(
        `UPDATE streams_replay 
         SET note = $2
         WHERE id = $1`,
        [replayId, note_sur_20]
      );
    } else {
      // Créer une nouvelle entrée (au cas où)
      const result = await pool.query(
        `INSERT INTO streams_replay
          (user_id, stagiaire_id, channel_id, file_path, note, certificat_valide, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '24 hours')
         RETURNING id`,
        [stagiaire_user_id, stagiaire_user_id, channelId, '', note_sur_20, false]
      );
      replayId = result.rows[0].id;
    }

    // Sauvegarder aussi dans la table notes pour l'historique
    await pool.query(
      `INSERT INTO notes (formateur_id, stagiaire_id, note, commentaire)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (formateur_id, stagiaire_id) 
       DO UPDATE SET note = EXCLUDED.note, updated_at = CURRENT_TIMESTAMP`,
      [formateur_id, stagiaire_user_id, note_sur_20, `Note en direct: ${note_sur_5}/5`]
    );

    res.json({
      success: true,
      message: 'Note enregistrée avec succès',
      replay_id: replayId,
      note_sur_20,
      note_sur_5,
      certificat_valide: certificatActuel
    });

  } catch (error) {
    console.error('Erreur notation live:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Route de test
router.get('/test', (req, res) => {
  res.json({
    message: 'API is working',
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

module.exports = router;
