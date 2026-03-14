// core/collision.js — Simple circle-circle and circle-bounds collisions
import { Vec2 } from './vec2.js';

/**
 * Circle vs Circle overlap test.
 * Returns null if no collision, otherwise { overlap, normal, midpoint }.
 */
export function circleVsCircle(posA, rA, posB, rB) {
  const dx = posB.x - posA.x;
  const dy = posB.y - posA.y;
  const distSq = dx * dx + dy * dy;
  const minDist = rA + rB;

  if (distSq >= minDist * minDist) return null;

  const dist = Math.sqrt(distSq);
  const overlap = minDist - dist;
  const normal = dist > 0
    ? new Vec2(dx / dist, dy / dist)
    : new Vec2(1, 0);                 // degenerate: same position

  return { overlap, normal, dist };
}

/**
 * Push a circle back inside rectangular bounds [0, worldW] × [0, worldH].
 * Returns soft pushback force + wall-contact flag.
 */
export function circleVsBounds(pos, radius, worldW, worldH, pushStrength = 200) {
  const force = new Vec2(0, 0);
  let touching = false;

  if (pos.x - radius < 0)              { force.x += pushStrength * (radius - pos.x);       touching = true; }
  if (pos.x + radius > worldW)         { force.x -= pushStrength * (pos.x + radius - worldW); touching = true; }
  if (pos.y - radius < 0)              { force.y += pushStrength * (radius - pos.y);       touching = true; }
  if (pos.y + radius > worldH)         { force.y -= pushStrength * (pos.y + radius - worldH); touching = true; }

  return { force, touching };
}
