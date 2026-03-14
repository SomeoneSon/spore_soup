// game/camera.js — Pan, zoom, follow target
import { Vec2 } from '../core/vec2.js';

export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.pos = new Vec2(0, 0);   // world position of camera center
    this.zoom = 1;
    this.minZoom = 0.15;
    this.maxZoom = 3;
    this.target = null;          // body to follow (or null)

    this._dragging = false;
    this._dragStart = new Vec2();
    this._camStart = new Vec2();

    this._bindEvents();
  }

  // --- Public ---

  follow(body) { this.target = body; }
  unfollow()   { this.target = null; }

  /** Apply camera transform to a canvas 2D context */
  apply(ctx) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(w / 2, h / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.pos.x, -this.pos.y);
  }

  /** Smooth follow per frame */
  update(dt) {
    if (this.target) {
      const targetPos = this.target.pos || this.target;
      this.pos = this.pos.lerp(targetPos, 1 - Math.exp(-5 * dt));
    }
  }

  /** Convert screen coords → world coords */
  screenToWorld(sx, sy) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    return new Vec2(
      (sx - w / 2) / this.zoom + this.pos.x,
      (sy - h / 2) / this.zoom + this.pos.y,
    );
  }

  // --- Input ---

  _bindEvents() {
    const c = this.canvas;

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    }, { passive: false });

    c.addEventListener('pointerdown', (e) => {
      if (e.button === 0) {
        this._dragging = true;
        this._dragStart.set(e.clientX, e.clientY);
        this._camStart = this.pos.clone();
      }
    });

    window.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      const dx = (e.clientX - this._dragStart.x) / this.zoom;
      const dy = (e.clientY - this._dragStart.y) / this.zoom;
      // If user drags far enough, detach from target
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        this.target = null;
        if (this.onDragDetach) this.onDragDetach();
      }
      this.pos = new Vec2(this._camStart.x - dx, this._camStart.y - dy);
    });

    window.addEventListener('pointerup', () => { this._dragging = false; });
  }
}
