// main.js — Point d'entrée du Bubble Shooter Retro (ESM).
// Rendu Canvas 2D, boucle requestAnimationFrame, entrées clavier/souris/tactile,
// gestion des écrans (menu / jeu / game over). La logique pure vit dans logic.js.

import {
  COLOR_COUNT,
  hexCenter,
  createRng,
  createGrid,
  fillInitialRows,
  findGroup,
  floatingBubbles,
  computeScore,
  addTopRow,
  isGameOver,
  findSnapCell,
} from './logic.js';

// --- Constantes du jeu ------------------------------------------------------
const COLS = 12; // nombre de colonnes (lignes paires)
const ROWS = 16; // nombre de lignes de la grille
const INITIAL_ROWS = 5; // lignes remplies au départ
const DANGER_ROW = ROWS - 1; // game over quand une bulle atteint ce rang
const SHOTS_TO_NEW_ROW = 6; // tirs ratés avant l'ajout d'une ligne
const ROW_INTERVAL_START = 12; // secondes avant l'accélération temporelle initiale
const MAX_AIM_ANGLE = Math.PI / 2 - 0.06; // angle de visée maximal (radians)

// Palette néon (5 couleurs), cohérente avec le hub.
const PALETTE = [
  { base: '#f43f5e', light: '#fda4af', dark: '#881337' }, // rose
  { base: '#f59e0b', light: '#fde68a', dark: '#78350f' }, // ambre
  { base: '#22d3ee', light: '#a5f3fc', dark: '#155e75' }, // cyan
  { base: '#a3e635', light: '#d9f99d', dark: '#3f6212' }, // lime
  { base: '#a855f7', light: '#e9d5ff', dark: '#6b21a8' }, // violet
];

// Clé de persistance du meilleur score (préfixe imposé).
const STORAGE_KEY = 'odg.game_bubble_shooter.highscore';

// --- Références DOM ---------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const hudEl = document.getElementById('hud');
const scoreEl = document.getElementById('score-value');
const highscoreEl = document.getElementById('highscore-value');
const menuEl = document.getElementById('menu');
const gameoverEl = document.getElementById('gameover');
const finalScoreEl = document.getElementById('final-score');
const newRecordEl = document.getElementById('new-record');
const startButton = document.getElementById('start-button');
const restartButton = document.getElementById('restart-button');

// --- État du jeu ------------------------------------------------------------
const state = {
  status: 'menu', // 'menu' | 'playing' | 'gameover'
  score: 0,
  combo: 0,
  missCount: 0,
  rowTimer: 0,
  grid: null,
  parity: 0,
  currentColor: 0,
  nextColor: 0,
  aimAngle: 0, // 0 = droit devant (vers le haut)
  flying: null, // { x, y, tx, ty, color, speed, snap }
  effects: [], // particules de pop et bulles qui tombent
  rng: null,
};

// --- Layout (recalculé au resize) ------------------------------------------
let layout = null;

function computeLayout(w, h) {
  const PAD = 12;
  const TOP = 14;
  const CANON = 92; // espace réservé sous la grille pour le canon
  const rByWidth = (w - 2 * PAD) / (2 * COLS);
  const rByHeight = (h - TOP - CANON) / (ROWS * Math.sqrt(3) + 3);
  const radius = Math.max(6, Math.floor(Math.min(rByWidth, rByHeight)));
  const boardW = 2 * COLS * radius;
  const boardH = ROWS * Math.sqrt(3) * radius;
  const offsetX = (w - boardW) / 2;
  const offsetY = TOP;
  const canon = {
    x: w / 2,
    y: offsetY + boardH + radius * 2.3,
    bx: COLS * radius, // coordonnées du canon dans l'espace du plateau
    by: ROWS * Math.sqrt(3) * radius + radius * 2.3,
  };
  return { w, h, radius, boardW, boardH, offsetX, offsetY, canon };
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layout = computeLayout(w, h);
}

