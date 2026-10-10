// Walking through a floor in the first person, the mouse never taken: drag to look (the
// left or right button, or one finger), W A S D or the arrows to move (Shift: faster), a
// double-click or a double tap on the floor to glide there, the wheel a step on or back;
// walls, windows and shut doors to bump into. A plain click (a press that moves less than
// a few pixels) is not a look: the walker says it was one (``click``, at the pointer) and
// the world says what is there; as it says a double-click (``double``), and a right-click
// or a long press (``menu``).
//
// Looking feels as Street View's: the view is held where it was pressed and follows the
// drag (eased a little), and a drag let go of while it moves turns on a moment, slowing.
// Nothing here goes by the clock but the drag's own speed: each frame moves the walker, a
// glide or a turn a tenth of a second at most, so that on a slow machine they are seen.

import * as THREE from "three";

const CELL = 2; // m, collision grid
const KEYS = { KeyW: "f", ArrowUp: "f", KeyS: "b", ArrowDown: "b", KeyA: "l", ArrowLeft: "l", KeyD: "r", ArrowRight: "r" };

/** How looking and moving feel. ``drag``, ``touch``: a press moved this many pixels (a
 * finger's, more) is a drag, not a click; ``double``: two clicks within this many seconds,
 * and ``near`` pixels (a finger's, ``nearTouch``), are a double-click; ``pitch``: looking
 * up or down at most (radians); ``ease``: how quickly the view follows the drag (1/s);
 * ``friction``: how quickly a turn flung on slows (1/s); ``fling``: the drag's last
 * seconds a fling is measured over; ``hold``: a finger held still this long is a long
 * press; ``step``: metres the wheel moves, a hundred pixels of it; ``glide``: metres a
 * second of a glide, and its least and most seconds. */
export const LOOK = { drag: 4, touch: 10, double: 0.4, near: 8, nearTouch: 30, pitch: 1.45, ease: 22, friction: 6, fling: 0.08,
  hold: 0.55, step: 0.8, glide: { speed: 3.2, least: 0.35, most: 1.8 } };

/** Wall edges of one floor, bucketed for quick collision checks; and its doors' gates,
 * each in the way while its door is shut. */
export class Obstacles {
  /** ``segments``: [[x1, z1, x2, z2], …]; ``gates``: [{ segment, door }, …], each in the
   * way while ``door.blocks``. */
  constructor(segments, gates = []) {
    this.segments = segments;
    this.gates = gates;
    this.grid = new Map();
    // (a gate's index is past the segments')
    [...segments, ...gates.map((g) => g.segment)].forEach((s, i) => {
      const [x1, z1, x2, z2] = s;
      for (let gx = Math.floor(Math.min(x1, x2) / CELL); gx <= Math.floor(Math.max(x1, x2) / CELL); gx++) {
        for (let gz = Math.floor(Math.min(z1, z2) / CELL); gz <= Math.floor(Math.max(z1, z2) / CELL); gz++) {
          const key = `${gx},${gz}`;
          if (!this.grid.has(key)) this.grid.set(key, []);
          this.grid.get(key).push(i);
        }
      }
    });
  }

  near(x, z) {
    const out = new Set();
    const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) for (const k of this.grid.get(`${gx + i},${gz + j}`) || []) out.add(k);
    }
    return out;
  }

  /** Move a circle of ``radius`` from (x, z) by (dx, dz), sliding along walls; shut doors
   * in the way too, unless ``gates`` is false (doors that open as they are walked into). */
  move(x, z, dx, dz, radius, { gates = true } = {}) {
    let nx = x + dx, nz = z + dz;
    for (let pass = 0; pass < 3; pass++) {
      let pushed = false;
      for (const k of this.near(nx, nz)) {
        const gate = k < this.segments.length ? null : this.gates[k - this.segments.length];
        if (gate && (!gates || !gate.door.blocks)) continue;
        const [x1, z1, x2, z2] = gate ? gate.segment : this.segments[k];
        const ex = x2 - x1, ez = z2 - z1;
        const len2 = ex * ex + ez * ez || 1e-9;
        const t = Math.max(0, Math.min(1, ((nx - x1) * ex + (nz - z1) * ez) / len2));
        const px = x1 + t * ex, pz = z1 + t * ez;
        const ox = nx - px, oz = nz - pz;
        const d = Math.hypot(ox, oz);
        if (d < radius && d > 1e-9) {
          nx = px + (ox / d) * radius;
          nz = pz + (oz / d) * radius;
          pushed = true;
        }
      }
      if (!pushed) break;
    }
    return [nx, nz];
  }
}

