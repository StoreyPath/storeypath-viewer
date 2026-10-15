// The drawing view: a drawing as its own program shows it (spec/DRAWING-VIEW.md), drawn
// in an element of the page. Its lines, fills and points are drawn with WebGL (three.js),
// its texts written by the browser over them, sharp at any zoom, and marks outlined on
// top, each named (the plans found on a sheet, the parts read as floors). Two looks: CAD
// (the drawing's own colours on dark) and Print (black on white). Drag to move, scroll or
// pinch to zoom, +, -, 0 and the arrows; or follow another view's camera (a plan's: the
// drawing under it). A page adds its own chrome round it (StoreyPath Studio's dialog, its
// layers panel and legend), through the methods and events below.

import * as THREE from "three";

import { UNIT_METRES, fetchDrawingView, readDrawingView } from "./view.js";

export { DRAWING_VIEW_FORMAT, UNIT_METRES, fetchDrawingView, linesOn, parseDrawingView, readDrawingView, textsOf } from "./view.js";

export const LOOKS = ["cad", "print"];
const PRINT_BG = "#ffffff", PRINT_INK = "#000000";
const FONT = "Arial, Helvetica, sans-serif"; // the texts' letters (their width is fitted to the drawing's)
const MIN_TEXT_PX = 4; // a text smaller on the screen is not written
const MAX_TEXTS = 3000; // written at once at most: the largest
const ZOOM_STEP = 1.6; // a button or a key zooms by this much
const MAX_ZOOM = 5000; // as far in as this many times the main body fitted
const FIT_PAD = 24; // px around what is fitted
const MARK = "#ff8a00", MARK_TEXT = "#ffffff", MARK_FONT = `600 12px system-ui, ${FONT}`;

const VERTEX = `precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float size;
in vec2 position;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 0.0, 1.0);
  gl_PointSize = size;
}`;
const FRAGMENT = `precision highp float;
uniform vec3 color;
uniform float opacity;
out vec4 ink;
void main() { ink = vec4(color, opacity); }`;

/** A colour said "#rrggbb" or "#rrggbbaa" as [r, g, b] (0–1, as written: no colour space
 * of three.js's in between) and its opacity. */
function rgba(hex) {
  const n = (i) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return [new THREE.Vector3(n(1), n(3), n(5)), hex.length >= 9 ? n(7) : 1];
}

function div(cls, attrs = {}) {
  const e = document.createElement("div");
  e.className = cls;
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
  return e;
}

/**
 * A drawing view in ``container`` (an element, or a selector). Options: ``look`` ("cad" or
 * "print"); ``units`` (the drawing's units, for metres, when the view's own are not to be
 * trusted); ``marks`` (setMarks); ``onPick(mark)`` (a mark clicked: it is a button then)
 * and ``pickLabel`` (what that does: "Choose"); ``interactive`` (false: it only follows
 * setCamera, as a plan's backdrop; default true); ``background`` (a CSS colour, or
 * "transparent"; default: the look's); ``texts`` (false: none written); ``label`` (what
 * a screen reader says it is).
 * Events: ``load``, ``camerachange`` ({x, y, k}), ``cursor`` ({x, y, metres} where the
 * pointer is, or null when it leaves), ``markhover`` ({mark}), ``pick`` ({mark}),
 * ``contextlost``.
 */
