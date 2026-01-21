const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Stockage des connexions et streams
const streams = new Map(); // { streamId: { broadcasterId, viewers: Set(), metadata } }
const clients = new Map(); // { clientId: { ws, type, streamId } }

// Gestion WebSocket
wss.on('connection', (ws, req) => {
  const clientId = uuidv4();
  let clientType = 'viewer';
  
  console.log(`🔌 Nouvelle connexion: ${clientId}`);
  
  // Initialiser le client
  clients.set(clientId, {
    ws,
    type: clientType,
    streamId: null,
    connectedAt: new Date()
  });
  
  // Envoyer confirmation
  ws.send(JSON.stringify({
    type: 'welcome',
    clientId,
    availableStreams: Array.from(streams.keys())
  }));
  
  // Gestion des messages
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'create-stream':
          handleCreateStream(clientId, message);
          break;
          
        case 'join-stream':
          handleJoinStream(clientId, message);
          break;
          
        case 'offer':
          handleOffer(clientId, message);
          break;
          
        case 'answer':
          handleAnswer(clientId, message);
          break;
          
        case 'ice-candidate':
          handleIceCandidate(clientId, message);
          break;
          
        case 'leave-stream':
          handleLeaveStream(clientId);
          break;
          
        case 'list-streams':
          ws.send(JSON.stringify({
            type: 'streams-list',
            streams: Array.from(streams.entries()).map(([id, stream]) => ({
              id,
              broadcaster: stream.broadcasterId,
              viewers: stream.viewers.size,
              metadata: stream.metadata
            }))
          }));
          break;
      }
    } catch (err) {
      console.error('❌ Erreur message:', err);
    }
  });
  
  // Gestion de la déconnexion
  ws.on('close', () => {
    console.log(`🔌 Déconnexion: ${clientId}`);
    handleDisconnect(clientId);
  });
});

