const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const os = require("os");
const pool = require('./config/database');
const apiRoutes = require('./routes/apiRoutes');
const NotificationService = require('./services/notificationService');
require('./jobs/cleanupReplays');
require('./jobs/cleanupChannel');
const {
  startRecording,
  saveFrame,
  stopRecording
} = require('./services/streamRecorder');

const path = require('path');

const app = express({
  maxHeaderSize: 64 * 1024 // 64 KB
});

app.use(express.json());

const server = http.createServer(app);

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Configuration CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware de logging
app.use((req, res, next) => {
  console.log(` ${req.method} ${req.path} depuis: ${req.headers.origin || 'direct'}`);
  next();
});

app.use('/recordings', express.static(
  path.join(__dirname, 'recordings')
));

app.use('/api', apiRoutes);

//  Créer le WebSocket Server avec 'noServer: true'
const wss = new WebSocket.Server({
  noServer: true, // Ne pas créer automatiquement le serveur
  perMessageDeflate: false
});

// Vérifier périodiquement les canaux actifs
setInterval(() => {
  const now = Date.now();
  channels.forEach((channel, channelId) => {
    if (channel.unity && channel.unity.readyState === WebSocket.OPEN) {
      // Mettre à jour lastPing
      channel.lastPing = now;

      // Envoyer un ping pour garder la connexion active
      try {
        channel.unity.send(JSON.stringify({ type: 'ping', timestamp: now }));
      } catch (e) {
        console.log(` Erreur ping channel ${channelId}:`, e.message);
      }
    } else if (channel.unity && channel.unity.readyState !== WebSocket.OPEN) {
      // Nettoyer les channels avec Unity déconnecté
      console.log(` Nettoyage channel ${channelId} - Unity déconnecté`);
      channels.delete(channelId);
      broadcastChannelsList();
    }
  });
}, 30000);