export class DrawingView extends EventTarget {
  constructor(container, options = {}) {
    super();
    const element = typeof container === "string" ? document.querySelector(container) : container;
    if (!element) throw new Error(`DrawingView: container ${String(container)} not found`);
    this.container = element;
    this.options = { interactive: true, texts: true, pickLabel: "Choose", ...options };
    this.look = LOOKS.includes(options.look) ? options.look : "cad";
    this.marks = [];
    this.view = null; // the view read (readDrawingView), once open
    this.cam = { cx: 0, cy: 0, k: 1 }; // the middle of the element (units from the view's origin), px a unit
    this.pointers = new Map(); // pointer id → where it is (px in the element)
    this.hovered = null;
    this.objects = [];
    this.layerOn = [];
    this.queued = false;
    this.width = this.height = 1;
    this.dpr = 1;
    const interactive = this.options.interactive;
    this.root = div("sp-drawing", interactive ? { tabindex: "0", role: "region",
      "aria-label": options.label ?? "The drawing: drag to move it, scroll or pinch to zoom" } : { "aria-hidden": "true" });
    if (!interactive) this.root.classList.add("sp-drawing-still");
    this.glCanvas = document.createElement("canvas");
    this.glCanvas.className = "sp-drawing-gl";
    this.textCanvas = document.createElement("canvas");
    this.textCanvas.className = "sp-drawing-text";
    this.tip = div("sp-drawing-tip", { role: "tooltip", hidden: true });
    this.root.append(this.glCanvas, this.textCanvas, this.tip);
    element.append(this.root);
    if (options.marks) this.setMarks(options.marks);
  }

  // ---- the view ---------------------------------------------------------------------------

  /**
   * Open a drawing view: its URL (fetched: ``onProgress(got, total)``, ``signal`` to stop),
   * its bytes (a Blob, an ArrayBuffer, a Uint8Array: as a package holds it, gzip), or a view
   * read already. Resolves once it is drawn, fitted on its main body.
   */
  async open(source, { onProgress = null, signal = undefined } = {}) {
    const view = typeof source === "string" || source instanceof URL ? await fetchDrawingView(source, { onProgress, signal })
      : source?.head ? source : await readDrawingView(source);
    if (this.gone) return this;
    await new Promise((r) => requestAnimationFrame(r)); // (the page says it is drawing it, first)
    if (!this.gone) this.show(view);
    return this;
  }

  /** The head of the view open (spec/DRAWING-VIEW.md), or null. */
  get head() {
    return this.view?.head ?? null;
  }

  /** Metres in one of the drawing's units: as ``units`` says, else as the view's, else null. */
  get metresPerUnit() {
    return UNIT_METRES[this.options.units] ?? UNIT_METRES[this.view?.head.units] ?? null;
  }

