// world/food.js — Food items: types, spawning, rendering
import { Vec2 } from '../core/vec2.js';

/** @enum {string} */
export const FoodType = {
  GRASS: 'grass',
  MEAT:  'meat',
};

let _foodId = 0;

const FOOD_MAX_AGE = 25;   // seconds before food decays

export class Food {
  constructor(pos, type = FoodType.GRASS) {
    this.id     = _foodId++;
    this.pos    = pos;
    this.type   = type;
    this.radius = type === FoodType.GRASS ? 4 : 5;
    this.energy = type === FoodType.GRASS
      ? 20 + Math.random() * 10   // 20–30
      : 40 + Math.random() * 20;  // 40–60
    this.alive  = true;
    this.age    = 0;               // seconds since spawn

    // visual wobble
    this._phase = Math.random() * Math.PI * 2;
  }

  /** Returns true if still alive after aging. */
  tick(dt) {
    if (!this.alive) return false;
    this.age += dt;
    if (this.age >= FOOD_MAX_AGE) {
      this.alive = false;
      return false;
    }
    return true;
  }

  /** Life fraction (1 = fresh, 0 = about to decay) for visual fade. */
  get lifeFraction() {
    return Math.max(0, 1 - this.age / FOOD_MAX_AGE);
  }
}

/**
 * Spawn food items scattered across the world.
 */
export function spawnFood(worldW, worldH, grassCount, meatCount = 0) {
  const items = [];
  const margin = 100;

  for (let i = 0; i < grassCount; i++) {
    const pos = new Vec2(
      margin + Math.random() * (worldW - margin * 2),
      margin + Math.random() * (worldH - margin * 2),
    );
    const f = new Food(pos, FoodType.GRASS);
    f.age = Math.random() * FOOD_MAX_AGE * 0.8;  // stagger despawn
    items.push(f);
  }

  for (let i = 0; i < meatCount; i++) {
    const pos = new Vec2(
      margin + Math.random() * (worldW - margin * 2),
      margin + Math.random() * (worldH - margin * 2),
    );
    items.push(new Food(pos, FoodType.MEAT));
  }

  return items;
}

/**
 * Render a single food item.
 */
export function renderFood(ctx, food, time) {
  if (!food.alive) return;

  const wobble = Math.sin(time * 2 + food._phase) * 1.5;
  const x = food.pos.x;
  const y = food.pos.y + wobble;
  const r = food.radius;

  // Fade based on remaining life
  const life = food.lifeFraction;
  const alpha = 0.3 + life * 0.7;   // 0.3 when about to die, 1.0 when fresh

  if (food.type === FoodType.GRASS) {
    // green glowing dot
    ctx.beginPath();
    ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(80, 220, 120, ${0.2 * alpha})`;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(80, 220, 120, ${alpha})`;
    ctx.fill();
  } else {
    // reddish meat chunk
    ctx.beginPath();
    ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(220, 80, 80, ${0.2 * alpha})`;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(220, 80, 80, ${alpha})`;
    ctx.fill();
  }
}

// --- FoodSpawner: pulsating source that ejects food, then teleports --------

const SPAWNER_LIFETIME    = 25;   // seconds before relocating
const SPAWNER_EJECT_INTERVAL = 3; // seconds between ejections
const SPAWNER_EJECT_COUNT = 2;    // food items per ejection
const SPAWNER_EJECT_SPEED = 80;   // px/s initial velocity of ejected food
const SPAWNER_RADIUS      = 30;   // visual radius
const SPAWNER_SAFE_MARGIN = 100;  // min distance from hazard center
const SPAWNER_MIN_APART  = 800;  // min distance between spawners

export class FoodSpawner {
  /**
   * @param {Vec2}   pos
   */
  constructor(pos) {
    this.pos   = pos;
    this.age   = 0;
    this.alive = true;
    this._ejectTimer = SPAWNER_EJECT_INTERVAL * 0.5; // first burst sooner
    this._phase = Math.random() * Math.PI * 2;
  }

