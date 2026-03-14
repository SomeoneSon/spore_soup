// world/soup.js — Main world: tick, spawn creatures, manage entities
import { Vec2 } from '../core/vec2.js';
import { SpatialHash } from '../core/spatial.js';
import { circleVsCircle, circleVsBounds } from '../core/collision.js';
import { Body } from '../creature/body.js';
import { Food, FoodType, spawnFood, FoodSpawner, spawnFoodSpawners, relocateSpawner } from './food.js';
import { spawnHazards } from './hazards.js';
import { NeatBrain } from '../brain/neat.js';
import { GenomePool } from '../brain/pool.js';
import { gatherInputs } from '../creature/sensors.js';

// --- Balance constants (from DESIGN §7) ---
const ENERGY_DRAIN_BASE   = 2;     // per second
const ENERGY_DRAIN_SPEED  = 0.02;  // per px/s per second
const WALL_DAMAGE_RATE    = 5;     // HP/s while touching wall
const FOOD_SENSE_RADIUS   = 60;    // how close any segment must be to eat
const OMNIVORE_EFFICIENCY = 0.25;  // no mouth/cilia → 25% energy
const FOOD_RESPAWN_DELAY  = 2;     // seconds before checking respawn
const SPAWNER_COUNT       = 6;     // number of food spawners
const MAX_FOOD            = 300;   // cap total alive food items
const NOVELTY_CELL        = 128;   // grid cell size for novelty tracking

export class Soup {
  constructor(worldW = 4096, worldH = 4096) {
    this.worldW = worldW;
    this.worldH = worldH;

    // Spatial hashes: one for creatures, one for food
    this.spatialCreatures = new SpatialHash(128);
    this.spatialFood      = new SpatialHash(128);

    this.creatures = [];
    this.food      = [];
    this.hazards   = [];
    this.spawners  = [];           // FoodSpawner instances

    this.time = 0;                   // elapsed seconds
    this._foodTimer = 0;             // respawn timer
    this._targetGrass = 0;           // desired food count (set in init)

    // Evolution
    this.pool = new GenomePool();
    this.generationTime = 0;         // time within current generation
    this.generationDone = false;     // flag: all dead or timeout
  }

  // ------------------------------------------------------------------
  // Initialization
  // ------------------------------------------------------------------

  init({ creatureCount = 30, grassCount = 300, meatCount = 0,
         poisonCount = 5, spikeCount = 0 } = {}) {
    this._creatureCount = creatureCount;
    this._targetGrass = grassCount;
    this._targetMeat  = meatCount;
    this._poisonCount = poisonCount;
    this._spikeCount  = spikeCount;

    this.pool = new GenomePool(creatureCount);
    const genomes = this.pool.initPopulation();
    this._spawnGeneration(genomes);

    this.food = spawnFood(this.worldW, this.worldH, grassCount, meatCount);
    this.hazards = spawnHazards(this.worldW, this.worldH, poisonCount, spikeCount);
    this.spawners = spawnFoodSpawners(this.worldW, this.worldH, SPAWNER_COUNT, this.hazards);
  }

  /** Full reset: new pool, new population, respawn food. */
  reset() {
    this.time = 0;
    this.pool = new GenomePool(this._creatureCount);
    const genomes = this.pool.initPopulation();
    this._spawnGeneration(genomes);
    this.food = spawnFood(this.worldW, this.worldH, this._targetGrass, this._targetMeat || 0);
    this.hazards = spawnHazards(this.worldW, this.worldH, this._poisonCount || 0, this._spikeCount || 0);
    this.spawners = spawnFoodSpawners(this.worldW, this.worldH, SPAWNER_COUNT, this.hazards);
  }

  // ------------------------------------------------------------------
  // Spawn helpers
  // ------------------------------------------------------------------

