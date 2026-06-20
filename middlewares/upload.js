const multer = require('multer');
const streamifier = require('streamifier');
const { PassThrough } = require('stream');

// Try to load sharp, but don't crash if it's not available
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('sharp module not available, image optimization disabled');
  sharp = null;
}

const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

function compressVideo(buffer, type) {
  return new Promise((resolve, reject) => {
    try {
      const ffmpeg = require('fluent-ffmpeg');
      const inputStream = streamifier.createReadStream(buffer);
      const outputChunks = [];
      const outputStream = new PassThrough();

      outputStream.on('data', (chunk) => outputChunks.push(chunk));
      outputStream.on('end', () => resolve(Buffer.concat(outputChunks)));
      outputStream.on('error', reject);

      ffmpeg(inputStream).format('mp4')
        .videoCodec('libx264')
        .size('?x720')
        .videoBitrate('1000k')
        .audioCodec('aac')
        .audioBitrate('128k')
        .on('error', (err) => {
          console.error('ffmpeg error:', err);
          resolve(buffer);
        }).pipe(outputStream, { end: true });
    } catch (e) {
      console.warn('ffmpeg not available, video compression disabled');
      resolve(buffer);
    }
  });
}

async function optimizeAndPrepare(req, res, next) {
  if (!req.files && !req.file) return next();

  try {
    const filesToProcess = req.files ? req.files : [req.file];
    
    const processedFiles = await Promise.all(
      filesToProcess.map(async (file) => {
        let buffer = file.buffer;

        if (file.mimetype.startsWith('image/') && sharp) {
          try {
            buffer = await sharp(buffer)
              .resize({ width: 1200, withoutEnlargement: true })
              .webp({ quality: 80 })
              .toBuffer();
            file.mimetype = 'image/webp';
            file.originalname = file.originalname.replace(/\.[^/.]+$/, "") + ".webp";
            file.buffer = buffer;
          } catch (e) {
            console.warn('Image optimization failed, using original:', e.message);
          }
        } else if (file.mimetype.startsWith('video/')) {
          try {
            buffer = await compressVideo(buffer, 'mp4');
            file.mimetype = 'video/mp4';
            file.originalname = file.originalname.replace(/\.[^/.]+$/, "") + ".mp4";
            file.buffer = buffer;
          } catch (e) {
            console.warn('Video compression failed, using original:', e.message);
          }
        }

        return file;
      })
    );

    if (req.files) {
      req.files = processedFiles;
    } else {
      req.file = processedFiles[0];
    }
    
    next();
  } catch (err) {
    console.error('Error optimizing files:', err);
    next();
  }
}

module.exports = { upload, optimizeAndPrepare };
