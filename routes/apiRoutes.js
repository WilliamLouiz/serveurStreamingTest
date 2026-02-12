const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const pool = require('../config/database');
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const channelRoutes = require('./channelRoutes');
const adminRoutes = require('./adminRoutes');
const encadrementRoute = require("./encadrementRoutes");
const noteRoute = require("./noteRoutes");
const notificationRoute = require("./notificationRoutes")
const commentRoutes = require("./commentRoutes");

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
        sr.*,
        u.id as stagiaire_user_id,
        u.nom as stagiaire_nom,
        u.prenom as stagiaire_prenom,
        u.stagiaire_id,
        f.nom as formateur_nom,
        f.prenom as formateur_prenom,
        n.note as existing_note,
        n.commentaire as note_commentaire,
        n.created_at as note_date
      FROM streams_replay sr
      LEFT JOIN users u ON sr.stagiaire_id = u.stagiaire_id
      LEFT JOIN encadrements e ON u.id = e.stagiaire_id AND e.formateur_id = $1
      LEFT JOIN users f ON e.formateur_id = f.id
      LEFT JOIN notes n ON u.id = n.stagiaire_id AND n.formateur_id = $1
      WHERE sr.expires_at > NOW()
    `;
    
    // Si c'est un formateur, seulement ses stagiaires
    if (user.role === 'formateur') {
      query += ` AND e.formateur_id = $1`;
    } else if (user.role === 'admin') {
      // Admin voit tout - pas de filtre
    } else {
      return res.status(403).json({
        success: false,
        error: 'Accès non autorisé'
      });
    }
    
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
        has_note: !!replay.existing_note,
        existing_note: replay.existing_note,
        note_commentaire: replay.note_commentaire,
        note_date: replay.note_date
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

// Route de test
router.get('/test', (req, res) => {
  res.json({
    message: 'API is working',
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

module.exports = router;