/** A key the page's: typed into a field, or in a dialog or a menu open over it. */
const pagesKey = (e) => e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey
  || Boolean(e.target?.closest?.("input, textarea, select, [contenteditable], dialog[open], [aria-modal=true], [role=menu], [role=listbox]"));
const reducedMotion = () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
const eased = (s) => s * s * (3 - 2 * s);

export class Walker extends EventTarget {
  /** ``camera``: the view, turned and moved; ``element``: what is dragged (the world's
   * canvas); ``claim(e)``: asked as a press starts, whether the page takes it (an item
   * carried): then it is not a look, nor a click. */
  constructor(camera, element, { eye = 1.6, radius = 0.22, speed = 1.7, run = 3.6, claim = null } = {}) {
    super();
    this.camera = camera;
    this.element = element;
    this.eye = eye;
    this.radius = radius;
    this.speed = speed;
    this.run = run;
    this.claim = claim;
    this.sensitivity = 1;
    this.obstacles = new Obstacles([]);
    this.floorY = 0;
    this.keys = new Set();
    this.fast = false;
    this.enabled = false;
    this.gates = true; // shut doors in a glide's way (false: they open as walked into)
    this.intent = null; // the way the walker moves this frame, { x, z } (a unit), or null
    this.want = null; // where the view is turning to: { yaw, pitch }, or null (as the camera is)
    this.spin = null; // a turn flung on: { yaw, pitch } radians a second
    this.press = null; // a press under way: a click, or a drag that looks
    this.pressed = new Set(); // the pointers down (two fingers: neither looks nor clicks)
    this.last = null; // the last click: { t, x, y, type }, for a double-click
    this.glide = null; // gliding to a point: { from, to, s, seconds, stuck }
    this.stepping = 0; // metres the wheel asked for, to go (back: below 0)
    this.#listen();
  }

  /** Whether a drag is looking now. */
  get looking() {
    return Boolean(this.press?.moved);
  }

  /** Whether the walker is gliding to a point. */
  get gliding() {
    return Boolean(this.glide);
  }

  /** Stand at (x, z) on a floor whose walking surface is at ``y``. */
  place(x, z, y, obstacles, heading) {
    this.floorY = y;
    this.obstacles = obstacles;
    this.camera.position.set(x, y + this.eye, z);
    if (heading !== undefined) this.camera.rotation.set(0, heading, 0, "YXZ");
    this.want = null;
    this.spin = null;
    this.#endGlide("stopped");
    this.stepping = 0;
  }

  /** Let go of everything under way: the keys held, a drag, a turn flung on, a glide. */
  release() {
    this.keys.clear();
    this.fast = false;
    if (this.press) this.#endPress(null);
    this.pressed.clear();
    this.spin = null;
    this.want = null;
    this.#endGlide("stopped");
    this.stepping = 0;
  }

  /** The view turned by a drag of (dx, dy) pixels: the scene held under the pointer
   * (dragged right, the view turns left; down, it looks up), times ``sensitivity``. */
  turn(dx, dy) {
    const k = this.#perPixel();
    this.want ??= this.#angles();
    this.want.yaw += dx * k;
    this.want.pitch = Math.max(-LOOK.pitch, Math.min(LOOK.pitch, this.want.pitch + dy * k));
  }

