const cron = require('node-cron');
const fs = require('fs');
const pool = require('../config/database');

cron.schedule('0 * * * *', async () => {
  const { rows } = await pool.query(`
    SELECT id, file_path
    FROM streams_replay
    WHERE expires_at < NOW()
  `);

  for (const replay of rows) {
    if (fs.existsSync(replay.file_path)) {
      fs.unlinkSync(replay.file_path);
    }

    await pool.query(
      'DELETE FROM streams_replay WHERE id = $1',
      [replay.id]
    );
  }

  console.log(' Replays expirés supprimés');
});
