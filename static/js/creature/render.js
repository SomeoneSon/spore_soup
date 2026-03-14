// creature/render.js — Smooth snake contour rendering (Catmull-Rom spline)
import { Vec2 } from '../core/vec2.js';

// --- Sensor ray config (mirrors sensors.js) ---
const RAY_ANGLES = [
  0, Math.PI * 0.25, -Math.PI * 0.25,
  Math.PI * 0.5, -Math.PI * 0.5,
  Math.PI * 0.75, -Math.PI * 0.75, Math.PI,
];
const BASE_RANGE = 40;
const PER_EYE    = 60;

/**
 * Draw a creature body as a smooth filled contour.
 * Uses left/right contour points + Catmull-Rom through them.
 */
export function renderBody(ctx, body) {
  const segs = body.segments;
  if (segs.length < 2) return;

  // 1. Build left[] and right[] contour points
  const left  = [];
  const right = [];

  for (let i = 0; i < segs.length; i++) {
    let dir;
    if (i === 0) {
      dir = segs[0].pos.sub(segs[1].pos).normalize();
    } else if (i === segs.length - 1) {
      dir = segs[i - 1].pos.sub(segs[i].pos).normalize();
    } else {
      dir = segs[i - 1].pos.sub(segs[i + 1].pos).normalize();
    }

    const perp = new Vec2(-dir.y, dir.x);
    const r = segs[i].radius;

    left.push(segs[i].pos.add(perp.scale(r)));
    right.push(segs[i].pos.sub(perp.scale(r)));
  }

  // 2. Head cap: smooth arc from right side → front → left side
  const capSteps = 5;
  const headCap = [];
  for (let k = 0; k <= capSteps; k++) {
    const t = k / capSteps;
    const angle = body.heading - Math.PI / 2 + t * Math.PI;
    headCap.push(segs[0].pos.add(Vec2.fromAngle(angle).scale(segs[0].radius)));
  }

  // 3. Tail cap: smooth arc from left side → back → right side
  const tailDirAngle = Math.atan2(
    segs[segs.length - 2].pos.y - segs[segs.length - 1].pos.y,
    segs[segs.length - 2].pos.x - segs[segs.length - 1].pos.x,
  );
  const tailCap = [];
  for (let k = 0; k <= capSteps; k++) {
    const t = k / capSteps;
    const angle = tailDirAngle + Math.PI / 2 + t * Math.PI;
    tailCap.push(segs[segs.length - 1].pos.add(Vec2.fromAngle(angle).scale(segs[segs.length - 1].radius)));
  }

  // 4. Build closed outline: headCap → left body → tailCap → right body
  const outline = [
    ...headCap,
    ...left.slice(1, -1),
    ...tailCap,
    ...right.slice(1, -1).reverse(),
  ];

  // 5. Draw Catmull-Rom spline contour
  const [h, s, l] = body.color;

  ctx.beginPath();
  catmullRomPath(ctx, outline, 0.5, true);

  // Semi-transparent gradient fill (see-through body)
  const grad = ctx.createLinearGradient(
    segs[0].pos.x, segs[0].pos.y,
    segs[segs.length - 1].pos.x, segs[segs.length - 1].pos.y,
  );
  grad.addColorStop(0, `hsla(${h}, ${s}%, ${l + 10}%, 0.5)`);
  grad.addColorStop(1, `hsla(${h}, ${s}%, ${l - 5}%, 0.4)`);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = `hsla(${h}, ${s}%, ${l - 15}%, 0.7)`;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // 6. Spine: connecting line through segment centres
  ctx.beginPath();
  ctx.moveTo(segs[0].pos.x, segs[0].pos.y);
  for (let i = 1; i < segs.length; i++) {
    ctx.lineTo(segs[i].pos.x, segs[i].pos.y);
  }
  ctx.strokeStyle = `hsla(${h}, ${s + 10}%, ${l - 20}%, 0.4)`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // 7. Vertebrae (small discs at each segment)
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    ctx.beginPath();
    ctx.arc(seg.pos.x, seg.pos.y, seg.radius * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${h}, ${s + 5}%, ${l - 10}%, 0.35)`;
    ctx.fill();
    ctx.strokeStyle = `hsla(${h}, ${s + 10}%, ${l - 20}%, 0.3)`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // 8. Nucleus (prominent, at centre segment)
  const mid = segs[Math.floor(segs.length / 2)];
  ctx.beginPath();
  ctx.arc(mid.pos.x, mid.pos.y, mid.radius * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = `hsla(${h}, ${s + 15}%, ${l - 10}%, 0.7)`;
  ctx.fill();
  ctx.strokeStyle = `hsla(${h}, ${s + 20}%, ${l - 25}%, 0.5)`;
  ctx.lineWidth = 1;
  ctx.stroke();

  // 9. Eyes (only if eye parts installed)
  const eyeCount = body.parts ? body.parts.filter(p => p === 'eye').length : 0;
  if (eyeCount > 0) drawEyes(ctx, body, eyeCount);

  // 6. Cilia (antennae on head)
  if (body.parts && body.parts.includes('cilia')) {
    _drawCilia(ctx, body);
  }
}

// --- Eyes -----------------------------------------------------------------

function drawEyes(ctx, body, count = 2) {
  const head = body.segments[0];
  const dir  = Vec2.fromAngle(body.heading);
  const perp = new Vec2(-dir.y, dir.x);
  const r    = head.radius;

  const eyeOffsets = count >= 2 ? [0.45, -0.45] : [0];
  for (const side of eyeOffsets) {
    const eyePos = head.pos
      .add(dir.scale(r * 0.4))
      .add(perp.scale(r * side));

    // white
    ctx.beginPath();
    ctx.arc(eyePos.x, eyePos.y, r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = '#eee';
    ctx.fill();

    // pupil
    const pupilPos = eyePos.add(dir.scale(r * 0.08));
    ctx.beginPath();
    ctx.arc(pupilPos.x, pupilPos.y, r * 0.11, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
  }
}

function _drawCilia(ctx, body) {
  const head = body.segments[0];
  const dir  = Vec2.fromAngle(body.heading);
  const perp = new Vec2(-dir.y, dir.x);
  const r    = head.radius;
  const t    = body.age || 0;

  // Two thin antennae wiggling
  for (const side of [0.3, -0.3]) {
    const base = head.pos.add(dir.scale(r * 0.7)).add(perp.scale(r * side));
    const wobble = Math.sin(t * 6 + side * 5) * 0.3;
    const tipAngle = body.heading + side * 0.6 + wobble;
    const tipDir = Vec2.fromAngle(tipAngle);
    const tip = base.add(tipDir.scale(r * 1.2));

    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.quadraticCurveTo(
      base.x + tipDir.x * r * 0.5 + perp.x * side * 3,
      base.y + tipDir.y * r * 0.5 + perp.y * side * 3,
      tip.x, tip.y,
    );
    ctx.strokeStyle = `hsl(${body.color[0]}, ${body.color[1]}%, ${body.color[2] + 15}%)`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // small bulb at tip
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${body.color[0]}, ${body.color[1]}%, ${body.color[2] + 25}%)`;
    ctx.fill();
  }
}