//  Gérer manuellement l'upgrade WebSocket
server.on('upgrade', (request, socket, head) => {
  console.log(`🔌 Upgrade request for WebSocket`);

  // Accepter toutes les connexions WebSocket
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Structures identiques au serveur 1
const channels = new Map();
const channelStats = new Map();

console.log("🟢 Starting Multi-Channel JPEG Streaming Server (Backend)...");

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const interfaceName in interfaces) {
    for (const iface of interfaces[interfaceName]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIP();

// WebSocket handling - IDENTIQUE au serveur 1
wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress;
  const clientId = Date.now();
  let currentChannel = null;
  let isUnity = false;

  console.log(`✅ [${clientId}] WebSocket CONNECTED from ${ip}`);

  let expectingFrame = false;
  let currentFrameMetadata = null;

  // Envoyer un message de confirmation de connexion
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Connected to streaming server',
    timestamp: Date.now()
  }));

  ws.on("message", async (msg) => {
    const buffer = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);

    if (buffer.length === 1 && buffer[0] === 0x1E) {
      expectingFrame = true;
      return;
    }

    if (expectingFrame && currentFrameMetadata) {
      saveFrame(currentFrameMetadata.channelId, buffer);

      broadcastToChannel(
        currentFrameMetadata.channelId,
        buffer,
        currentFrameMetadata
      );

      expectingFrame = false;
      currentFrameMetadata = null;
      return;
    }

    try {
      const data = buffer.toString();
      const msgObj = JSON.parse(data);

      switch (msgObj.type) {
        case 'unity-register': {
          const { channelId, userId, metadata } = msgObj;

          console.log(` [${clientId}] Unity registering for channel: ${channelId}`);
          console.log(` User ID reçu: ${userId}`);

          // Vérifier userId
          if (!userId) {
            console.log(` Pas de User ID fourni`);

            // Envoyer une erreur claire à Unity
            ws.send(JSON.stringify({
              type: 'register-error',
              channelId: channelId,
              error: 'USER_ID_REQUIRED',
              message: 'Identifiant utilisateur requis',
              popup: {
                title: 'Erreur d\'authentification',
                content: 'Veuillez fourir un identifiant utilisateur valide.',
                type: 'error'
              }
            }));

            // Fermer la connexion après un délai
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.close(1008, 'User ID required');
              }
            }, 1000);
            return;
          }

          try {
            // Vérification STRICTE de la base de données - PAS DE FALLBACK
            console.log(` Recherche stagiaire_id: ${userId}`);

            // Vérifier d'abord si la base de données est disponible
            try {
              await pool.query('SELECT 1');
            } catch (dbError) {
              console.error(' DATABASE UNAVAILABLE - Rejet de la connexion');
              ws.send(JSON.stringify({
                type: 'register-error',
                channelId: channelId,
                error: 'DATABASE_UNAVAILABLE',
                message: 'Service temporairement indisponible',
                popup: {
                  title: 'Erreur serveur',
                  content: 'Le service est temporairement indisponible. Veuillez réessayer plus tard.',
                  type: 'error'
                }
              }));

              setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.close(1013, 'Service temporarily unavailable');
                }
              }, 1000);
              return;
            }

            // Recherche de l'utilisateur dans la base de données
            const result = await pool.query(
              `SELECT id, nom, prenom, email, stagiaire_id, status, certificat_valide
              FROM users
              WHERE stagiaire_id = $1
                AND role = 'stagiaire'`,
              [userId]
            );

            // CAS 1: Utilisateur non trouvé
            if (result.rows.length === 0) {
              console.log(` Aucun utilisateur trouvé avec stagiaire_id: ${userId}`);

              ws.send(JSON.stringify({
                type: 'register-error',
                channelId: channelId,
                error: 'USER_NOT_FOUND',
                message: 'Identifiant inconnu',
                popup: {
                  title: 'Authentification échouée',
                  content: 'Cet identifiant n\'existe pas. Veuillez vérifier votre identifiant.',
                  type: 'error'
                }
              }));

              setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.close(1008, 'User not found');
                }
              }, 1000);
              return;
            }

            const dbUser = result.rows[0];

            // CAS 2: Utilisateur non validé
            if (dbUser.status !== 'validated') {
              console.log(` Utilisateur ${userId} non validé (status: ${dbUser.status})`);

              ws.send(JSON.stringify({
                type: 'register-error',
                channelId: channelId,
                error: 'USER_NOT_VALIDATED',
                message: 'Compte non validé',
                popup: {
                  title: 'Compte en attente de validation',
                  content: 'Votre compte n\'a pas encore été validé par un formateur.',
                  type: 'warning'
                }
              }));

              setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.close(1008, 'Account not validated');
                }
              }, 1000);
              return;
            }

            // CAS 3: Succès - utilisateur validé trouvé
            console.log(` Stagiaire validé trouvé: ${dbUser.prenom} ${dbUser.nom}`);

            const userInfo = {
              id: dbUser.id,
              nom: dbUser.nom,
              prenom: dbUser.prenom,
              email: dbUser.email,
              stagiaire_id: dbUser.stagiaire_id,
              certificat_valide: dbUser.certificat_valide
            };

            // Créer le channel
            const channel = {
              unity: ws,
              viewers: new Set(),
              metadata: metadata || {},
              userId: userId,
              user: userInfo,
              dbUser: dbUser,
              authenticated: true,
              active: true,
              lastPing: Date.now()
            };

            channels.set(channelId, channel);

            // Sauvegarder le canal actif
            await saveActiveChannel(channelId, dbUser.id, userId, {
              channelName: `Channel ${channelId}`,
              userAgent: metadata.userAgent,
              ip: req.socket.remoteAddress,
              resolution: metadata.resolution,
              fps: metadata.fps
            });

            // Répondre à Unity avec succès
            ws.send(JSON.stringify({
              type: 'register-ack',
              channelId: channelId,
              userId: userId,
              authenticated: true,
              user: {
                nom: userInfo.nom,
                prenom: userInfo.prenom,
                email: userInfo.email,
                certificat_valide: userInfo.certificat_valide
              },
              message: 'Connexion réussie',
              popup: {
                title: 'Connexion réussie',
                content: `Bienvenue ${userInfo.prenom} ${userInfo.nom}`,
                type: 'success'
              }
            }));

            console.log(` Channel '${channelId}' enregistré avec succès pour ${userInfo.prenom} ${userInfo.nom}`);

            // Créer une entrée dans streams_replay DÈS LE DÉBUT
            try {
              // Vérifier si une entrée existe déjà pour ce channel
              const existing = await pool.query(
                `SELECT id FROM streams_replay WHERE channel_id = $1`,
                [channelId]
              );

              if (existing.rows.length === 0) {
                await pool.query(`
                  INSERT INTO streams_replay
                    (user_id, stagiaire_id, channel_id, file_path, expires_at, note, certificat_valide)
                  VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours', $5, $6)
                `, [
                  dbUser.id,
                  userId,
                  channelId,
                  '', // file_path vide pour l'instant
                  null, // note pas encore
                  false // certificat pas encore
                ]);
                console.log(` Entrée créée dans streams_replay pour ${channelId} (en attente du fichier)`);
              } else {
                console.log(` Entrée déjà existante pour ${channelId}`);
              }
            } catch (error) {
              console.error('Erreur création entrée:', error);
            }
            // Démarrer l'enregistrement
            startRecording(channelId, userId);

            // Notifier le formateur
            try {
              const formateurResult = await pool.query(
                `SELECT formateur_id 
                FROM encadrements 
                WHERE stagiaire_id = $1`,
                [dbUser.id]
              );

              if (formateurResult.rows.length > 0) {
                const formateur_id = formateurResult.rows[0].formateur_id;

                await NotificationService.notifyFormateurStagiaireConnected(
                  formateur_id,
                  `${userInfo.prenom} ${userInfo.nom}`,
                  channelId
                );
              }
            } catch (notifError) {
              console.error(" Erreur notification formateur:", notifError.message);
              // Ne pas bloquer la connexion pour une erreur de notification
            }

            // Mettre à jour la liste des canaux
            broadcastChannelsList();

            // Mettre à jour les variables de la connexion
            currentChannel = channelId;
            isUnity = true;

          } catch (error) {
            console.error(` Erreur critique lors de l'enregistrement:`, error);

            ws.send(JSON.stringify({
              type: 'register-error',
              channelId: channelId,
              error: 'SERVER_ERROR',
              message: 'Erreur serveur interne',
              popup: {
                title: 'Erreur technique',
                content: 'Une erreur technique est survenue. Veuillez réessayer.',
                type: 'error'
              }
            }));

            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.close(1011, 'Internal server error');
              }
            }, 1000);
          }
          break;
        }

        case 'viewer-subscribe':
          console.log(` [${clientId}] Viewer subscribing to channel: ${msgObj.channelId}`);
          subscribeViewer(ws, msgObj.channelId);
          currentChannel = msgObj.channelId;

          ws.send(JSON.stringify({
            type: 'subscribe-ack',
            channelId: msgObj.channelId,
            metadata: getChannelMetadata(msgObj.channelId)
          }));

          updateViewerCount(msgObj.channelId);
          break;

        case 'viewer-unsubscribe':
          console.log(`👋 [${clientId}] Viewer unsubscribing from channel: ${msgObj.channelId}`);
          unsubscribeViewer(ws, msgObj.channelId);
          currentChannel = null;
          break;

        case 'frame':
          currentFrameMetadata = msgObj;
          break;

        case 'ping':
          ws.send(JSON.stringify({
            type: 'pong',
            timestamp: Date.now()
          }));
          break;

        case 'list-channels':
          ws.send(JSON.stringify({
            type: 'channels-list',
            channels: getAvailableChannels(),
            timestamp: Date.now()
          }));
          break;

        case 'test':
          // Pour tester la connexion
          ws.send(JSON.stringify({
            type: 'test-response',
            message: 'WebSocket server is working',
            timestamp: Date.now()
          }));
          break;
      }
    } catch (e) {
      console.log(` [${clientId}] Unknown message, length: ${buffer.length} bytes`);
    }
  });

  ws.on("close", async () => {
    console.log(` [${clientId}] Connection closed`);

    if (isUnity && currentChannel) {
      console.log(` Unity disconnected from channel: ${currentChannel}`);
      await removeActiveChannel(currentChannel);

      const replay = await stopRecording(currentChannel);

      if (replay) {
        try {
          // Trouver l'ID utilisateur
          const userResult = await pool.query(
            'SELECT id FROM users WHERE stagiaire_id = $1',
            [replay.stagiaireId]
          );

          if (userResult.rows.length > 0) {
            const userId = userResult.rows[0].id;

            // Mettre à jour l'entrée existante avec le fichier
            const updateResult = await pool.query(`
        UPDATE streams_replay 
        SET 
          file_path = $2,
          expires_at = NOW() + INTERVAL '24 hours'
        WHERE channel_id = $1 AND file_path = ''
        RETURNING id, note
      `, [replay.channelId, replay.filePath]);

            if (updateResult.rows.length > 0) {
              console.log(`✅ Replay mis à jour avec fichier, note existante: ${updateResult.rows[0].note}`);
            } else {
              // Si aucune entrée trouvée avec file_path vide, on vérifie si une entrée existe déjà avec un fichier
              const checkExisting = await pool.query(
                `SELECT id FROM streams_replay WHERE channel_id = $1`,
                [replay.channelId]
              );

              if (checkExisting.rows.length === 0) {
                // Créer une nouvelle entrée (cas improbable)
                await pool.query(`
            INSERT INTO streams_replay
              (user_id, stagiaire_id, channel_id, file_path, expires_at, note, certificat_valide)
            VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours', $5, $6)
          `, [
                  userId,
                  replay.stagiaireId,
                  replay.channelId,
                  replay.filePath,
                  null,
                  false
                ]);
              }
            }

            // Notifier
            await NotificationService.notifyStagiaireReplayAvailable(userId, replay.filePath);

            console.log(`✅ Replay sauvegardé pour ${replay.channelId}`);
          }
        } catch (error) {
          console.error('❌ Erreur sauvegarde replay:', error);
        }
      }
      removeUnityFromChannel(currentChannel);
      notifyChannelViewers(currentChannel, {
        type: 'unity-disconnected',
        channelId: currentChannel
      });
    } else if (currentChannel) {
      console.log(` Viewer disconnected from channel: ${currentChannel}`);
      unsubscribeViewer(ws, currentChannel);
    }

    updateViewerCount(currentChannel);
  });

  ws.on("error", (err) => {
    console.log(` [${clientId}] Error:`, err.message);
  });
});