// --- Persistance (localStorage) --------------------------------------------
function loadHighscore() {
  try {
    return Number(localStorage.getItem(STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveHighscore(value) {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    /* stockage indisponible : on ignore */
  }
}

// --- Cycle de vie -----------------------------------------------------------
function newGame() {
  const rng = createRng((Date.now() ^ 0x9e3779b9) >>> 0);
  state.rng = rng;
  state.grid = fillInitialRows(createGrid(ROWS, COLS, 0), INITIAL_ROWS, COLOR_COUNT, rng);
  state.parity = 0;
  state.score = 0;
  state.combo = 0;
  state.missCount = 0;
  state.rowTimer = 0;
  state.aimAngle = 0;
  state.flying = null;
  state.effects = [];
  state.currentColor = Math.floor(rng() * COLOR_COUNT);
  state.nextColor = Math.floor(rng() * COLOR_COUNT);
  state.status = 'playing';
  hudEl.classList.remove('hidden');
  menuEl.classList.add('hidden');
  gameoverEl.classList.add('hidden');
  updateHud();
}

function endGame() {
  state.status = 'gameover';
  state.flying = null;
  const best = loadHighscore();
  const isRecord = state.score > best;
  if (isRecord) saveHighscore(state.score);
  finalScoreEl.textContent = `Score : ${state.score}`;
  newRecordEl.classList.toggle('hidden', !isRecord);
  highscoreEl.textContent = String(Math.max(best, state.score));
  gameoverEl.classList.remove('hidden');
}

function updateHud() {
  scoreEl.textContent = String(state.score);
  highscoreEl.textContent = String(Math.max(loadHighscore(), state.score));
}

// --- Accélération -----------------------------------------------------------
function addNewRow() {
  const result = addTopRow(state.grid, state.parity, COLS, ROWS, COLOR_COUNT, state.rng);
  state.grid = result.grid;
  state.parity = result.parity;
  if (result.overflow || isGameOver(state.grid, DANGER_ROW, COLS, ROWS, state.parity)) {
    endGame();
  }
}

function registerMiss() {
  state.combo = 0;
  state.missCount += 1;
  if (state.missCount >= SHOTS_TO_NEW_ROW) {
    state.missCount = 0;
    addNewRow();
  }
}

// --- Tir --------------------------------------------------------------------
function aimDirection() {
  return { dx: Math.sin(state.aimAngle), dy: -Math.cos(state.aimAngle) };
}

function shoot() {
  if (state.status !== 'playing' || state.flying) return;
  const dir = aimDirection();
  const snap = findSnapCell(
    state.grid,
    layout.canon.bx,
    layout.canon.by,
    dir.dx,
    dir.dy,
    layout.radius,
    COLS,
    ROWS,
    state.parity,
  );
  if (!snap) {
    registerMiss();
    return;
  }
  const center = hexCenter(snap.row, snap.col, layout.radius, state.parity);
  state.flying = {
    sx: layout.canon.x,
    sy: layout.canon.y,
    x: layout.canon.x,
    y: layout.canon.y,
    tx: layout.offsetX + center.x,
    ty: layout.offsetY + center.y,
    color: state.currentColor,
    t: 0,
    duration: 0.28, // durée de vol fixe (secondes)
    snap,
  };
  // Passe à la bulle suivante.
  state.currentColor = state.nextColor;
  state.nextColor = Math.floor(state.rng() * COLOR_COUNT);
}

function resolveShot(snap, color) {
  const grid = state.grid.map((row) => row.slice());
  grid[snap.row][snap.col] = color;

  const group = findGroup(grid, snap.row, snap.col, COLS, ROWS, state.parity);
  const willPop = group.length >= 3;

  // Bulles qui tombent (suspendues) après retrait du groupe.
  let dropped = [];
  if (willPop) {
    const afterGroup = grid.map((row) => row.slice());
    for (const [r, c] of group) afterGroup[r][c] = null;
    dropped = floatingBubbles(afterGroup, COLS, ROWS, state.parity);
  }

  // Nouvelle grille : retrait du groupe (>= 3) et des bulles suspendues.
  const next = grid.map((row) => row.slice());
  for (const [r, c] of group) next[r][c] = null;
  for (const [r, c] of dropped) next[r][c] = null;
  state.grid = next;

  // Effets visuels.
  if (willPop) {
    for (const [r, c] of group) spawnPop(r, c, grid[r][c]);
  }
  for (const [r, c] of dropped) spawnFall(r, c, grid[r][c]);

  // Score et combo.
  if (willPop) {
    const gained = computeScore(group.length, dropped.length, state.combo);
    state.score += gained;
    state.combo += 1;
    state.missCount = 0;
  } else {
    registerMiss();
  }

  updateHud();

  if (isGameOver(state.grid, DANGER_ROW, COLS, ROWS, state.parity)) {
    endGame();
  }
}

// --- Effets visuels ---------------------------------------------------------
function spawnPop(row, col, color) {
  const center = hexCenter(row, col, layout.radius, state.parity);
  const x = layout.offsetX + center.x;
  const y = layout.offsetY + center.y;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    state.effects.push({
      type: 'pop',
      x,
      y,
      vx: Math.cos(a) * layout.radius * 6,
      vy: Math.sin(a) * layout.radius * 6,
      color,
      life: 0.4,
      maxLife: 0.4,
      r: layout.radius * 0.35,
    });
  }
}

function spawnFall(row, col, color) {
  const center = hexCenter(row, col, layout.radius, state.parity);
  state.effects.push({
    type: 'fall',
    x: layout.offsetX + center.x,
    y: layout.offsetY + center.y,
    vy: 0,
    color,
    life: 0.8,
    maxLife: 0.8,
    r: layout.radius,
  });
}

// --- Boucle de jeu ----------------------------------------------------------
// Interpolation d'assouplissement pour le vol de la bulle (décélération douce).
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

let lastTime = 0;

function update(dt) {
  if (state.status !== 'playing') {
    // Les effets continuent de s'animer même sur l'écran de fin.
    updateEffects(dt);
    return;
  }

  // Accélération temporelle : une ligne toutes les N secondes (N décroît).
  state.rowTimer += dt;
  const interval = Math.max(4, ROW_INTERVAL_START - state.score / 400);
  if (state.rowTimer >= interval) {
    state.rowTimer = 0;
    if (!state.flying && lowestRow(state.grid) >= 0) addNewRow();
  }

  // Vol de la bulle vers sa case (durée fixe, interpolation avec easing).
  if (state.flying) {
    const f = state.flying;
    f.t += dt / f.duration;
    if (f.t >= 1) {
      const snap = f.snap;
      const color = f.color;
      state.flying = null;
      resolveShot(snap, color);
    } else {
      const e = easeOutCubic(f.t);
      f.x = f.sx + (f.tx - f.sx) * e;
      f.y = f.sy + (f.ty - f.sy) * e;
    }
  }

  updateEffects(dt);
}

// Rang le plus bas occupé (ou -1). Petit helper local, sans dépendre de logic.js.
function lowestRow(grid) {
  for (let r = grid.length - 1; r >= 0; r--) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== null) return r;
    }
  }
  return -1;
}