  show(view) {
    this.clear();
    this.view = view;
    const h = view.head;
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas: this.glCanvas, antialias: true, alpha: this.options.background === "transparent" });
      } catch {
        throw new Error("this browser cannot draw with WebGL");
      }
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.glCanvas.addEventListener("webglcontextlost", () => this.gone || this.emit("contextlost"));
      if (this.options.interactive) this.listen();
      this.watch = new ResizeObserver(() => this.resize());
      this.watch.observe(this.root);
    }
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
    this.camera.position.z = 1;
    const kinds = { lines: view.lines, fills: view.fills, points: view.points };
    const dot = Math.max(2, Math.round(1.5 * this.renderer.getPixelRatio())); // a point's size, in the screen's pixels
    const order = { fills: 0, lines: 1, points: 2 }; // (fills under the lines, as a print has them)
    // where everything is, said once for all: three.js would work it out from points of three
    // numbers, and these have two
    const [x0, y0, x1, y1] = this.relative(h.bounds);
    const sphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, 0), Math.hypot(x1 - x0, y1 - y0) / 2);
    h.batches.forEach((b, i) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(kinds[b.kind].subarray(2 * b.first, 2 * (b.first + b.count)), 2));
      geometry.boundingSphere = sphere;
      const [color, opacity] = rgba(h.colors[b.color]);
      const material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: VERTEX, fragmentShader: FRAGMENT, depthTest: false, depthWrite: false,
        side: THREE.DoubleSide, // (a triangle is filled whichever way round it was made)
        transparent: opacity < 1, uniforms: { color: { value: color }, opacity: { value: opacity }, size: { value: dot } },
      });
      const Kind = b.kind === "lines" ? THREE.LineSegments : b.kind === "fills" ? THREE.Mesh : THREE.Points;
      const object = new Kind(geometry, material);
      object.frustumCulled = false; // (all of it is drawn: the GPU leaves out what is off the element)
      object.matrixAutoUpdate = false;
      object.renderOrder = order[b.kind] * 1e6 + i;
      object.userData = { batch: b, color: [color, opacity] };
      this.scene.add(object);
      this.objects.push(object);
    });
    this.layerOn = h.layers.map((l) => !l.off);
    const css = getComputedStyle(this.root), token = (name, or) => css.getPropertyValue(name).trim() || or;
    this.markInk = { line: token("--sp-drawing-mark", MARK), text: token("--sp-drawing-mark-text", MARK_TEXT),
      font: token("--sp-drawing-mark-font", MARK_FONT) };
    this.prepareTexts();
    this.placeMarks();
    this.resize();
    this.fit();
    this.paint();
    this.emit("load", { head: h });
  }

  /** The look: "cad" (the drawing's own colours, on its own dark ground) or "print" (black
   * on white). */
  setLook(look) {
    if (!LOOKS.includes(look)) throw new Error(`a look is ${LOOKS.join(" or ")}`);
    this.look = look;
    this.paint();
  }

  /** The layers, each its ``name``, ``color`` (#rrggbb, or null), ``count`` (things drawn on
   * it), ``off`` (off or frozen in the drawing) and ``shown``. */
  get layers() {
    return (this.view?.head.layers ?? []).map((l, i) => ({ ...l, shown: Boolean(this.layerOn[i]) }));
  }

  /** Show or hide a layer (its index, or its name). */
  setLayer(layer, shown) {
    const i = typeof layer === "number" ? layer : (this.view?.head.layers ?? []).findIndex((l) => l.name === layer);
    if (i < 0 || i >= this.layerOn.length) return;
    this.layerOn[i] = Boolean(shown);
    this.paint();
  }

  /** Show or hide every layer. */
  setLayers(shown) {
    this.layerOn = this.layerOn.map(() => Boolean(shown));
    this.paint();
  }

  /** Each batch in the look's colours, the layers shown or hidden. */
  paint() {
    if (!this.renderer) return;
    const print = this.look === "print";
    const ground = this.options.background ?? (print ? PRINT_BG : this.view.head.background);
    if (ground === "transparent") this.renderer.setClearColor(0x000000, 0);
    else this.renderer.setClearColor(ground, 1);
    this.root.style.background = ground === "transparent" ? "" : ground;
    const [ink] = rgba(PRINT_INK);
    for (const o of this.objects) {
      const [color] = o.userData.color;
      o.material.uniforms.color.value = print ? ink : color; // (a tint stays one: grey, printed)
      o.visible = this.layerOn[o.userData.batch.layer];
    }
    this.draw();
  }

  /** What each text needs to be written quickly: its size, its middle and how far it reaches. */
  prepareTexts() {
    const t = this.view.texts, n = t.length / 8;
    this.textCount = n;
    this.capLen = new Float32Array(n);
    this.textMid = new Float32Array(2 * n);
    this.textReach = new Float32Array(n);
    this.textWidths = new Float32Array(n).fill(NaN); // each text's width written at 100 px (measured when first written)
    for (let i = 0; i < n; i++) {
      const [x, y, a, b, c, d, cap, width] = t.subarray(8 * i, 8 * i + 8);
      const w = width > 0 ? width : 0.6 * cap * this.view.head.words[i].length;
      const along = Math.hypot(a, b), up = Math.hypot(c, d);
      this.capLen[i] = cap * up;
      this.textMid[2 * i] = x + (a * w + c * cap) / 2;
      this.textMid[2 * i + 1] = y + (b * w + d * cap) / 2;
      this.textReach[i] = (along * w + up * cap) / 2;
    }
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = `100px ${FONT}`;
    this.measure = measure;
    this.capRatio = measure.measureText("H").actualBoundingBoxAscent / 100 || 0.716;
  }

  // ---- marks -----------------------------------------------------------------------------

  /** What to outline on the drawing, each {``label`` (short, on the drawing), ``title`` (when
   * the pointer is on it), ``region``: [x0, y0, x1, y1] in the view's coordinates, or null
   * (not outlined), and anything else the page keeps with it}. */
  setMarks(marks) {
    this.marks = (marks ?? []).map((m) => ({ mark: m, box: null }));
    this.hovered = null;
    this.placeMarks();
    this.draw();
  }

  placeMarks() {
    if (!this.view) return;
    const [ox, oy] = this.view.head.origin;
    for (const m of this.marks) {
      const r = m.mark.region;
      m.box = r ? [r[0] - ox, r[1] - oy, r[2] - ox, r[3] - oy] : null;
    }
  }

  // ---- where the element looks -------------------------------------------------------------

  /** The element's size changed: drawn again at it (a ResizeObserver calls it). */
  resize() {
    const r = this.root.getBoundingClientRect();
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer?.setSize(this.width, this.height, false);
    this.textCanvas.width = Math.round(this.width * this.dpr);
    this.textCanvas.height = Math.round(this.height * this.dpr);
    this.draw();
  }

  /** px a unit that shows ``box`` (from the origin) whole. */
  fitting(box) {
    const w = Math.max(box[2] - box[0], 1e-9), h = Math.max(box[3] - box[1], 1e-9);
    const room = (n) => Math.max(n - 2 * FIT_PAD, n / 2); // (an element smaller than its margins: half of it)
    return Math.min(room(this.width) / w, room(this.height) / h);
  }

  relative(box) {
    const [ox, oy] = this.view.head.origin;
    return [box[0] - ox, box[1] - oy, box[2] - ox, box[3] - oy];
  }

  /** ``box`` ([x0, y0, x1, y1] in the view's coordinates) fitted to the element; without
   * it, the main body: a stray far off is not (zoomed out, it is there). */
  fit(box = null) {
    if (!this.view) return;
    const b = box ? this.relative(box) : this.relative(this.view.head.body);
    const k = Math.max(this.fitting(b), 1e-12);
    Object.assign(this.cam, { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, k });
    this.limit();
    this.moved();
  }

  /** A mark (as given to setMarks) fitted to the element. */
  fitMark(mark) {
    if (mark?.region) this.fit(mark.region);
  }

  /** As far out as everything fits twice over, as far in as MAX_ZOOM. */
  limit() {
    const all = this.fitting(this.relative(this.view.head.bounds)), body = this.fitting(this.relative(this.view.head.body));
    this.cam.k = Math.min(Math.max(this.cam.k, Math.min(all, body) / 2), body * MAX_ZOOM);
  }

  /** The view: {x, y} the point of the drawing at the middle of the element (the view's
   * coordinates), ``k`` px a unit. */
  getCamera() {
    const [ox, oy] = this.view?.head.origin ?? [0, 0];
    return { x: this.cam.cx + ox, y: this.cam.cy + oy, k: this.cam.k };
  }

  /** Look where another view looks (a plan's camera turned into this one's: the drawing
   * under the plan), drawn at once: no frame behind it. */
  setCamera({ x, y, k }) {
    const [ox, oy] = this.view?.head.origin ?? [0, 0];
    Object.assign(this.cam, { cx: x - ox, cy: y - oy, k });
    this.draw(true);
    this.emit("camerachange", this.getCamera());
  }

  /** A point of the element (CSS px from its corner) in the view's coordinates. */
  toDrawing([px, py]) {
    const [ox, oy] = this.view?.head.origin ?? [0, 0];
    const [x, y] = this.at(px, py);
    return [x + ox, y + oy];
  }

  /** A point of the drawing (the view's coordinates) on the element (CSS px). */
  toScreen([x, y]) {
    const [ox, oy] = this.view?.head.origin ?? [0, 0];
    const { cx, cy, k } = this.cam;
    return [this.width / 2 + (x - ox - cx) * k, this.height / 2 - (y - oy - cy) * k];
  }

  at(px, py) {
    const { cx, cy, k } = this.cam;
    return [cx + (px - this.width / 2) / k, cy - (py - this.height / 2) / k];
  }

  /** Zoom by ``f`` about ``at`` (CSS px in the element; default its middle). */
  zoomBy(f, at = [this.width / 2, this.height / 2]) {
    if (!this.view) return;
    const [px, py] = at;
    const [wx, wy] = this.at(px, py);
    this.cam.k *= f;
    this.limit();
    const { k } = this.cam;
    this.cam.cx = wx - (px - this.width / 2) / k;
    this.cam.cy = wy + (py - this.height / 2) / k;
    this.moved();
  }

  /** Move the drawing by (dx, dy) CSS px. */
  panBy(dx, dy) {
    this.cam.cx -= dx / this.cam.k;
    this.cam.cy += dy / this.cam.k;
    this.moved();
  }

  moved() {
    this.draw();
    this.emit("camerachange", this.getCamera());
  }

  /** A bar ``px`` long or a little more, a round length in metres: {px, metres, label}; null
   * when the units are not known. */
  scale(px = 80) {
    const mpu = this.metresPerUnit;
    if (!mpu || !this.view) return null;
    const want = px / this.cam.k * mpu, p = 10 ** Math.floor(Math.log10(want));
    const metres = [1, 2, 5, 10].find((n) => n * p >= want) * p;
    const label = metres >= 1000 ? `${(metres / 1000).toLocaleString("en")} km`
      : metres >= 1 ? `${metres.toLocaleString("en")} m` : `${Math.round(metres * 1000).toLocaleString("en")} mm`;
    return { px: Math.round(metres / mpu * this.cam.k), metres, label };
  }

  /** Drawn in the next frame (``now``: at once). */
  draw(now = false) {
    if (!this.renderer || this.gone) return;
    if (now) {
      this.render();
      return;
    }
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      if (!this.gone) this.render();
    });
  }

  render() {
    const { cx, cy, k } = this.cam, w = this.width / 2 / k, h = this.height / 2 / k;
    Object.assign(this.camera, { left: -w, right: w, top: h, bottom: -h });
    this.camera.position.set(cx, cy, 1);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
    const ctx = this.textCanvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.textCanvas.width, this.textCanvas.height);
    if (this.options.texts !== false) this.drawTexts(ctx);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawMarks(ctx);
  }

  drawTexts(ctx) {
    const { cx, cy, k } = this.cam, dpr = this.dpr;
    const halfW = this.width / 2 / k, halfH = this.height / 2 / k;
    const t = this.view.texts, styles = this.view.styles, words = this.view.head.words, colors = this.view.head.colors;
    const shown = [];
    for (let i = 0; i < this.textCount; i++) {
      if (k * this.capLen[i] < MIN_TEXT_PX || !this.layerOn[styles[2 * i]]) continue;
      const r = this.textReach[i];
      if (Math.abs(this.textMid[2 * i] - cx) > halfW + r || Math.abs(this.textMid[2 * i + 1] - cy) > halfH + r) continue;
      shown.push(i);
    }
    if (shown.length > MAX_TEXTS) {
      shown.sort((p, q) => this.capLen[q] - this.capLen[p]);
      shown.length = MAX_TEXTS;
    }
    const size = (i) => Math.max(1, Math.min(2000, Math.round(k * this.capLen[i] / this.capRatio)));
    shown.sort((p, q) => size(p) - size(q)); // (a font set once for all of a size)
    const print = this.look === "print";
    ctx.textBaseline = "alphabetic";
    let font = 0, ink = "";
    for (const i of shown) {
      const [x, y, a, b, c, d, cap, width] = t.subarray(8 * i, 8 * i + 8);
      const f = size(i);
      if (f !== font) ctx.font = `${(font = f)}px ${FONT}`;
      const colour = print ? PRINT_INK : colors[styles[2 * i + 1]];
      if (colour !== ink) ctx.fillStyle = ink = colour;
      if (Number.isNaN(this.textWidths[i])) this.textWidths[i] = this.measure.measureText(words[i]).width;
      const w100 = this.textWidths[i];
      // the browser's letters as wide as the drawing sets them (its font is not the drawing's)
      const sx = width > 0 && w100 > 0 ? Math.min(4, Math.max(0.25, (width * 100 * this.capRatio) / (w100 * cap))) : 1;
      const g = cap / (this.capRatio * f); // units a px of the letters
      ctx.setTransform(dpr * k * a * g * sx, -dpr * k * b * g * sx, -dpr * k * c * g, dpr * k * d * g,
        dpr * (k * (x - cx) + this.width / 2), dpr * (this.height / 2 - k * (y - cy)));
      ctx.fillText(words[i], 0, 0);
    }
  }

  drawMarks(ctx) {
    if (!this.marks.some((m) => m.box)) return;
    const { cx, cy, k } = this.cam, W = this.width, H = this.height;
    const colour = this.markInk.line;
    ctx.font = this.markInk.font;
    ctx.textBaseline = "middle";
    for (const m of this.marks) {
      if (!m.box) continue;
      const x0 = W / 2 + (m.box[0] - cx) * k, x1 = W / 2 + (m.box[2] - cx) * k;
      const y0 = H / 2 - (m.box[3] - cy) * k, y1 = H / 2 - (m.box[1] - cy) * k;
      if (x1 < 0 || x0 > W || y1 < 0 || y0 > H) continue;
      const on = m === this.hovered;
      if (on) {
        ctx.fillStyle = colour;
        ctx.globalAlpha = 0.12;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = colour;
      ctx.lineWidth = on ? 3 : 2;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      const text = String(m.mark.label ?? "");
      const label = text.length > 40 ? `${text.slice(0, 39)}…` : text;
      const lw = ctx.measureText(label).width + 12;
      const lx = Math.min(Math.max(x0, 4), W - lw - 4), ly = Math.min(Math.max(y0, 4), H - 24);
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.roundRect(lx, ly, lw, 20, 4);
      ctx.fill();
      ctx.fillStyle = this.markInk.text;
      ctx.fillText(label, lx + 6, ly + 10.5);
    }
  }

  // ---- pointer, wheel and keys -------------------------------------------------------------

  listen() {
    const s = this.root;
    const at = (e) => {
      const r = s.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    s.addEventListener("pointerdown", (e) => {
      this.tip.hidden = true;
      s.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, at(e));
      this.downAt = this.pointers.size === 1 ? at(e) : null;
      this.wasMoved = false;
    });
    s.addEventListener("pointermove", (e) => {
      const p = at(e);
      this.cursor(p);
      const before = this.pointers.get(e.pointerId);
      if (!before) return this.hover(p);
      if (this.downAt && Math.hypot(p[0] - this.downAt[0], p[1] - this.downAt[1]) > 4) this.wasMoved = true;
      if (this.pointers.size === 2) { // pinched: zoomed about the middle, moved with it
        const [other] = [...this.pointers].filter(([id]) => id !== e.pointerId).map(([, q]) => q);
        const was = Math.hypot(before[0] - other[0], before[1] - other[1]);
        const now = Math.hypot(p[0] - other[0], p[1] - other[1]);
        this.panBy((p[0] - before[0]) / 2, (p[1] - before[1]) / 2);
        if (was > 0) this.zoomBy(now / was, [(p[0] + other[0]) / 2, (p[1] + other[1]) / 2]);
        this.wasMoved = true;
      } else this.panBy(p[0] - before[0], p[1] - before[1]);
      this.pointers.set(e.pointerId, p);
    });
    const up = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (e.type === "pointerup" && !this.wasMoved && this.downAt && !this.pointers.size) this.click(at(e));
      if (!this.pointers.size) this.downAt = null;
    };
    s.addEventListener("pointerup", up);
    s.addEventListener("pointercancel", up);
    s.addEventListener("pointerleave", () => {
      if (!this.pointers.size) {
        this.hover(null);
        this.emit("cursor", null);
      }
    });
    s.addEventListener("wheel", (e) => {
      e.preventDefault();
      const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1;
      this.zoomBy(Math.exp(-e.deltaY * lines * 0.0015), at(e));
    }, { passive: false });
    s.addEventListener("dblclick", (e) => this.zoomBy(ZOOM_STEP, at(e)));
    s.addEventListener("keydown", (e) => this.key(e));
  }

  /** A key for the drawing: + and - zoom, 0 or F fit, the arrows move it. Whether it was
   * one (and is done with): a page may send it the keys pressed anywhere on it. */
  key(e) {
    if (!this.view || e.defaultPrevented || e.target?.closest?.("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) {
      return false;
    }
    const step = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (e.key === "+" || e.key === "=") this.zoomBy(ZOOM_STEP);
    else if (e.key === "-" || e.key === "_") this.zoomBy(1 / ZOOM_STEP);
    else if (e.key === "0" || e.key === "f" || e.key === "F") this.fit();
    else if (step) this.panBy(step[0] * this.width / 8, step[1] * this.height / 8);
    else return false;
    e.preventDefault();
    return true;
  }

  /** The mark under a point of the element (the smallest, where they overlap). */
  markAt(p) {
    if (!p || !this.view) return null;
    const [wx, wy] = this.at(...p);
    const under = this.marks.filter((m) => m.box && wx >= m.box[0] && wx <= m.box[2] && wy >= m.box[1] && wy <= m.box[3]);
    const area = (m) => (m.box[2] - m.box[0]) * (m.box[3] - m.box[1]);
    return under.sort((a, b) => area(a) - area(b))[0] || null;
  }

  hover(p) {
    const m = this.markAt(p);
    if (m !== this.hovered) {
      this.hovered = m;
      this.draw();
      this.emit("markhover", { mark: m?.mark ?? null });
    }
    const pick = this.options.onPick;
    this.root.classList.toggle("sp-picking", Boolean(m && pick));
    this.tip.hidden = !m;
    if (!m) return;
    const { label = "", title = "" } = m.mark;
    const strong = document.createElement("strong");
    strong.textContent = title && title !== label ? `${label} · ${title}` : label;
    const how = document.createElement("span");
    how.className = "sp-drawing-tip-how";
    how.textContent = `Click: ${this.options.pickLabel.toLowerCase()}`;
    this.tip.replaceChildren(strong, ...(pick ? [how] : []));
    const r = this.tip.getBoundingClientRect();
    this.tip.style.left = `${Math.min(p[0] + 14, this.width - r.width - 8)}px`;
    this.tip.style.top = `${Math.min(p[1] + 16, this.height - r.height - 8)}px`;
  }

  click(p) {
    const m = this.markAt(p);
    if (m && this.options.onPick) this.pick(m.mark);
  }

  /** A mark chosen: ``onPick`` and the ``pick`` event. */
  pick(mark) {
    this.emit("pick", { mark });
    this.options.onPick?.(mark);
  }

  /** Where the pointer is: in the view's coordinates, and in metres when its units are known. */
  cursor(p) {
    if (!this.view) return;
    const [x, y] = this.toDrawing(p), mpu = this.metresPerUnit;
    this.emit("cursor", { x, y, metres: mpu ? [x * mpu, y * mpu] : null });
  }

  emit(type, detail = null) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** What is drawn let go (the GPU's memory too), ready for another view. */
  clear() {
    for (const o of this.objects) {
      o.geometry.dispose();
      o.material.dispose();
    }
    this.objects = [];
    this.view = null;
  }

  /** Gone from the page, and the GPU's memory given back now (a big drawing's lines). */
  destroy() {
    if (this.gone) return;
    this.gone = true;
    this.watch?.disconnect();
    this.clear();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    this.root.remove();
  }
}
