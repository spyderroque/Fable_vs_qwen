// Grid logic: pathfinding, line of sight, directional cover, visibility.
// Pure module — all gameplay math lives here, rendering elsewhere.
//
// Tile types:
//   floor — walkable
//   door  — walkable gap in a building wall (no cover, doesn't block sight)
//   half  — low cover object: blocks movement, gives half cover, does NOT block sight
//   full  — tall cover object: blocks movement & sight, gives full cover (destructible)
//   wall  — building wall: blocks movement & sight, gives full cover (tough)

export const key = (x, y) => y * 1000 + x;
export const unkey = (k) => [k % 1000, Math.floor(k / 1000)];

export function makeMap(w, h) {
  const tiles = new Array(w * h);
  for (let i = 0; i < w * h; i++) tiles[i] = { type: 'floor', hp: 0, prop: null, interior: false };
  return { w, h, tiles };
}

export const idx = (map, x, y) => y * map.w + x;
export const inBounds = (map, x, y) => x >= 0 && y >= 0 && x < map.w && y < map.h;
export const tileAt = (map, x, y) => map.tiles[y * map.w + x];

export function isWalkable(map, x, y) {
  if (!inBounds(map, x, y)) return false;
  const t = tileAt(map, x, y).type;
  return t === 'floor' || t === 'door';
}

export function blocksSight(map, x, y) {
  if (!inBounds(map, x, y)) return true;
  const t = tileAt(map, x, y).type;
  return t === 'full' || t === 'wall';
}

export function coverTypeAt(map, x, y) {
  if (!inBounds(map, x, y)) return 'none';
  const t = tileAt(map, x, y).type;
  if (t === 'full' || t === 'wall') return 'full';
  if (t === 'half') return 'half';
  return 'none';
}

const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

// Dijkstra flood out to maxCost (in tile units; diagonals cost ~1.414).
// Diagonal moves are forbidden if either adjacent orthogonal is blocked (no corner cutting).
// occupied: Set of key(x,y) for tiles blocked by other units.
export function dijkstraRange(map, occupied, sx, sy, maxCost) {
  const out = new Map(); // key -> { cost, px, py }
  out.set(key(sx, sy), { cost: 0, px: -1, py: -1 });
  const open = [{ x: sx, y: sy, cost: 0 }];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].cost < open[bi].cost) bi = i;
    const cur = open.splice(bi, 1)[0];
    const curBest = out.get(key(cur.x, cur.y));
    if (curBest && cur.cost > curBest.cost + 1e-9) continue;

    const tryStep = (dx, dy, stepCost) => {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!isWalkable(map, nx, ny)) return;
      if (occupied && occupied.has(key(nx, ny))) return;
      const nc = cur.cost + stepCost;
      if (nc > maxCost + 1e-9) return;
      const prev = out.get(key(nx, ny));
      if (!prev || nc < prev.cost - 1e-9) {
        out.set(key(nx, ny), { cost: nc, px: cur.x, py: cur.y });
        open.push({ x: nx, y: ny, cost: nc });
      }
    };

    for (const [dx, dy] of ORTH) tryStep(dx, dy, 1);
    for (const [dx, dy] of DIAG) {
      if (isWalkable(map, cur.x + dx, cur.y) && isWalkable(map, cur.x, cur.y + dy)) {
        tryStep(dx, dy, Math.SQRT2);
      }
    }
  }
  return out;
}

// Reconstruct a path (list of {x,y}, excluding start) from a dijkstraRange result.
export function pathFromRange(range, tx, ty) {
  const node = range.get(key(tx, ty));
  if (!node) return null;
  const path = [];
  let x = tx, y = ty;
  while (true) {
    const n = range.get(key(x, y));
    if (!n || n.px < 0) break;
    path.push({ x, y });
    x = n.px; y = n.py;
  }
  path.reverse();
  return path;
}

