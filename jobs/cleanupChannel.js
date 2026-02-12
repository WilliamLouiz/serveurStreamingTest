const cron = require('node-cron');
const pool = require('../config/database');

cron.schedule('*/5 * * * *', async () => {
  try {
    // Marquer comme déconnectés les canaux qui n'ont pas pingé depuis plus de 2 minutes
    const result = await pool.query(`
      UPDATE active_channels 
      SET status = 'disconnected'
      WHERE last_ping < NOW() - INTERVAL '2 minutes'
        AND status = 'connected'
      RETURNING channel_id
    `);
    
    if (result.rows.length > 0) {
      console.log(`Canaux marqués comme déconnectés: ${result.rows.map(r => r.channel_id).join(', ')}`);
    }
    
    // Supprimer les canaux déconnectés depuis plus de 24h
    await pool.query(`
      DELETE FROM active_channels 
      WHERE status = 'disconnected' 
        AND last_ping < NOW() - INTERVAL '24 hours'
    `);
    
  } catch (error) {
    console.error('Erreur nettoyage canaux:', error);
  }
});

module.exports = cron;