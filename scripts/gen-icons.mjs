/** 从 assets-src/logo.svg 生成 manifest 所需的各尺寸 PNG */
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';

const svg = readFileSync('assets-src/logo.svg');
mkdirSync('public/icons', { recursive: true });

for (const size of [16, 32, 48, 128]) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(`public/icons/icon-${size}.png`);
  console.log(`icon-${size}.png`);
}
