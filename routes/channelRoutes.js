const express = require('express');
const router = express.Router();
const channelController = require('../controllers/channelController');
const { authenticate, authorize } = require('../middleware/auth');
const { validateChannel } = require('../middleware/validation');
const { ROLES } = require('../config/constants');

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

module.exports = router;