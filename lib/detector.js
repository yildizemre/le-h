// Gerçek nesne algılama (YOLO-World, sınıflar sabitlenmiş ONNX): kişi, baret, forklift, yelek, ateş, duman.
// Kutular piksel isabetli; içerik görsellerindeki çerçeveler bu modelden gelir (AI tahmini değil).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { DATA } = require('./db');

const CLASSES = ['person', 'hard hat', 'forklift', 'safety vest', 'fire', 'smoke'];
const MIN = { person: 0.35, 'hard hat': 0.18, forklift: 0.15, 'safety vest': 0.3, fire: 0.25, smoke: 0.25 };
const MODEL = process.env.DETECT_MODEL || path.join(DATA, 'models', 'hv-world.onnx');
const S = 640;
let sess = null;
async function session() {
  if (sess) return sess;
  if (!fs.existsSync(MODEL)) throw new Error('Algılama modeli yok: ' + MODEL);
  const ort = require('onnxruntime-node');
  sess = await ort.InferenceSession.create(MODEL, { intraOpNumThreads: 2 });
  return sess;
}

const iou = (a, b) => {
  const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1), x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
  const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return i / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - i || 1);
};

// buf → [{cls, conf, x1,y1,x2,y2}] (0-1, orijinal görsele göre)
async function detect(buf) {
  const ort = require('onnxruntime-node'), s = await session();
  const meta = await sharp(buf).metadata(), W = meta.width, H = meta.height;
  const r = Math.min(S / W, S / H), nw = Math.round(W * r), nh = Math.round(H * r), px = Math.floor((S - nw) / 2), py = Math.floor((S - nh) / 2);
  let c = [];
  // model ölçekleme yöntemine hassas: iki farklı ön işlemeyle çalıştırıp birleştir (TTA)
  for (const kernel of ['linear', 'nearest']) {
    const rgb = await sharp(buf).removeAlpha().resize(nw, nh, { kernel, fit: 'fill', fastShrinkOnLoad: false }).extend({ top: py, bottom: S - nh - py, left: px, right: S - nw - px, background: { r: 114, g: 114, b: 114 } }).raw().toBuffer();
    const t = new Float32Array(3 * S * S);
    for (let i = 0; i < S * S; i++) { t[i] = rgb[i * 3] / 255; t[S * S + i] = rgb[i * 3 + 1] / 255; t[2 * S * S + i] = rgb[i * 3 + 2] / 255; }
    const out = await s.run({ images: new ort.Tensor('float32', t, [1, 3, S, S]) });
    const o = out[Object.keys(out)[0]], d = o.data, N = o.dims[2], nc = o.dims[1] - 4;
    for (let j = 0; j < N; j++) {
      let best = 0, k = -1;
      for (let q = 0; q < nc; q++) { const v = d[(4 + q) * N + j]; if (v > best) { best = v; k = q; } }
      const name = CLASSES[k]; if (!name || best < MIN[name]) continue;
      const cx = d[j], cy = d[N + j], w = d[2 * N + j], h = d[3 * N + j];
      const x1 = (cx - w / 2 - px) / r / W, y1 = (cy - h / 2 - py) / r / H, x2 = (cx + w / 2 - px) / r / W, y2 = (cy + h / 2 - py) / r / H;
      c.push({ cls: name, conf: +best.toFixed(2), x1: Math.max(0, x1), y1: Math.max(0, y1), x2: Math.min(1, x2), y2: Math.min(1, y2) });
    }
  }
  c.sort((a, b) => b.conf - a.conf);
  const keep = [];
  for (const b of c) if (!keep.some(k => k.cls === b.cls && iou(k, b) > 0.45)) keep.push(b);
  return keep;
}

// Algılamaları içeriğin konusuna göre çizilecek kutulara çevir:
// baret kişinin üst kısmındaysa uyumlu (yeşil), değilse "BARET YOK" (kırmızı); forklift + en yakın yaya kırmızı
function toBoxes(dets, it = {}) {
  const topic = `${it.alert || ''} ${it.module || ''} ${it.theme || ''}`.toLocaleLowerCase('tr');
  const kkd = /baret|kkd|kask|helmet|ppe/.test(topic), fork = /forklift|araç|yaya/.test(topic), fire = /yangın|duman|ateş/.test(topic);
  const forks = dets.filter(d => d.cls === 'forklift');
  const inFork = p => { const cx = (p.x1 + p.x2) / 2, cy = (p.y1 + p.y2) / 2; return forks.some(f => cx > f.x1 && cx < f.x2 && cy > f.y1 && cy < f.y2); }; // sürücü yaya değildir
  const persons = dets.filter(d => d.cls === 'person' && !inFork(d)).slice(0, 8), hats = dets.filter(d => d.cls === 'hard hat');
  const boxes = [];
  for (const p of persons) {
    const ph = p.y2 - p.y1;
    const hat = hats.find(h => { const cx = (h.x1 + h.x2) / 2, cy = (h.y1 + h.y2) / 2; return cx > p.x1 && cx < p.x2 && cy > p.y1 - ph * 0.08 && cy < p.y1 + ph * 0.35; });
    if (hat) hat.used = true;
    if (kkd) {
      boxes.push({ label: hat ? 'BARET VAR' : 'BARET YOK', conf: p.conf, level: hat ? 'ok' : 'alarm', x: p.x1, y: p.y1, w: p.x2 - p.x1, h: ph });
      if (hat) boxes.push({ label: 'BARET', conf: hat.conf, level: 'ok', x: hat.x1, y: hat.y1, w: hat.x2 - hat.x1, h: hat.y2 - hat.y1, small: true });
    } else boxes.push({ label: 'KİŞİ', conf: p.conf, level: 'info', x: p.x1, y: p.y1, w: p.x2 - p.x1, h: ph, pid: boxes.length });
  }
  for (const f of dets.filter(d => d.cls === 'forklift').slice(0, 2)) {
    boxes.push({ label: 'FORKLIFT', conf: f.conf, level: fork ? 'alarm' : 'warn', x: f.x1, y: f.y1, w: f.x2 - f.x1, h: f.y2 - f.y1 });
    if (fork) { // en yakın yaya alarm
      const fc = [(f.x1 + f.x2) / 2, (f.y1 + f.y2) / 2]; let near = null, nd = 9;
      for (const b of boxes) if (b.label === 'KİŞİ') { const dd = Math.hypot((b.x + b.w / 2) - fc[0], (b.y + b.h / 2) - fc[1]); if (dd < nd) { nd = dd; near = b; } }
      if (near) { near.label = 'YAYA'; near.level = 'alarm'; near.link = [fc[0], fc[1]]; }
    }
  }
  for (const f of dets.filter(d => d.cls === 'fire' || d.cls === 'smoke').slice(0, 3))
    boxes.push({ label: f.cls === 'fire' ? 'ATEŞ' : 'DUMAN', conf: f.conf, level: fire ? 'alarm' : 'warn', x: f.x1, y: f.y1, w: f.x2 - f.x1, h: f.y2 - f.y1 });
  return boxes;
}

module.exports = { detect, toBoxes, MODEL, CLASSES };