// Fonction pour créer un stream
function handleCreateStream(broadcasterId, message) {
  const streamId = message.streamId || `stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const metadata = message.metadata || {};
  
  streams.set(streamId, {
    broadcasterId,
    viewers: new Set(),
    metadata: {
      title: metadata.title || 'Stream sans titre',
      description: metadata.description || '',
      createdAt: new Date(),
      ...metadata
    }
  });
  
  const client = clients.get(broadcasterId);
  client.type = 'broadcaster';
  client.streamId = streamId;
  
  client.ws.send(JSON.stringify({
    type: 'stream-created',
    streamId,
    metadata: streams.get(streamId).metadata
  }));
  
  console.log(`📡 Stream créé: ${streamId} par ${broadcasterId}`);
  
  // Notifier tous les clients qu'un nouveau stream est disponible
  broadcastToAll({
    type: 'stream-added',
    streamId,
    metadata: streams.get(streamId).metadata,
    broadcaster: broadcasterId
  }, broadcasterId);
}

// Fonction pour rejoindre un stream
function handleJoinStream(viewerId, message) {
  const { streamId } = message;
  const stream = streams.get(streamId);
  
  if (!stream) {
    const client = clients.get(viewerId);
    client.ws.send(JSON.stringify({
      type: 'error',
      message: 'Stream non trouvé'
    }));
    return;
  }
  
  stream.viewers.add(viewerId);
  const client = clients.get(viewerId);
  client.streamId = streamId;
  
  // Informer le broadcaster
  const broadcaster = clients.get(stream.broadcasterId);
  if (broadcaster && broadcaster.ws.readyState === WebSocket.OPEN) {
    broadcaster.ws.send(JSON.stringify({
      type: 'viewer-joined',
      viewerId,
      streamId,
      viewerCount: stream.viewers.size
    }));
  }
  
  client.ws.send(JSON.stringify({
    type: 'stream-joined',
    streamId,
    broadcasterId: stream.broadcasterId,
    metadata: stream.metadata
  }));
  
  console.log(`👁️ Viewer ${viewerId} a rejoint ${streamId}`);
}

// Relayer les offres WebRTC
function handleOffer(senderId, message) {
  const { targetId, sdp } = message;
  const targetClient = clients.get(targetId);
  
  if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
    targetClient.ws.send(JSON.stringify({
      type: 'offer',
      senderId,
      sdp
    }));
    console.log(`📤 Offer relayé: ${senderId} -> ${targetId}`);
  }
}

// Relayer les réponses WebRTC
function handleAnswer(senderId, message) {
  const { targetId, sdp } = message;
  const targetClient = clients.get(targetId);
  
  if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
    targetClient.ws.send(JSON.stringify({
      type: 'answer',
      senderId,
      sdp
    }));
    console.log(`📥 Answer relayé: ${senderId} -> ${targetId}`);
  }
}

// Relayer les candidats ICE
function handleIceCandidate(senderId, message) {
  const { targetId, candidate } = message;
  const targetClient = clients.get(targetId);
  
  if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
    targetClient.ws.send(JSON.stringify({
      type: 'ice-candidate',
      senderId,
      candidate
    }));
  }
}

// Gestion de la déconnexion
function handleDisconnect(clientId) {
  const client = clients.get(clientId);
  if (!client) return;
  
  // Si c'est un broadcaster, supprimer son stream
  if (client.type === 'broadcaster' && client.streamId) {
    const stream = streams.get(client.streamId);
    if (stream) {
      // Informer tous les viewers
      stream.viewers.forEach(viewerId => {
        const viewer = clients.get(viewerId);
        if (viewer && viewer.ws.readyState === WebSocket.OPEN) {
          viewer.ws.send(JSON.stringify({
            type: 'stream-ended',
            streamId: client.streamId
          }));
        }
        // Réinitialiser le viewer
        if (viewer) viewer.streamId = null;
      });
      
      streams.delete(client.streamId);
      console.log(`🗑️ Stream supprimé: ${client.streamId}`);
      
      // Notifier tous les clients
      broadcastToAll({
        type: 'stream-removed',
        streamId: client.streamId
      }, clientId);
    }
  }
  
  // Si c'est un viewer, le retirer du stream
  if (client.type === 'viewer' && client.streamId) {
    const stream = streams.get(client.streamId);
    if (stream) {
      stream.viewers.delete(clientId);
      
      // Informer le broadcaster
      const broadcaster = clients.get(stream.broadcasterId);
      if (broadcaster && broadcaster.ws.readyState === WebSocket.OPEN) {
        broadcaster.ws.send(JSON.stringify({
          type: 'viewer-left',
          viewerId: clientId,
          viewerCount: stream.viewers.size
        }));
      }
    }
  }
  
  clients.delete(clientId);
}

function handleLeaveStream(clientId) {
  handleDisconnect(clientId);
  const client = clients.get(clientId);
  if (client) {
    client.streamId = null;
    client.type = 'viewer';
  }
}

// Fonction pour broadcast à tous les clients
function broadcastToAll(message, excludeId = null) {
  clients.forEach((client, clientId) => {
    if (clientId !== excludeId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  });
}

// API REST pour les statistiques
app.get('/api/streams', (req, res) => {
  const activeStreams = [];
  
  streams.forEach((stream, streamId) => {
    activeStreams.push({
      id: streamId,
      broadcaster: stream.broadcasterId,
      viewers: stream.viewers.size,
      metadata: stream.metadata,
      isActive: clients.has(stream.broadcasterId)
    });
  });
  
  res.json({
    success: true,
    total: activeStreams.length,
    streams: activeStreams,
    totalClients: clients.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/stats', (req, res) => {
  let broadcasters = 0;
  let viewers = 0;
  
  clients.forEach(client => {
    if (client.type === 'broadcaster') broadcasters++;
    else viewers++;
  });
  
  res.json({
    clients: {
      total: clients.size,
      broadcasters,
      viewers
    },
    streams: streams.size,
    uptime: process.uptime()
  });
});

// Démarrer le serveur
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ====================================
  🚀 SERVEUR WEBRTC STREAMING
  ====================================
  Port: ${PORT}
  WebSocket: ws://localhost:${PORT}
  API: http://localhost:${PORT}/api/streams
  ====================================
  `);
});