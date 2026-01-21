const fs = require('fs');
const { networkInterfaces } = require('os');
const { exec } = require('child_process');

function getLocalIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const IP = getLocalIP();

console.log('🌐 Configuration du serveur WebRTC Streaming');
console.log('=============================================');
console.log(`📡 Votre IP: ${IP}`);
console.log();

// Vérifier si les certificats existent déjà
if (fs.existsSync('./localhost+3.pem')) {
  console.log('✅ Certificats SSL déjà générés');
} else {
  console.log('🔐 Génération des certificats SSL...');
  exec(`mkcert localhost 127.0.0.1 ::1 ${IP}`, (error, stdout, stderr) => {
    if (error) {
      console.error('❌ Erreur:', error.message);
      return;
    }
    console.log(stdout);
    console.log('✅ Certificats générés avec succès');
  });
}

console.log();
console.log('📋 Instructions:');
console.log('1. npm install');
console.log('2. npm start');
console.log();
console.log('🔗 URLs:');
console.log(`   • Serveur: https://${IP}:5000`);
console.log(`   • Application: https://${IP}:3000`);
console.log();