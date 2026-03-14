// creature/sensors.js — Egocentric sensor rays for NN input
import { Vec2 } from '../core/vec2.js';

// Base ray directions (relative to heading). Always 8 rays; without eyes far rays return 0.
const RAY_ANGLES = [
  0,                       // 0: forward
  Math.PI * 0.25,          // 1: front-right (45°)
  -Math.PI * 0.25,         // 2: front-left  (-45°)
  Math.PI * 0.5,           // 3: right (90°)      — needs ≥ 1 eye
  -Math.PI * 0.5,          // 4: left (-90°)       — needs ≥ 1 eye
  Math.PI * 0.75,          // 5: back-right (135°) — needs 2 eyes
  -Math.PI * 0.75,         // 6: back-left (-135°) — needs 2 eyes
  Math.PI,                 // 7: back (180°)       — needs 2 eyes
];

const BASE_RANGE  = 120;  // px, without eyes (generous base so NN gets useful signal)
const PER_EYE     = 60;   // px per eye
const BASE_RAYS   = 4;    // rays without eyes (indices 0–3 but we use 0,1,2 + partial)

// Sensor type codes (multiplied by inverse distance for NN)
const TYPE_GRASS   =  1.0;
const TYPE_MEAT    =  0.6;
const TYPE_ALLY    =  0.2;
const TYPE_POISON  = -1.0;
const TYPE_SPIKE   = -0.8;
const TYPE_ENEMY   = -0.7;
const TYPE_WALL    = -0.5;

/**
 * Gather all NN inputs for a creature.
 *
 * @param {Body}  body
 * @param {Soup}  soup   — world reference for spatial queries
 * @returns {number[]}   — flat array of 16 floats (fixed size)
 */
export function gatherInputs(body, soup) {
  const eyeCount = body.parts ? body.parts.filter(p => p === 'eye').length : 0;
  const range = BASE_RANGE + eyeCount * PER_EYE;
  const activeRays = eyeCount >= 2 ? 8 : eyeCount >= 1 ? 5 : 3;

  // --- Ray casting ---
  const rays = new Array(8).fill(0);

  for (let i = 0; i < 8; i++) {
    if (i >= activeRays) { rays[i] = 0; continue; }

    const worldAngle = body.heading + RAY_ANGLES[i];
    const rayDir = Vec2.fromAngle(worldAngle);

    // sample along ray in steps
    let bestSignal = 0;
    const steps = 5;
    for (let s = 1; s <= steps; s++) {
      const dist = (s / steps) * range;
      const px = body.pos.x + rayDir.x * dist;
      const py = body.pos.y + rayDir.y * dist;
      const invDist = 1 - (dist / range);   // 1.0 at head, 0.0 at max range

      // check food
      const nearbyFood = soup.spatialFood.query(px, py, 20);
      for (const f of nearbyFood) {
        if (!f.alive) continue;
        if (f.pos.distanceToSq(new Vec2(px, py)) < 400) {  // ~20px
          const code = f.type === 'grass' ? TYPE_GRASS : TYPE_MEAT;
          const sig = code * invDist;
          if (Math.abs(sig) > Math.abs(bestSignal)) bestSignal = sig;
        }
      }

      // check hazards
      for (const h of soup.hazards) {
        const d = h.pos.distanceTo(new Vec2(px, py));
        if (d < h.radius) {
          const code = h.type === 'poison' ? TYPE_POISON : TYPE_SPIKE;
          const sig = code * invDist;
          if (Math.abs(sig) > Math.abs(bestSignal)) bestSignal = sig;
        }
      }

      // check other creatures
      const nearbyCreatures = soup.spatialCreatures.query(px, py, 20);
      for (const other of nearbyCreatures) {
        if (other === body || !other.alive) continue;
        if (other.pos.distanceToSq(new Vec2(px, py)) < (other.radius + 10) * (other.radius + 10)) {
          const sig = TYPE_ALLY * invDist;
          if (Math.abs(sig) > Math.abs(bestSignal)) bestSignal = sig;
        }
      }

      // check walls
      if (px < 0 || px > soup.worldW || py < 0 || py > soup.worldH) {
        const sig = TYPE_WALL * invDist;
        if (Math.abs(sig) > Math.abs(bestSignal)) bestSignal = sig;
      }
    }
    rays[i] = bestSignal;
  }

  // --- Scalar inputs ---
  const hpPct     = body.hp / body.maxHp;
  const energyPct = body.energy / body.maxEnergy;

  // nearest food angle + dist (relative to heading) — long range compass
  const COMPASS_RANGE = 500;
  let foodAngle = 0, foodDist = 0;
  const nf = _nearestAlive(soup.spatialFood, body.pos, COMPASS_RANGE, f => f.alive);
  if (nf) {
    const toFood = Math.atan2(nf.pos.y - body.pos.y, nf.pos.x - body.pos.x);
    foodAngle = _wrapAngle(toFood - body.heading) / Math.PI;   // -1..1
    foodDist  = 1 - Math.min(body.pos.distanceTo(nf.pos) / COMPASS_RANGE, 1);
  }

  // nearest danger angle + dist
  let dangerAngle = 0, dangerDist = 0;
  const nd = _nearestHazard(soup.hazards, body.pos, COMPASS_RANGE);
  if (nd) {
    const toDanger = Math.atan2(nd.pos.y - body.pos.y, nd.pos.x - body.pos.x);
    dangerAngle = _wrapAngle(toDanger - body.heading) / Math.PI;
    dangerDist  = 1 - Math.min(body.pos.distanceTo(nd.pos) / COMPASS_RANGE, 1);
  }

  // angular velocity (~turn rate from last frame)
  const angVel = (body._prevHeading !== undefined)
    ? _wrapAngle(body.heading - body._prevHeading) / (Math.PI * 0.1)
    : 0;
  body._prevHeading = body.heading;

  // memory (recurrent neuron from previous tick)
  const memPrev = body._memoryNeuron || 0;

  // --- Assemble 16 fixed inputs ---
  return [
    rays[0], rays[1], rays[2], rays[3],
    rays[4], rays[5], rays[6], rays[7],
    hpPct, energyPct,
    foodAngle, foodDist,
    dangerAngle, dangerDist,
    Math.max(-1, Math.min(1, angVel)),
    Math.max(-1, Math.min(1, memPrev)),
  ];
}

// --- helpers ---

function _wrapAngle(a) {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

function _nearestAlive(spatialHash, pos, range, pred) {
  const candidates = spatialHash.query(pos.x, pos.y, range);
  let best = null, bestDist = Infinity;
  for (const c of candidates) {
    if (!pred(c)) continue;
    const d = pos.distanceToSq(c.pos);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

function _nearestHazard(hazards, pos, range) {
  let best = null, bestDist = range * range;
  for (const h of hazards) {
    const d = pos.distanceToSq(h.pos);
    if (d < bestDist) { bestDist = d; best = h; }
  }
  return best;
}
