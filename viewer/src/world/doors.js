// A floor's doors in the 3D world, shut and opened: by the walker (a click or E at one
// within reach, or walking into one shut), or by the page (setDoorOpen). A door starts
// open, as the plan draws it; shut, it is a gate across its span that the walker bumps
// into.
//
// Each leaf is a run of its floor's merged door and handle geometry, and of the door's
// lines along edges (the "model" look), as build.js lists them (``doors``): a leaf swings
// about its hinge by its few vertices written again in place, nothing built again and
// nothing drawn apart. A floor of a thousand doors still draws its leaves in one call, and
// costs nothing a frame while no door moves.

import * as THREE from "three";

/** How doors are used: from this near (m, along the floor, from the walker to where the
 * crosshair meets the door or its doorway); swinging this long (s, eased; a door turned
 * back half way, half as long); and, walked into from this near (m, the walker to its span)
 * while shut, opened by itself (doors: "auto"). */
export const DOOR = { reach: 2, seconds: 0.5, auto: 0.5 };
const CELL = 4; // m: the grid doors are found by, near the walker

/** Eased in and out: 0 to 1, slow at each end. */
const ease = (s) => (s < 0.5 ? 4 * s * s * s : 1 - (-2 * s + 2) ** 3 / 2);
/** An angle in (−π, π]. */
const wrap = (a) => a - 2 * Math.PI * Math.ceil((a - Math.PI) / (2 * Math.PI));

/** One door: its ID (the opening's), its span ([x1, z1, x2, z2], jamb to jamb, the
 * middle of its wall), how high it is, its leaves, and where it is. */
class Door {
  constructor({ id, span, top, leaves }) {
    this.id = id;
    this.span = span;
    this.top = top;
    // each leaf: its hinge [x, z], its angles open (as drawn) and shut (radians counter-
    // clockwise from east, seen from above: the way (cos a, −sin a) in x and z), its length
    // from its hinge to its free edge, its runs ([first, count] of vertices) of the door,
    // the handles and the lines, and the way it swings from shut to open (its sweep)
    this.leaves = leaves.map((l) => ({ hinge: l.hinge, open: l.open, shut: l.shut, length: l.length,
      runs: { door: l.door ?? null, handle: l.handle ?? null, edges: null }, sweep: wrap(l.open - l.shut), from: {} }));
    this.open = true; // as asked
    this.t = 1; // where it is: 1 open as the plan draws it, 0 shut
    this.swing = null; // under way: { from, to, s, seconds }
    this.blocks = false; // shut: in the walker's way
  }

  /** A leaf's angle now. */
  angle(leaf) {
    return leaf.open + (this.t - 1) * leaf.sweep;
  }
}

export class FloorDoors {
  /** ``list``: build.js's ``doors`` (or a pre-built floor's); ``door``, ``handle``: the
   * floor's meshes of those names, whose vertices the leaves' runs are. */
  constructor(list, { door = null, handle = null } = {}) {
    this.doors = list.map((d) => new Door(d));
    this.byId = new Map(this.doors.filter((d) => d.id).map((d) => [d.id, d]));
    /** The doors swinging now. */
    this.moving = new Set();
    /** What the walker bumps into of them (Obstacles): each door's span, while it is shut. */
    this.gates = this.doors.map((d) => ({ segment: d.span, door: d }));
    this.geometries = { door: door?.geometry ?? null, handle: handle?.geometry ?? null, edges: null };
    for (const g of [this.geometries.door, this.geometries.handle]) this.#bound(g);
    this.grid = new Map();
    this.doors.forEach((d) => {
      const reach = Math.max(0, ...d.leaves.map((l) => l.length));
      const [x1, z1, x2, z2] = d.span;
      for (let i = Math.floor((Math.min(x1, x2) - reach) / CELL); i <= Math.floor((Math.max(x1, x2) + reach) / CELL); i++) {
        for (let j = Math.floor((Math.min(z1, z2) - reach) / CELL); j <= Math.floor((Math.max(z1, z2) + reach) / CELL); j++) {
          const key = `${i},${j}`;
          if (!this.grid.has(key)) this.grid.set(key, []);
          this.grid.get(key).push(d);
        }
      }
    });
  }