  _spawnGeneration(genomes) {
    this.creatures = [];
    this.generationTime = 0;
    this.generationDone = false;

    // Shared color for this generation (same species, slight variation)
    const baseHue = this._speciesHue != null ? this._speciesHue
      : (this._speciesHue = Math.random() * 360);
    const baseSat = 55;
    const baseLit = 50;

    const radii = this._creatureRadii || [12, 10, 9, 7];
    const parts = this._creatureParts || [];

    const margin = 200;
    for (const genome of genomes) {
      const pos = new Vec2(
        margin + Math.random() * (this.worldW - margin * 2),
        margin + Math.random() * (this.worldH - margin * 2),
      );
      const segCount = radii.length;
      const color = [
        baseHue + (Math.random() - 0.5) * 20,
        baseSat + (Math.random() - 0.5) * 10,
        baseLit + (Math.random() - 0.5) * 10,
      ];
      const body = new Body(pos, { segmentCount: segCount, radii: [...radii], color });
      const startHeading = Math.random() * Math.PI * 2;
      body.heading = startHeading;
      // Lay segments along the random heading so body faces that direction
      const dx = -Math.cos(startHeading) * 14;  // SEGMENT_SPACING = 14
      const dy = -Math.sin(startHeading) * 14;
      for (let i = 0; i < body.segments.length; i++) {
        body.segments[i].pos.set(pos.x + dx * i, pos.y + dy * i);
      }
      body.foodEaten = 0;
      body.wallTime  = 0;
      body.idleTime  = 0;
      body._totalIdleTime = 0;
      body._distanceTraveled = 0;
      body._spawnPos = pos.clone();
      body._lastPos = pos.clone();
      body._approachScore = 0;     // dense gradient: how much creature approached food
      body._lastFoodDist = Infinity;
      body._visitedCells = new Set();  // novelty: grid cells visited
      body._memoryNeuron = 0;
      body.parts = [...parts];
      // Attach brain
      body.brain  = new NeatBrain(genome);
      body.genome = genome;
      this.creatures.push(body);
    }
  }

  spawnCreatures(n = 10) {
    // legacy fallback (unused with NN)
    const margin = 200;
    for (let i = 0; i < n; i++) {
      const pos = new Vec2(
        margin + Math.random() * (this.worldW - margin * 2),
        margin + Math.random() * (this.worldH - margin * 2),
      );
      const segCount = 3 + Math.floor(Math.random() * 4);
      const body = new Body(pos, { segmentCount: segCount });
      body.heading = Math.random() * Math.PI * 2;
      body._wanderAngle = Math.random() * Math.PI * 2;
      body.foodEaten = 0;
      body.wallTime  = 0;
      body.idleTime  = 0;
      this.creatures.push(body);
    }
  }

  // ------------------------------------------------------------------
  // NN-driven AI
  // ------------------------------------------------------------------

  _brainStep(body, dt) {
    const inputs = gatherInputs(body, this);
    const out = body.brain.forward(inputs);
    body._memoryNeuron = out.memory;
    body.steer(out.thrust, out.turn, dt);
  }

  /** Find nearest alive food within a sensible range (for sensors). */
  _nearestFood(body) {
    const range = 160;
    const candidates = this.spatialFood.query(body.pos.x, body.pos.y, range);
    let best = null, bestDist = Infinity;
    for (const f of candidates) {
      if (!f.alive) continue;
      const d = body.pos.distanceToSq(f.pos);
      if (d < bestDist) { bestDist = d; best = f; }
    }
    return best;
  }

  // ------------------------------------------------------------------
  // Fitness calculation
  // ------------------------------------------------------------------

  _computeFitness(body) {
    // Food is king — each food item is a massive reward
    const food = (body.foodEaten || 0);
    const foodScore = food * 100;

    // Dense gradient: reward approaching food even without eating
    const approachScore = Math.min((body._approachScore || 0) * 0.1, 40);

    // Novelty: unique grid cells visited (128px cells in 4096px world = 32×32 grid)
    const cellsVisited = body._visitedCells ? body._visitedCells.size : 0;
    const noveltyScore = Math.min(cellsVisited * 1.5, 50);

    // Exploration: net displacement from spawn (anti-circle)
    const netDisp = body._spawnPos ? body.pos.distanceTo(body._spawnPos) : 0;
    const totalDist = body._distanceTraveled || 1;
    const straightness = Math.min(netDisp / Math.max(totalDist, 1), 1);
    const exploreScore = Math.min(netDisp * 0.02 * (0.5 + straightness), 20);

    // Penalties
    const wallPenalty = (body.wallTime || 0) * 2.0;
    const idlePenalty = (body._totalIdleTime || 0) * 1.5;

    return foodScore + approachScore + noveltyScore + exploreScore - wallPenalty - idlePenalty;
  }

  // ------------------------------------------------------------------
  // Generation lifecycle
  // ------------------------------------------------------------------

  _checkGeneration() {
    const allDead = this.creatures.every(c => !c.alive);
    const timeout = this.generationTime > 60;  // 60s max per generation

    if (!allDead && !timeout) return;

    // Score all creatures
    const scored = this.creatures.map(c => ({
      genome: c.genome,
      fitness: this._computeFitness(c),
    }));

    // Evolve
    const nextGenomes = this.pool.evolve(scored);

    // Randomize world layout for new generation
    this.food = spawnFood(this.worldW, this.worldH, this._targetGrass, this._targetMeat || 0);
    this.hazards = spawnHazards(this.worldW, this.worldH, this._poisonCount || 0, this._spikeCount || 0);
    this.spawners = spawnFoodSpawners(this.worldW, this.worldH, SPAWNER_COUNT, this.hazards);

    // Spawn next generation
    this._spawnGeneration(nextGenomes);
  }

