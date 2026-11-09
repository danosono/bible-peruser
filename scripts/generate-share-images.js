// Share image from the app icon + the Gospel Go wordmark.
//
// Reads the 512×512 Bible Peruser icon (images/favicon-peruser-v1.png — the
// Gg mark with the gold bar that scripts/generate-favicon.js produces; it is
// the app's icon everywhere: tab, home screen and manifest alike) and the
// 620×300 "Gospel go" wordmark (images/gospelgo-logo.png, transparent) and
// writes
//   images/bible-peruser-card-1200x630.png
// the landscape link-preview card at the 1.91:1 size Open Graph previews
// want: icon on the left, wordmark on the right, on the app's dark
// background (#181a1b). App identity from the icon, publisher from the
// wordmark; neither is ever enlarged (the wordmark sits at its native size,
// the icon is shrunk slightly).
//
// Usage: node scripts/generate-share-images.js
// (rerun after generate-favicon.js if the icon ever changes)
//
// Built-ins only (zlib + fs), same approach as generate-favicon.js: a minimal
// PNG decoder/encoder for the one shape these files are — 8-bit RGBA,
// non-interlaced. Not a general-purpose codec.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const IMAGES = path.join(__dirname, "..", "images");
const SOURCE = path.join(IMAGES, "favicon-peruser-v1.png");
const WORDMARK = path.join(IMAGES, "gospelgo-logo.png");
const OUT_CARD = path.join(IMAGES, "bible-peruser-card-1200x630.png");
const BG = [0x18, 0x1a, 0x1b]; // --bg-main
const CARD_W = 1200;
const CARD_H = 630;
const CARD_ICON = 400; // icon size on the card (shrunk from 512, never enlarged)
const ICON_X = 90;
const GAP = 50; // between icon and wordmark

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// ── CRC32 (PNG chunk checksums) ──
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ── Decode: 8-bit RGBA non-interlaced → { width, height, data(RGBA) } ──
function decodePng(file) {
  const buf = fs.readFileSync(file);
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error(`${file}: not a PNG`);
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      const color = data[9];
      const interlace = data[12];
      if (depth !== 8 || color !== 6 || interlace !== 0) {
        throw new Error(`${file}: need 8-bit RGBA non-interlaced (got depth ${depth}, color ${color}, interlace ${interlace})`);
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      switch (filter) {
        case 0:
          break;
        case 1:
          v += a;
          break;
        case 2:
          v += b;
          break;
        case 3:
          v += (a + b) >> 1;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default:
          throw new Error(`${file}: unknown filter ${filter} on row ${y}`);
      }
      cur[x] = v & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, data: out };
}

// ── Encode RGBA → PNG (filter 0 every row; zlib does the rest) ──
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(img) {
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0;
    img.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8; // depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Resample: bilinear with premultiplied alpha, so transparent pixels never
// bleed their (meaningless) color into the edge. 512 → 480 is a mild shrink,
// well within what bilinear handles cleanly. ──
function resizeBilinear(img, w, h) {
  const out = Buffer.alloc(w * h * 4);
  const sx = img.width / w;
  const sy = img.height / h;
  const px = (x, y, c) => img.data[(y * img.width + x) * 4 + c];
  for (let y = 0; y < h; y++) {
    const fy = Math.min(img.height - 1, (y + 0.5) * sy - 0.5);
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(img.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(img.width - 1, (x + 0.5) * sx - 0.5);
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(img.width - 1, x0 + 1);
      const tx = fx - x0;
      const o = (y * w + x) * 4;
      // premultiplied interpolation
      let acc = [0, 0, 0, 0];
      const taps = [
        [x0, y0, (1 - tx) * (1 - ty)],
        [x1, y0, tx * (1 - ty)],
        [x0, y1, (1 - tx) * ty],
        [x1, y1, tx * ty],
      ];
      for (const [tx0, ty0, wgt] of taps) {
        const a = px(tx0, ty0, 3) * wgt;
        acc[0] += px(tx0, ty0, 0) * a;
        acc[1] += px(tx0, ty0, 1) * a;
        acc[2] += px(tx0, ty0, 2) * a;
        acc[3] += a;
      }
      if (acc[3] > 0) {
        out[o] = Math.round(acc[0] / acc[3]);
        out[o + 1] = Math.round(acc[1] / acc[3]);
        out[o + 2] = Math.round(acc[2] / acc[3]);
      }
      out[o + 3] = Math.round(acc[3]);
    }
  }
  return { width: w, height: h, data: out };
}

// ── Solid-color canvas, and alpha-blending a layer onto it at (ox, oy) ──
function makeCanvas(w, h, bg) {
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = bg[0];
    out[i * 4 + 1] = bg[1];
    out[i * 4 + 2] = bg[2];
    out[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data: out };
}
function blit(canvas, fg, ox, oy) {
  const { width: w, height: h, data: out } = canvas;
  for (let y = 0; y < fg.height; y++) {
    const cy = oy + y;
    if (cy < 0 || cy >= h) continue;
    for (let x = 0; x < fg.width; x++) {
      const cx = ox + x;
      if (cx < 0 || cx >= w) continue;
      const i = (y * fg.width + x) * 4;
      const a = fg.data[i + 3] / 255;
      if (a === 0) continue;
      const o = (cy * w + cx) * 4;
      out[o] = Math.round(fg.data[i] * a + out[o] * (1 - a));
      out[o + 1] = Math.round(fg.data[i + 1] * a + out[o + 1] * (1 - a));
      out[o + 2] = Math.round(fg.data[i + 2] * a + out[o + 2] * (1 - a));
    }
  }
}

const icon = decodePng(SOURCE);
if (icon.width !== 512 || icon.height !== 512) {
  throw new Error(`expected a 512×512 source icon, got ${icon.width}×${icon.height}`);
}
const wordmark = decodePng(WORDMARK);
if (ICON_X + CARD_ICON + GAP + wordmark.width > CARD_W) {
  throw new Error(`icon + wordmark (${wordmark.width}px) do not fit the ${CARD_W}px card`);
}

const cardIcon = resizeBilinear(icon, CARD_ICON, CARD_ICON);
const card = makeCanvas(CARD_W, CARD_H, BG);
blit(card, cardIcon, ICON_X, Math.round((CARD_H - CARD_ICON) / 2));
blit(
  card,
  wordmark,
  ICON_X + CARD_ICON + GAP,
  Math.round((CARD_H - wordmark.height) / 2),
);
fs.writeFileSync(OUT_CARD, encodePng(card));
console.log(`wrote ${path.relative(process.cwd(), OUT_CARD)} (${card.width}×${card.height})`);