// === FONCTIONS IDENTIQUES AU SERVEUR 1 ===
function registerUnity(ws, channelId, metadata) {
  if (!channels.has(channelId)) {
    channels.set(channelId, {
      unity: ws,
      viewers: new Set(),
      metadata: metadata || {}
    });
  } else {
    const channel = channels.get(channelId);
    channel.unity = ws;
    channel.metadata = metadata || channel.metadata;
  }

  console.log(`✅ Channel '${channelId}' registered/updated`);
}

function broadcastChannelsList() {
  const availableChannels = getAvailableChannels();
  const message = JSON.stringify({
    type: 'channels-list',
    channels: availableChannels,
    timestamp: Date.now()
  });

  console.log(`📢 Diffusion liste canaux (${availableChannels.length} canaux)`);

  // Envoyer à tous les clients connectés SAUF les Unity
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      // Vérifier si ce client est une connexion Unity
      let isUnity = false;

      // Parcourir tous les canaux pour vérifier si ce client est un Unity
      channels.forEach((channel, channelId) => {
        if (channel.unity === client) {
          isUnity = true;
        }
      });

      // Ne pas envoyer la liste aux Unity
      if (!isUnity) {
        try {
          client.send(message);
        } catch (e) {
          console.log(`⚠️ Erreur envoi liste à client:`, e.message);
        }
      }
    }
  });
}

