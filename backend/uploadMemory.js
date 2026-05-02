const multer = require('multer');

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 },
});

module.exports = uploadMemory;
