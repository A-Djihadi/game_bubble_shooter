// logic.js — Logique pure du Bubble Shooter Retro (sans DOM, sans rendu).
// Fonctions pures et déterministes, testables via `node --test tests/` sans dépendance.
// Modèle : grille hexagonale "odd-r" (lignes impaires décalées d'une demi-case).

// Nombre de couleurs de bulles (indices 0..COLOR_COUNT-1).
export const COLOR_COUNT = 5;

// Décalage horizontal d'une ligne selon son rang et la parité du sommet.
// 0 = alignée à gauche, 1 = décalée d'une demi-case vers la droite.
const rowOffset = (row, parity) => (row + parity) % 2;

// Largeur (nombre de colonnes) d'une ligne : les lignes décalées perdent une colonne.
export function rowWidth(row, cols, parity = 0) {
  return cols - rowOffset(row, parity);
}

// Centre (en pixels) de la case (row, col) pour un rayon de bulle donné.
export function hexCenter(row, col, radius, parity = 0) {
  const x = (col + rowOffset(row, parity) * 0.5) * 2 * radius + radius;
  const y = row * radius * Math.sqrt(3) + radius;
  return { x, y };
}

// Cases voisines (dans les limites) d'une case (row, col).
export function neighbors(row, col, cols, rows, parity = 0) {
  const off = rowOffset(row, parity);
  const candidates = [
    [row, col - 1],
    [row, col + 1],
  ];
  if (off === 0) {
    // Ligne alignée : les voisins haut/bas sont décalés à gauche.
    candidates.push([row - 1, col - 1], [row - 1, col], [row + 1, col - 1], [row + 1, col]);
  } else {
    // Ligne décalée : les voisins haut/bas sont décalés à droite.
    candidates.push([row - 1, col], [row - 1, col + 1], [row + 1, col], [row + 1, col + 1]);
  }
  return candidates.filter(
    ([r, c]) => r >= 0 && r < rows && c >= 0 && c < rowWidth(r, cols, parity),
  );
}

// Générateur pseudo-aléatoire déterministe (mulberry32) : même graine, même séquence.
export function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Grille vide : `rows` lignes, chacune de la largeur adaptée à sa parité.
export function createGrid(rows, cols, parity = 0) {
  return Array.from({ length: rows }, (_, r) => new Array(rowWidth(r, cols, parity)).fill(null));
}

// Remplit les `initialRows` premières lignes avec des bulles de couleurs aléatoires.
export function fillInitialRows(grid, initialRows, colorCount, rng) {
  const next = grid.map((row) => row.slice());
  const n = Math.min(initialRows, next.length);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < next[r].length; c++) {
      next[r][c] = Math.floor(rng() * colorCount);
    }
  }
  return next;
}

// Groupe connexe (inondation) de bulles de la même couleur que (row, col).
export function findGroup(grid, row, col, cols, rows, parity = 0) {
  const color = grid[row][col];
  if (color === null || color === undefined) return [];
  const seen = new Set();
  const stack = [[row, col]];
  const group = [];
  seen.add(`${row}:${col}`);
  while (stack.length) {
    const [r, c] = stack.pop();
    group.push([r, c]);
    for (const [nr, nc] of neighbors(r, c, cols, rows, parity)) {
      const key = `${nr}:${nc}`;
      if (!seen.has(key) && grid[nr][nc] === color) {
        seen.add(key);
        stack.push([nr, nc]);
      }
    }
  }
  return group;
}

// Bulles « suspendues » : toutes les bulles non reliées à la ligne du haut.
export function floatingBubbles(grid, cols, rows, parity = 0) {
  const seen = new Set();
  const stack = [];
  for (let c = 0; c < grid[0].length; c++) {
    if (grid[0][c] !== null) {
      seen.add(`0:${c}`);
      stack.push([0, c]);
    }
  }
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [nr, nc] of neighbors(r, c, cols, rows, parity)) {
      const key = `${nr}:${nc}`;
      if (!seen.has(key) && grid[nr][nc] !== null) {
        seen.add(key);
        stack.push([nr, nc]);
      }
    }
  }
  const floating = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== null && !seen.has(`${r}:${c}`)) {
        floating.push([r, c]);
      }
    }
  }
  return floating;
}

// Applique un tir sur la case (row, col) : éclate un groupe de 3+ et fait tomber
// les bulles suspendues. Retourne la nouvelle grille et les décomptes.
export function applyMatch(grid, row, col, cols, rows, parity = 0) {
  const group = findGroup(grid, row, col, cols, rows, parity);
  if (group.length < 3) {
    return { grid, popped: 0, dropped: 0 };
  }
  const next = grid.map((r) => r.slice());
  for (const [r, c] of group) next[r][c] = null;
  const floating = floatingBubbles(next, cols, rows, parity);
  for (const [r, c] of floating) next[r][c] = null;
  return { grid: next, popped: group.length, dropped: floating.length };
}

