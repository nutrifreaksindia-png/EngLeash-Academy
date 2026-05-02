/**
 * Generates app icon: rectangular logo on white background with padding.
 * Run: node scripts/generate-icon.js
 * Requires: npm install --save-dev sharp
 */
const path = require('path');
const fs = require('fs');

let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('Run: npm install --save-dev sharp');
  process.exit(1);
}

const SIZE = 1024;
const PADDING_PERCENT = 0.18; // 18% padding on each side
const padding = Math.round(SIZE * PADDING_PERCENT);
const contentSize = SIZE - 2 * padding;

const root = path.join(__dirname, '..');
const logoPath = path.join(root, '..', 'brand', 'logo_long.jpg');
const outPath = path.join(root, 'assets', 'icon.png');

if (!fs.existsSync(logoPath)) {
  console.error('Logo not found:', logoPath);
  process.exit(1);
}

async function main() {
  const logo = sharp(logoPath);
  const meta = await logo.metadata();
  const w = meta.width || 1;
  const h = meta.height || 1;
  const scale = Math.min(contentSize / w, contentSize / h, 1);
  const logoW = Math.round(w * scale);
  const logoH = Math.round(h * scale);
  const left = Math.round((SIZE - logoW) / 2);
  const top = Math.round((SIZE - logoH) / 2);

  const logoBuf = await logo
    .resize(logoW, logoH, { fit: 'inside' })
    .toBuffer();

  await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: logoBuf, left, top }])
    .png()
    .toFile(outPath);

  console.log('Generated:', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
