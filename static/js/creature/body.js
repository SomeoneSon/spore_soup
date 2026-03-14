// creature/body.js — Segmented creature body with verlet-chain follow
import { Vec2 } from '../core/vec2.js';
import { circleVsBounds } from '../core/collision.js';

const DRAG = 3.0;            // velocity damping factor
const SEGMENT_SPACING = 14;  // px between segment centres

export class Body {
  /**
   * @param {Vec2}   pos      – spawn position (world)
   * @param {object} opts
   * @param {number} opts.segmentCount  – 3‒8
   * @param {number[]} opts.radii       – per-segment radius (length = segmentCount)
   * @param {number[]} opts.color       – [h, s, l]  HSL base
   */
  constructor(pos, opts = {}) {
    const count = opts.segmentCount || 4;
    const radii = opts.radii || Array.from({ length: count }, (_, i) => {
      // default: bigger head, taper to tail
      const t = i / (count - 1);
      return 12 - t * 5;          // 12 → 7
    });

    this.segments = [];
    for (let i = 0; i < count; i++) {
      this.segments.push({
        pos: new Vec2(pos.x - i * SEGMENT_SPACING, pos.y),
        radius: radii[i],
        parts: [],
      });
    }

    this.velocity = new Vec2(0, 0);
    this.heading  = 0;               // radians, computed from seg0→seg1

    // Stats (Phase 2+ will expand)
    this.hp       = 100;
    this.maxHp    = 100;
    this.energy   = 100;
    this.maxEnergy = 100;
    this.alive    = true;

    // Visual
    this.color = opts.color || [
      Math.random() * 360,
      50 + Math.random() * 30,
      45 + Math.random() * 15,
    ];

    this.age = 0;  // seconds alive
  }

  /** Head position shortcut */
  get pos() { return this.segments[0].pos; }

  /** Head radius shortcut */
  get radius() { return this.segments[0].radius; }

  // ------------------------------------------------------------------
  // Steering (called by AI / NN)
  // ------------------------------------------------------------------

  /**
   * @param {number} thrust  0..1  forward force
   * @param {number} turn   -1..1  turning rate
   * @param {number} dt      delta seconds
   */
  steer(thrust, turn, dt) {
    const turnSpeed = 10.5;   // radians / sec at turn=1
    this.heading += turn * turnSpeed * dt;

    const maxSpeed = 80;     // px/s base (no fins yet)
    const dir = Vec2.fromAngle(this.heading);
    this.velocity.addSelf(dir.scale(thrust * maxSpeed * dt * 4));

    // Directly blend velocity toward desired heading so the body actually turns
    // (the verlet chain fights heading changes — this overcomes inertia)
    const speed = this.velocity.length();
    if (speed > 3) {
      const desiredDir = Vec2.fromAngle(this.heading);
      const blendRate = 0.22 * dt * 60;  // ~22% per frame at 60fps
      const nx = this.velocity.x + (desiredDir.x * speed - this.velocity.x) * blendRate;
      const ny = this.velocity.y + (desiredDir.y * speed - this.velocity.y) * blendRate;
      this.velocity.set(nx, ny);
    }
  }

  // ------------------------------------------------------------------
  // Physics tick
  // ------------------------------------------------------------------

  update(dt, worldW, worldH) {
    if (!this.alive) return;

    // --- head kinematics ---
    this.velocity.scaleSelf(1 - DRAG * dt);          // drag
    this.segments[0].pos.addSelf(this.velocity.scale(dt));

    // soft wall pushback
    const { force, touching } = circleVsBounds(
      this.segments[0].pos, this.segments[0].radius, worldW, worldH,
    );
    this.velocity.addSelf(force.scale(dt));

    // --- verlet follow with gentle snake undulation ---
    const speed = this.velocity.length();
    for (let i = 1; i < this.segments.length; i++) {
      const prev = this.segments[i - 1].pos;
      const curr = this.segments[i].pos;
      const dir  = prev.sub(curr);
      const dist = dir.length();
      if (dist > SEGMENT_SPACING * 0.5) {
        const n = dir.scale(1 / dist);
        const perp = new Vec2(-n.y, n.x);

        // Base target: directly behind previous segment
        let tx = prev.x - n.x * SEGMENT_SPACING;
        let ty = prev.y - n.y * SEGMENT_SPACING;

        // Gentle lateral undulation (much softer than before)
        if (speed > 5) {
          const ratio = i / this.segments.length;
          const amp = ratio * 1.2 * Math.min(speed / 60, 1.0);
          const wave = Math.sin(this.age * 2.5 - i * 0.6) * amp;
          tx += perp.x * wave;
          ty += perp.y * wave;
        }

        // Maintain exact segment spacing
        const dx = tx - prev.x;
        const dy = ty - prev.y;
        const td = Math.sqrt(dx * dx + dy * dy);
        if (td > 0.001) {
          curr.set(
            prev.x + (dx / td) * SEGMENT_SPACING,
            prev.y + (dy / td) * SEGMENT_SPACING,
          );
        }
      }
    }

    // --- anti-folding: enforce minimum angle between consecutive segments ---
    const MIN_DOT = -0.3;  // ~107° max bend (dot product threshold)
    for (let i = 2; i < this.segments.length; i++) {
      const a = this.segments[i - 2].pos;
      const b = this.segments[i - 1].pos;
      const c = this.segments[i].pos;
      const ab = b.sub(a);
      const bc = c.sub(b);
      const abLen = ab.length();
      const bcLen = bc.length();
      if (abLen < 0.001 || bcLen < 0.001) continue;
      const dot = (ab.x * bc.x + ab.y * bc.y) / (abLen * bcLen);
      if (dot < MIN_DOT) {
        // Segment is folding back — push it outward along the AB direction
        const target = b.add(ab.scale(SEGMENT_SPACING / abLen));
        // Blend toward corrected position
        c.set(
          c.x + (target.x - c.x) * 0.5,
          c.y + (target.y - c.y) * 0.5,
        );
      }
    }

    // --- heading from first two segments ---
    const s0 = this.segments[0].pos;
    const s1 = this.segments[1].pos;
    this.heading = Math.atan2(s0.y - s1.y, s0.x - s1.x);

    this.age += dt;
  }
}