// Line of sight between tile centers using Amanatides-Woo voxel traversal.
// Intermediate sight-blocking tiles block; the endpoints themselves never block.
export function losClear(map, x0, y0, x1, y1) {
  if (x0 === x1 && y0 === y1) return true;
  // Nudge endpoints toward each other so lines through exact corners don't flicker.
  let ax = x0 + 0.5, ay = y0 + 0.5, bx = x1 + 0.5, by = y1 + 0.5;
  const ddx = bx - ax, ddy = by - ay;
  const len = Math.hypot(ddx, ddy);
  ax += (ddx / len) * 1e-4; ay += (ddy / len) * 1e-4;

  let cx = x0, cy = y0;
  const stepX = ddx > 0 ? 1 : -1, stepY = ddy > 0 ? 1 : -1;
  const tDeltaX = ddx !== 0 ? Math.abs(1 / ddx) : Infinity;
  const tDeltaY = ddy !== 0 ? Math.abs(1 / ddy) : Infinity;
  let tMaxX = ddx !== 0 ? ((ddx > 0 ? (cx + 1 - ax) : (ax - cx)) * tDeltaX) : Infinity;
  let tMaxY = ddy !== 0 ? ((ddy > 0 ? (cy + 1 - ay) : (ay - cy)) * tDeltaY) : Infinity;

  let guard = 0;
  while (guard++ < 256) {
    if (tMaxX < tMaxY) { tMaxX += tDeltaX; cx += stepX; }
    else { tMaxY += tDeltaY; cy += stepY; }
    if (cx === x1 && cy === y1) return true;
    if (Math.min(tMaxX, tMaxY) > 1) return true; // passed the target
    if (blocksSight(map, cx, cy)) return false;
  }
  return false;
}

// Positions a shooter may "step out" to: own tile, plus walkable orthogonal
// neighbors when the shooter hugs cover (XCOM-style peeking).
export function peekPositions(map, occupied, x, y) {
  const out = [{ x, y }];
  let inCover = false;
  for (const [dx, dy] of ORTH) {
    if (coverTypeAt(map, x + dx, y + dy) !== 'none') inCover = true;
  }
  if (!inCover) return out;
  for (const [dx, dy] of ORTH) {
    const nx = x + dx, ny = y + dy;
    if (isWalkable(map, nx, ny) && !(occupied && occupied.has(key(nx, ny)))) {
      out.push({ x: nx, y: ny });
    }
  }
  return out;
}

// Can `a` draw a firing line to `b`? Both shooter and target lean out of
// cover (XCOM-style), so check all peek-position combinations.
export function shotLineExists(map, occupied, ax, ay, bx, by) {
  const from = peekPositions(map, occupied, ax, ay);
  const to = peekPositions(map, occupied, bx, by);
  for (const f of from) {
    for (const t of to) {
      if (losClear(map, f.x, f.y, t.x, t.y)) return true;
    }
  }
  return false;
}

// Directional cover for a target standing at (tx,ty) against an attacker at (ax,ay).
// A cover object on an orthogonal side protects when the attack comes from that hemisphere.
export function coverFrom(map, tx, ty, ax, ay) {
  let vx = ax - tx, vy = ay - ty;
  const len = Math.hypot(vx, vy) || 1;
  vx /= len; vy /= len;
  let best = 'none';
  const rank = { none: 0, half: 1, full: 2 };
  for (const [dx, dy] of ORTH) {
    const ct = coverTypeAt(map, tx + dx, ty + dy);
    if (ct === 'none') continue;
    const dot = vx * dx + vy * dy;
    if (dot > 0.35 && rank[ct] > rank[best]) best = ct;
  }
  return best;
}

// Best cover available on any side — used for AI tile scoring and UI shields.
export function coverSides(map, x, y) {
  const sides = [];
  for (const [dx, dy] of ORTH) {
    const ct = coverTypeAt(map, x + dx, y + dy);
    if (ct !== 'none') sides.push({ dx, dy, type: ct });
  }
  return sides;
}

// Set of tile keys visible from (sx,sy) within `range` tiles (euclidean).
// A viewer hugging cover also sees from its peek positions.
export function visibleSet(map, sx, sy, range) {
  const out = new Set();
  const origins = peekPositions(map, null, sx, sy);
  const r = Math.ceil(range);
  const r2 = range * range;
  for (let y = Math.max(0, sy - r); y <= Math.min(map.h - 1, sy + r); y++) {
    for (let x = Math.max(0, sx - r); x <= Math.min(map.w - 1, sx + r); x++) {
      const dx = x - sx, dy = y - sy;
      if (dx * dx + dy * dy > r2) continue;
      for (const o of origins) {
        if (losClear(map, o.x, o.y, x, y)) { out.add(key(x, y)); break; }
      }
    }
  }
  return out;
}

export const distTiles = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
