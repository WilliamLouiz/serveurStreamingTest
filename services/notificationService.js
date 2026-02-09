const pool = require('../config/database');

class NotificationService {
  /**
   * Créer une notification
   */
  static async create(notificationData) {
    const { user_id, titre, description, type, metadata = {} } = notificationData;

    try {
      const result = await pool.query(
        `INSERT INTO notifications 
         (user_id, titre, description, type, metadata, is_read) 
         VALUES ($1, $2, $3, $4, $5, false)
         RETURNING id, created_at`,
        [user_id, titre, description, type, JSON.stringify(metadata)]
      );

      console.log(` Notification créée pour l'utilisateur ${user_id}: ${titre}`);

      // Émettre un événement WebSocket si nécessaire
      return {
        success: true,
        notification: result.rows[0]
      };

    } catch (error) {
      console.error('Erreur création notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Notifier l'admin d'un nouvel utilisateur
   */
  static async notifyAdminNewUser(user) {
    try {
      console.log(' notifyAdminNewUser appelé avec:', user);

      // Vérifier que l'utilisateur a les propriétés nécessaires
      if (!user || !user.id || !user.email) {
        console.error(' Utilisateur invalide pour notification:', user);
        return;
      }

      // Trouver tous les admins
      const admins = await pool.query(
        "SELECT id FROM users WHERE role = 'admin'"
      );

      console.log(` Admins trouvés: ${admins.rows.length}`);

      const promises = admins.rows.map(admin =>
        this.create({
          user_id: admin.id,
          titre: "Nouvel utilisateur en attente",
          description: `${user.prenom || ''} ${user.nom || ''} (${user.role || 'user'}) a créé un compte et attend validation`,
          type: 'user_pending',
          metadata: {
            user_id: user.id,
            nom: user.nom || '',
            prenom: user.prenom || '',
            email: user.email || '',
            role: user.role || 'user',
            status: 'pending'
          }
        })
      );

      await Promise.all(promises);
      console.log(` Admins notifiés du nouvel utilisateur ${user.email}`);

    } catch (error) {
      console.error('Erreur notification admin:', error);
    }
  }

  /**
   * Notifier un stagiaire que son compte est validé
   */
  static async notifyStagiaireValidated(user) {
    return this.create({
      user_id: user.id,
      titre: "Compte validé ",
      description: "Votre compte a été validé par l'administrateur. Vous pouvez maintenant utiliser la plateforme VR.",
      type: 'account_validated',
      metadata: {
        stagiaire_id: user.stagiaire_id
      }
    });
  }

  /**
   * Notifier un formateur qu'un stagiaire est connecté au stream
   */
  static async notifyFormateurStagiaireConnected(formateur_id, stagiaire_name, channel_id) {
    try {
      // Validation des paramètres
      if (!formateur_id) {
        throw new Error('formateur_id est requis');
      }
      if (!stagiaire_name) {
        throw new Error('stagiaire_name est requis');
      }

      // S'assurer que formateur_id est un nombre
      const formateurIdNum = parseInt(formateur_id);
      if (isNaN(formateurIdNum)) {
        throw new Error(`formateur_id doit être un nombre, reçu: ${formateur_id}`);
      }

      // Vérifier que le formateur existe
      const formateurCheck = await pool.query(
        'SELECT id, nom, prenom FROM users WHERE id = $1',
        [formateurIdNum]
      );

      if (formateurCheck.rows.length === 0) {
        throw new Error(`Formateur avec ID ${formateurIdNum} non trouvé`);
      }
      // Créer la notification
      const query = `
        INSERT INTO notifications 
          (user_id, titre, description, type, metadata, is_read, created_at) 
        VALUES ($1, $2, $3, $4, $5, false, CURRENT_TIMESTAMP)
        RETURNING id, created_at
      `;

      const params = [
        formateurIdNum,
        "Stagiaire connecté au stream",
        `${stagiaire_name} est maintenant connecté au stream VR (Channel: ${channel_id})`,
        'stagiaire_connected',
        JSON.stringify({
          channel_id: channel_id,
          stagiaire_name: stagiaire_name,
          action_url: `/formateur/multiStream?channel=${channel_id}`,
          timestamp: new Date().toISOString()
        })
      ];

      const result = await pool.query(query, params);

      // Vérifier que la notification est bien dans la base
      const verification = await pool.query(
        'SELECT * FROM notifications WHERE id = $1',
        [result.rows[0].id]
      );

      return {
        success: true,
        notification: result.rows[0]
      };

    } catch (error) {
      console.error('[NotificationService] Erreur création notification:');
      console.error('   Message:', error.message);
      console.error('   Code:', error.code || 'N/A');
      console.error('   Stack:', error.stack);

      return {
        success: false,
        error: error.message,
        details: error
      };
    }
  }

  /**
   * Notifier un stagiaire que son replay est disponible
   */
  // Dans notificationService.js
  static async notifyStagiaireReplayAvailable(user_id, replay_url) {
    console.log(` [NotificationService] notifyStagiaireReplayAvailable appelée`);
    console.log(`   user_id: ${user_id} (type: ${typeof user_id})`);
    console.log(`   replay_url: ${replay_url}`);

    try {
      // Validation et conversion
      const userIdNum = parseInt(user_id);
      if (isNaN(userIdNum)) {
        throw new Error(`user_id doit être un nombre, reçu: ${user_id}`);
      }

      // Vérifier que l'utilisateur existe
      const userCheck = await pool.query(
        'SELECT id, nom, prenom, stagiaire_id FROM users WHERE id = $1',
        [userIdNum]
      );

      if (userCheck.rows.length === 0) {
        throw new Error(`Utilisateur avec ID ${userIdNum} non trouvé`);
      }

      const user = userCheck.rows[0];
      console.log(` Utilisateur trouvé: ${user.prenom} ${user.nom} (${user.stagiaire_id})`);

      // Créer la notification
      const result = await pool.query(
        `INSERT INTO notifications 
       (user_id, titre, description, type, metadata, is_read, user_identifier) 
       VALUES ($1, $2, $3, $4, $5, false, $6)
       RETURNING id, created_at`,
        [
          userIdNum,
          "Replay disponible ",
          "Votre session VR a été enregistrée. Vous pouvez maintenant visionner le replay.",
          'replay_available',
          JSON.stringify({
            replay_url: replay_url,
            action_text: "Voir le replay",
            stagiaire_id: user.stagiaire_id
          }),
          user.stagiaire_id  // Stocker aussi l'identifiant VR pour référence
        ]
      );

      console.log(` Notification replay créée avec ID: ${result.rows[0].id}`);

      return {
        success: true,
        notification: result.rows[0]
      };

    } catch (error) {
      console.error(' Erreur création notification replay:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Marquer une notification comme lue
   */
  static async markAsRead(notification_id, user_id) {
    try {
      await pool.query(
        `UPDATE notifications 
         SET is_read = true, read_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND user_id = $2`,
        [notification_id, user_id]
      );

      return { success: true };

    } catch (error) {
      console.error('Erreur marquer notification comme lue:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Marquer toutes les notifications comme lues
   */
  static async markAllAsRead(user_id) {
    try {
      await pool.query(
        `UPDATE notifications 
         SET is_read = true, read_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND is_read = false`,
        [user_id]
      );

      return { success: true };

    } catch (error) {
      console.error('Erreur marquer toutes comme lues:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Récupérer les notifications d'un utilisateur
   */
  static async getUserNotifications(user_id, limit = 20, unread_only = false) {
    try {
      let query = `
        SELECT 
          id,
          titre,
          description,
          type,
          metadata,
          is_read,
          created_at,
          read_at
        FROM notifications
        WHERE user_id = $1
      `;

      const params = [user_id];

      if (unread_only) {
        query += ' AND is_read = false';
      }

      query += ' ORDER BY created_at DESC';

      if (limit) {
        query += ' LIMIT $2';
        params.push(limit);
      }

      const result = await pool.query(query, params);

      return {
        success: true,
        notifications: result.rows,
        unread_count: unread_only ? result.rowCount : await this.getUnreadCount(user_id)
      };

    } catch (error) {
      console.error('Erreur récupération notifications:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Compter les notifications non lues
   */
  static async getUnreadCount(user_id) {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) FROM notifications 
         WHERE user_id = $1 AND is_read = false`,
        [user_id]
      );

      return parseInt(result.rows[0].count);

    } catch (error) {
      console.error('Erreur comptage notifications non lues:', error);
      return 0;
    }
  }

  /**
   * Supprimer une notification
   */
  static async delete(notification_id, user_id) {
    try {
      await pool.query(
        `DELETE FROM notifications 
         WHERE id = $1 AND user_id = $2`,
        [notification_id, user_id]
      );

      return { success: true };

    } catch (error) {
      console.error('Erreur suppression notification:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = NotificationService;

// Fonction d'export pour compatibilité
module.exports.createNotification = NotificationService.create;
module.exports.notifyAdminNewUser = NotificationService.notifyAdminNewUser;
module.exports.notifyStagiaireValidated = NotificationService.notifyStagiaireValidated;