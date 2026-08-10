/**
 * Generates the PWA icons in `public/icons` — an ink field with a gold Nivasa
 * monogram. Pure Node (zlib + a minimal PNG encoder), so there is no image
 * dependency to install. Run with `npm run icons` after changing the marks.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const INK = [0x1c, 0x19, 0x17];
const GOLD = [0xa1, 0x62, 0x07];
const GOLD_LIGHT = [0xc9, 0x9a, 0x3f];

/* ------------------------------------------------------------- png encoder */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {Uint8Array} rgb packed RGB, width*height*3 */
function encodePng(rgb, size) {
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- the mark */

/** Shortest distance from a point to a segment. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * @param {number} size    canvas edge in px
 * @param {number} inset   fraction of the edge kept clear around the monogram
 * @param {boolean} ring   draw the hairline frame (skipped on maskable icons)
 */
function renderIcon(size, inset, ring) {
  const rgb = new Uint8Array(size * size * 3);
  const pad = size * inset;
  const x0 = pad;
  const x1 = size - pad;
  const y0 = pad;
  const y1 = size - pad;
  const w = size * 0.105; // stroke width
  const half = w / 2;

  const ringInset = size * 0.055;
  const ringWidth = Math.max(1.5, size * 0.008);

  // The three strokes of the N: left stem, diagonal, right stem.
  const strokes = [
    [x0 + half, y0, x0 + half, y1],
    [x0 + half, y0, x1 - half, y1],
    [x1 - half, y0, x1 - half, y1],
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      let d = Infinity;
      for (const [ax, ay, bx, by] of strokes) {
        d = Math.min(d, distToSegment(px, py, ax, ay, bx, by));
      }
      // 1px feather keeps the diagonal from stair-stepping.
      let coverage = Math.max(0, Math.min(1, half - d + 0.5));
      let colour = GOLD;

      if (ring) {
        const edge = Math.min(px, py, size - px, size - py);
        const ringCoverage = Math.max(
          0,
          Math.min(1, ringWidth / 2 - Math.abs(edge - ringInset) + 0.5),
        );
        if (ringCoverage > coverage) {
          coverage = ringCoverage;
          colour = GOLD_LIGHT;
        }
      }

      const [r, g, b] = coverage <= 0 ? INK : mix(INK, colour, coverage);
      const i = (y * size + x) * 3;
      rgb[i] = r;
      rgb[i + 1] = g;
      rgb[i + 2] = b;
    }
  }
  return encodePng(rgb, size);
}

mkdirSync(OUT_DIR, { recursive: true });

const files = [
  ["icon-192.png", renderIcon(192, 0.26, true)],
  ["icon-512.png", renderIcon(512, 0.26, true)],
  // Maskable icons are cropped to a circle by the launcher: keep the mark well inside.
  ["icon-maskable-512.png", renderIcon(512, 0.34, false)],
];

for (const [name, buffer] of files) {
  writeFileSync(resolve(OUT_DIR, name), buffer);
  console.log(`wrote public/icons/${name} (${buffer.length} bytes)`);
}
