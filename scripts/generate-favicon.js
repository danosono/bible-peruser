// Favicon Generator
// Paints one solid gold pill bar in the upper-left corner of the shared
// images/Gg.png Gospelgo logo, producing images/favicon-peruser-v1.png — a
// favicon that's instantly tellable apart from a plain Gg.png tab (every
// other Gospelgo app/site) and from Bible Explorer's own favicon (same
// upper-left corner — see that project's scripts/generate-favicon-v3.js —
// but orange there and three stacked bars, one wide gold bar here), while
// any app/tab using the shared Gg.png elsewhere (e.g. this app's own in-page
// header logo) is untouched.
//
// Usage: node scripts/generate-favicon.js
//
// No npm install — only Node's built-in zlib (PNG is just DEFLATE-compressed
// scanlines in a well-documented container) and fs. Only handles the one PNG
// shape images/Gg.png actually is (8-bit depth, RGBA color type,
// non-interlaced) — not a general-purpose PNG codec.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SOURCE = path.join(__dirname, "..", "images", "Gg.png");
const OUTPUT = path.join(__dirname, "..", "images", "favicon-peruser-v1.png");

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const GOLD = [255, 224, 130, 255]; // #ffe082 — Bible Peruser's constant (non-themed) gold accent

// Same upper-left corner Bible Explorer's generate-favicon-v3.js uses, but
// one wide pill bar instead of three stacked ones.
const BARS = [{ x: 20, y: 50, w: 300, h: 165 }];

function readChunks(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Not a PNG file");
  }
  const chunks = [];
  let offset = 8;
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    chunks.push({ type, data });
    offset += 12 + len; // length + type + data + crc
  }
  return chunks;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Reverses PNG's per-scanline filtering (bpp = bytes per pixel = 4 for
// 8-bit RGBA), producing a flat width*height*4 pixel buffer with no filter
// bytes or row padding.
function unfilter(inflated, width, height, bpp) {
  const rowBytes = width * bpp;
  const out = Buffer.alloc(height * rowBytes);
  for (let y = 0; y < height; y++) {
    const filterType = inflated[y * (rowBytes + 1)];
    const srcStart = y * (rowBytes + 1) + 1;
    const rowOut = out.subarray(y * rowBytes, (y + 1) * rowBytes);
    const prevRowOut = y > 0 ? out.subarray((y - 1) * rowBytes, y * rowBytes) : null;
    for (let x = 0; x < rowBytes; x++) {
      const raw = inflated[srcStart + x];
      const a = x >= bpp ? rowOut[x - bpp] : 0;
      const b = prevRowOut ? prevRowOut[x] : 0;
      const c = prevRowOut && x >= bpp ? prevRowOut[x - bpp] : 0;
      let value;
      switch (filterType) {
        case 0: value = raw; break;
        case 1: value = raw + a; break;
        case 2: value = raw + b; break;
        case 3: value = raw + Math.floor((a + b) / 2); break;
        case 4: value = raw + paethPredictor(a, b, c); break;
        default: throw new Error(`Unsupported PNG filter type ${filterType}`);
      }
      rowOut[x] = value & 0xff;
    }
  }
  return out;
}

// Re-adds a filter byte (type 0 / None) before each scanline — simplest
// correct encoding, not the smallest possible file.
function refilterNone(pixels, width, height, bpp) {
  const rowBytes = width * bpp;
  const out = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    out[y * (rowBytes + 1)] = 0;
    pixels.copy(out, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  return out;
}

function drawPill(pixels, width, x, y, w, h, color) {
  const r = h / 2;
  const cx1 = x + r;
  const cx2 = x + w - r;
  const cy = y + r;
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      const inRectBody = px >= x + r && px <= x + w - r;
      let inside = inRectBody;
      if (!inside) {
        const cx = px < cx1 ? cx1 : cx2;
        const dx = px - cx;
        const dy = py - cy;
        inside = dx * dx + dy * dy <= r * r;
      }
      if (inside) {
        const idx = (py * width + px) * 4;
        pixels[idx] = color[0];
        pixels[idx + 1] = color[1];
        pixels[idx + 2] = color[2];
        pixels[idx + 3] = color[3];
      }
    }
  }
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typeAndData) >>> 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function main() {
  const source = fs.readFileSync(SOURCE);
  const chunks = readChunks(source);
  const ihdrChunk = chunks.find((c) => c.type === "IHDR");
  if (!ihdrChunk) throw new Error("Missing IHDR chunk");

  const width = ihdrChunk.data.readUInt32BE(0);
  const height = ihdrChunk.data.readUInt32BE(4);
  const bitDepth = ihdrChunk.data.readUInt8(8);
  const colorType = ihdrChunk.data.readUInt8(9);
  const interlace = ihdrChunk.data.readUInt8(12);
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(
      `Unsupported PNG format (bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}) — this script only handles 8-bit RGBA, non-interlaced`,
    );
  }

  const idatData = Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data));
  const inflated = zlib.inflateSync(idatData);
  const pixels = unfilter(inflated, width, height, 4);

  for (const bar of BARS) drawPill(pixels, width, bar.x, bar.y, bar.w, bar.h, GOLD);

  const filtered = refilterNone(pixels, width, height, 4);
  const newIdat = zlib.deflateSync(filtered, { level: 9 });

  const png = Buffer.concat([
    PNG_SIGNATURE,
    makeChunk("IHDR", ihdrChunk.data),
    makeChunk("IDAT", newIdat),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);

  fs.writeFileSync(OUTPUT, png);
  console.log(`Wrote ${OUTPUT}`);
}

main();
