// tests/logic.test.js — Tests Node (node --test) de la logique pure du Bubble Shooter.
// Zéro dépendance : exécutés par `node --test tests/`.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COLOR_COUNT,
  rowWidth,
  hexCenter,
  neighbors,
  createRng,
  createGrid,
  fillInitialRows,
  findGroup,
  floatingBubbles,
  applyMatch,
  computeScore,
  addTopRow,
  lowestOccupiedRow,
  isGameOver,
  findSnapCell,
} from '../public/logic.js';

// Trie une liste de cases [row, col] pour des comparaisons indépendantes de l'ordre.
const sortCells = (cells) => cells.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);

test('rowWidth : les lignes impaires ont une colonne de moins (offset odd-r)', () => {
  assert.equal(COLOR_COUNT, 5);
  assert.equal(rowWidth(0, 12, 0), 12);
  assert.equal(rowWidth(1, 12, 0), 11);
  assert.equal(rowWidth(2, 12, 0), 12);
  // La parité du sommet décale tout : ligne 0 impaire si parity = 1.
  assert.equal(rowWidth(0, 12, 1), 11);
  assert.equal(rowWidth(1, 12, 1), 12);
});

test('hexCenter : deux cases voisines sont espacées exactement de 2 * radius', () => {
  const radius = 10;
  const a = hexCenter(0, 0, radius, 0);
  const b = hexCenter(1, 0, radius, 0); // voisin bas-droite de (0,0)
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  assert.ok(Math.abs(d - 2 * radius) < 1e-9, `distance attendue ${2 * radius}, obtenue ${d}`);
});

test('neighbors : six voisins valides pour une case intérieure (ligne impaire)', () => {
  const cells = sortCells(neighbors(1, 1, 12, 10, 0));
  assert.deepEqual(cells, [
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 2],
    [2, 1],
    [2, 2],
  ]);
});

test('neighbors : les bords et coins du plateau sont respectés', () => {
  // Coin supérieur gauche : seuls (0,1) et (1,0) sont en jeu.
  assert.deepEqual(sortCells(neighbors(0, 0, 12, 10, 0)), [
    [0, 1],
    [1, 0],
  ]);
});

test('createRng : générateur déterministe (même graine, même séquence)', () => {
  const a = createRng(42);
  const b = createRng(42);
  const c = createRng(43);
  for (let i = 0; i < 20; i++) {
    const va = a();
    assert.equal(va, b(), `valeur ${i} : la même graine doit donner la même séquence`);
    assert.notEqual(va, c(), `valeur ${i} : une graine différente doit donner autre chose`);
  }
});

test('createGrid / fillInitialRows : dimensions et remplissage des lignes initiales', () => {
  const grid = createGrid(3, 5, 0);
  assert.equal(grid.length, 3);
  assert.equal(grid[0].length, 5);
  assert.equal(grid[1].length, 4);
  assert.equal(grid[2].length, 5);
  assert.ok(grid.every((row) => row.every((cell) => cell === null)));

  const rng = createRng(1);
  const filled = fillInitialRows(grid, 2, 4, rng);
  // Les deux premières lignes sont remplies, la troisième reste vide.
  assert.ok(filled[0].every((c) => typeof c === 'number' && c >= 0 && c < 4));
  assert.ok(filled[1].every((c) => typeof c === 'number' && c >= 0 && c < 4));
  assert.ok(filled[2].every((c) => c === null));
});

test('findGroup : récupère le groupe connexe de même couleur (forme en L)', () => {
  // (0,0)(0,1)(0,2) + (1,0) reliés en bas-droite = groupe de 4.
  const grid = createGrid(4, 5, 0);
  grid[0][0] = 0;
  grid[0][1] = 0;
  grid[0][2] = 0;
  grid[1][0] = 0;
  const group = sortCells(findGroup(grid, 0, 0, 5, 4, 0));
  assert.deepEqual(group, [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 0],
  ]);
});

test('floatingBubbles : détecte les bulles non reliées à la ligne du haut', () => {
  const grid = createGrid(3, 3, 0);
  grid[0][0] = 1; // reliée au sommet
  grid[1][1] = 1; // isolée (ses voisins du haut sont vides)
  assert.deepEqual(sortCells(floatingBubbles(grid, 3, 3, 0)), [[1, 1]]);
});

test('applyMatch : éclate le groupe de 3+ et fait tomber les bulles suspendues', () => {
  const grid = createGrid(4, 5, 0);
  grid[0][0] = 0;
  grid[0][1] = 0;
  grid[0][2] = 0;
  grid[1][0] = 0; // reliée au sommet, fait partie du groupe
  grid[3][0] = 1; // suspendue, doit tomber
  const result = applyMatch(grid, 0, 0, 5, 4, 0);
  assert.equal(result.popped, 4);
  assert.equal(result.dropped, 1);
  assert.equal(result.grid[0][0], null);
  assert.equal(result.grid[1][0], null);
  assert.equal(result.grid[3][0], null);
});