function updateEffects(dt) {
  const next = [];
  for (const e of state.effects) {
    e.life -= dt;
    if (e.type === 'pop') {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.vy += 900 * dt; // gravité légère
      e.r *= 0.92;
    } else if (e.type === 'fall') {
      e.vy += 1600 * dt;
      e.y += e.vy * dt;
    }
    if (e.life > 0) next.push(e);
  }
  state.effects = next;
}

// --- Rendu ------------------------------------------------------------------
function render() {
  const { w, h } = layout;
  ctx.clearRect(0, 0, w, h);
  drawBackground(w, h);
  drawBoard();
  if (state.status === 'playing') {
    drawAimLine();
  }
  drawCanon();
  drawFlying();
  drawEffects();
}

function drawBackground(w, h) {
  // Fond sombre avec halo central et scanlines rétro.
  const g = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, Math.max(w, h) * 0.8);
  g.addColorStop(0, '#0d1220');
  g.addColorStop(1, '#05060a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let y = 0; y < h; y += 4) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBoard() {
  if (!state.grid) return;
  const { radius, offsetX, offsetY } = layout;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < state.grid[r].length; c++) {
      const color = state.grid[r][c];
      if (color === null) continue;
      const center = hexCenter(r, c, radius, state.parity);
      drawBubble(offsetX + center.x, offsetY + center.y, color, radius);
    }
  }
}

