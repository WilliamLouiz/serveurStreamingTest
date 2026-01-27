const express = require('express');
const router = express.Router();

// Importer les routes
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const channelRoutes = require('./channelRoutes');
const adminRoutes = require('./adminRoutes');

// Utiliser les routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/channels', channelRoutes);
router.use('/admin', adminRoutes); // Nouvelle route admin

// Route de test
router.get('/test', (req, res) => {
  res.json({
    message: 'API is working',
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

module.exports = router;