  /** Glide to (x, z) on the floor, along a straight line, as far as nothing is in the way
   * (shut doors in it too, unless they open as they are walked into: ``gates`` false). The
   * point it glides to ({ x, z }), or null when something is in the way at once. At once
   * when reduced motion is asked for. */
  glideTo(x, z) {
    const p = this.camera.position, dx = x - p.x, dz = z - p.z, far = Math.hypot(dx, dz);
    if (far < 0.05) return null;
    const ux = dx / far, uz = dz / far;
    // as far along the line as the walker goes without being pushed off it
    let gone = 0;
    while (gone < far) {
      const s = Math.min(0.1, far - gone), ax = p.x + ux * gone, az = p.z + uz * gone;
      const [nx, nz] = this.obstacles.move(ax, az, ux * s, uz * s, this.radius, { gates: this.gates });
      if (Math.hypot(nx - (ax + ux * s), nz - (az + uz * s)) > 0.01) break;
      gone += s;
    }
    if (gone < 0.25) return null;
    const to = [p.x + ux * gone, p.z + uz * gone];
    this.stepping = 0;
    if (reducedMotion()) {
      p.set(to[0], this.floorY + this.eye, to[1]);
      this.dispatchEvent(new CustomEvent("glide", { detail: { state: "there", x: to[0], z: to[1] } }));
      return { x: to[0], z: to[1] };
    }
    this.#endGlide("stopped");
    this.glide = { from: [p.x, p.z], to, s: 0, seconds: Math.max(LOOK.glide.least, Math.min(LOOK.glide.most, gone / LOOK.glide.speed)), stuck: 0 };
    this.dispatchEvent(new CustomEvent("glide", { detail: { state: "going", x: to[0], z: to[1] } }));
    return { x: to[0], z: to[1] };
  }

  /** A step on (metres; back, below 0), as the wheel asks: walked over the next frames. */
  step(metres) {
    this.stepping = Math.max(-2, Math.min(2, this.stepping + metres));
  }

  update(dt) {
    this.intent = null;
    if (!this.enabled) return;
    const t = Math.min(dt, 0.1);
    this.#look(t);
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const move = new THREE.Vector3();
    if (this.keys.has("f")) move.add(forward);
    if (this.keys.has("b")) move.sub(forward);
    if (this.keys.has("r")) move.add(right);
    if (this.keys.has("l")) move.sub(right);
    const p = this.camera.position;
    if (move.lengthSq() > 0) { // the keys: a glide or a step given up
      this.#endGlide("stopped");
      this.stepping = 0;
      move.normalize();
      this.intent = { x: move.x, z: move.z };
      move.multiplyScalar((this.fast ? this.run : this.speed) * t);
      const [x, z] = this.obstacles.move(p.x, p.z, move.x, move.z, this.radius);
      p.set(x, this.floorY + this.eye, z);
    } else if (this.glide) this.#glide(t);
    else if (this.stepping) {
      const want = Math.sign(this.stepping) * Math.min(Math.abs(this.stepping), this.run * t);
      const [x, z] = this.obstacles.move(p.x, p.z, forward.x * want, forward.z * want, this.radius);
      const moved = Math.hypot(x - p.x, z - p.z);
      this.intent = { x: forward.x * Math.sign(want), z: forward.z * Math.sign(want) };
      p.set(x, this.floorY + this.eye, z);
      this.stepping = moved < Math.abs(want) * 0.3 ? 0 : this.stepping - want;
      if (Math.abs(this.stepping) < 1e-3) this.stepping = 0;
    }
  }

