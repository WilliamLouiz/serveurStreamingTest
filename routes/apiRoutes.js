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

const path = require('path');
// Utiliser les routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/channels', channelRoutes);
router.use('/admin', adminRoutes);
router.use("/encadrements", encadrementRoute);
router.use("/notes", noteRoute);
router.use("/notifications", notificationRoute);

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

// Route de test
router.get('/test', (req, res) => {
  res.json({
    message: 'API is working',
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

module.exports = router;