// --- Catmull‑Rom spline ---------------------------------------------------

function catmullRomPath(ctx, pts, tension, closed) {
  if (pts.length < 2) return;

  const n = pts.length;
  ctx.moveTo(pts[0].x, pts[0].y);

  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[(i + 2) % n];

    const steps = 8;
    for (let t = 1; t <= steps; t++) {
      const f = t / steps;
      const f2 = f * f;
      const f3 = f2 * f;

      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * f +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * f2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * f3
      );
      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * f +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * f2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * f3
      );
      ctx.lineTo(x, y);
    }
  }
  if (closed) ctx.closePath();
}

// --- World background grid ------------------------------------------------

/**
 * Render NN sensor visualization for the followed creature.
 * Shows: sensor cone, active rays with signal colors, nearest food/danger vectors.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Body} body
 * @param {number[]} inputs  — the 16 NN inputs from gatherInputs()
 */
export function renderSensorOverlay(ctx, body, inputs) {
  if (!body || !body.alive || !inputs) return;

  const eyeCount = body.parts ? body.parts.filter(p => p === 'eye').length : 0;
  const range = BASE_RANGE + eyeCount * PER_EYE;
  const activeRays = eyeCount >= 2 ? 8 : eyeCount >= 1 ? 5 : 3;
  const hx = body.pos.x;
  const hy = body.pos.y;

  ctx.save();

  // --- 1. Sensor cone (field of view arc) ---
  // Compute symmetric angular span from active ray angles
  let maxAbsAngle = 0;
  for (let i = 0; i < activeRays; i++) {
    const absA = Math.abs(RAY_ANGLES[i]);
    if (absA > maxAbsAngle) maxAbsAngle = absA;
  }
  // Special case: if rear ray (π) is active, it's full 360°
  const fullCircle = activeRays >= 8;

  if (fullCircle) {
    // Full circle for 360° vision
    ctx.beginPath();
    ctx.arc(hx, hy, range, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(100, 200, 255, 0.04)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(100, 200, 255, 0.12)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.arc(hx, hy, range, body.heading - maxAbsAngle - 0.15, body.heading + maxAbsAngle + 0.15);
    ctx.closePath();
    ctx.fillStyle = 'rgba(100, 200, 255, 0.04)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(100, 200, 255, 0.12)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // range circle (dashed)
  ctx.beginPath();
  ctx.setLineDash([4, 6]);
  ctx.arc(hx, hy, range, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(100, 200, 255, 0.08)';
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.setLineDash([]);

  // --- 2. Sensor rays with signal strength ---
  for (let i = 0; i < 8; i++) {
    const signal = inputs[i];
    const worldAngle = body.heading + RAY_ANGLES[i];
    const endX = hx + Math.cos(worldAngle) * range;
    const endY = hy + Math.sin(worldAngle) * range;

    if (i >= activeRays) {
      // inactive ray — very dim dotted line
      ctx.beginPath();
      ctx.setLineDash([2, 4]);
      ctx.moveTo(hx, hy);
      ctx.lineTo(endX, endY);
      ctx.strokeStyle = 'rgba(80, 80, 80, 0.15)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }

    // Choose color based on signal
    let color;
    const absSignal = Math.abs(signal);
    if (signal > 0.01) {
      // positive = food (green)
      color = `rgba(50, 255, 100, ${0.15 + absSignal * 0.6})`;
    } else if (signal < -0.01) {
      // negative = danger (red/purple)
      color = `rgba(255, 60, 60, ${0.15 + absSignal * 0.6})`;
    } else {
      // no signal = dim
      color = 'rgba(100, 200, 255, 0.12)';
    }

    // ray line
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = color;
    ctx.lineWidth = absSignal > 0.01 ? 1.2 + absSignal * 1.5 : 0.7;
    ctx.stroke();

    // signal dot at tip
    if (absSignal > 0.05) {
      ctx.beginPath();
      ctx.arc(endX, endY, 2.5 + absSignal * 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  // --- 3. Nearest food vector (inputs[10]=angle, [11]=dist) ---
  const foodAngle = inputs[10] * Math.PI + body.heading;
  const foodDist  = inputs[11];
  if (foodDist > 0.01) {
    const fLen = range * 2 * (1 - foodDist);  // convert inverted dist back
    const actualLen = Math.min(fLen, range * 2);
    const fx = hx + Math.cos(foodAngle) * actualLen;
    const fy = hy + Math.sin(foodAngle) * actualLen;

    // arrow line
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(fx, fy);
    ctx.strokeStyle = 'rgba(80, 255, 120, 0.45)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // arrowhead
    _drawArrowhead(ctx, hx, hy, fx, fy, 8, 'rgba(80, 255, 120, 0.6)');
  }

  // --- 4. Nearest danger vector (inputs[12]=angle, [13]=dist) ---
  const dangerAngle = inputs[12] * Math.PI + body.heading;
  const dangerDist  = inputs[13];
  if (dangerDist > 0.01) {
    const dLen = range * 2 * (1 - dangerDist);
    const actualLen = Math.min(dLen, range * 2);
    const dx = hx + Math.cos(dangerAngle) * actualLen;
    const dy = hy + Math.sin(dangerAngle) * actualLen;

    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(dx, dy);
    ctx.strokeStyle = 'rgba(255, 80, 80, 0.45)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    _drawArrowhead(ctx, hx, hy, dx, dy, 8, 'rgba(255, 80, 80, 0.6)');
  }

  ctx.restore();
}

function _drawArrowhead(ctx, x1, y1, x2, y2, size, color) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(angle - 0.4) * size, y2 - Math.sin(angle - 0.4) * size);
  ctx.lineTo(x2 - Math.cos(angle + 0.4) * size, y2 - Math.sin(angle + 0.4) * size);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export function renderWorldBackground(ctx, worldW, worldH, camera) {
  // background
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, worldW, worldH);

  // subtle grid
  const gridSize = 128;
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= worldW; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, worldH); ctx.stroke();
  }
  for (let y = 0; y <= worldH; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(worldW, y); ctx.stroke();
  }

  // border glow
  ctx.strokeStyle = 'rgba(80, 200, 255, 0.25)';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, worldW, worldH);
}