function drawBubble(x, y, colorIndex, radius) {
  const p = PALETTE[colorIndex % PALETTE.length];
  const g = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.35, radius * 0.12, x, y, radius);
  g.addColorStop(0, p.light);
  g.addColorStop(0.55, p.base);
  g.addColorStop(1, p.dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  // Reflet.
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(x - radius * 0.32, y - radius * 0.36, radius * 0.22, 0, Math.PI * 2);
  ctx.fill();
  // Liseré.
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawAimLine() {
  const dir = aimDirection();
  const snap = findSnapCell(
    state.grid,
    layout.canon.bx,
    layout.canon.by,
    dir.dx,
    dir.dy,
    layout.radius,
    COLS,
    ROWS,
    state.parity,
  );
  const target = snap
    ? (() => {
        const c = hexCenter(snap.row, snap.col, layout.radius, state.parity);
        return { x: layout.offsetX + c.x, y: layout.offsetY + c.y };
      })()
    : { x: layout.canon.x, y: layout.offsetY };

  ctx.save();
  ctx.strokeStyle = 'rgba(236, 72, 153, 0.55)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.moveTo(layout.canon.x, layout.canon.y);
  ctx.lineTo(target.x, target.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // Fantôme de la case visée.
  if (snap) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(target.x, target.y, layout.radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCanon() {
  const { x, y } = layout.canon;
  const r = layout.radius;
  // Socle du canon.
  ctx.save();
  ctx.fillStyle = '#0b0e1a';
  ctx.strokeStyle = 'rgba(236, 72, 153, 0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - r * 1.4, y + r * 1.6);
  ctx.lineTo(x + r * 1.4, y + r * 1.6);
  ctx.lineTo(x + r * 0.6, y + r * 0.4);
  ctx.lineTo(x - r * 0.6, y + r * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // Bulle chargée.
  if (state.status !== 'menu') {
    drawBubble(x, y, state.currentColor, r);
    // Aperçu de la bulle suivante.
    drawBubble(x + r * 2.2, y + r * 1.2, state.nextColor, r * 0.7);
  }
}

function drawFlying() {
  if (!state.flying) return;
  drawBubble(state.flying.x, state.flying.y, state.flying.color, layout.radius);
}

function drawEffects() {
  for (const e of state.effects) {
    const alpha = Math.max(0, e.life / e.maxLife);
    const p = PALETTE[e.color % PALETTE.length];
    ctx.save();
    ctx.globalAlpha = alpha;
    if (e.type === 'pop') {
      ctx.fillStyle = p.base;
      ctx.beginPath();
      ctx.arc(e.x, e.y, Math.max(0.5, e.r), 0, Math.PI * 2);
      ctx.fill();
    } else {
      drawBubble(e.x, e.y, e.color, e.r);
    }
    ctx.restore();
  }
}

// --- Entrées ----------------------------------------------------------------
function setAimFromPoint(px, py) {
  const { x, y } = layout.canon;
  let angle = Math.atan2(px - x, -(py - y));
  angle = Math.max(-MAX_AIM_ANGLE, Math.min(MAX_AIM_ANGLE, angle));
  state.aimAngle = angle;
}

function onPointerDown(e) {
  e.preventDefault();
  if (state.status !== 'playing') return;
  canvas.setPointerCapture(e.pointerId);
  setAimFromPoint(e.clientX, e.clientY);
}

function onPointerMove(e) {
  if (state.status !== 'playing' || state.flying) return;
  // Visée au survol (souris) ou au glissement (tactile).
  setAimFromPoint(e.clientX, e.clientY);
}

function onPointerUp(e) {
  e.preventDefault();
  if (state.status !== 'playing') return;
  setAimFromPoint(e.clientX, e.clientY);
  shoot();
}

function onPointerCancel() {
  // Le navigateur reprend le geste : on ne tire pas.
}

function onKeyDown(e) {
  if (state.status !== 'playing') {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      newGame();
    }
    return;
  }
  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      state.aimAngle = Math.max(-MAX_AIM_ANGLE, state.aimAngle - 0.05);
      break;
    case 'ArrowRight':
      e.preventDefault();
      state.aimAngle = Math.min(MAX_AIM_ANGLE, state.aimAngle + 0.05);
      break;
    case ' ':
    case 'Enter':
      e.preventDefault();
      shoot();
      break;
    default:
      break;
  }
}

// --- Boucle d'animation -----------------------------------------------------
function frame(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000 || 0);
  lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

// --- Initialisation ---------------------------------------------------------
function init() {
  resize();
  window.addEventListener('resize', resize);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('keydown', onKeyDown);

  startButton.addEventListener('click', newGame);
  restartButton.addEventListener('click', newGame);

  highscoreEl.textContent = String(loadHighscore());

  requestAnimationFrame((t) => {
    lastTime = t;
    requestAnimationFrame(frame);
  });
}

init();
