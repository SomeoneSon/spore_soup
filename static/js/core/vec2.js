// core/vec2.js — Immutable + mutable 2D vector
export class Vec2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  // --- Immutable ---
  add(v)       { return new Vec2(this.x + v.x, this.y + v.y); }
  sub(v)       { return new Vec2(this.x - v.x, this.y - v.y); }
  scale(s)     { return new Vec2(this.x * s, this.y * s); }
  negate()     { return new Vec2(-this.x, -this.y); }

  dot(v)       { return this.x * v.x + this.y * v.y; }
  cross(v)     { return this.x * v.y - this.y * v.x; }

  length()     { return Math.sqrt(this.x * this.x + this.y * this.y); }
  lengthSq()   { return this.x * this.x + this.y * this.y; }

  normalize() {
    const len = this.length();
    return len > 0 ? new Vec2(this.x / len, this.y / len) : new Vec2(0, 0);
  }

  distanceTo(v) {
    const dx = this.x - v.x, dy = this.y - v.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  distanceToSq(v) {
    const dx = this.x - v.x, dy = this.y - v.y;
    return dx * dx + dy * dy;
  }

  rotate(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return new Vec2(this.x * c - this.y * s, this.x * s + this.y * c);
  }

  lerp(v, t) {
    return new Vec2(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t);
  }

  angle() { return Math.atan2(this.y, this.x); }

  clone() { return new Vec2(this.x, this.y); }

  // --- Mutable ---
  addSelf(v)    { this.x += v.x; this.y += v.y; return this; }
  subSelf(v)    { this.x -= v.x; this.y -= v.y; return this; }
  scaleSelf(s)  { this.x *= s;   this.y *= s;   return this; }

  set(x, y) { this.x = x; this.y = y; return this; }

  normalizeSelf() {
    const len = this.length();
    if (len > 0) { this.x /= len; this.y /= len; }
    return this;
  }

  // --- Static helpers ---
  static fromAngle(angle) {
    return new Vec2(Math.cos(angle), Math.sin(angle));
  }

  static random(scale = 1) {
    const a = Math.random() * Math.PI * 2;
    return new Vec2(Math.cos(a) * scale, Math.sin(a) * scale);
  }
}