  // ------------------------------------------------------------------
  // Energy & HP
  // ------------------------------------------------------------------

  _drainEnergy(body, dt) {
    const speed = body.velocity.length();
    const drain = (ENERGY_DRAIN_BASE + speed * ENERGY_DRAIN_SPEED) * dt;
    body.energy = Math.max(0, body.energy - drain);

    // track idle (accumulates total, not just current streak)
    if (speed < 5) { body.idleTime += dt; body._totalIdleTime = (body._totalIdleTime || 0) + dt; }
    else body.idleTime = 0;

    // track distance traveled
    if (body._lastPos) {
      body._distanceTraveled = (body._distanceTraveled || 0) + body.pos.distanceTo(body._lastPos);
      body._lastPos = body.pos.clone();
    }

    // novelty: track grid cells visited
    if (body._visitedCells) {
      const cx = Math.floor(body.pos.x / NOVELTY_CELL);
      const cy = Math.floor(body.pos.y / NOVELTY_CELL);
      body._visitedCells.add(cx * 10000 + cy);
    }

    // track approach toward nearest food (dense gradient signal)
    const nearFood = this._nearestFood(body);
    if (nearFood) {
      const d = body.pos.distanceTo(nearFood.pos);
      if (body._lastFoodDist !== Infinity && d < body._lastFoodDist) {
        body._approachScore = (body._approachScore || 0) + (body._lastFoodDist - d);
      }
      body._lastFoodDist = d;
    } else {
      body._lastFoodDist = Infinity;
    }

    // starve → HP loss
    if (body.energy <= 0) {
      body.hp -= 10 * dt;
    }
  }

  _wallDamage(body, dt) {
    const { touching } = circleVsBounds(body.pos, body.radius, this.worldW, this.worldH);
    if (touching) {
      body.hp -= WALL_DAMAGE_RATE * dt;
      body.wallTime += dt;
    }
  }

