const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:5000');

ws.on('open', () => {
  console.log('✅ Connected as Unity simulator');
  
  // Envoyer un message connect
  ws.send(JSON.stringify({
    type: 'connect',
    connectionId: 'unity-simulator'
  }));
  
  // Attendre et envoyer une offre factice
  setTimeout(() => {
    const fakeOffer = {
      type: 'offer',
      data: {
        connectionId: 'unity-simulator',
        sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 100 101 102 121 127 120 125 107 108 109 124 119 123 118 114 115 116\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:xyz\r\na=ice-pwd:abcd\r\na=ice-options:trickle\r\na=fingerprint:sha-256 AA:BB:CC\r\na=setup:actpass\r\na=mid:0\r\na=extmap:1 urn:ietf:params:rtp-hdrext:toffset\r\na=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time\r\na=extmap:3 urn:3gpp:video-orientation\r\na=sendrecv\r\na=rtcp-mux\r\na=rtcp-rsize\r\na=rtpmap:96 VP8/90000\r\na=rtcp-fb:96 goog-remb\r\na=rtcp-fb:96 transport-cc\r\na=rtcp-fb:96 ccm fir\r\na=rtcp-fb:96 nack\r\na=rtcp-fb:96 nack pli\r\na=rtpmap:97 rtx/90000\r\na=fmtp:97 apt=96\r\na=rtpmap:98 VP9/90000\r\na=rtcp-fb:98 goog-remb\r\na=rtcp-fb:98 transport-cc\r\na=rtcp-fb:98 ccm fir\r\na=rtcp-fb:98 nack\r\na=rtcp-fb:98 nack pli\r\na=fmtp:98 profile-id=0\r\na=rtpmap:99 rtx/90000\r\na=fmtp:99 apt=98\r\n'
      }
    };
    
    ws.send(JSON.stringify(fakeOffer));
    console.log('📤 Sent fake offer');
  }, 2000);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  console.log('Received:', msg.type, msg.message || '');
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});