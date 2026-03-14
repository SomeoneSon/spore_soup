// game/main.js — Game loop, rendering orchestration
import { Camera }    from './camera.js';
import { Soup }      from '../world/soup.js';
import { renderBody, renderWorldBackground, renderSensorOverlay } from '../creature/render.js';
import { renderFood, renderFoodSpawner } from '../world/food.js';
import { renderHazard } from '../world/hazards.js';
import { gatherInputs } from '../creature/sensors.js';
import { Vec2 } from '../core/vec2.js';
import { Editor } from './editor.js';

// --- Setup ----------------------------------------------------------------

const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');

function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// --- World ----------------------------------------------------------------

const WORLD_W = 6800;
const WORLD_H = 4096;
const soup   = new Soup(WORLD_W, WORLD_H);
const camera = new Camera(canvas);

soup.init({
  creatureCount: 50,
  grassCount: 160,
  meatCount: 0,
  poisonCount: 5,
  spikeCount: 3,
});

// start camera following first creature
camera.pos.set(soup.creatures[0].pos.x, soup.creatures[0].pos.y);
camera.follow(soup.creatures[0]);
camera.zoom = 1.5;

// When user drags the camera, switch to free camera mode
camera.onDragDetach = () => { followMode = false; };

// expose for debugging
window._soup = soup;
window._camera = camera;

// --- Creature editor -------------------------------------------------------

let playerGenes = 999;        // gene currency (TODO: connect to progression)
let creatureRadii = [12, 10, 9, 7];
let creatureParts = [];       // [{partId, segIndex}]

const editor = new Editor(canvas, {
  layer: 0,
  genes: playerGenes,
  onApply: ({ radii, parts, genes }) => {
    creatureRadii = radii;
    creatureParts = parts;
    playerGenes = genes;
    // Apply to all current + future creatures
    soup._creatureRadii = radii;
    soup._creatureParts = parts.map(p => p.partId);
    // Propagate to shadow sims
    for (const shadow of shadowSoups) {
      shadow._creatureRadii = radii;
      shadow._creatureParts = parts.map(p => p.partId);
    }
    // Body plan changed — reset all training from scratch
    soup.reset();
    for (const shadow of shadowSoups) {
      shadow.reset();
    }
    _lastSyncTime = 0;
    // Follow a creature from the new generation
    const firstAlive = soup.creatures.find(c => c.alive);
    if (firstAlive) camera.follow(firstAlive);
    followMode = true;
    editorOpen = false;
  },
  onCancel: () => {
    editorOpen = false;
  },
});

let editorOpen = false;

document.addEventListener('keydown', (e) => {
  if (e.key === 'e' || e.key === 'E' || e.key === 'у' || e.key === 'У') {
    if (!editorOpen) {
      editorOpen = true;
      editor.open({
        radii: creatureRadii,
        parts: creatureParts,
        speciesHue: soup._speciesHue,
        genes: playerGenes,
      });
    }
  }
});

// --- Follow mode ----------------------------------------------------------

let followMode = true;   // true = auto-follow + switch on death; false = free camera

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('click', (e) => {
  if (editorOpen) return;
  const wp = camera.screenToWorld(e.clientX, e.clientY);
  let closest = null, closestDist = 40 / camera.zoom;
  for (const c of soup.creatures) {
    if (!c.alive) continue;
    const d = c.pos.distanceTo(wp);
    if (d < closestDist) { closest = c; closestDist = d; }
  }
  if (closest) {
    camera.follow(closest);
    followMode = true;
  }
});

// --- Speed control --------------------------------------------------------

let gameSpeed = 1;         // 1, 2, 5, 10
const SPEED_OPTIONS = [1, 2, 5, 10];

// --- HUD ------------------------------------------------------------------

const hudEl = document.getElementById('hud');

// Build persistent HUD structure once (speed buttons won't be destroyed each frame)
hudEl.innerHTML =
  `<div id="hud-stats"></div>` +
  `<div style="margin-top:4px" id="hud-controls"></div>`;

const hudStats    = document.getElementById('hud-stats');
const hudControls = document.getElementById('hud-controls');