  _hazardDamage(body, dt) {
    for (const h of this.hazards) {
      // Check all body segments against each hazard
      const effectiveRadius = h.type === 'spike' ? h.radius * 2.0 : h.radius;
      for (const seg of body.segments) {
        const dist = seg.pos.distanceTo(h.pos);
        if (dist < effectiveRadius + seg.radius) {
          if (h.type === 'spike') {
            // Knockback from spikes + real damage
            const away = body.pos.sub(h.pos);
            const awayLen = away.length();
            if (awayLen > 0.01) {
              body.velocity.addSelf(away.scale(120 / awayLen));
            }
            body.hp -= h.damage * 0.5 * dt;   // meaningful damage (12.5 HP/s)
          } else {
            body.hp -= h.damage * dt;
          }
          break;  // one hit per hazard per tick is enough
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Creature-to-creature collision
  // ------------------------------------------------------------------

  _creatureCollisions() {
    for (let i = 0; i < this.creatures.length; i++) {
      const a = this.creatures[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.creatures.length; j++) {
        const b = this.creatures[j];
        if (!b.alive) continue;
        // Quick broad-phase: skip if heads are too far apart
        const headDist = a.pos.distanceToSq(b.pos);
        const maxReach = (a.segments.length + b.segments.length) * 14 + 30; // segments * spacing + margin
        if (headDist > maxReach * maxReach) continue;
        // Check all segments of A vs all segments of B
        for (const sa of a.segments) {
          for (const sb of b.segments) {
            const col = circleVsCircle(sa.pos, sa.radius, sb.pos, sb.radius);
            if (col) {
              const push = col.normal.scale(col.overlap * 0.5);
              sa.pos.subSelf(push);
              sb.pos.addSelf(push);
              // Velocity impulse (only once per pair)
              a.velocity.subSelf(col.normal.scale(15));
              b.velocity.addSelf(col.normal.scale(15));
            }
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // Eating
  // ------------------------------------------------------------------

  _tryEat(body) {
    const eatRadius = FOOD_SENSE_RADIUS;

    // Determine efficiency based on parts
    const hasCilia = body.parts && body.parts.includes('cilia');
    const hasMouth = body.parts && body.parts.includes('mouth');

    // Only eat from head segment (index 0)
    const head = body.segments[0];
    const nearby = this.spatialFood.query(head.pos.x, head.pos.y, eatRadius);
    for (const f of nearby) {
      if (!f.alive) continue;
      const dist = head.pos.distanceTo(f.pos);
      if (dist < head.radius + f.radius) {
        let efficiency = 0;
        if (f.type === FoodType.GRASS || f.type === 'grass') {
          efficiency = hasCilia ? 1.0 : hasMouth ? 0 : OMNIVORE_EFFICIENCY;
        } else {
          efficiency = hasMouth ? 1.0 : hasCilia ? 0 : OMNIVORE_EFFICIENCY;
        }
        if (efficiency <= 0) continue;
        f.alive = false;
        body.energy = Math.min(body.maxEnergy, body.energy + f.energy * efficiency);
        body.foodEaten++;
      }
    }
  }

  // ------------------------------------------------------------------
  // Death
  // ------------------------------------------------------------------

  _checkDeath(body) {
    if (body.hp <= 0 && body.alive) {
      body.alive = false;
      body._deathTime = this.time;
    }
  }

  // ------------------------------------------------------------------
  // Food respawn
  // ------------------------------------------------------------------

  _respawnFood(dt) {
    this._foodTimer += dt;
    if (this._foodTimer < FOOD_RESPAWN_DELAY) return;
    this._foodTimer = 0;

    const aliveCount = this.food.filter(f => f.alive).length;
    const freeCount  = this.food.filter(f => f.alive && !f._fromSpawner).length;
    const margin = 100;

    // Always respawn free food scattered across the map
    if (freeCount < this._targetGrass && aliveCount < MAX_FOOD) {
      const batch = Math.min(8, this._targetGrass - freeCount);
      for (let i = 0; i < batch; i++) {
        const pos = new Vec2(
          margin + Math.random() * (this.worldW - margin * 2),
          margin + Math.random() * (this.worldH - margin * 2),
        );
        this.food.push(new Food(pos, FoodType.GRASS));
      }
    }

    // clean up dead food references periodically
    if (this.food.length > MAX_FOOD + 100) {
      this.food = this.food.filter(f => f.alive);
    }
  }

  // ------------------------------------------------------------------
  // Main tick
  // ------------------------------------------------------------------

  tick(dt) {
    this.time += dt;
    this.generationTime += dt;

    // --- Food spawner logic (only eject if below food cap) ---
    const aliveFood = this.food.filter(f => f.alive).length;
    for (const sp of this.spawners) {
      if (!sp.alive) {
        relocateSpawner(sp, this.worldW, this.worldH, this.hazards, this.spawners);
      }
      if (aliveFood < MAX_FOOD) {
        const ejected = sp.tick(dt);
        for (const f of ejected) this.food.push(f);
      } else {
        // Still advance spawner age even when capped
        sp.age += dt;
        if (sp.age >= 25) sp.alive = false;
      }
    }

    // --- Flying food physics (spawner-ejected) + food aging/despawn ---
    for (const f of this.food) {
      if (!f.alive) continue;
      // Age all food items — old food decays
      f.tick(dt);
      if (!f.alive) continue;
      // Flying physics
      if (!f._flying) continue;
      f.pos.x += f._vx * dt;
      f.pos.y += f._vy * dt;
      // Decelerate
      f._vx *= (1 - 3 * dt);
      f._vy *= (1 - 3 * dt);
      // Stop when slow enough
      if (f._vx * f._vx + f._vy * f._vy < 4) {
        f._flying = false;
      }
      // Clamp to world bounds
      f.pos.x = Math.max(10, Math.min(this.worldW - 10, f.pos.x));
      f.pos.y = Math.max(10, Math.min(this.worldH - 10, f.pos.y));
    }

    // rebuild spatial hashes
    this.spatialCreatures.clear();
    this.spatialFood.clear();

    for (const f of this.food) {
      if (f.alive) this.spatialFood.insert(f);
    }

    // Pre-insert all alive creatures so sensors can detect them
    for (const c of this.creatures) {
      if (c.alive) this.spatialCreatures.insert(c);
    }

    for (const c of this.creatures) {
      if (!c.alive) continue;

      // NN-driven AI
      this._brainStep(c, dt);

      // physics
      c.update(dt, this.worldW, this.worldH);

      // energy & damage
      this._drainEnergy(c, dt);
      this._wallDamage(c, dt);
      this._hazardDamage(c, dt);

      // eating
      this._tryEat(c);

      // death check
      this._checkDeath(c);
    }

    // Creature-to-creature collision (pushback)
    this._creatureCollisions();

    // food respawn
    this._respawnFood(dt);

    // generation lifecycle
    this._checkGeneration();
  }
}
