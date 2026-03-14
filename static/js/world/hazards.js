// world/hazards.js — Poison zones & spike patches
import { Vec2 } from '../core/vec2.js';

export class Hazard {
  /**
   * @param {Vec2}   pos
   * @param {string} type   'poison' | 'spike'
   * @param {number} radius
   * @param {number} damage  per second while inside
   */
  constructor(pos, type, radius, damage) {
    this.pos    = pos;
    this.type   = type;
    this.radius = radius;
    this.damage = damage;
    this._phase = Math.random() * Math.PI * 2;

    // pre-generate blob offsets for poison (amorphous cloud shape)
    if (type === 'poison') {
      this._blobPoints = 12;
      this._blobOffsets = [];
      for (let i = 0; i < this._blobPoints; i++) {
        this._blobOffsets.push({
          rFactor: 0.7 + Math.random() * 0.6,   // 0.7–1.3 radius variation
          speed:   0.3 + Math.random() * 0.7,    // animation speed
          phase:   Math.random() * Math.PI * 2,
        });
      }
    }

    // pre-generate spike angles
    if (type === 'spike') {
      this._spikeCount = 7 + Math.floor(Math.random() * 5);   // 7–11 spikes
      this._spikeAngles = [];
      for (let i = 0; i < this._spikeCount; i++) {
        this._spikeAngles.push({
          base:   (i / this._spikeCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.3,
          length: 0.5 + Math.random() * 0.7,   // spike length factor
          width:  0.08 + Math.random() * 0.06,  // half-angle width
        });
      }
    }
  }
}

export function spawnHazards(worldW, worldH, poisonCount, spikeCount = 0) {
  const items = [];
  const margin = 200;

  for (let i = 0; i < poisonCount; i++) {
    const pos = new Vec2(
      margin + Math.random() * (worldW - margin * 2),
      margin + Math.random() * (worldH - margin * 2),
    );
    const radius = 80 + Math.random() * 100;   // 80–180 px (large toxic zones)
    items.push(new Hazard(pos, 'poison', radius, 15));
  }

  for (let i = 0; i < spikeCount; i++) {
    const pos = new Vec2(
      margin + Math.random() * (worldW - margin * 2),
      margin + Math.random() * (worldH - margin * 2),
    );
    const radius = 30 + Math.random() * 30;   // 30–60 px (larger spike patches)
    items.push(new Hazard(pos, 'spike', radius, 25));
  }

  return items;
}

export function renderHazard(ctx, hazard, time) {
  if (hazard.type === 'poison') {
    _renderPoison(ctx, hazard, time);
  } else {
    _renderSpike(ctx, hazard, time);
  }
}

// --- Poison: purple amorphous cloud --------------------------------------

function _renderPoison(ctx, h, time) {
  const x = h.pos.x;
  const y = h.pos.y;
  const r = h.radius;
  const n = h._blobPoints;

  // build amorphous blob path
  const pts = [];
  for (let i = 0; i < n; i++) {
    const b = h._blobOffsets[i];
    const angle = (i / n) * Math.PI * 2;
    const wobble = Math.sin(time * b.speed + b.phase) * 0.15;
    const dist = r * (b.rFactor + wobble);
    pts.push({
      x: x + Math.cos(angle) * dist,
      y: y + Math.sin(angle) * dist,
    });
  }

  // outer glow layer
  ctx.save();
  ctx.beginPath();
  _smoothBlobPath(ctx, pts);
  const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 1.4);
  glow.addColorStop(0,   'rgba(140, 50, 200, 0.20)');
  glow.addColorStop(0.5, 'rgba(120, 30, 180, 0.12)');
  glow.addColorStop(1,   'rgba(100, 20, 160, 0)');
  ctx.fillStyle = glow;
  ctx.fill();

  // main cloud body
  ctx.beginPath();
  _smoothBlobPath(ctx, pts);
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 1.0);
  grad.addColorStop(0,   'rgba(160, 60, 220, 0.30)');
  grad.addColorStop(0.4, 'rgba(140, 40, 200, 0.22)');
  grad.addColorStop(0.8, 'rgba(120, 30, 180, 0.10)');
  grad.addColorStop(1,   'rgba(100, 20, 160, 0)');
  ctx.fillStyle = grad;
  ctx.fill();

  // inner bright core
  ctx.beginPath();
  ctx.arc(x, y, r * 0.25, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(180, 80, 255, 0.25)';
  ctx.fill();

  // tiny bubbles / particles
  for (let i = 0; i < 4; i++) {
    const angle = time * 0.5 + i * 1.57 + h._phase;
    const dist = r * 0.3 + Math.sin(time * 1.2 + i) * r * 0.2;
    const bx = x + Math.cos(angle) * dist;
    const by = y + Math.sin(angle) * dist;
    ctx.beginPath();
    ctx.arc(bx, by, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(200, 120, 255, 0.35)';
    ctx.fill();
  }
  ctx.restore();
}

/** Smooth closed path through blob points using quadratic curves */
function _smoothBlobPath(ctx, pts) {
  const n = pts.length;
  // start at midpoint between last and first
  const mx = (pts[n - 1].x + pts[0].x) / 2;
  const my = (pts[n - 1].y + pts[0].y) / 2;
  ctx.moveTo(mx, my);

  for (let i = 0; i < n; i++) {
    const next = pts[(i + 1) % n];
    const midX = (pts[i].x + next.x) / 2;
    const midY = (pts[i].y + next.y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
  }
  ctx.closePath();
}

// --- Spike: red circle with protruding spikes -----------------------------

function _renderSpike(ctx, h, time) {
  const x = h.pos.x;
  const y = h.pos.y;
  const r = h.radius;

  // outer danger glow
  ctx.save();
  const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 1.8);
  glow.addColorStop(0, 'rgba(220, 40, 40, 0.12)');
  glow.addColorStop(1, 'rgba(220, 40, 40, 0)');
  ctx.beginPath();
  ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  // main red circle base
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  const base = ctx.createRadialGradient(x, y, 0, x, y, r);
  base.addColorStop(0,   'rgba(180, 30, 30, 0.5)');
  base.addColorStop(0.7, 'rgba(150, 20, 20, 0.35)');
  base.addColorStop(1,   'rgba(120, 15, 15, 0.2)');
  ctx.fillStyle = base;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 60, 60, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // draw individual spikes as triangles
  for (const s of h._spikeAngles) {
    const wobble = Math.sin(time * 1.8 + s.base * 3 + h._phase) * 0.1;
    const angle = s.base + wobble;
    const tipLen = r + r * s.length;

    const tipX = x + Math.cos(angle) * tipLen;
    const tipY = y + Math.sin(angle) * tipLen;

    const baseL = angle - s.width;
    const baseR = angle + s.width;
    const bx1 = x + Math.cos(baseL) * r * 0.85;
    const by1 = y + Math.sin(baseL) * r * 0.85;
    const bx2 = x + Math.cos(baseR) * r * 0.85;
    const by2 = y + Math.sin(baseR) * r * 0.85;

    ctx.beginPath();
    ctx.moveTo(bx1, by1);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(bx2, by2);
    ctx.closePath();

    ctx.fillStyle = 'rgba(220, 50, 50, 0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 80, 80, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // bright center dot
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 100, 100, 0.7)';
  ctx.fill();

  ctx.restore();
}
