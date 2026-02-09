const express = require("express");
const router = express.Router();

const { authenticate } = require("../middleware/auth");
const NotificationService = require("../services/notificationService");


/**
 * Récupérer les notifications de l'utilisateur
 */
router.get(
  "/me",
  authenticate,
  async (req, res) => {
    try {
      const { limit = 20, unread_only = false } = req.query;

      const result = await NotificationService.getUserNotifications(
        req.user.id, 
        parseInt(limit),
        unread_only === 'true'
      );

      if (!result.success) {
        return res.status(500).json(result);
      }

      // Calculer le nombre de non-lues
      const unread_count = result.notifications.filter(n => !n.is_read).length;

      // Générer un champ description propre pour chaque notification
      const notifications = result.notifications.map(n => {
        let desc = n.description;
        // Si description vide, générer par défaut
        if (!desc) {
          const username = n.metadata?.username || 'Utilisateur';
          const firstname = n.metadata?.prenom || '';
          const lastname = n.metadata?.nom || '';
          desc = `${firstname} ${lastname} (${username}) a créé un compte et attend validation`.trim();
        }
        return { ...n, description: desc };
      });

      res.json({
        success: true,
        notifications,
        unread_count
      });

    } catch (error) {
      console.error('Erreur récupération notifications:', error);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }
);


/**
 * Compter les notifications non lues
 */
router.get(
  "/me/unread-count",
  authenticate,
  async (req, res) => {
    try {
      const count = await NotificationService.getUnreadCount(req.user.id);
      
      res.json({
        success: true,
        unread_count: count
      });

    } catch (error) {
      console.error('Erreur comptage notifications:', error);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }
);

/**
 * Marquer une notification comme lue
 */
router.patch(
  "/:id/read",
  authenticate,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      const result = await NotificationService.markAsRead(id, req.user.id);

      if (!result.success) {
        return res.status(500).json(result);
      }

      res.json({
        success: true,
        message: "Notification marquée comme lue"
      });

    } catch (error) {
      console.error('Erreur marquer notification comme lue:', error);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }
);

/**
 * Marquer toutes les notifications comme lues
 */
router.patch(
  "/read-all",
  authenticate,
  async (req, res) => {
    try {
      const result = await NotificationService.markAllAsRead(req.user.id);

      if (!result.success) {
        return res.status(500).json(result);
      }

      res.json({
        success: true,
        message: "Toutes les notifications marquées comme lues"
      });

    } catch (error) {
      console.error('Erreur marquer toutes comme lues:', error);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }
);

/**
 * Supprimer une notification
 */
router.delete(
  "/:id",
  authenticate,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      const result = await NotificationService.delete(id, req.user.id);

      if (!result.success) {
        return res.status(500).json(result);
      }

      res.json({
        success: true,
        message: "Notification supprimée"
      });

    } catch (error) {
      console.error('Erreur suppression notification:', error);
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
  }
);


module.exports = router;