let dbConnected = false;
async function testDatabaseConnection() {
  try {
    if (pool) {
      await pool.query('SELECT 1');
      dbConnected = true;
      console.log(' Base de données connectée');
    }
  } catch (error) {
    dbConnected = false;
    console.log(' Base de données non disponible, mode fallback activé');
  }
}
testDatabaseConnection();


function subscribeViewer(ws, channelId) {
  if (!channels.has(channelId)) {
    console.log(` Channel '${channelId}' does not exist`);
    ws.send(JSON.stringify({
      type: 'subscribe-error',
      channelId: channelId,
      error: 'Channel does not exist'
    }));
    return;
  }

  const channel = channels.get(channelId);
  channel.viewers.add(ws);
  console.log(` Viewer subscribed to channel '${channelId}' (total: ${channel.viewers.size})`);
}

function unsubscribeViewer(ws, channelId) {
  if (channels.has(channelId)) {
    const channel = channels.get(channelId);
    channel.viewers.delete(ws);
    console.log(` Viewer unsubscribed from channel '${channelId}' (remaining: ${channel.viewers.size})`);
  }
}

function removeUnityFromChannel(channelId) {
  if (channels.has(channelId)) {
    channels.delete(channelId);
    console.log(` Channel '${channelId}' removed (no Unity source)`);
  }
}

