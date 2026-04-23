// Generates a 1024x1024 branded PNG at src-tauri/icons/source.png
// so `tauri icon` can fan it out to all required platform formats.
//
// Pure-Node PNG synthesis (no image library needed). Produces a
// filled-rounded-rect "C" on a dark background in the accent colour.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "src-tauri", "icons", "source.png");

const SIZE = 1024;
const BG    = [0x12, 0x17, 0x1f, 0xff]; // #12171f
const FG    = [0xff, 0xb8, 0x4d, 0xff]; // #ffb84d (accent)
const INK   = [0x0f, 0x11, 0x15, 0xff];

function rgba(pixels, x, y, c) {
  const i = (y * SIZE + x) * 4;
  pixels[i] = c[0]; pixels[i + 1] = c[1]; pixels[i + 2] = c[2]; pixels[i + 3] = c[3];
}

function rounded(pixels) {
  // Rounded square background
  const r = SIZE * 0.18;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = Math.max(0, Math.max(r - x, x - (SIZE - 1 - r)));
      const dy = Math.max(0, Math.max(r - y, y - (SIZE - 1 - r)));
      const inside = dx * dx + dy * dy <= r * r;
      rgba(pixels, x, y, inside ? BG : [0, 0, 0, 0]);
    }
  }
}

function heart(pixels) {
  // A "heart" shape in the accent colour, roughly centred, with a
  // stylised tick to hint at "card/design" (but without being a literal
  // heart, since Cardiac is an editor not a health app).
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const outerR = SIZE * 0.36;
  const innerR = SIZE * 0.22;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > outerR || d < innerR) continue;
      // Gap on the right like a "C"
      if (dx > 0 && Math.abs(dy) < outerR * 0.28) continue;
      rgba(pixels, x, y, FG);
    }
  }
  // Inset dot (accent ink) in the middle
  const dotR = SIZE * 0.065;
  for (let y = -dotR | 0; y <= dotR; y++) {
    for (let x = -dotR | 0; x <= dotR; x++) {
      if (x * x + y * y > dotR * dotR) continue;
      rgba(pixels, Math.round(cx + x), Math.round(cy + y), INK);
    }
  }
}

function crc32Table() {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
}
const CRC = crc32Table();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);  len.writeUInt32BE(data.length);
  const typ = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);  crc.writeUInt32BE(crc32(Buffer.concat([typ, data])));
  return Buffer.concat([len, typ, data, crc]);
}

function encodePng(pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);      // width
  ihdr.writeUInt32BE(SIZE, 4);      // height
  ihdr[8]  = 8;                     // bit depth
  ihdr[9]  = 6;                     // colour type RGBA
  ihdr[10] = 0;                     // compression
  ihdr[11] = 0;                     // filter
  ihdr[12] = 0;                     // interlace

  // Scanline-filtered data
  const stride = SIZE * 4;
  const raw = Buffer.alloc((stride + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * (stride + 1)] = 0; // no filter
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const pixels = Buffer.alloc(SIZE * SIZE * 4, 0);
rounded(pixels);
heart(pixels);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, encodePng(pixels));
console.log(`wrote ${OUT} (${SIZE}x${SIZE})`);
