/**
 * Generates TV app icon and banner: rectangular logo on white background with padding.
 * Run from mobile-app: node scripts/generate-tv-icon.js
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

const mobileRoot = path.join(__dirname, '..');
const tvRoot = path.join(mobileRoot, '..', 'tv-app');
const logoPath = path.join(mobileRoot, '..', 'brand', 'logo_long.jpg');
const outDirNodpi = path.join(tvRoot, 'app', 'src', 'main', 'res', 'drawable-nodpi');
const outDirDrawable = path.join(tvRoot, 'app', 'src', 'main', 'res', 'drawable');

const PADDING_PERCENT = 0.18;

function getSizes() {
  const padding = (size) => Math.round(size * PADDING_PERCENT);
  return [
    { name: 'ic_launcher.png', width: 192, height: 192 },
    { name: 'banner.png', width: 1280, height: 720 },
  ];
}

if (!fs.existsSync(logoPath)) {
  console.error('Logo not found:', logoPath);
  process.exit(1);
}

[outDirNodpi, outDirDrawable].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

async function generateOne(sizeSpec) {
  const { name, width: SIZE_W, height: SIZE_H } = sizeSpec;
  const paddingX = Math.round(SIZE_W * PADDING_PERCENT);
  const paddingY = Math.round(SIZE_H * PADDING_PERCENT);
  const contentW = SIZE_W - 2 * paddingX;
  const contentH = SIZE_H - 2 * paddingY;

  const logo = sharp(logoPath);
  const meta = await logo.metadata();
  const w = meta.width || 1;
  const h = meta.height || 1;
  const scale = Math.min(contentW / w, contentH / h, 1);
  const logoW = Math.round(w * scale);
  const logoH = Math.round(h * scale);
  const left = Math.round((SIZE_W - logoW) / 2);
  const top = Math.round((SIZE_H - logoH) / 2);

  const logoBuf = await logo
    .resize(logoW, logoH, { fit: 'inside' })
    .toBuffer();

  const outPath = path.join(outDirNodpi, name);
  await sharp({
    create: {
      width: SIZE_W,
      height: SIZE_H,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: logoBuf, left, top }])
    .png()
    .toFile(outPath);

  const outPathDrawable = path.join(outDirDrawable, name);
  fs.copyFileSync(outPath, outPathDrawable);
  console.log('Generated:', outPath, 'and', outPathDrawable);
}

async function main() {
  for (const spec of getSizes()) {
    await generateOne(spec);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