function broadcastToChannel(channelId, frameData, metadata) {
  if (!channels.has(channelId)) {
    console.log(` Channel '${channelId}' not found for broadcasting`);
    return;
  }

  const channel = channels.get(channelId);
  const viewerCount = channel.viewers.size;

  if (viewerCount === 0) return;

  let sentCount = 0;
  channel.viewers.forEach(viewer => {
    if (viewer.readyState === WebSocket.OPEN) {
      try {
        viewer.send(JSON.stringify({
          type: 'frame-metadata',
          channelId: channelId,
          timestamp: metadata.timestamp,
          frameSize: metadata.frameSize
        }));

        viewer.send(Buffer.from([0x1E]));
        viewer.send(frameData);

        sentCount++;
      } catch (e) {
        console.log(` Error sending to viewer on channel '${channelId}':`, e.message);
        channel.viewers.delete(viewer);
      }
    }
  });

  if (Math.random() < 0.05) {
    console.log(`[${channelId}] Sent frame to ${sentCount}/${viewerCount} viewer(s), size: ${Math.round(frameData.length / 1024)} KB`);
  }

  updateChannelStats(channelId, viewerCount);
}

function updateViewerCount(channelId) {
  if (!channelId || !channels.has(channelId)) return;

  const channel = channels.get(channelId);
  const viewerCount = channel.viewers.size;

  if (channel.unity && channel.unity.readyState === WebSocket.OPEN) {
    channel.unity.send(JSON.stringify({
      type: 'viewer-count-update',
      channelId: channelId,
      count: viewerCount
    }));
  }
}

function updateChannelStats(channelId, viewerCount) {
  if (!channelStats.has(channelId)) {
    channelStats.set(channelId, {
      viewerCount: 0,
      lastFrameTime: null,
      frameCount: 0
    });
  }

  const stats = channelStats.get(channelId);
  stats.viewerCount = viewerCount;
  stats.lastFrameTime = new Date();
  stats.frameCount++;
}

function getChannelMetadata(channelId) {
  if (channels.has(channelId)) {
    return channels.get(channelId).metadata;
  }
  return null;
}

function getAvailableChannels() {
  const availableChannels = [];

  channels.forEach((channel, channelId) => {
    if (channel.unity && channel.unity.readyState === WebSocket.OPEN && channel.active) {
      availableChannels.push({
        id: channelId,
        userId: channel.userId,
        user: channel.user, // Inclure les infos utilisateur complètes
        authenticated: channel.authenticated,
        viewerCount: channel.viewers.size,
        metadata: channel.metadata,
        active: channel.active
      });
    }
  });

  return availableChannels;
}

function notifyChannelViewers(channelId, message) {
  if (!channels.has(channelId)) return;

  const channel = channels.get(channelId);
  channel.viewers.forEach(viewer => {
    if (viewer.readyState === WebSocket.OPEN) {
      viewer.send(JSON.stringify(message));
    }
  });
}

async function saveActiveChannel(channelId, userId, stagiaireId, metadata = {}) {
  try {
    await pool.query(`
      INSERT INTO active_channels (channel_id, user_id, stagiaire_id, metadata, status, last_ping)
      VALUES ($1, $2, $3, $4, 'connected', CURRENT_TIMESTAMP)
      ON CONFLICT (channel_id) 
      DO UPDATE SET 
        user_id = EXCLUDED.user_id,
        stagiaire_id = EXCLUDED.stagiaire_id,
        metadata = EXCLUDED.metadata,
        status = 'connected',
        last_ping = CURRENT_TIMESTAMP,
        connected_at = CASE 
          WHEN active_channels.status = 'disconnected' THEN CURRENT_TIMESTAMP 
          ELSE active_channels.connected_at 
        END
    `, [channelId, userId, stagiaireId, JSON.stringify(metadata)]);

    console.log(` Canal ${channelId} sauvegardé en base`);
  } catch (error) {
    console.error(' Erreur sauvegarde canal:', error);
  }
}