  dispose() {
    window.removeEventListener("keydown", this.#down);
    window.removeEventListener("keyup", this.#up);
    window.removeEventListener("blur", this.#blur);
    for (const [type, fn, options] of this.#on) this.element.removeEventListener(type, fn, options);
  }

  // ---- looking ------------------------------------------------------------------------------

  /** The radians a pixel of drag turns the view: so that what was pressed stays under
   * the pointer (about), times ``sensitivity``. */
  #perPixel() {
    const h = this.element.clientHeight || 600;
    return ((this.camera.fov * Math.PI) / 180 / h) * this.sensitivity;
  }

  /** The view's yaw and pitch now. */
  #angles() {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
    return { yaw: e.y, pitch: e.x };
  }

  /** The view eased to where it is turning; a turn flung on, slowing. */
  #look(t) {
    if (this.spin) {
      this.want ??= this.#angles();
      this.want.yaw += this.spin.yaw * t;
      this.want.pitch = Math.max(-LOOK.pitch, Math.min(LOOK.pitch, this.want.pitch + this.spin.pitch * t));
      const k = Math.exp(-LOOK.friction * t);
      this.spin.yaw *= k;
      this.spin.pitch *= k;
      if (Math.hypot(this.spin.yaw, this.spin.pitch) < 0.03) this.spin = null;
    }
    if (!this.want) return;
    const now = this.#angles(), want = this.want;
    // (the yaw now, the turn round the circle nearest the one wanted)
    const yaw = now.yaw + Math.round((want.yaw - now.yaw) / (2 * Math.PI)) * 2 * Math.PI;
    const f = 1 - Math.exp(-LOOK.ease * t);
    let y = yaw + (want.yaw - yaw) * f, x = now.pitch + (want.pitch - now.pitch) * f;
    const done = Math.abs(want.yaw - y) < 1e-4 && Math.abs(want.pitch - x) < 1e-4;
    if (done) [y, x] = [want.yaw, want.pitch];
    this.camera.rotation.set(x, y, 0, "YXZ");
    if (done && !this.spin && !this.press?.moved) this.want = null;
  }

  // ---- gliding ------------------------------------------------------------------------------

  #glide(t) {
    const g = this.glide, p = this.camera.position;
    g.s = Math.min(1, g.s + t / g.seconds);
    const k = eased(g.s), wx = g.from[0] + (g.to[0] - g.from[0]) * k, wz = g.from[1] + (g.to[1] - g.from[1]) * k;
    const dx = wx - p.x, dz = wz - p.z, want = Math.hypot(dx, dz);
    const [x, z] = this.obstacles.move(p.x, p.z, dx, dz, this.radius);
    const l = Math.hypot(g.to[0] - g.from[0], g.to[1] - g.from[1]) || 1;
    this.intent = { x: (g.to[0] - g.from[0]) / l, z: (g.to[1] - g.from[1]) / l };
    // stopped short (a door shut in the way): given up after a few frames
    g.stuck = want > 1e-3 && Math.hypot(x - p.x, z - p.z) < want * 0.3 ? g.stuck + 1 : 0;
    p.set(x, this.floorY + this.eye, z);
    if (g.s >= 1) this.#endGlide("there");
    else if (g.stuck >= 4) this.#endGlide("stopped");
  }

