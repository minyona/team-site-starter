import { deflateSync } from "node:zlib";

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (1 + stride) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function hex(color, fallback) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color || ""));
  const h = m ? m[1] : fallback;
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16), 255];
}

function cubic(a, b, c, d, t) {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

function flatten(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const pts = [];
  let i = 0;
  let cmd = "";
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const line = (nx, ny) => {
    if (!pts.length) { sx = nx; sy = ny; }
    x = nx;
    y = ny;
    pts.push([x, y]);
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    if (cmd === "M") {
      line(+tokens[i++], +tokens[i++]);
      cmd = "L";
    } else if (cmd === "L") line(+tokens[i++], +tokens[i++]);
    else if (cmd === "V") line(x, +tokens[i++]);
    else if (cmd === "v") line(x, y + +tokens[i++]);
    else if (cmd === "H") line(+tokens[i++], y);
    else if (cmd === "C" || cmd === "c") {
      const rel = cmd === "c";
      const x1 = (rel ? x : 0) + +tokens[i++];
      const y1 = (rel ? y : 0) + +tokens[i++];
      const x2 = (rel ? x : 0) + +tokens[i++];
      const y2 = (rel ? y : 0) + +tokens[i++];
      const ex = (rel ? x : 0) + +tokens[i++];
      const ey = (rel ? y : 0) + +tokens[i++];
      for (let s = 1; s <= 14; s++) pts.push([cubic(x, x1, x2, ex, s / 14), cubic(y, y1, y2, ey, s / 14)]);
      x = ex;
      y = ey;
    } else if (cmd === "Z" || cmd === "z") {
      x = sx;
      y = sy;
    } else break;
  }
  return pts;
}

function inside(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const OUTER = flatten("M60 4 112 20v44c0 34-22 58-52 72C30 122 8 98 8 64V20z");
const INNER = flatten("M60 14 103 27v37c0 28-18 49-43 61C35 113 17 92 17 64V27z");

function star() {
  const pts = [];
  const cx = 60;
  const cy = 88;
  for (let n = 0; n < 10; n++) {
    const r = n % 2 === 0 ? 8.2 : 3.5;
    const a = -Math.PI / 2 + (n * Math.PI) / 5;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}
const STAR = star();

const GLYPH = {
  S: ["01110", "10001", "10000", "01110", "00001", "10001", "01110"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"]
};

function textHit(vx, vy) {
  const cell = 2.05;
  const gap = 1.7;
  const letters = ["S", "F", "C"];
  const width = letters.length * 5 * cell + (letters.length - 1) * gap;
  const x0 = 60 - width / 2;
  const y0 = 33;
  for (let li = 0; li < letters.length; li++) {
    const g = GLYPH[letters[li]];
    const gx = x0 + li * (5 * cell + gap);
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (g[r][c] !== "1") continue;
        const x = gx + c * cell;
        const y = y0 + r * cell;
        if (vx >= x && vx < x + cell * 0.92 && vy >= y && vy < y + cell * 0.92) return true;
      }
    }
  }
  return false;
}

export function crestPng(size, theme) {
  const dark = hex(theme.dark, "14213d");
  const primary = hex(theme.primary, "2f7d5b");
  const accent = hex(theme.accent, "e3a82b");
  const paper = hex(theme.paper, "f4f6f1");
  const white = [255, 255, 255, 255];
  const pad = size * 0.07;
  const scale = (size - pad * 2) / 140;
  const ox = (size - 120 * scale) / 2;
  const oy = (size - 140 * scale) / 2;
  const rgba = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const vx = (px + 0.5 - ox) / scale;
      const vy = (py + 0.5 - oy) / scale;
      let color = paper;
      if (inside(OUTER, vx, vy)) color = dark;
      if (inside(INNER, vx, vy)) color = primary;
      if (inside(INNER, vx, vy) && vx >= 17 && vx <= 103 && vy >= 61.5 && vy <= 66.5) color = accent;
      if ((vx - 60) ** 2 + (vy - 88) ** 2 <= 17 ** 2) color = white;
      if (inside(STAR, vx, vy)) color = dark;
      if (textHit(vx, vy)) color = white;
      const o = (py * size + px) * 4;
      rgba[o] = color[0];
      rgba[o + 1] = color[1];
      rgba[o + 2] = color[2];
      rgba[o + 3] = color[3];
    }
  }
  return encodePng(size, size, rgba);
}
