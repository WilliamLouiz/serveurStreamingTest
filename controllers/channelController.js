const Channel = require('../models/Channel');

exports.getAllChannels = async (req, res) => {
  try {
    const channels = await Channel.getAll();
    res.json({
      success: true,
      channels,
      count: channels.length
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des canaux:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des canaux'
    });
  }
};

exports.getPopularChannels = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const channels = await Channel.getPopularChannels(parseInt(limit));
    res.json({
      success: true,
      channels
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des canaux populaires:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des canaux populaires'
    });
  }
};

exports.getChannelById = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) {
      return res.status(404).json({
        success: false,
        error: 'Canal non trouvé'
      });
    }

    res.json({
      success: true,
      channel
    });
  } catch (error) {
    console.error('Erreur lors de la récupération du canal:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération du canal'
    });
  }
};

exports.createChannel = async (req, res) => {
  try {
    const { name, description } = req.body;
    
    const channelId = await Channel.create({
      name,
      description,
      created_by: req.user.id
    });

    const channel = await Channel.findById(channelId);

    res.status(201).json({
      success: true,
      message: 'Canal créé avec succès',
      channel
    });
  } catch (error) {
    console.error('Erreur lors de la création du canal:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la création du canal'
    });
  }
};

exports.updateChannel = async (req, res) => {
  try {
    const { name, description } = req.body;
    
    // Vérifier que l'utilisateur est le créateur ou un admin
    const channel = await Channel.findById(req.params.id);
    if (!channel) {
      return res.status(404).json({
        success: false,
        error: 'Canal non trouvé'
      });
    }

    if (channel.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Vous n\'êtes pas autorisé à modifier ce canal'
      });
    }

    const updated = await Channel.update(req.params.id, { name, description });
    
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'Canal non trouvé'
      });
    }

    const updatedChannel = await Channel.findById(req.params.id);

    res.json({
      success: true,
      message: 'Canal mis à jour avec succès',
      channel: updatedChannel
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du canal:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la mise à jour du canal'
    });
  }
};

exports.deleteChannel = async (req, res) => {
  try {
    // Vérifier que l'utilisateur est le créateur ou un admin
    const channel = await Channel.findById(req.params.id);
    if (!channel) {
      return res.status(404).json({
        success: false,
        error: 'Canal non trouvé'
      });
    }

    if (channel.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Vous n\'êtes pas autorisé à supprimer ce canal'
      });
    }

    const deleted = await Channel.delete(req.params.id);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Canal non trouvé'
      });
    }

    res.json({
      success: true,
      message: 'Canal supprimé avec succès'
    });
  } catch (error) {
    console.error('Erreur lors de la suppression du canal:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la suppression du canal'
    });
  }
};

exports.subscribeToChannel = async (req, res) => {
  try {
    const subscriptionId = await Channel.subscribe(req.user.id, req.params.channelId);
    
    if (subscriptionId === null) {
      return res.status(400).json({
        success: false,
        error: 'Vous êtes déjà abonné à ce canal'
      });
    }

    res.json({
      success: true,
      message: 'Abonnement réussi',
      subscriptionId
    });
  } catch (error) {
    console.error('Erreur lors de l\'abonnement au canal:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de l\'abonnement au canal'
    });
  }
};

exports.unsubscribeFromChannel = async (req, res) => {
  try {
    const unsubscribed = await Channel.unsubscribe(req.user.id, req.params.channelId);
    
    if (!unsubscribed) {
      return res.status(400).json({
        success: false,
        error: 'Vous n\'êtes pas abonné à ce canal'
      });
    }

    res.json({
      success: true,
      message: 'Désabonnement réussi'
    });
  } catch (error) {
    console.error('Erreur lors du désabonnement du canal:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors du désabonnement du canal'
    });
  }
};

exports.getMySubscriptions = async (req, res) => {
  try {
    const channels = await Channel.getUserSubscriptions(req.user.id);
    
    res.json({
      success: true,
      channels,
      count: channels.length
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des abonnements:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des abonnements'
    });
  }
};

exports.getChannelsByMe = async (req, res) => {
  try {
    const db = require('../config/database');
    const result = await db.query(
      'SELECT * FROM channels WHERE created_by = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    
    res.json({
      success: true,
      channels: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des canaux créés:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des canaux créés'
    });
  }
};