async function updateChannelStatus(channelId, status) {
  try {
    await pool.query(`
      UPDATE active_channels 
      SET status = $2, last_ping = CURRENT_TIMESTAMP
      WHERE channel_id = $1
    `, [channelId, status]);

    console.log(`Statut canal ${channelId} mis à jour: ${status}`);
  } catch (error) {
    console.error(' Erreur mise à jour statut:', error);
  }
}

async function removeActiveChannel(channelId) {
  try {
    await pool.query(`
      UPDATE active_channels 
      SET status = 'disconnected', last_ping = CURRENT_TIMESTAMP
      WHERE channel_id = $1
    `, [channelId]);

    console.log(` Canal ${channelId} marqué comme déconnecté`);
  } catch (error) {
    console.error(' Erreur suppression canal:', error);
  }
}


// ===== ROUTES HTTP =====

// Route racine
app.get("/", (req, res) => {
  res.json({
    status: "WebSocket Streaming Server",
    message: "Connect using WebSocket protocol",
    endpoints: {
      websocket: `ws://${req.headers.host}`,
      api_channels: `/api/channels`,
      health: `/health`
    },
    stats: {
      channels: channels.size,
      totalViewers: Array.from(channels.values()).reduce((sum, ch) => sum + ch.viewers.size, 0)
    }
  });
});

// Route API REST pour obtenir la liste des canaux
app.get("/api/channels", (req, res) => {
  res.json({
    channels: getAvailableChannels(),
    timestamp: Date.now()
  });
});

// Route de santé
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    channels: channels.size,
    totalViewers: Array.from(channels.values()).reduce((sum, ch) => sum + ch.viewers.size, 0),
    server: {
      ip: LOCAL_IP,
      uptime: process.uptime()
    }
  });
});

// Route pour tester WebSocket via navigateur
app.get("/test-websocket", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Test WebSocket</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        #output { background: #f5f5f5; padding: 10px; margin: 10px 0; }
        .success { color: green; }
        .error { color: red; }
      </style>
    </head>
    <body>
      <h1>Test WebSocket Connection</h1>
      <button onclick="testConnection()">Test Connection</button>
      <div id="output"></div>
      
      <script>
        function testConnection() {
          const output = document.getElementById('output');
          output.innerHTML = 'Testing WebSocket connection...';
          
          const ws = new WebSocket('ws://' + window.location.host);
          
          ws.onopen = () => {
            output.innerHTML += '<div class="success">✅ WebSocket connected!</div>';
            ws.send(JSON.stringify({ type: 'test' }));
          };
          
          ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'welcome') {
              output.innerHTML += '<div class="success">✅ Received welcome message</div>';
            } else if (msg.type === 'test-response') {
              output.innerHTML += '<div class="success">✅ Server responded to test</div>';
              ws.close();
            }
          };
          
          ws.onerror = (error) => {
            output.innerHTML += '<div class="error">❌ Connection failed</div>';
          };
          
          ws.onclose = () => {
            output.innerHTML += '<div>Connection closed</div>';
          };
        }
      </script>
    </body>
    </html>
  `);
});

app.use('/api', (req, res, next) => {
  // Middleware pour rafraîchir automatiquement les tokens
  const newToken = res.get('X-New-Token');

  if (newToken) {
    // Modifier la réponse pour inclure le nouveau token
    const originalJson = res.json;
    res.json = function (data) {
      if (data && typeof data === 'object') {
        data.newToken = newToken;
        data.tokenRefreshed = true;
      }
      originalJson.call(this, data);
    };
  }

  next();
});

const { refreshSession } = require('./middleware/auth');
app.use('/api', refreshSession);

const PORT = process.env.PORT || 5000;

server.listen(PORT, "0.0.0.0", async () => {
  const LOCAL_IP = getLocalIP();

  console.log("\n ===== SERVEUR DÉMARRÉ ===== 🚀");
  console.log("URLs d'accès:");
  console.log(`   - IP locale:  http://${LOCAL_IP}:${PORT}`);
  console.log(`   - Localhost:  http://localhost:${PORT}`);
  console.log(`   - WebSocket:  ws://${LOCAL_IP}:${PORT}`);
  console.log(`   - WebSocket:  ws://localhost:${PORT}`);
  console.log("");
});
