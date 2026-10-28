'use strict';
// Draws the app icon (orange rounded square with "cc") and wraps it as .ico / .png without any dependency.
const zlib = require('zlib');

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// Each pixel is supersampled 3x3 for smooth edges.
function render(size) {
  const bg = [0xc9, 0x64, 0x42], fg = [255, 255, 255], SS = 3, k = size / 256;
  const radius = 56 * k;
  const inBox = (x, y) => {
    const dx = Math.max(radius - x, 0, x - (size - radius)), dy = Math.max(radius - y, 0, y - (size - radius));
    return dx * dx + dy * dy <= radius * radius;
  };
  // A "C": ring with a gap facing right.
  const inC = (x, y, cx) => {
    const dx = x - cx * k, dy = y - 128 * k, d = Math.hypot(dx, dy);
    return d <= 44 * k && d >= 25 * k && Math.abs(Math.atan2(dy, dx)) > 0.72;
  };
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte 0 + RGBA
    for (let x = 0; x < size; x++) {
      let box = 0, glyph = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
        if (!inBox(px, py)) continue;
        box++;
        if (inC(px, py, 86) || inC(px, py, 170)) glyph++;
      }
      const a = box / (SS * SS), g = box ? glyph / box : 0, o = 1 + x * 4;
      for (let c = 0; c < 3; c++) row[o + c] = Math.round(bg[c] * (1 - g) + fg[c] * g);
      row[o + 3] = Math.round(a * 255);
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
}

function png(size = 256) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(render(size))), chunk('IEND', Buffer.alloc(0))]);
}

// ICO with PNG-compressed images (supported since Windows Vista).
function ico(sizes = [256, 48, 32, 16]) {
  const imgs = sizes.map((s) => png(s));
  const head = Buffer.alloc(6 + 16 * imgs.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
  let off = head.length;
  imgs.forEach((img, i) => {
    const e = 6 + i * 16, s = sizes[i];
    head[e] = s === 256 ? 0 : s; head[e + 1] = s === 256 ? 0 : s;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(img.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += img.length;
  });
  return Buffer.concat([head, ...imgs]);
}

module.exports = { png, ico };