  /** The doors within ``r`` metres of (x, z), or a little more. */
  near(x, z, r) {
    const out = new Set();
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        for (const d of this.grid.get(`${i},${j}`) ?? []) out.add(d);
      }
    }
    return out;
  }

  /** Shut a door (``open`` false) or open it: swinging, or ``instant``ly. Whether that
   * changed what was asked of it. */
  set(door, open, instant = false) {
    const changed = door.open !== open;
    door.open = open;
    if (open) door.blocks = false; // passable at once: opening, it swings out of the way
    const to = open ? 1 : 0;
    if (instant || door.t === to) {
      door.t = to;
      door.swing = null;
      this.moving.delete(door);
      this.#pose(door);
      door.blocks = !open;
      return changed;
    }
    if (door.swing?.to === to) return changed; // swinging that way already
    door.swing = { from: door.t, to, s: 0, seconds: DOOR.seconds * Math.abs(to - door.t) };
    this.moving.add(door);
    return changed;
  }

  /** The doors swinging moved on by ``dt`` seconds; whether one moved. A door is in the
   * walker's way once it is wholly shut. */
  step(dt) {
    if (!this.moving.size) return false;
    for (const door of this.moving) {
      const sw = door.swing;
      sw.s = Math.min(1, sw.s + dt / sw.seconds);
      door.t = sw.from + (sw.to - sw.from) * ease(sw.s);
      this.#pose(door);
      if (sw.s >= 1) {
        door.swing = null;
        this.moving.delete(door);
        door.blocks = !door.open;
      }
    }
    return true;
  }

  /** The door's lines along edges (the "model" look), made once its floor shows them:
   * ``geometry``, the door's lines; ``list``, build.js's doors of that build (the same
   * doors, in the same order), whose leaves' runs of lines they are. Turned as each door is. */
  lines(geometry, list) {
    const same = list.length === this.doors.length
      && list.every((d, i) => d.id === this.doors[i].id && d.leaves.length === this.doors[i].leaves.length);
    if (!geometry || !same) return;
    this.geometries.edges = geometry;
    this.#bound(geometry);
    this.doors.forEach((d, i) => d.leaves.forEach((l, k) => {
      l.runs.edges = list[i].leaves[k].edges;
      l.from.edges = null;
    }));
    for (const d of this.doors) if (d.t !== 1) this.#pose(d);
  }

  /** The door the crosshair is on: the first of the doors near the eye ``o`` (a Vector3)
   * that the look ``d`` (a unit Vector3) meets — a leaf as it is now, or the doorway between
   * its jambs, between the floor at ``y0`` and the door's head — within ``reach`` metres along
   * the floor, with no wall or window of ``walls`` (Obstacles) before it. { door, t } (t:
   * metres along the look), or null. */
  aim(o, d, y0, reach, walls) {
    const flat = Math.hypot(d.x, d.z);
    if (flat < 1e-6) return null; // looking straight up or down
    let best = null;
    const meet = (x1, z1, x2, z2, top) => {
      const ex = x2 - x1, ez = z2 - z1, den = d.x * ez - d.z * ex;
      if (Math.abs(den) < 1e-12) return null;
      const qx = x1 - o.x, qz = z1 - o.z;
      const t = (qx * ez - qz * ex) / den, s = (qx * d.z - qz * d.x) / den;
      if (t <= 0 || s < 0 || s > 1 || t * flat > reach) return null;
      const y = o.y + d.y * t - y0;
      return y >= 0 && y <= top ? t : null;
    };
    for (const door of this.near(o.x, o.z, reach)) {
      const hits = [meet(...door.span, door.top)];
      for (const leaf of door.leaves) {
        const a = door.angle(leaf), [hx, hz] = leaf.hinge;
        hits.push(meet(hx, hz, hx + Math.cos(a) * leaf.length, hz - Math.sin(a) * leaf.length, door.top));
      }
      for (const t of hits) if (t !== null && (!best || t < best.t)) best = { door, t };
    }
    if (!best || !walls) return best;
    // a wall or a window before it: not within reach
    for (const k of walls.near(o.x, o.z)) {
      const seg = walls.segments[k];
      if (!seg) continue; // (a gate: a door, met above)
      const t = meet(seg[0], seg[1], seg[2], seg[3], Infinity);
      if (t !== null && t < best.t - 0.03) return null;
    }
    return best;
  }

  /** A shut door the walker at (x, z) walks into: within DOOR.auto of its span, going
   * towards it (``intent``: the way it moves, a unit {x, z}) and looking that way (``look``,
   * {x, z}); or null. */
  bumped(x, z, intent, look) {
    for (const door of this.near(x, z, DOOR.auto + 0.5)) {
      if (door.open) continue;
      const [x1, z1, x2, z2] = door.span, ex = x2 - x1, ez = z2 - z1;
      const s = Math.max(0, Math.min(1, ((x - x1) * ex + (z - z1) * ez) / (ex * ex + ez * ez || 1e-9)));
      const vx = x1 + s * ex - x, vz = z1 + s * ez - z, dist = Math.hypot(vx, vz);
      if (dist > DOOR.auto) continue;
      if (dist < 1e-6) return door;
      const toward = (intent.x * vx + intent.z * vz) / dist, facing = (look.x * vx + look.z * vz) / (Math.hypot(look.x, look.z) || 1) / dist;
      if (toward >= 0.5 && facing > 0.2) return door;
    }
    return null;
  }

  /** Each door as it is: its ID, whether it is open (as asked), whether it is swinging, its
   * span ([[x, z], [x, z]]) and its leaves ([hinge, free edge] each, [x, z]), where they are now. */
  plan() {
    return this.doors.map((d) => ({ id: d.id, open: d.open, moving: this.moving.has(d),
      span: [[d.span[0], d.span[1]], [d.span[2], d.span[3]]],
      leaves: d.leaves.map((l) => {
        const a = d.angle(l), [hx, hz] = l.hinge;
        return [[hx, hz], [hx + Math.cos(a) * l.length, hz - Math.sin(a) * l.length]];
      }) }));
  }

  /** A door's leaves where it is now: each run turned about its leaf's hinge from where the
   * plan draws it (kept, the first time it is turned), written in place. */
  #pose(door) {
    for (const leaf of door.leaves) {
      const turn = (door.t - 1) * leaf.sweep, c = Math.cos(turn), s = Math.sin(turn), [hx, hz] = leaf.hinge;
      for (const key of ["door", "handle", "edges"]) {
        const g = this.geometries[key], run = leaf.runs[key];
        if (!g || !run || !run[1]) continue;
        const attr = g.getAttribute("position"), a = attr.array, [first, count] = run;
        const from = (leaf.from[key] ??= a.slice(first * 3, (first + count) * 3));
        for (let i = 0, j = first * 3; i < count * 3; i += 3, j += 3) {
          const px = from[i] - hx, pz = from[i + 2] - hz;
          a[j] = hx + px * c + pz * s;
          a[j + 1] = from[i + 1];
          a[j + 2] = hz - px * s + pz * c;
        }
        attr.addUpdateRange(first * 3, count * 3);
        attr.needsUpdate = true;
      }
    }
  }

  /** A geometry's bounds (what is drawn, or cast shadows, is chosen by them) taking in
   * every way its leaves swing, so that a leaf swung is never left out. */
  #bound(g) {
    if (!g?.getAttribute("position")) return;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const { min, max } = g.boundingBox, sphere = g.boundingSphere, p = new THREE.Vector3();
    for (const door of this.doors) {
      for (const { hinge: [x, z], length } of door.leaves) {
        const r = length + 0.1;
        for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
          for (const y of [min.y, max.y]) sphere.expandByPoint(p.set(x + dx, y, z + dz));
        }
      }
    }
  }
}
