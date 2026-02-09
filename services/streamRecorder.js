const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { v4: uuidv4 } = require('uuid');

ffmpeg.setFfmpegPath(ffmpegPath);

// Enregistreur actif par channel
const recorders = new Map();

function startRecording(channelId, stagiaireId) {
  if (recorders.has(channelId)) return;

  const dateDir = new Date().toISOString().split('T')[0];
  const baseDir = path.join(__dirname, '..', 'recordings', dateDir);

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  const videoId = uuidv4();
  const framesDir = path.join(baseDir, `${videoId}_frames`);
  fs.mkdirSync(framesDir);

  recorders.set(channelId, {
    videoId,
    framesDir,
    frameCount: 0,
    startedAt: new Date(),
    stagiaireId,
    channelId,
    baseDir
  });

  console.log(` Enregistrement démarré pour ${channelId}`);
}

function saveFrame(channelId, buffer) {
  const recorder = recorders.get(channelId);
  if (!recorder) return;

  const frameName = `frame_${String(recorder.frameCount).padStart(6, '0')}.jpg`;
  const framePath = path.join(recorder.framesDir, frameName);

  fs.writeFileSync(framePath, buffer);
  recorder.frameCount++;
}

async function stopRecording(channelId) {
  const recorder = recorders.get(channelId);
  if (!recorder) return null;

  const outputVideo = path.join(
    recorder.baseDir,
    `${recorder.videoId}.mp4`
  );

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(path.join(recorder.framesDir, 'frame_%06d.jpg'))
      .inputFPS(10) //  selon le framerate
      .outputOptions('-pix_fmt yuv420p')
      .save(outputVideo)
      .on('end', resolve)
      .on('error', reject);
  });

  fs.rmSync(recorder.framesDir, { recursive: true, force: true });
  recorders.delete(channelId);

  console.log(`Vidéo générée: ${outputVideo}`);

  return {
    filePath: outputVideo,
    stagiaireId: recorder.stagiaireId,
    channelId: recorder.channelId
  };
}

module.exports = {
  startRecording,
  saveFrame,
  stopRecording
};