  /**
   * Tick the spawner. Returns array of newly ejected Food items (may be empty).
   * @param {number} dt
   * @returns {Food[]}
   */
  tick(dt) {
    if (!this.alive) return [];
    this.age += dt;

    // Lifetime expired → mark for relocation
    if (this.age >= SPAWNER_LIFETIME) {
      this.alive = false;
      return [];
    }

    this._ejectTimer += dt;
    if (this._ejectTimer < SPAWNER_EJECT_INTERVAL) return [];
    this._ejectTimer = 0;

    // Eject food in all directions
    const ejected = [];
    for (let i = 0; i < SPAWNER_EJECT_COUNT; i++) {
      const angle = (i / SPAWNER_EJECT_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const dist = 30 + Math.random() * 40;
      const fx = this.pos.x + Math.cos(angle) * dist;
      const fy = this.pos.y + Math.sin(angle) * dist;
      const food = new Food(new Vec2(fx, fy), FoodType.GRASS);
      food.energy = 25 + Math.random() * 15;  // 25–40 (slightly richer)
      // Give food a velocity so it "flies" outward
      food._vx = Math.cos(angle) * SPAWNER_EJECT_SPEED;
      food._vy = Math.sin(angle) * SPAWNER_EJECT_SPEED;
      food._flying = true;
      food._fromSpawner = true;
      ejected.push(food);
    }
    return ejected;
  }
}

/**
 * Spawn N food spawners in safe locations (away from hazards).
 */
export function spawnFoodSpawners(worldW, worldH, count, hazards) {
  const spawners = [];
  const margin = 300;
  for (let i = 0; i < count; i++) {
    let pos, safe;
    for (let attempt = 0; attempt < 50; attempt++) {
      pos = new Vec2(
        margin + Math.random() * (worldW - margin * 2),
        margin + Math.random() * (worldH - margin * 2),
      );
      safe = true;
      for (const h of hazards) {
        if (pos.distanceTo(h.pos) < h.radius + SPAWNER_SAFE_MARGIN) {
          safe = false;
          break;
        }
      }
      if (safe) {
        for (const other of spawners) {
          if (pos.distanceTo(other.pos) < SPAWNER_MIN_APART) {
            safe = false;
            break;
          }
        }
      }
      if (safe) break;
    }
    if (pos) spawners.push(new FoodSpawner(pos));
  }
  return spawners;
}

/**
 * Relocate a dead spawner to a new safe position.
 */
export function relocateSpawner(spawner, worldW, worldH, hazards, allSpawners) {
  const margin = 300;
  for (let attempt = 0; attempt < 50; attempt++) {
    const pos = new Vec2(
      margin + Math.random() * (worldW - margin * 2),
      margin + Math.random() * (worldH - margin * 2),
    );
    let safe = true;
    for (const h of hazards) {
      if (pos.distanceTo(h.pos) < h.radius + SPAWNER_SAFE_MARGIN) {
        safe = false;
        break;
      }
    }
    if (safe && allSpawners) {
      for (const other of allSpawners) {
        if (other === spawner || !other.alive) continue;
        if (pos.distanceTo(other.pos) < SPAWNER_MIN_APART) {
          safe = false;
          break;
        }
      }
    }
    if (safe) {
      spawner.pos = pos;
      spawner.age = 0;
      spawner.alive = true;
      spawner._ejectTimer = SPAWNER_EJECT_INTERVAL * 0.5;
      spawner._phase = Math.random() * Math.PI * 2;
      return;
    }
  }
  // fallback: just place it randomly
  spawner.pos = new Vec2(
    margin + Math.random() * (worldW - margin * 2),
    margin + Math.random() * (worldH - margin * 2),
  );
  spawner.age = 0;
  spawner.alive = true;
  spawner._ejectTimer = SPAWNER_EJECT_INTERVAL * 0.5;
}

/**
 * Render a food spawner (glowing pulsating ring).
 */
export function renderFoodSpawner(ctx, spawner, time) {
  if (!spawner.alive) return;

  const x = spawner.pos.x;
  const y = spawner.pos.y;
  const pulse = 0.7 + 0.3 * Math.sin(time * 3 + spawner._phase);
  const r = SPAWNER_RADIUS * pulse;

  // Remaining life fraction for fade-out
  const lifeFrac = 1 - spawner.age / SPAWNER_LIFETIME;
  const alpha = Math.min(1, lifeFrac * 2); // fade in last 50% of life

  // Outer glow
  const grad = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 1.5);
  grad.addColorStop(0, `rgba(120, 255, 160, ${0.3 * alpha})`);
  grad.addColorStop(0.5, `rgba(80, 220, 120, ${0.15 * alpha})`);
  grad.addColorStop(1, `rgba(40, 180, 80, 0)`);
  ctx.beginPath();
  ctx.arc(x, y, r * 1.5, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Inner ring
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(100, 255, 140, ${0.6 * alpha})`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(150, 255, 180, ${0.8 * alpha})`;
  ctx.fill();

  // Particle hints — rotating dots
  for (let i = 0; i < 4; i++) {
    const a = time * 1.5 + (i / 4) * Math.PI * 2 + spawner._phase;
    const pr = r * 0.8;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * pr, y + Math.sin(a) * pr, 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(100, 255, 140, ${0.5 * alpha})`;
    ctx.fill();
  }
}