// Create speed buttons once
const _speedBtnEls = {};
{
  const frag = document.createDocumentFragment();
  for (const s of SPEED_OPTIONS) {
    const btn = document.createElement('span');
    btn.className = 'speed-btn' + (gameSpeed === s ? ' active' : '');
    btn.textContent = `×${s}`;
    btn.addEventListener('click', (e) => { gameSpeed = s; e.stopPropagation(); });
    frag.appendChild(btn);
    frag.appendChild(document.createTextNode(' '));
    _speedBtnEls[s] = btn;
  }
  const sep1 = document.createTextNode(' | ');
  frag.appendChild(sep1);
  const shadowInfo = document.createElement('span');
  shadowInfo.id = 'hud-shadow';
  frag.appendChild(shadowInfo);
  const sep2 = document.createTextNode(' | ');
  frag.appendChild(sep2);
  const zoomInfo = document.createElement('span');
  zoomInfo.id = 'hud-zoom';
  frag.appendChild(zoomInfo);
  const sep3 = document.createTextNode(' | ');
  frag.appendChild(sep3);
  const editorBtn = document.createElement('span');
  editorBtn.className = 'speed-btn';
  editorBtn.textContent = '[E] Редактор';
  editorBtn.addEventListener('click', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
  });
  frag.appendChild(editorBtn);
  frag.appendChild(document.createTextNode(' '));
  // Follow/unfollow toggle button
  const followBtn = document.createElement('span');
  followBtn.className = 'speed-btn';
  followBtn.id = 'hud-follow-btn';
  followBtn.textContent = '🔒 Слежение';
  followBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (followMode) {
      // Switch to free camera
      followMode = false;
      camera.unfollow();
    } else {
      // Switch to follow mode, pick nearest alive creature
      followMode = true;
      const alive = soup.creatures.find(c => c.alive);
      if (alive) camera.follow(alive);
    }
  });
  frag.appendChild(followBtn);
  hudControls.appendChild(frag);
}

function updateHUD() {
  const alive = soup.creatures.filter(c => c.alive).length;
  const followed = camera.target;
  let extra = '';
  if (followed && followed.alive) {
    const hp  = Math.max(0, followed.hp).toFixed(0);
    const eng = Math.max(0, followed.energy).toFixed(0);
    extra = ` | HP: ${hp}/${followed.maxHp} | E: ${eng}/${followed.maxEnergy} | Еда: ${followed.foodEaten || 0}`;
  }
  const foodAlive = soup.food.filter(f => f.alive).length;
  const gen = soup.pool.generation;
  const best = soup.pool.bestFitness === -Infinity ? '—' : soup.pool.bestFitness.toFixed(1);
  const avg = soup.pool.avgFitness ? soup.pool.avgFitness.toFixed(1) : '—';
  const genTime = soup.generationTime.toFixed(0);
  const stag = soup.pool._stagnation || 0;
  const stagLabel = stag >= 5
    ? ` <span style="color:#f66" title="${stag} поколений без улучшения — мутация усилена">⚠ Застой (${stag})</span>`
    : '';

  // Update stats text (no buttons here — safe to use innerHTML)
  hudStats.innerHTML =
    `Слой: Первичный бульон &nbsp;|&nbsp; ` +
    `Поколение: ${gen} &nbsp;|&nbsp; ` +
    `Особей: ${alive}/${soup.creatures.length} &nbsp;|&nbsp; ` +
    `Еда: ${foodAlive} &nbsp;|&nbsp; ` +
    `Время: ${genTime}с &nbsp;|&nbsp; ` +
    `Лучший: ${best} &nbsp;|&nbsp; Средний: ${avg}${stagLabel}` +
    extra;

  // Update speed button active state (no DOM recreation)
  for (const s of SPEED_OPTIONS) {
    _speedBtnEls[s].classList.toggle('active', gameSpeed === s);
  }

  // Update shadow & zoom info
  const shadowMaxGen = Math.max(...shadowSoups.map(s => s.pool.generation));
  const shadowBest = Math.max(...shadowSoups.map(s => s.pool.bestFitness)).toFixed(1);
  document.getElementById('hud-shadow').textContent =
    `Фон: ${SHADOW_COUNT} миров (покол. ${shadowMaxGen}, лучш. ${shadowBest})`;
  document.getElementById('hud-zoom').textContent = `Zoom: ${camera.zoom.toFixed(2)}`;

  // Update follow button state
  const followBtn = document.getElementById('hud-follow-btn');
  if (followMode && camera.target) {
    followBtn.textContent = '🔒 Слежение';
    followBtn.classList.add('active');
  } else {
    followBtn.textContent = '🔓 Своб. камера';
    followBtn.classList.remove('active');
  }
}

// --- Death animation (fade out) -------------------------------------------

