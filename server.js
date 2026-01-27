const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const os = require("os");

const app = express();

app.use(express.json());

const server = http.createServer(app);

// 🔥 IMPORTANT: Créer le WebSocket Server avec 'noServer: true'
const wss = new WebSocket.Server({ 
  noServer: true, // Ne pas créer automatiquement le serveur
  perMessageDeflate: false
});

// 🔥 Gérer manuellement l'upgrade WebSocket
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

// Configuration CORS pour les requêtes HTTP
app.use(cors({
  origin: '*', // TOUTES les IPs sont acceptées
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// Middleware de logging
app.use((req, res, next) => {
  console.log(`🌐 ${req.method} ${req.path} depuis: ${req.headers.origin || 'direct'}`);
  next();
});

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

  ws.on("message", (msg) => {
    const buffer = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
    
    if (buffer.length === 1 && buffer[0] === 0x1E) {
      expectingFrame = true;
      return;
    }
    
    if (expectingFrame && currentFrameMetadata) {
      try {
        broadcastToChannel(currentFrameMetadata.channelId, buffer, currentFrameMetadata);
        expectingFrame = false;
        currentFrameMetadata = null;
      } catch (e) {
        console.log(`❌ [${clientId}] Error broadcasting frame:`, e.message);
      }
      return;
    }
    
    try {
      const data = buffer.toString();
      const msgObj = JSON.parse(data);
      
      switch(msgObj.type) {
        case 'unity-register':
          console.log(`🎮 [${clientId}] Unity registering for channel: ${msgObj.channelId}`);
          registerUnity(ws, msgObj.channelId, msgObj.metadata);
          currentChannel = msgObj.channelId;
          isUnity = true;
          
          ws.send(JSON.stringify({ 
            type: 'register-ack', 
            channelId: msgObj.channelId 
          }));
          
          updateViewerCount(msgObj.channelId);
          break;
          
        case 'viewer-subscribe':
          console.log(`👀 [${clientId}] Viewer subscribing to channel: ${msgObj.channelId}`);
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
    } catch(e) {
      console.log(`❓ [${clientId}] Unknown message, length: ${buffer.length} bytes`);
    }
  });

  ws.on("close", () => {
    console.log(`❌ [${clientId}] Connection closed`);
    
    if (isUnity && currentChannel) {
      console.log(`🎮 Unity disconnected from channel: ${currentChannel}`);
      removeUnityFromChannel(currentChannel);
      notifyChannelViewers(currentChannel, { 
        type: 'unity-disconnected', 
        channelId: currentChannel 
      });
    } else if (currentChannel) {
      console.log(`👋 Viewer disconnected from channel: ${currentChannel}`);
      unsubscribeViewer(ws, currentChannel);
    }
    
    updateViewerCount(currentChannel);
  });

  ws.on("error", (err) => {
    console.log(`🔥 [${clientId}] Error:`, err.message);
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

function subscribeViewer(ws, channelId) {
  if (!channels.has(channelId)) {
    console.log(`❌ Channel '${channelId}' does not exist`);
    ws.send(JSON.stringify({ 
      type: 'subscribe-error', 
      channelId: channelId,
      error: 'Channel does not exist'
    }));
    return;
  }
  
  const channel = channels.get(channelId);
  channel.viewers.add(ws);
  console.log(`✅ Viewer subscribed to channel '${channelId}' (total: ${channel.viewers.size})`);
}

function unsubscribeViewer(ws, channelId) {
  if (channels.has(channelId)) {
    const channel = channels.get(channelId);
    channel.viewers.delete(ws);
    console.log(`✅ Viewer unsubscribed from channel '${channelId}' (remaining: ${channel.viewers.size})`);
  }
}

function removeUnityFromChannel(channelId) {
  if (channels.has(channelId)) {
    channels.delete(channelId);
    console.log(`🗑️ Channel '${channelId}' removed (no Unity source)`);
  }
}

function broadcastToChannel(channelId, frameData, metadata) {
  if (!channels.has(channelId)) {
    console.log(`❌ Channel '${channelId}' not found for broadcasting`);
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
      } catch(e) {
        console.log(`⚠️ Error sending to viewer on channel '${channelId}':`, e.message);
        channel.viewers.delete(viewer);
      }
    }
  });
  
  if (Math.random() < 0.05) {
    console.log(`📤 [${channelId}] Sent frame to ${sentCount}/${viewerCount} viewer(s), size: ${Math.round(frameData.length/1024)} KB`);
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
    if (channel.unity && channel.unity.readyState === WebSocket.OPEN) {
      availableChannels.push({
        id: channelId,
        viewerCount: channel.viewers.size,
        metadata: channel.metadata,
        active: true
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

const PORT = process.env.PORT || 5000;

// 🔥 Utiliser server.listen() au lieu de app.listen()
server.listen(PORT, "0.0.0.0", () => {
  console.log("\n🚀 ===== SERVEUR DÉMARRÉ ===== 🚀");
  console.log("📡 URLs d'accès:");
  console.log(`   - IP locale:  http://${LOCAL_IP}:${PORT}`);
  console.log(`   - Localhost:  http://localhost:${PORT}`);
  console.log(`   - WebSocket:  ws://${LOCAL_IP}:${PORT}`);
  console.log(`   - WebSocket:  ws://localhost:${PORT}`);
  console.log("");
  console.log("✅ CORS configuré pour accepter TOUTES les origines (*)");
  console.log("🔓 Toutes les IP peuvent se connecter");
  console.log("\n🌐 Test WebSocket:");
  console.log(`   http://localhost:${PORT}/test-websocket`);
});