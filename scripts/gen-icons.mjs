/** 从 assets-src/logo.svg 生成 manifest 所需的各尺寸 PNG */
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';

const svg = readFileSync('assets-src/logo.svg');
mkdirSync('public/icons', { recursive: true });

for (const size of [16, 32, 48, 128]) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(`public/icons/icon-${size}.png`);
  console.log(`icon-${size}.png`);
}

// 锁定态灰色变体（复刻官方 locked icon）
for (const size of [16, 32]) {
  await sharp(svg, { density: 384 })
    .resize(size, size)
    .greyscale()
    .png()
    .toFile(`public/icons/icon-gray-${size}.png`);
  console.log(`icon-gray-${size}.png`);
}