function renderDeadCreature(ctx, body, time) {
  const elapsed = time - (body._deathTime || 0);
  if (elapsed > 2) return;   // fully gone after 2s
  const alpha = 1 - elapsed / 2;
  ctx.globalAlpha = alpha * 0.5;
  renderBody(ctx, body);
  ctx.globalAlpha = 1;
}

// --- Background (shadow) simulations --------------------------------------

const SHADOW_COUNT = 5;     // parallel invisible sims
const shadowSoups = [];
let _lastSyncTime = 0;      // proper timer for shadow sync

for (let i = 0; i < SHADOW_COUNT; i++) {
  const s = new Soup(WORLD_W, WORLD_H);
  s.init({
    creatureCount: 50,
    grassCount: 160,
    meatCount: 0,
    poisonCount: 5,
    spikeCount: 3,
  });
  // Share species color with main
  s._speciesHue = soup._speciesHue;
  shadowSoups.push(s);
}

window._shadowSoups = shadowSoups;

/**
 * When a shadow world completes a generation ahead of the visible one,
 * adopt its pool if it has better fitness.
 */
function syncShadowPools() {
  for (const shadow of shadowSoups) {
    if (shadow.pool.generation > soup.pool.generation &&
        shadow.pool.bestFitness > soup.pool.bestFitness) {
      // Adopt shadow's archive into main pool
      for (const entry of shadow.pool.archive) {
        soup.pool._insertArchive(entry.genome, entry.fitness);
      }
    }
  }
}

// --- Game loop ------------------------------------------------------------

let lastTime = 0;

function loop(timestamp) {
  const rawDt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  // --- Editor mode: render editor overlay, pause sim ---
  if (editorOpen) {
    hudEl.style.display = 'none';
    editor.render();
    requestAnimationFrame(loop);
    return;
  }
  hudEl.style.display = '';

  const dt = rawDt * gameSpeed;

  // update visible world (sub-step if speed > 2 for stability)
  const steps = gameSpeed <= 2 ? 1 : Math.min(gameSpeed, 5);
  const subDt = dt / steps;
  for (let i = 0; i < steps; i++) {
    soup.tick(subDt);
  }

  // update shadow worlds (headless, faster than visible world)
  // Budget: cap total shadow ticks to avoid freezing under load
  const SHADOW_SPEED_MULT = 3;
  const shadowStepsPerWorld = Math.max(steps * SHADOW_SPEED_MULT, 5);
  const totalBudget = 40;   // max total shadow ticks per frame
  const cappedSteps = Math.min(shadowStepsPerWorld, Math.floor(totalBudget / shadowSoups.length));
  const shadowDt = rawDt * gameSpeed * SHADOW_SPEED_MULT / cappedSteps;
  for (const shadow of shadowSoups) {
    for (let i = 0; i < cappedSteps; i++) {
      shadow.tick(shadowDt);
    }
  }

  // Sync best genomes from shadows periodically (once per 5 sim-seconds)
  if (soup.time - _lastSyncTime >= 5) {
    _lastSyncTime = soup.time;
    syncShadowPools();
  }

  camera.update(rawDt);

  // Auto-follow: only if followMode is on
  if (followMode) {
    if (!camera.target || !camera.target.alive || !soup.creatures.includes(camera.target)) {
      const alive = soup.creatures.find(c => c.alive);
      if (alive) camera.follow(alive);
      else camera.unfollow();
    }
  }

  // render
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#060a10';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  camera.apply(ctx);
  renderWorldBackground(ctx, WORLD_W, WORLD_H, camera);

  // hazards (behind everything)
  for (const h of soup.hazards) {
    renderHazard(ctx, h, soup.time);
  }

  // food spawners
  for (const sp of soup.spawners) {
    renderFoodSpawner(ctx, sp, soup.time);
  }

  // food
  for (const f of soup.food) {
    if (f.alive) renderFood(ctx, f, soup.time);
  }

  // creatures (alive + death animation)
  for (const c of soup.creatures) {
    if (c.alive) {
      renderBody(ctx, c);
    } else {
      renderDeadCreature(ctx, c, soup.time);
    }
  }

  // sensor overlay for followed creature
  if (camera.target && camera.target.alive) {
    const inputs = gatherInputs(camera.target, soup);
    renderSensorOverlay(ctx, camera.target, inputs);
  }

  updateHUD();
  requestAnimationFrame(loop);
}

requestAnimationFrame((ts) => { lastTime = ts; loop(ts); });