// Score d'un tir : points de base (10 par bulle éclatée, 20 par bulle tombée),
// multipliés par (combo + 1).
export function computeScore(popped, dropped, combo = 0) {
  return (popped * 10 + dropped * 20) * (combo + 1);
}

// Ajoute une ligne au sommet et décale la grille d'un rang vers le bas.
// La parité du sommet bascule pour conserver l'alignement hex.
// `overflow` vaut true si la dernière ligne (abandonnée) contenait une bulle.
export function addTopRow(grid, parity, cols, rows, colorCount, rng) {
  const newParity = 1 - parity;
  const topWidth = rowWidth(0, cols, newParity);
  const top = Array.from({ length: topWidth }, () => Math.floor(rng() * colorCount));
  const next = new Array(rows);
  next[0] = top;
  for (let r = 1; r < rows; r++) {
    next[r] = grid[r - 1].slice();
  }
  const overflow = grid[rows - 1].some((cell) => cell !== null);
  return { grid: next, parity: newParity, overflow };
}

// Rang le plus bas contenant une bulle, ou -1 si la grille est vide.
export function lowestOccupiedRow(grid, cols, rows, parity = 0) {
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== null) return r;
    }
  }
  return -1;
}

// Fin de partie : une bulle occupe un rang >= dangerRow.
export function isGameOver(grid, dangerRow, cols, rows, parity = 0) {
  return lowestOccupiedRow(grid, cols, rows, parity) >= dangerRow;
}

// --- Collision et trajectoire du tir ----------------------------------------

// Case vide la plus proche de x sur la ligne du haut (ligne 0).
function snapToTopRow(grid, x, radius, cols, parity) {
  const width = rowWidth(0, cols, parity);
  const off = rowOffset(0, parity);
  let col = Math.round((x - radius) / (2 * radius) - off * 0.5);
  col = Math.max(0, Math.min(col, width - 1));
  if (grid[0][col] === null) return { row: 0, col };
  for (let d = 1; d < width; d++) {
    if (col - d >= 0 && grid[0][col - d] === null) return { row: 0, col: col - d };
    if (col + d < width && grid[0][col + d] === null) return { row: 0, col: col + d };
  }
  return null;
}

// Bulle occupée la plus proche du point (x, y) à moins de 2 * radius.
function nearestHit(grid, x, y, radius, cols, rows, parity) {
  const limit = 2 * radius;
  let best = null;
  let bestDist = limit;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] === null) continue;
      const { x: cx, y: cy } = hexCenter(r, c, radius, parity);
      const d = Math.hypot(cx - x, cy - y);
      if (d <= limit && d < bestDist) {
        bestDist = d;
        best = { row: r, col: c };
      }
    }
  }
  return best;
}

// Case vide la plus proche du point (x, y) — c'est là que la bulle se glisse.
function snapNear(grid, x, y, radius, cols, rows, parity) {
  let best = null;
  let bestDist = Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== null) continue;
      const { x: cx, y: cy } = hexCenter(r, c, radius, parity);
      const d = Math.hypot(cx - x, cy - y);
      if (d < bestDist) {
        bestDist = d;
        best = { row: r, col: c };
      }
    }
  }
  return best;
}

// Calcule la case où se fixe une bulle tirée depuis (startX, startY) dans la
// direction (dirX, dirY). Collision cercle-cercle précise, rebonds latéraux,
// fixation sur la ligne du haut. Retourne { row, col } ou null si impossible.
export function findSnapCell(grid, startX, startY, dirX, dirY, radius, cols, rows, parity = 0) {
  const len = Math.hypot(dirX, dirY);
  if (len === 0) return null;
  let dx = dirX / len;
  let dy = dirY / len;
  // Le canon ne tire que vers le haut.
  if (dy > 0) dy = -dy;
  if (dy === 0) return null;

  let x = startX;
  let y = startY;
  const boardWidth = 2 * cols * radius;
  const left = radius;
  const right = boardWidth - radius;
  const step = radius * 0.5;
  const maxSteps = 4000;

  for (let i = 0; i < maxSteps; i++) {
    x += dx * step;
    y += dy * step;
    if (x < left) {
      x = left;
      dx = -dx;
    } else if (x > right) {
      x = right;
      dx = -dx;
    }
    if (y <= radius) {
      return snapToTopRow(grid, x, radius, cols, parity);
    }
    if (nearestHit(grid, x, y, radius, cols, rows, parity)) {
      return snapNear(grid, x, y, radius, cols, rows, parity);
    }
  }
  return null;
}