  #endGlide(state) {
    if (!this.glide) return;
    const p = this.camera.position;
    this.glide = null;
    this.dispatchEvent(new CustomEvent("glide", { detail: { state, x: p.x, z: p.z } }));
  }

  // ---- the pointer: a drag looks; a click, a double-click, a right-click are said --------------

  #on = [];

  #listen() {
    window.addEventListener("keydown", this.#down);
    window.addEventListener("keyup", this.#up);
    window.addEventListener("blur", this.#blur);
    const on = (type, fn, options) => {
      this.element.addEventListener(type, fn, options);
      this.#on.push([type, fn, options]);
    };
    on("pointerdown", (e) => this.#pointerDown(e));
    on("pointermove", (e) => this.#pointerMove(e));
    on("pointerup", (e) => this.#pointerUp(e));
    on("pointercancel", (e) => {
      this.pressed.delete(e.pointerId);
      if (this.press?.id === e.pointerId) this.#endPress(null);
    });
    // walking, the browser's own menu is not shown over the view (a right-drag looks)
    on("contextmenu", (e) => { if (this.enabled) e.preventDefault(); });
    on("wheel", (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      if (e.ctrlKey) return; // a pinch: walking, nothing is zoomed
      const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 600 : e.deltaY;
      this.step(Math.max(-LOOK.step, Math.min(LOOK.step, (-px / 100) * LOOK.step)));
    }, { passive: false });
  }

  #pointerDown(e) {
    if (!this.enabled) return;
    this.pressed.add(e.pointerId);
    if (this.pressed.size > 1) { // a second finger: neither a look nor a click
      if (this.press) this.#endPress(null);
      return;
    }
    const touch = e.pointerType === "touch";
    if (!touch && e.button !== 0 && e.button !== 2) return;
    if (!touch && e.button === 0 && this.claim?.(e)) return; // the page's (an item carried)
    this.spin = null; // pressed: a turn flung on is held
    this.press = { id: e.pointerId, button: touch ? 0 : e.button, type: e.pointerType, x: e.clientX, y: e.clientY, at: [e.clientX, e.clientY],
      moved: false, moves: [[e.timeStamp, e.clientX, e.clientY]], altKey: e.altKey, shiftKey: e.shiftKey, hold: 0 };
    this.element.setPointerCapture?.(e.pointerId);
    if (touch) { // a finger held still: a long press (the page's menu)
      const press = this.press;
      press.hold = setTimeout(() => {
        if (this.press !== press || press.moved) return;
        this.#endPress(null);
        this.#say("menu", press, press.x, press.y);
      }, LOOK.hold * 1000);
    }
  }

  #pointerMove(e) {
    const press = this.press;
    if (!press || press.id !== e.pointerId) return;
    const far = Math.hypot(e.clientX - press.at[0], e.clientY - press.at[1]);
    if (!press.moved) {
      if (far <= (press.type === "touch" ? LOOK.touch : LOOK.drag)) return;
      press.moved = true;
      clearTimeout(press.hold);
      this.dispatchEvent(new CustomEvent("look", { detail: { state: "start" } }));
    }
    this.turn(e.clientX - press.x, e.clientY - press.y);
    press.x = e.clientX;
    press.y = e.clientY;
    press.moves.push([e.timeStamp, e.clientX, e.clientY]);
    while (press.moves.length > 2 && press.moves[0][0] < e.timeStamp - LOOK.fling * 1000) press.moves.shift();
  }

  #pointerUp(e) {
    this.pressed.delete(e.pointerId);
    const press = this.press;
    if (!press || press.id !== e.pointerId) return;
    this.#endPress(e);
  }

  /** A press ended (``e``: let go of; null: given up): a drag flung on as it moved; a press
   * that did not move, a click (two near each other, a double-click). */
  #endPress(e) {
    const press = this.press;
    this.press = null;
    clearTimeout(press.hold);
    this.element.releasePointerCapture?.(press.id);
    if (press.moved) {
      if (e) this.#fling(press, e.timeStamp);
      this.dispatchEvent(new CustomEvent("look", { detail: { state: "end" } }));
      return;
    }
    if (!e) return;
    if (press.button === 2) return this.#say("menu", press, e.clientX, e.clientY);
    const touch = press.type === "touch", t = e.timeStamp / 1000, last = this.last;
    if (last && last.type === press.type && t - last.t <= LOOK.double
      && Math.hypot(e.clientX - last.x, e.clientY - last.y) <= (touch ? LOOK.nearTouch : LOOK.near)) {
      this.last = null;
      return this.#say("double", press, e.clientX, e.clientY);
    }
    this.last = { t, x: e.clientX, y: e.clientY, type: press.type };
    this.#say("click", press, e.clientX, e.clientY);
  }

  /** A drag let go of while it moved: turned on a moment (not when reduced motion is asked for). */
  #fling(press, at) {
    const moves = press.moves.filter(([t]) => t >= at - LOOK.fling * 1000);
    if (moves.length < 2 || reducedMotion()) return;
    const [t0, x0, y0] = moves[0], [t1, x1, y1] = moves.at(-1);
    if (at - t1 > 50 || t1 - t0 < 8) return; // held still before it was let go of
    const k = this.#perPixel(), s = (t1 - t0) / 1000, most = 6;
    const yaw = ((x1 - x0) / s) * k, pitch = ((y1 - y0) / s) * k, speed = Math.hypot(yaw, pitch);
    if (speed < 0.3) return;
    const f = Math.min(1, most / speed);
    this.spin = { yaw: yaw * f, pitch: pitch * f };
  }

  #say(type, press, clientX, clientY) {
    this.dispatchEvent(new CustomEvent(type, { detail: { clientX, clientY, button: press.button, pointerType: press.type,
      altKey: press.altKey, shiftKey: press.shiftKey } }));
  }

  // ---- the keys ----------------------------------------------------------------------------

  #down = (e) => {
    if (!this.enabled || pagesKey(e)) return;
    if (KEYS[e.code]) {
      this.keys.add(KEYS[e.code]);
      e.preventDefault();
    }
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.fast = true;
  };

  #up = (e) => {
    if (KEYS[e.code]) this.keys.delete(KEYS[e.code]);
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.fast = false;
  };

  #blur = () => { // the window left: nothing held any more
    this.keys.clear();
    this.fast = false;
  };
}
