const express = require('express');
const router = express.Router();
const channelController = require('../controllers/channelController');
const { authenticate, authorize } = require('../middleware/auth');
const { validateChannel } = require('../middleware/validation');
const { ROLES } = require('../config/constants');
const pool = require('../config/database');
// Routes publiques
router.get('/', channelController.getAllChannels);
router.get('/popular', channelController.getPopularChannels);
router.get('/:id', channelController.getChannelById);

// Routes protégées
router.use(authenticate);

// Créer un canal (Formateur ou Admin)
router.post('/', authorize([ROLES.FORMATEUR, ROLES.ADMIN]), validateChannel, channelController.createChannel);

// Mettre à jour un canal (créateur ou admin)
router.put('/:id', channelController.updateChannel);

// Supprimer un canal (créateur ou admin)
router.delete('/:id', channelController.deleteChannel);

// S'abonner à un canal
router.post('/:channelId/subscribe', channelController.subscribeToChannel);

// Se désabonner d'un canal
router.post('/:channelId/unsubscribe', channelController.unsubscribeFromChannel);

// Mes abonnements
router.get('/my-subscriptions', channelController.getMySubscriptions);

// Canaux que j'ai créés
router.get('/created-by-me', channelController.getChannelsByMe);

// Route pour récupérer les canaux actifs avec infos stagiaires
router.get('/active-channels', authenticate, async (req, res) => {
  try {
    const user = req.user;
    
    let query = `
        SELECT 
        ac.*,
        u.id as user_id,
        u.nom,
        u.prenom,
        u.email,
        u.stagiaire_id,
        u.role,
        f.nom as formateur_nom,
        f.prenom as formateur_prenom,
        f.id as formateur_id,
        e.id as encadrement_id
      FROM active_channels ac
      LEFT JOIN users u ON ac.user_id = u.id
      LEFT JOIN encadrements e ON u.id = e.stagiaire_id
      LEFT JOIN users f ON e.formateur_id = f.id
      WHERE ac.status = 'connected'
    `;
    
    // Si c'est un formateur, seulement voir ses stagiaires
    if (user.role === 'formateur') {
      query += ` AND e.formateur_id = $1`;
    }
    // Admin voit tout
    
    query += ` ORDER BY ac.connected_at DESC`;
    
    const params = user.role === 'formateur' ? [user.id] : [];
    
    const result = await pool.query(query, params);
    
    const channels = result.rows.map(row => ({
      channel_id: row.channel_id,
      channel_name: `Channel ${row.channel_id}`,
      connected_at: row.connected_at,
      last_ping: row.last_ping,
      stagiaire: row.user_id ? {
        id: row.user_id,
        nom: row.nom,
        prenom: row.prenom,
        fullName: `${row.prenom} ${row.nom}`,
        email: row.email,
        stagiaire_id: row.stagiaire_id
      } : null,
      formateur: row.formateur_id ? {
        id: row.formateur_id,
        nom: row.formateur_nom,
        prenom: row.formateur_prenom,
        fullName: `${row.formateur_prenom} ${row.formateur_nom}`
      } : null,
      metadata: row.metadata || {},
      encadrement_id: row.encadrement_id
    }));
    
    res.json({
      success: true,
      channels: channels,
      count: channels.length
    });
    
  } catch (error) {
    console.error('Erreur récupération canaux actifs:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des canaux actifs'
    });
  }
});

// Route pour récupérer un canal spécifique avec ses détails
router.get('/active-channels/:channelId', authenticate, async (req, res) => {
  try {
    const { channelId } = req.params;
    const user = req.user;
    
    const query = `
      SELECT 
        ac.*,
        u.id as user_id,
        u.nom,
        u.prenom,
        u.email,
        u.stagiaire_id,
        u.role,
        f.nom as formateur_nom,
        f.prenom as formateur_prenom,
        f.id as formateur_id,
        e.id as encadrement_id,
        n.note,
        n.commentaire,
        n.created_at as note_date
      FROM active_channels ac
      LEFT JOIN users u ON ac.user_id = u.id
      LEFT JOIN encadrements e ON u.id = e.stagiaire_id
      LEFT JOIN users f ON e.formateur_id = f.id
      LEFT JOIN notes n ON u.id = n.stagiaire_id AND n.formateur_id = $2
      WHERE ac.channel_id = $1 AND ac.status = 'connected'
      ORDER BY n.created_at DESC
      LIMIT 1
    `;
    
    const params = user.role === 'formateur' ? [channelId, user.id] : [channelId, null];
    
    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Canal non trouvé ou déconnecté'
      });
    }
    
    const row = result.rows[0];
    const channel = {
      channel_id: row.channel_id,
      channel_name: `Channel ${row.channel_id}`,
      connected_at: row.connected_at,
      last_ping: row.last_ping,
      stagiaire: row.user_id ? {
        id: row.user_id,
        nom: row.nom,
        prenom: row.prenom,
        fullName: `${row.prenom} ${row.nom}`,
        email: row.email,
        stagiaire_id: row.stagiaire_id
      } : null,
      formateur: row.formateur_id ? {
        id: row.formateur_id,
        nom: row.formateur_nom,
        prenom: row.formateur_prenom,
        fullName: `${row.formateur_prenom} ${row.formateur_nom}`
      } : null,
      metadata: row.metadata || {},
      encadrement_id: row.encadrement_id,
      note: row.note ? {
        note: parseFloat(row.note),
        note_sur_5: Math.round(parseFloat(row.note) / 4 * 10) / 10,
        commentaire: row.commentaire,
        date: row.note_date
      } : null
    };
    
    res.json({
      success: true,
      channel: channel
    });
    
  } catch (error) {
    console.error('Erreur récupération détail canal:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération du canal'
    });
  }
});

// Route pour récupérer un stagiaire par son ID VR (VR7574, etc.)
router.get('/stagiaire/:identifier', authenticate, async (req, res) => {
  try {
    const { identifier } = req.params;
    
    const result = await pool.query(
      `SELECT id, nom, prenom, email, stagiaire_id, role, status 
       FROM users 
       WHERE stagiaire_id = $1 OR id::text = $1
       AND role = 'stagiaire'`,
      [identifier]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Stagiaire non trouvé'
      });
    }
    
    res.json({
      success: true,
      user: result.rows[0]
    });
    
  } catch (error) {
    console.error('Erreur récupération stagiaire:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;