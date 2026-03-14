// game/editor.js — Spore-style creature editor overlay
import { Vec2 } from '../core/vec2.js';
import { Body } from '../creature/body.js';
import { renderBody } from '../creature/render.js';
import { PARTS, getAvailableParts, canAddPart, countParts, totalPartsCost } from '../creature/parts.js';

const EDITOR_PADDING = 60;

export class Editor {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   * @param {number} opts.layer — current layer (determines available parts)
   * @param {number} opts.genes — available gene currency
   * @param {Function} opts.onApply — callback({radii, parts, genes})
   * @param {Function} opts.onCancel
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.layer  = opts.layer || 0;
    this.genes  = opts.genes || 999;
    this.onApply  = opts.onApply  || (() => {});
    this.onCancel = opts.onCancel || (() => {});

    this.active = false;

    // Creature model for editing
    this.segmentCount = 4;
    this.radii = [12, 10, 9, 7];
    this.parts = [];          // flat list of {partId, segIndex, side}
    this.speciesHue = 180;

    // UI state
    this._hoveredSeg = -1;
    this._dragPart   = null;   // {partId} while dragging from palette
    this._mousePos   = { x: 0, y: 0 };

    // Bind handlers
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseUp   = this._handleMouseUp.bind(this);
    this._onWheel     = this._handleWheel.bind(this);
    this._onKeyDown   = this._handleKeyDown.bind(this);
  }

  /** Open editor with current creature config */
  open({ radii, parts, speciesHue, genes }) {
    this.radii = [...radii];
    this.segmentCount = radii.length;
    this.parts = parts ? parts.map(p => ({ ...p })) : [];
    this.speciesHue = speciesHue || 180;
    if (genes != null) this.genes = genes;
    this.active = true;
    this._hoveredSeg = -1;
    this._dragPart = null;

    this.canvas.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    this.canvas.addEventListener('mouseup', this._onMouseUp);
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    document.addEventListener('keydown', this._onKeyDown);
  }

  close() {
    this.active = false;
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    this.canvas.removeEventListener('mouseup', this._onMouseUp);
    this.canvas.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('keydown', this._onKeyDown);
  }

  // --- Build preview body for rendering ---
  _buildPreviewBody() {
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2 - 30;
    const spacing = 20;   // wider spacing for editor view

    const body = new Body(new Vec2(cx + spacing * 1.5, cy), {
      segmentCount: this.segmentCount,
      radii: this.radii,
      color: [this.speciesHue, 55, 50],
    });
    // lay out horizontally
    for (let i = 0; i < body.segments.length; i++) {
      body.segments[i].pos = new Vec2(cx + spacing * 1.5 - i * spacing, cy);
    }
    body.heading = 0;

    // Attach parts info for rendering
    body.parts = this.parts.map(p => p.partId);

    return body;
  }

  // --- Render editor overlay ---
  render() {
    if (!this.active) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // dark overlay
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(0, 0, w, h);

    // Title
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Редактор существа', w / 2, 40);

    // Gene counter
    const spent = totalPartsCost(this.parts.map(p => p.partId));
    const remaining = this.genes - spent;
    ctx.font = '16px "Segoe UI", sans-serif';
    ctx.fillStyle = remaining >= 0 ? '#6f6' : '#f66';
    ctx.textAlign = 'right';
    ctx.fillText(`🧬 Гены: ${remaining}`, w - 20, 35);

    // Preview creature (large, centered)
    const body = this._buildPreviewBody();
    ctx.save();
    const scale = 3.0;
    const cx = w / 2;
    const cy = h / 2 - 30;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    renderBody(ctx, body);
    ctx.restore();

    // Segment labels + highlight
    for (let i = 0; i < body.segments.length; i++) {
      const seg = body.segments[i];
      const sx = cx + (seg.pos.x - cx) * scale;
      const sy = cy + (seg.pos.y - cy) * scale;
      const sr = seg.radius * scale;

      if (i === this._hoveredSeg) {
        ctx.beginPath();
        ctx.arc(sx, sy, sr + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(80, 200, 255, 0.7)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = 'rgba(80, 200, 255, 0.8)';
        ctx.font = '12px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`R: ${this.radii[i].toFixed(0)}`, sx, sy - sr - 10);
        ctx.fillText('scroll = толщина', sx, sy - sr - 24);
      }

      // show attached parts for this segment
      const segParts = this.parts.filter(p => p.segIndex === i);
      for (let j = 0; j < segParts.length; j++) {
        const p = segParts[j];
        const def = PARTS[p.partId];
        const py = sy + sr + 14 + j * 14;
        ctx.fillStyle = '#ccc';
        ctx.font = '10px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(def.name, sx, py);
      }
    }

    // Part palette at bottom
    this._renderPalette(ctx, w, h);

    // Stats panel on right
    this._renderStats(ctx, w, h, body);

    // Buttons
    this._renderButtons(ctx, w, h);

    // Drag preview
    if (this._dragPart) {
      const def = PARTS[this._dragPart];
      ctx.fillStyle = 'rgba(80, 200, 255, 0.5)';
      ctx.font = 'bold 14px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(def.name, this._mousePos.x, this._mousePos.y - 10);
    }

    ctx.restore();
  }

  _renderPalette(ctx, w, h) {
    const available = getAvailableParts(this.layer);
    const paletteY = h - 80;
    const itemW = 110;
    const startX = (w - available.length * itemW) / 2;

    ctx.fillStyle = 'rgba(20, 30, 50, 0.8)';
    ctx.fillRect(startX - 10, paletteY - 10, available.length * itemW + 20, 70);
    ctx.strokeStyle = 'rgba(80, 200, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(startX - 10, paletteY - 10, available.length * itemW + 20, 70);

    for (let i = 0; i < available.length; i++) {
      const part = available[i];
      const px = startX + i * itemW + itemW / 2;

      const count = countParts({ parts: this.parts.map(p => p.partId) }, part.id);
      const atMax = count >= part.max;
      const spent = totalPartsCost(this.parts.map(p => p.partId));
      const canAfford = (this.genes - spent) >= part.cost;

      ctx.fillStyle = atMax ? '#666' : canAfford ? '#ddd' : '#a66';
      ctx.font = 'bold 13px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(part.name, px, paletteY + 10);

      ctx.font = '11px "Segoe UI", sans-serif';
      ctx.fillStyle = '#999';
      ctx.fillText(`${part.cost} 🧬  (${count}/${part.max})`, px, paletteY + 26);
      ctx.fillText(part.description, px, paletteY + 40);

      // store hitbox for click
      part._px = px - itemW / 2;
      part._py = paletteY - 10;
      part._pw = itemW;
      part._ph = 70;
    }
  }

  _renderStats(ctx, w, h, body) {
    const sx = w - 200;
    const sy = 70;

    ctx.fillStyle = 'rgba(20, 30, 50, 0.8)';
    ctx.fillRect(sx, sy, 180, 160);
    ctx.strokeStyle = 'rgba(80, 200, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx, sy, 180, 160);

    ctx.fillStyle = '#aaa';
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';

    const eyeCount = countParts({ parts: this.parts.map(p => p.partId) }, 'eye');
    const hasCilia = countParts({ parts: this.parts.map(p => p.partId) }, 'cilia') > 0;
    const hasMouth = countParts({ parts: this.parts.map(p => p.partId) }, 'mouth') > 0;
    const finCount = countParts({ parts: this.parts.map(p => p.partId) }, 'fin');

    const sensorRange = 40 + eyeCount * 60;
    const rays = eyeCount >= 2 ? 8 : eyeCount >= 1 ? 5 : 3;
    const eatMode = hasCilia ? 'Травоядный (100%)' : hasMouth ? 'Хищник (100%)' : 'Всеядный (25%)';

    const lines = [
      `Сегменты: ${this.segmentCount}`,
      `Обзор: ${sensorRange}px (${rays} лучей)`,
      `Глаза: ${eyeCount}`,
      `Питание: ${eatMode}`,
      `Плавники: ${finCount}`,
      `Скорость: ${(40 + finCount * 20).toFixed(0)} px/s`,
      `HP: 100  |  Энергия: 100`,
    ];

    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], sx + 10, sy + 20 + i * 17);
    }

    // Segment count +/- buttons
    const btnY = sy + 142;
    this._addSegBtn = { x: sx + 10, y: btnY, w: 78, h: 22 };
    this._remSegBtn = { x: sx + 94, y: btnY, w: 78, h: 22 };

    const canAdd = this.segmentCount < 8;
    const canRem = this.segmentCount > 3;

    ctx.fillStyle = canAdd ? 'rgba(50,180,80,0.6)' : 'rgba(60,60,60,0.4)';
    ctx.fillRect(this._addSegBtn.x, this._addSegBtn.y, this._addSegBtn.w, this._addSegBtn.h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('+ Сегмент', this._addSegBtn.x + 39, this._addSegBtn.y + 15);

    ctx.fillStyle = canRem ? 'rgba(180,50,50,0.6)' : 'rgba(60,60,60,0.4)';
    ctx.fillRect(this._remSegBtn.x, this._remSegBtn.y, this._remSegBtn.w, this._remSegBtn.h);
    ctx.fillStyle = '#fff';
    ctx.fillText('− Сегмент', this._remSegBtn.x + 39, this._remSegBtn.y + 15);
  }

  _renderButtons(ctx, w, h) {
    // Apply button
    this._applyBtn = { x: w / 2 - 120, y: h - 130, w: 100, h: 32 };
    ctx.fillStyle = 'rgba(50, 180, 80, 0.6)';
    ctx.fillRect(this._applyBtn.x, this._applyBtn.y, this._applyBtn.w, this._applyBtn.h);
    ctx.strokeStyle = 'rgba(80, 255, 120, 0.5)';
    ctx.strokeRect(this._applyBtn.x, this._applyBtn.y, this._applyBtn.w, this._applyBtn.h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Применить', this._applyBtn.x + 50, this._applyBtn.y + 22);

    // Cancel button
    this._cancelBtn = { x: w / 2 + 20, y: h - 130, w: 100, h: 32 };
    ctx.fillStyle = 'rgba(180, 50, 50, 0.6)';
    ctx.fillRect(this._cancelBtn.x, this._cancelBtn.y, this._cancelBtn.w, this._cancelBtn.h);
    ctx.strokeStyle = 'rgba(255, 80, 80, 0.5)';
    ctx.strokeRect(this._cancelBtn.x, this._cancelBtn.y, this._cancelBtn.w, this._cancelBtn.h);
    ctx.fillStyle = '#fff';
    ctx.fillText('Отмена', this._cancelBtn.x + 50, this._cancelBtn.y + 22);
  }

  // --- Input handlers ---

  _handleMouseMove(e) {
    this._mousePos = { x: e.clientX, y: e.clientY };
    const body = this._buildPreviewBody();
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2 - 30;
    const scale = 3.0;

    this._hoveredSeg = -1;
    for (let i = 0; i < body.segments.length; i++) {
      const seg = body.segments[i];
      const sx = cx + (seg.pos.x - cx) * scale;
      const sy = cy + (seg.pos.y - cy) * scale;
      const sr = seg.radius * scale;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (Math.sqrt(dx * dx + dy * dy) < sr + 10) {
        this._hoveredSeg = i;
        break;
      }
    }
  }

  _handleWheel(e) {
    e.preventDefault();
    if (this._hoveredSeg < 0) return;
    const delta = e.deltaY > 0 ? -1 : 1;
    this.radii[this._hoveredSeg] = Math.max(5, Math.min(30, this.radii[this._hoveredSeg] + delta));
  }

  _handleMouseDown(e) {
    const mx = e.clientX, my = e.clientY;

    // Check segment add/remove buttons
    if (this._addSegBtn && _inRect(mx, my, this._addSegBtn)) {
      if (this.segmentCount < 8) {
        this.segmentCount++;
        const lastR = this.radii[this.radii.length - 1];
        this.radii.push(Math.max(5, lastR - 1));
      }
      return;
    }
    if (this._remSegBtn && _inRect(mx, my, this._remSegBtn)) {
      if (this.segmentCount > 3) {
        this.segmentCount--;
        this.radii.pop();
        // Remove parts that were on the removed segment
        this.parts = this.parts.filter(p => p.segIndex < this.segmentCount);
      }
      return;
    }

    // Check palette click
    const available = getAvailableParts(this.layer);
    for (const part of available) {
      if (part._px != null && mx >= part._px && mx <= part._px + part._pw &&
          my >= part._py && my <= part._py + part._ph) {
        const spent = totalPartsCost(this.parts.map(p => p.partId));
        const canAfford = (this.genes - spent) >= part.cost;
        const count = countParts({ parts: this.parts.map(p => p.partId) }, part.id);
        if (count < part.max && canAfford) {
          this._dragPart = part.id;
        }
        return;
      }
    }

    // Check apply/cancel buttons
    if (this._applyBtn && _inRect(mx, my, this._applyBtn)) {
      this._apply();
      return;
    }
    if (this._cancelBtn && _inRect(mx, my, this._cancelBtn)) {
      this.close();
      this.onCancel();
      return;
    }

    // Right-click on segment to remove last part
    if (e.button === 2 && this._hoveredSeg >= 0) {
      e.preventDefault();
      const idx = this.parts.findLastIndex(p => p.segIndex === this._hoveredSeg);
      if (idx >= 0) this.parts.splice(idx, 1);
    }
  }

  _handleMouseUp(e) {
    if (this._dragPart && this._hoveredSeg >= 0) {
      // Try to place part on hovered segment
      const mockBody = {
        parts: this.parts.map(p => p.partId),
        segments: Array.from({ length: this.segmentCount }, () => ({ parts: [] })),
      };
      // Count parts on this segment
      for (const p of this.parts) {
        if (mockBody.segments[p.segIndex]) {
          mockBody.segments[p.segIndex].parts.push(p.partId);
        }
      }

      const check = canAddPart(mockBody, this._dragPart, this._hoveredSeg);
      if (check.ok) {
        this.parts.push({ partId: this._dragPart, segIndex: this._hoveredSeg });
      }
    }
    this._dragPart = null;
  }

  _handleKeyDown(e) {
    if (e.key === 'Escape') {
      this.close();
      this.onCancel();
    }
    if (e.key === 'Enter') {
      this._apply();
    }
  }

  _apply() {
    const spent = totalPartsCost(this.parts.map(p => p.partId));
    const remaining = this.genes - spent;
    if (remaining < 0) return;  // can't afford

    this.close();
    this.onApply({
      radii: [...this.radii],
      parts: this.parts.map(p => ({ ...p })),
      genes: remaining,
    });
  }
}

function _inRect(mx, my, r) {
  return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
}