test('applyMatch : ne fait rien si le groupe compte moins de 3 bulles', () => {
  const grid = createGrid(3, 3, 0);
  grid[0][0] = 0;
  grid[0][2] = 0;
  const result = applyMatch(grid, 0, 0, 3, 3, 0);
  assert.equal(result.popped, 0);
  assert.equal(result.dropped, 0);
  assert.equal(result.grid[0][0], 0);
  assert.equal(result.grid[0][2], 0);
});

test('computeScore : points de base multipliés par (combo + 1)', () => {
  assert.equal(computeScore(4, 1, 2), 180); // (4*10 + 1*20) * 3
  assert.equal(computeScore(3, 0, 0), 30); // 3*10, pas de combo
  assert.equal(computeScore(0, 2, 1), 80); // (0 + 2*20) * 2
});

test('addTopRow : ajoute une ligne au sommet, décale la grille et bascule la parité', () => {
  const grid = createGrid(4, 4, 0);
  grid[0] = [1, 1, 1, 1];
  grid[1] = [1, 1, 1];
  grid[2] = [1, 1, 1, 1];
  grid[3] = [null, null, null];
  const rng = createRng(7);
  const result = addTopRow(grid, 0, 4, 4, 2, rng);
  assert.equal(result.parity, 1);
  assert.equal(result.grid[0].length, 3); // nouvelle ligne, offset inversé
  assert.deepEqual(result.grid[1], [1, 1, 1, 1]); // ancienne ligne 0 descendue
  assert.equal(result.grid[2].length, 3); // ancienne ligne 1
  assert.equal(result.grid[3].length, 4); // ancienne ligne 2
  assert.equal(result.overflow, false); // la ligne du bas était vide
});

test('addTopRow : signale le débordement quand une bulle atteint le bas', () => {
  const grid = createGrid(3, 4, 0);
  grid[0] = [1, 1, 1, 1];
  grid[1] = [1, 1, 1];
  grid[2] = [1, null, null, null]; // bulle sur la dernière ligne
  const result = addTopRow(grid, 0, 4, 3, 2, createRng(7));
  assert.equal(result.overflow, true);
});

test("lowestOccupiedRow / isGameOver : détectent l'arrivée d'une bulle en bas", () => {
  const grid = createGrid(3, 3, 0);
  assert.equal(lowestOccupiedRow(grid, 3, 3, 0), -1);
  grid[1][0] = 2;
  assert.equal(lowestOccupiedRow(grid, 3, 3, 0), 1);
  assert.equal(isGameOver(grid, 2, 3, 3, 0), false);
  grid[2][0] = 2;
  assert.equal(isGameOver(grid, 2, 3, 3, 0), true);
});

test('findSnapCell : sur grille vide, un tir vertical se fixe sur la ligne du haut', () => {
  const cols = 4;
  const rows = 5;
  const radius = 10;
  const grid = createGrid(rows, cols, 0);
  // Canon centré sur la colonne 1 (x = 30), tir droit vers le haut.
  assert.deepEqual(findSnapCell(grid, 30, 200, 0, -1, radius, cols, rows, 0), {
    row: 0,
    col: 1,
  });
});

test('findSnapCell : collision cercle précise contre une bulle existante', () => {
  const cols = 4;
  const rows = 5;
  const radius = 10;
  const grid = createGrid(rows, cols, 0);
  grid[0][0] = 0; // bulle au sommet, colonne 0
  // Tir vertical depuis la colonne 0 : la bulle touche (0,0) et se glisse en (1,0).
  assert.deepEqual(findSnapCell(grid, 10, 100, 0, -1, radius, cols, rows, 0), {
    row: 1,
    col: 0,
  });
});

test('findSnapCell : rebondit sur les murs latéraux et retombe en haut', () => {
  const cols = 4;
  const rows = 5;
  const radius = 10;
  const grid = createGrid(rows, cols, 0);
  // Tir en diagonale vers la gauche : la bulle rebondit puis se fixe sur la ligne 0.
  const snap = findSnapCell(grid, 40, 200, -1, -1, radius, cols, rows, 0);
  assert.ok(snap !== null, 'le tir doit aboutir à une case valide');
  assert.equal(snap.row, 0);
  assert.ok(snap.col >= 0 && snap.col < cols, `colonne attendue dans [0, ${cols}[, obtenue ${snap.col}`);
});

test('findSnapCell : direction nulle ou horizontale => null', () => {
  const grid = createGrid(5, 4, 0);
  assert.equal(findSnapCell(grid, 40, 200, 0, 0, 10, 4, 5, 0), null);
  assert.equal(findSnapCell(grid, 40, 200, 1, 0, 10, 4, 5, 0), null);
});
