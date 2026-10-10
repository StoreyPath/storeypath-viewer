// StoreyPathWorld: a building from a StoreyPath package as a 3D world you can
// look at from outside (the dollhouse view) or walk through (the walk view).
//
//   const world = new StoreyPathWorld("#world");
//   await world.open("/campus.storeypath");
//   world.setMode("walk");
//
// Walls, door and window openings come from the package (the floor's `walls`, the
// openings' `span`, and a door's `swings`: its leaves, open as the plan draws them),
// each room's floor and walls are in their finishes (format 0.9: a space's or zone's
// `floor_finish` and a space's `wall_finish`, else its type's: ../finishes.js; each side
// of a wall as the room it faces), and everything is drawn here: no textures or models
// are downloaded. A floor's geometry is built by build.js, here,
// or comes pre-built in the package (format 0.5: world/<floor-id>.glb, baked by
// the same build.js in Node), which is quicker to show on a slow machine.
//
// Furniture and equipment (format 0.6: desks, photocopiers, access points, …) are
// drawn only when asked for, or when one floor is shown: a building of thousands of
// desks costs nothing until then. Their geometry is made (or taken from the
// pre-built file) the first time a floor shows them: detailed when one floor is
// shown, a box each when more are.
//
// A page may edit on top of it (Studio's Review does): pointAt says what is under the
// pointer (a wall, and the room on that side of it), ghost shows where an item would go,
// mark shows lightly what a click would act on (a room's floor, its walls, an item),
// setFloorItems draws a floor's items again (nothing else), items are dragged
// (setDraggable, itemdrag…), a click says what it is on first (pick, cancelable), a
// right-click too (menu), updateSpace shows a room corrected (a finish at once, in place:
// its triangles drawn in another material, nothing built again) and reload a floor read
// again; finishOf says what a room's floor and walls are in. The world itself changes
// nothing.
//
// Walking (walk.js), the mouse is never taken: a drag (either button, or a finger) looks
// round, W A S D or the arrows move, a click acts where the pointer is, a double-click (or
// a double tap) on the floor glides there; what is under the pointer is said as it changes
// (hover), and a ring on the floor shows where a double-click would go.
//
// Doors open and shut when walking (doors.js): a click on one within reach swings it, as
// E does (the door under the pointer, else the nearest ahead); a shut one is in the
// walker's way and opens when walked into (unless the page asks for "manual" doors);
// setDoorOpen, useDoor and doorchange let a page do and follow the same. They start as the
// plan draws them, open; how they are is the view's, not the package's. An open leaf is
// never in the way.
//
// A way through the building (format 0.8: route() in ../navigation.js) is drawn with
// showRoute: a ribbon just over each floor it walks on, through the lift or stairs
// between them, its start and end marked; flyRoute takes the camera along it.
//
// It is drawn in a look (style.js: "real", real but clean, by default; "model", an
// architectural model) and a quality ("high", with ambient occlusion and multisampling;
// "low", for weak graphics; "auto", the default, chooses Low on a software, virtual or
// integrated renderer, or when High draws slowly at first). Switching either swaps
// materials, lights and passes: nothing is built again.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import { loadPackage } from "../package.js";
import { TYPE_COLORS } from "../theme.js";
import { EXTERIOR, defaultFinish, floorFinish, wallFinish } from "../finishes.js";
import {
  BUILDER, GEOMETRY, buildItems, buildPieces, ceilingPanels, cutPieces, flat, groupByFinish, inside, itemBox, itemExtent,
  itemPoint, occluders, originOf, planFloor, planItem, setItems, toLocal as localOf,
} from "./build.js";
import { DOOR, FloorDoors } from "./doors.js";
import { Painter } from "./finishes.js";
import { toLonLat } from "./frame.js";
import { qualityFor, rendererName } from "./gpu.js";
import { Materials } from "./materials.js";
import { QUALITY, SLOW_FRAME, STYLES } from "./style.js";
import { LOOK, Obstacles, Walker } from "./walk.js";
import {
  ROUTE_SIZE, along, arrowMesh, columnMaterial, discGeometry, easeInOut, easeOutBack, lengthsOf, lineMaterial, markMaterial, pinMesh,
  ribbon, ringGeometry, smoothed, tag, tourOf, walkedAt,
} from "./route.js";

const DEFAULTS = {
  ...GEOMETRY, // slab, door and window heights, wall thickness, cutaway height
  explode: 0, // m between floors in the dollhouse view
  labels: true,
  showHidden: false,
  items: null, // furniture and equipment: true, false, or null: shown when one floor is
  style: "real", // the look: "real" or "model" (style.js)
  quality: "auto", // "auto", "high" or "low"
  fog: null, // its colour (default: the look's)
  doors: "auto", // walking: a shut door opens when walked into ("auto"), or stays shut until opened ("manual")
  doorKey: "KeyE", // walking: the key (a KeyboardEvent code) that opens or shuts a door (useDoor); null: the page's
};
const DOOR_MODES = new Set(["auto", "manual"]);
// the hint by the pointer when it is on a door within reach
const HINT_STYLE = {
  position: "absolute", left: "0", top: "0", pointerEvents: "none", zIndex: "1",
  padding: "3px 9px", borderRadius: "7px", background: "rgba(16, 18, 23, 0.72)", color: "#fff", whiteSpace: "nowrap",
  font: '600 12px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif', display: "none",
};
const LABEL_STYLE = {
  display: "flex", flexDirection: "column", alignItems: "center", padding: "2px 7px", borderRadius: "7px",
  background: "rgba(255, 255, 255, 0.86)", color: "#16181d", whiteSpace: "nowrap",
  font: '600 11px/1.25 system-ui, -apple-system, "Segoe UI", sans-serif', boxShadow: "0 1px 4px rgba(0, 0, 0, 0.18)",
};
const VERTICAL = new Set(["stairs", "elevator", "escalator", "ramp"]);
// what pick, menu and hover say where nothing is
const NOWHERE = Object.freeze({ floor: null, x: null, z: null, local: null, space: null, room: null, item: null, wall: false });
const LABEL_ROOM = 56; // px: a room this wide on the screen (its longer side) has its label shown
// what casts and takes shadows, by material (walking, the ceiling keeps the sun out but
// at the windows); the order drawn in, after the rest
const CASTS = new Set(["slab", "wall", "wallTop", "wallCut", "wallPlain", "frame", "doorFrame", "door", "item", "skirting",
  "trim", "handle", "sillBoard", "ceiling"]);
const TAKES = new Set([...CASTS, "floor", "glass"].filter((m) => m !== "ceiling"));
const ORDER = { volume: 2, glass: 4 };
const QUALITIES = new Set(["auto", "high", "low"]);
// the sun's shadow follows what is looked at on a floor bigger than this (metres round
// it), walking and orbiting; and its frame moves in steps, so that it is drawn again
// only now and then
const SHADOW = { walk: 24, orbit: 1.1, least: 16, steps: 4 };
// auto: High is watched for this many frames, once the building has been shown this long (ms)
const WATCH = { frames: 90, after: 1500 };
// a way through the building: its ribbon this high over the floor and this wide, seen
// through what is in front of it, and arrows on it this far apart
const ROUTE = { order: 20, faded: 0.3,
  // its colours by default: the plan viewer's (viewer/svg/src/plan.css, --sp-route…)
  colours: { color: "#2463eb", casing: "#9cc0ff", arrow: "#ffffff", start: "#2463eb", end: "#e5484d" } };
const RIDE_WORDS = { lift: "Lift", stairs: "Stairs", escalator: "Escalator", ramp: "Ramp" };
// a floor faded back while a way is shown: its floors and its walls, a light shell
const FLOORISH = new Set(["floor", "slab"]);

export class StoreyPathWorld extends EventTarget {
  #o;
  #element;
  #renderer;
  #labelRenderer;
  #scene;
  #camera;
  #orbit;
  #walker;
  #materials; // the look's and quality's materials, shown now (one of #looks)
  #looks = new Map(); // "style:finish size" → Materials, each made the first time it is shown
  #painter = new Painter(); // paints the finishes, off the page's thread
  #style; // the look: "real" or "model"
  #quality; // asked for: "auto", "high" or "low"
  #drawn; // drawn: "high" or "low"
  #why = null; // why auto chose Low
  #watch = null; // auto: High's frames timed, at first
  #post = null; // High's passes (post.js), once loaded
  #posting = null;
  #hemi;
  #sun;
  #sunDir = new THREE.Vector3(-0.6, 1.4, 0.45).normalize(); // towards the sun
  #shadowAt = ""; // where the sun's shadow is fitted now
  #shadowsDirty = true; // the shadows drawn again next frame
  #panelLights = []; // walking: the nearest ceiling panels' lights
  #ground = null;
  #destroyed = false;
  #pkg = null;
  #origin = null;
  #building = null;
  #buildingGroup = null;
  #floors = new Map(); // floor id → built floor
  #baked = new Map(); // floor id → its pre-built 3D as read, or null to build it here
  #asked = 0; // the last building asked for
  #floor = null; // the floor shown on its own, or null for all
  #mode = "dollhouse";
  #xray = false;
  #cutaway = false;
  #selected = null;
  #lit = null; // the selected space's highlight
  #room = null; // the space the walker is in
  #timer = new THREE.Timer();
  #flight = null;
  #paused = false;
  #draggable = false; // items carried across their floor by a drag (setDraggable)
  #ghost = null; // an item's ghost (ghost)
  #ghostLook = null; // its materials
  #orbitView = null; // the dollhouse view before walking: { position, target }
  #caster = new THREE.Raycaster();
  #labelView = null; // the camera the labels were last placed for
  #labelsMoved = true; // what is shown changed: the labels placed again
  #route = null; // the way shown: { route, legs, links, marks, materials }
  #tour = null; // the camera going along it
  #stepNow = null; // the step of the way shown, or the tour is at
  #fadedLook = { // floors faded back while a way is shown
    floor: new THREE.MeshBasicMaterial({ color: 0xd7dce4, transparent: true, opacity: 0.22, depthWrite: false }),
    wall: new THREE.MeshBasicMaterial({ color: 0xc4cad4, transparent: true, opacity: 0.13, depthWrite: false }),
  };
  #toDress = new Map(); // floor → the kinds ("floor", "wall") whose finishes changed, dressed before the next frame
  #shut = new Set(); // the doors asked to be shut, by ID: kept when their floor is built again (a view's, not the package's)
  #swinging = new Set(); // the floors' doors (FloorDoors) with a door swinging
  #aimed = null; // walking: the door E works, { floor, door, under } (under the pointer, else the nearest ahead)
  #aimFrom = null; // the view and the pointer it was aimed from: null, aimed again (a door moved)
  #aimSaid = ""; // what was said of the door aimed at: its ID, whether open, whether under the pointer
  #hint; // the hint by the pointer, on a door within reach
  #pointer = null; // walking: the mouse over the view (client pixels), or null
  #hovered = null; // walking: what is under the pointer ({ ...pointAt, door }), as hover said it
  #hoverSaid = "";
  #ring = null; // walking: the ring on the floor under the pointer (where a double-click goes)
  #mark = null; // what a click would act on, marked lightly (mark)
  #carry = null; // an item carried by a drag: { id, floor, at, moved }
  #look = new THREE.Vector3(); // (the way the camera looks: kept, not made each frame)

  constructor(container, options = {}) {
    super();
    this.#o = { ...DEFAULTS, ...options };
    this.#style = STYLES[this.#o.style] ? this.#o.style : "real";
    this.#quality = QUALITIES.has(this.#o.quality) ? this.#o.quality : "auto";
    const element = typeof container === "string" ? document.querySelector(container) : container;
    if (!element) throw new Error(`StoreyPathWorld: container ${container} not found`);
    this.#element = element;
    element.classList.add("storeypath-world");
    if (getComputedStyle(element).position === "static") element.style.position = "relative";

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false; // drawn again only when what casts them, or their frame, changed
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.appendChild(renderer.domElement);
    this.#renderer = renderer;
    // auto: Low on a software, virtual or integrated renderer; else High, watched at first
    const gpu = qualityFor(rendererName(renderer.getContext()));
    this.#drawn = this.#quality === "auto" ? gpu.quality : this.#quality;
    this.#why = this.#quality === "auto" ? gpu.why : null;

    this.#labelRenderer = new CSS2DRenderer();
    Object.assign(this.#labelRenderer.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    element.appendChild(this.#labelRenderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.#hemi = new THREE.HemisphereLight();
    scene.add(this.#hemi);
    const sun = new THREE.DirectionalLight();
    sun.castShadow = true;
    scene.add(sun, sun.target);
    this.#sun = sun;
    this.#scene = scene;
    const look = (color) => ({
      solid: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false }),
      line: new THREE.LineBasicMaterial({ color, transparent: true, depthTest: false }),
    });
    this.#ghostLook = { ok: look(0x0ca678), refused: look(0xe03131),
      guide: new THREE.LineBasicMaterial({ color: 0xff8a00, transparent: true, depthTest: false }) };

    // near and far as close as they can be: the occlusion is worked out from depth
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3000);
    camera.position.set(30, 30, 30);
    this.#camera = camera;
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.maxPolarAngle = Math.PI * 0.49;
    orbit.screenSpacePanning = true;
    this.#orbit = orbit;

    this.#o.doors = DOOR_MODES.has(this.#o.doors) ? this.#o.doors : "auto";
    this.#hint = document.createElement("div");
    this.#hint.className = "sp3d-door-hint"; // styled here; pages may restyle (or hide) the class
    Object.assign(this.#hint.style, HINT_STYLE);
    this.#hint.setAttribute("aria-hidden", "true");
    element.appendChild(this.#hint);
    window.addEventListener("keydown", this.#onKey, true); // (first: a page's own E sees it was a door's)

    this.#walker = new Walker(camera, renderer.domElement, { claim: (e) => this.#claim(e) });

    this.#pointerPicking();
    this.#applyLook({ quiet: true });
    new ResizeObserver(() => this.#resize()).observe(element);
    this.#resize();
    this.#timer.connect(document);
    renderer.setAnimationLoop(() => this.#frame());
  }

  /** Stop drawing (the world kept as it is: shown again at once by resume), for a page
   * that hides it for a while. */
  pause() {
    if (this.#paused) return;
    this.#paused = true;
    this.#walker.release();
    this.#renderer.setAnimationLoop(null);
  }

  /** Draw again after pause. */
  resume() {
    if (!this.#paused) return;
    this.#paused = false;
    this.#timer.reset();
    this.#resize();
    this.#renderer.setAnimationLoop(() => this.#frame());
  }

  get paused() { return this.#paused; }

  // ---- the look --------------------------------------------------------------------

  /** The look: "real" (real but clean: floors finished by room type, plaster walls, soft
   * shadows) or "model" (an architectural model: white clay, floors tinted by room type,
   * lines along edges). Its materials, lights and passes change; nothing is built again. */
  setStyle(style) {
    if (!STYLES[style] || style === this.#style) return;
    this.#style = style;
    this.#applyLook();
  }

  /** The quality: "high" (ambient occlusion, multisampling, finer shadows and finishes),
   * "low" (none of them: for weak graphics), or "auto": Low on a software, virtual or
   * integrated renderer, or when High draws slowly at first; else High. */
  setQuality(quality) {
    if (!QUALITIES.has(quality) || quality === this.#quality) return;
    this.#quality = quality;
    const gpu = qualityFor(rendererName(this.#renderer.getContext()));
    this.#drawn = quality === "auto" ? gpu.quality : quality;
    this.#why = quality === "auto" ? gpu.why : null;
    this.#applyLook();
  }

  /** How it is drawn: ``style``, ``quality`` (as asked), ``drawn`` ("high" or "low") and
   * ``why`` auto chose Low ("software", "virtual" or "integrated": its renderer; "slow":
   * High drew slowly), else null. */
  get look() {
    return { style: this.#style, quality: this.#quality, drawn: this.#drawn, why: this.#why };
  }

  /** Resolves once the look is drawn as it will stay: its finishes painted, its passes loaded. */
  ready() {
    return Promise.all([this.#materials.ready(), this.#posting]).then(() => undefined);
  }

  /** The look and quality applied: tone mapping, materials (swapped on what is built),
   * the sky, lights, shadow map, passes and the pixels drawn. */
  #applyLook({ quiet = false } = {}) {
    const s = STYLES[this.#style], q = QUALITY[this.#drawn], r = this.#renderer;
    r.toneMapping = s.toneMapping;
    r.toneMappingExposure = s.exposure;
    const key = `${this.#style}:${q.finish}`;
    if (!this.#looks.has(key)) this.#looks.set(key, new Materials(r, { style: this.#style, quality: q, painter: this.#painter }));
    const m = this.#looks.get(key), swapped = m !== this.#materials;
    this.#materials = m;
    this.#scene.background = m.sky(s.sky);
    this.#scene.fog?.color.set(this.#o.fog ?? s.fog);
    this.#hemi.color.set(s.hemisphere[0]);
    this.#hemi.groundColor.set(s.hemisphere[1]);
    this.#sun.color.set(s.sun[0]);
    const shadow = this.#sun.shadow;
    Object.assign(shadow, { bias: s.shadow.bias, normalBias: s.shadow.normalBias, radius: s.shadow.radius });
    if (shadow.mapSize.x !== q.shadowMap) {
      shadow.mapSize.set(q.shadowMap, q.shadowMap);
      shadow.map?.dispose();
      shadow.map = null;
    }
    if (swapped) this.#rematerial();
    this.#lights(q.panels);
    this.#postProcessing(q.post);
    this.#resize();
    this.#applyVisibility(); // (lit as indoors or out, the x-ray, lines along edges, shadows)
    this.#watch = this.#quality === "auto" && this.#drawn === "high" && !this.#why ? { since: null, times: [] } : null;
    if (!quiet) this.#emit("lookchange", this.look);
  }

  /** Every piece built drawn with the look's materials. */
  #rematerial() {
    for (const f of this.#floors.values()) {
      for (const mesh of [...f.pieces, ...Object.values(f.itemMeshes).flat()]) {
        if (!mesh.userData.faded) mesh.material = this.#material(mesh.userData);
      }
    }
    if (this.#ground) this.#ground.material = this.#materials.ground();
    if (this.#lit) this.#lit.material = this.#materials.highlight;
  }

  /** ``n`` lights for the ceiling panels nearest the walker (shown only when walking). */
  #lights(n) {
    while (this.#panelLights.length < n) {
      // shining down from just under the ceiling, wide and soft
      const light = new THREE.SpotLight(0xfff6ea, 0, 9, 1.25, 1, 2);
      light.visible = false;
      this.#scene.add(light, light.target);
      this.#panelLights.push(light);
    }
    while (this.#panelLights.length > n) {
      const light = this.#panelLights.pop();
      this.#scene.remove(light, light.target);
      light.dispose();
    }
  }

  /** High's passes (post.js, loaded the first time), or none. */
  #postProcessing(on) {
    if (!on) {
      this.#post?.dispose();
      this.#post = null;
      this.#posting = null;
      return;
    }
    if (this.#post || this.#posting) return;
    this.#posting = import("./post.js").then(({ makeComposer }) => {
      if (this.#post || this.#destroyed || !QUALITY[this.#drawn].post) return;
      this.#post = makeComposer(this.#renderer, this.#scene, this.#camera, { samples: QUALITY.high.samples });
      this.#resize();
    }).catch((e) => console.warn(`StoreyPathWorld: no post-processing (${e.message}): drawn as Low is`));
  }

  /** Lines along the edges of a floor's pieces (the "model" look), made the first time:
   * of its walls, slab, openings and items in a form. */
  #edgesOf(f, form) {
    const add = (meshes, pieces) => {
      const lines = new Map(pieces.map((p) => [p.name, p.edges]));
      for (const mesh of meshes) {
        const edges = lines.get(mesh.name);
        if (!edges?.length) continue;
        const g = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(edges, 3));
        const line = new THREE.LineSegments(g, this.#materials.edges);
        line.name = `${mesh.name}:edges`;
        line.renderOrder = 1;
        line.raycast = () => {}; // never what a click is on
        mesh.add(line);
      }
    };
    if (!f.edged) {
      f.edged = true;
      const { pieces, doors } = buildPieces(f.plan, { ...this.#o, only: "edges" });
      add(f.pieces, [...pieces, ...cutPieces(pieces, f.elevation, this.#o)]);
      // (the door's: each leaf's lines turned as it is)
      const lines = f.pieces.find((m) => m.name === "door")?.children.find((l) => l.isLineSegments);
      if (lines) f.doors.lines(lines.geometry, doors);
    }
    f.itemsEdged ??= new Set();
    if (form && f.itemMeshes[form] && !f.itemsEdged.has(form)) {
      f.itemsEdged.add(form);
      add(f.itemMeshes[form], buildItems(f.plan, form, { ...this.#o, only: "edges" }));
    }
  }

  // ---- public API ---------------------------------------------------------------

  get package() { return this.#pkg; }
  get building() { return this.#building; }
  get floor() { return this.#floor; }
  get mode() { return this.#mode; }
  get selected() { return this.#selected; }
  get room() { return this.#room; }
  /** Whether the walker is walking (the walk view): its keys move it, a drag looks. */
  get walking() { return this.#mode === "walk"; }
  /** The floors shown from the package's pre-built 3D rather than built here. */
  get prebuilt() { return [...this.#floors.values()].filter((f) => f.prebuilt).map((f) => f.id); }
  /** The three.js camera, renderer and scene, for anything else. */
  get camera() { return this.#camera; }
  get renderer() { return this.#renderer; }
  get scene() { return this.#scene; }

  /** Open a package from a URL, Blob, File or ArrayBuffer. */
  async open(source) {
    const pkg = await loadPackage(source);
    this.#pkg = pkg;
    this.#baked = new Map();
    this.#shut.clear(); // its doors as the plan draws them
    await this.setBuilding(pkg.buildings[0]?.id);
    if (this.#pkg === pkg) this.#emit("load", { package: pkg }); // not when another was opened meanwhile
    return pkg;
  }

  /** Build and show a building. Resolves once it is shown: at once, unless its
   * floors come pre-built and are still to be read. */
  setBuilding(id) {
    const pkg = this.#pkg;
    if (!pkg || !id) return Promise.resolve();
    const asked = ++this.#asked;
    if (!pkg.floorsOf(id).some((f) => !this.#baked.has(f.id) && pkg.hasWorld(f.id))) {
      this.#show(id);
      return Promise.resolve();
    }
    return this.#readBaked(pkg, id).then(() => {
      if (this.#pkg === pkg && this.#asked === asked) this.#show(id);
    });
  }

  /** Build and show a building; with ``keep`` (the same building, read again), where it
   * was: the view, the floor shown, what is selected and the walker kept, and its frame. */
  #show(id, { keep = false } = {}) {
    const was = keep ? { floor: this.#floor, selected: this.#selected, route: this.#route } : null;
    if (keep) this.clearRoute(); // drawn again on the floors built again
    if (this.#buildingGroup) {
      this.#scene.remove(this.#buildingGroup);
      this.#dispose(this.#buildingGroup);
    }
    this.#building = id;
    this.#endTour();
    if (this.#watch) this.#watch.since = null; // (auto) its frames timed once it has been shown a while
    this.#route = null; // drawn on the floors taken away
    this.#floors.clear();
    this.#swinging.clear(); // (their doors: those of the floors built again are as asked at once)
    this.#aimFrom = null;
    this.#floor = null;
    this.#selected = null;
    this.#lit = null;
    this.#ghost = null;
    this.#mark = null;
    this.#buildingGroup = this.#buildBuilding(id, { keepOrigin: keep });
    this.#scene.add(this.#buildingGroup);
    if (keep) {
      if (was.floor && this.#floors.has(was.floor)) this.#floor = was.floor;
      if (this.#mode === "walk" && !this.#floors.has(this.#walkFloor)) {
        const p = this.#camera.position;
        this.#walkTo(this.#floor || this.#floorList()[0]?.id, p.x, p.z);
      }
      this.#applyVisibility();
      const found = was.selected ? this.#findSpace(was.selected) ?? this.#findItem(was.selected) : null;
      if (found) {
        this.#highlight(found);
        this.#selected = was.selected;
      }
      if (was.route) this.showRoute(was.route.route, { ...was.route.options, animate: false });
      return;
    }
    this.#applyVisibility();
    this.#frameBuilding(false);
    this.#emit("buildingchange", { id });
  }

  /** Read the package again (a URL, Blob, File or ArrayBuffer: the same project, changed)
   * and build again only ``floors`` (default: every floor of the building shown), where
   * they stand: the view, the mode, the floor shown, what is selected and where the
   * walker stands are kept, and the other floors as they are. A building whose floors
   * are not the same any more is built again whole, still where it was; one the package
   * no longer has is replaced by its first, as `open` does. Floors read again are built
   * here (not from a pre-built world/). Resolves with the package. */
  async reload(source, { floors } = {}) {
    const pkg = await loadPackage(source);
    const id = this.#building;
    if (!id || !pkg.floorsOf(id).length) {
      this.#pkg = pkg;
      this.#baked = new Map();
      await this.setBuilding(pkg.buildings[0]?.id);
      if (this.#pkg === pkg) this.#emit("load", { package: pkg });
      return pkg;
    }
    const ids = (list) => list.map((f) => f.id ?? f).sort().join();
    const same = ids([...this.#floors.keys()]) === ids(pkg.floorsOf(id));
    this.#pkg = pkg;
    this.#baked = new Map();
    if (!same) this.#show(id, { keep: true });
    else for (const f of floors ?? [...this.#floors.keys()]) if (this.#floors.has(f)) this.#rebuildFloor(f, { given: false });
    this.#emit("reload", { floors: same ? (floors ?? [...this.#floors.keys()]).filter((f) => this.#floors.has(f)) : [...this.#floors.keys()] });
    return pkg;
  }

  /** One floor built again from the package, in place of the one built (its items as
   * given by setFloorItems kept, unless ``given`` is false). */
  #rebuildFloor(id, { given = true } = {}) {
    const old = this.#floors.get(id), floor = this.#pkg?.get(id);
    if (!old || !floor) return;
    if (this.#ghost?.parent === old.group) this.#ghost = null; // goes with it
    // (the mark, in the floor taken away: made again on the one built, #remark)
    if (this.#lit?.parent === old.group) this.#lit = null;
    const route = this.#route;
    if (route) this.clearRoute(); // drawn again over the floor built again
    const built = this.#buildFloor(floor);
    if (given && old.given) {
      built.given = old.given;
      this.#furnish(built);
    }
    this.#buildingGroup.remove(old.group);
    this.#dispose(old.group);
    this.#swinging.delete(old.doors); // (its doors: as asked at once, built again)
    this.#aimFrom = null;
    this.#floors.set(id, built);
    this.#buildingGroup.add(built.group);
    this.#applyVisibility();
    this.#relight();
    this.#remark();
    if (route) this.showRoute(route.route, { ...route.options, animate: false });
  }

  /** The mark made again where what it marks is now (an item moved or turned, a floor
   * built again), or taken away when it is gone. */
  #remark() {
    const key = this.#mark?.userData.key;
    if (!key) return;
    if (this.#mark.parent) {
      this.#mark.removeFromParent();
      this.#mark.traverse((o) => o.geometry?.dispose());
    }
    this.#mark = null;
    this.mark(JSON.parse(key));
  }

  /** The highlight made again where what is selected is now (it may have moved), or
   * taken away when it is gone. */
  #relight() {
    if (!this.#selected) return;
    const found = this.#findSpace(this.#selected) ?? this.#findItem(this.#selected);
    this.#highlight(found);
    if (!found) this.#selected = null;
  }

  /** Show one floor (or all, with null). In the walk view, go to that floor. */
  setFloor(id) {
    if (id && !this.#floors.has(id)) return;
    this.#floor = id;
    if (this.#mode === "walk" && id) {
      const p = this.#camera.position;
      this.#walkTo(id, p.x, p.z);
    }
    this.#applyVisibility();
    this.#emit("floorchange", { id });
  }

  /** "dollhouse": orbit around the building; "walk": walk through it in the first person.
   * Walking starts outside the front door, looking in; or ``at`` ({ x, z }, local metres:
   * where the dollhouse view looks is `target`), on ``floor``, facing ``heading`` (radians,
   * as `player` turns; default: the way the view faces); at the middle of the nearest
   * room when ``at`` is in none. Back to the dollhouse, the view goes round the whole
   * building, or with ``back``, back to where it was before walking. */
  setMode(mode, { at, floor, heading, back = false } = {}) {
    if (mode === this.#mode) return;
    this.#mode = mode;
    if (mode === "walk") {
      // the orbit's last turn settled now, so that back from walking the view is where it was
      this.#orbit.enableDamping = false;
      this.#orbit.update();
      this.#orbit.enableDamping = true;
      this.#orbitView = { position: this.#camera.position.clone(), target: this.#orbit.target.clone() };
      this.#flight = null;
      const floorId = floor && this.#floors.has(floor) ? floor : this.#floor || this.#floorList()[0]?.id;
      const start = at ? this.#standAt(floorId, at) : this.#startPoint(floorId);
      this.#orbit.enabled = false;
      this.#walker.enabled = true;
      this.#walker.gates = this.#o.doors !== "auto";
      const dir = this.#camera.getWorldDirection(new THREE.Vector3());
      this.#walkTo(floorId, start.x, start.z, heading ?? start.heading ?? Math.atan2(-dir.x, -dir.z));
    } else {
      this.#walker.enabled = false;
      this.#walker.release();
      this.#orbit.enabled = true;
      this.#room = null;
      this.#renderer.domElement.style.cursor = "";
      this.#aimFrame(); // (none, now)
      if (back && this.#orbitView) {
        const { position, target } = this.#orbitView;
        this.#flight = { from: this.#camera.position.clone(), to: position, fromT: this.#orbit.target.clone(), toT: target, t: 0 };
      } else this.#frameBuilding(true);
    }
    this.#applyVisibility();
    this.#emit("modechange", { mode });
    this.#emit("walklock", { locked: mode === "walk" }); // (as before the mouse was never taken)
  }

  /** The walk view (as setMode("walk")). Before, it took the mouse to look around; it is
   * never taken now: a drag looks. Kept for pages written for that. */
  startWalking() {
    if (this.#mode !== "walk") this.setMode("walk");
  }

  /** Nothing now (the mouse is never taken). Kept for pages written for when it was. */
  stopWalking() {}

  /** How far a drag turns the view, times what feels right (1, the default: what was
   * pressed stays under the pointer). */
  get lookSensitivity() { return this.#walker.sensitivity; }
  set lookSensitivity(k) {
    const v = Number(k);
    if (Number.isFinite(v) && v > 0) this.#walker.sensitivity = Math.min(4, Math.max(0.25, v));
  }

  /** Where the dollhouse view looks: the point it turns around, { x, z } in local metres. */
  get target() {
    return { x: this.#orbit.target.x, z: this.#orbit.target.z };
  }

  /** Where to stand on a floor, near ``at``: there, in a room; else the middle of the
   * room nearest it. */
  #standAt(floorId, { x, z }) {
    const f = this.#floors.get(floorId);
    if (!f || this.#spaceAt(f, x, z)) return { x, z };
    let best = null;
    for (const s of f.spaces) {
      if (s.tucked && !this.#o.showHidden) continue;
      const d = Math.hypot(s.centre.x - x, s.centre.z - z);
      if (!best || d < best.d) best = { s, d };
    }
    return best ? { x: best.s.centre.x, z: best.s.centre.z } : { x, z };
  }

  // ---- the building's own frame ---------------------------------------------------------

  /** The building's placement on the map (format 0.7), or null. */
  #placement() {
    return this.#pkg?.manifest?.placements?.[this.#building] ?? null;
  }

  /** A point of the building's own frame — [x, y], metres of its drawings, as Studio and
   * an item's `local` have them — in the world: { x, z } (local metres). Null when the
   * package does not place the building (no `placements`: before format 0.7). */
  worldPoint([x, y]) {
    const placement = this.#placement();
    if (!placement || !this.#origin) return null;
    const [wx, n] = localOf(this.#origin, toLonLat(placement, [x, y]));
    return { x: wx, z: -n };
  }

  /** A point of the world ({ x, z }, local metres) in the building's own frame: [x, y],
   * the point its placement puts there (to a micrometre); null as for worldPoint. */
  buildingPoint({ x, z }) {
    const placement = this.#placement();
    if (!placement || !this.#origin) return null;
    const world = (p) => localOf(this.#origin, toLonLat(placement, p));
    // Newton's method: over a building the placement is a turn and a shift, all but exactly
    let p = [placement.x, placement.y];
    for (let i = 0; i < 8; i++) {
      const f = world(p), ax = world([p[0] + 1, p[1]]), ay = world([p[0], p[1] + 1]);
      const a = ax[0] - f[0], c = ax[1] - f[1], b = ay[0] - f[0], d = ay[1] - f[1], det = a * d - b * c;
      const ex = x - f[0], en = -z - f[1];
      if (Math.hypot(ex, en) < 1e-7 || !det) break;
      p = [p[0] + (d * ex - b * en) / det, p[1] + (a * en - c * ex) / det];
    }
    return p;
  }

  // ---- aiming: what is under the pointer ----------------------------------------------------

  /** What is under a point of the screen (client pixels; given none, the middle of the
   * view): the floor, the point on it ({ x, z }, local metres, and ``local``, [x, y] in the
   * building's own frame), the space or zone it is in, and the item there, if one is in the
   * way. The first thing in the way counts: aimed at a wall, the point is on the floor just
   * before it; at an item, the point under where it was met. Null when nothing is in the way
   * and no floor is there. Quick whatever the floor (no triangles: the plan's walls and the
   * items' boxes), so it can follow the pointer every frame. ``wall``: whether a wall (or
   * the wall over or under an opening) was met first; ``room``: the space the point is in
   * (``space``, or the space a zone is part of): on a wall, the room on its side. Walking,
   * on the walker's floor. */
  pointAt(clientX, clientY) {
    return this.#pointOn(clientX, clientY)?.point ?? null;
  }

  /** pointAt's point, and how far along the ray from the eye it was met (``t``). */
  #pointOn(clientX, clientY) {
    if (!this.#pkg) return null;
    this.#camera.updateMatrixWorld(); // (moved since the last frame, maybe)
    this.#caster.setFromCamera(this.#ndc(clientX, clientY), this.#camera);
    const ray = this.#caster.ray;
    const walking = this.#mode === "walk";
    const floors = walking ? [this.#floors.get(this.#walkFloor)].filter(Boolean)
      : [...this.#floors.values()].filter((f) => f.group.visible).sort((a, b) => b.ordinal - a.ordinal);
    let best = null, plane = null;
    for (const f of floors) {
      const got = this.#aimOn(f, ray);
      if (!got) continue;
      // a floor met where it has no slab is passed by (outside it), unless it is the walker's
      const on = got.item || got.wall || walking || this.#onSlab(f, got.x, got.z);
      if (!on) {
        plane ??= { f, ...got };
        continue;
      }
      if (!best || got.t < best.t) best = { f, ...got };
    }
    best ??= plane;
    if (!best) return null;
    const { f, x, z, item = null, wall = false } = best;
    const unit = this.#spaceAt(f, x, z);
    return { t: best.t, point: { floor: f.id, x, z, local: this.buildingPoint({ x, z }), space: unit?.id ?? null, room: unit?.space ?? null,
      item, wall: Boolean(wall) && !item } };
  }

  /** The point of the view under a point of the screen, as three.js has it (-1 to 1); the
   * middle, given none. */
  #ndc(clientX, clientY) {
    if (clientX === undefined || clientY === undefined || clientX === null || clientY === null) return new THREE.Vector2(0, 0);
    const r = this.#renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / (r.width || 1)) * 2 - 1, -((clientY - r.top) / (r.height || 1)) * 2 + 1);
  }

  /** What a ray meets first on a floor: { t, x, z } and ``item`` (its ID), ``wall`` (the
   * point pulled back off it, onto the floor before it) or neither (the floor); or null. */
  #aimOn(f, ray) {
    const o = ray.origin, d = ray.direction;
    const y0 = f.elevation + this.#offset(f);
    let best = null;
    if (d.y < -1e-9) {
      const t = (y0 - o.y) / d.y;
      if (t > 0) best = { t, x: o.x + d.x * t, z: o.z + d.z * t };
    }
    const far = best ? best.t : 500;
    // walls, parapets, windows and heads: where the ray's way across the plan crosses each,
    // at a height it stands
    const cut = this.#mode === "dollhouse" && this.#cutaway;
    f.occluders ??= occluders(f.plan, this.#o);
    for (const [x1, z1, x2, z2, from, to, toCut] of f.occluders) {
      const top = cut ? Math.min(to, toCut) : to;
      if (top <= from) continue;
      const ex = x2 - x1, ez = z2 - z1, den = d.x * ez - d.z * ex;
      if (Math.abs(den) < 1e-12) continue;
      const qx = x1 - o.x, qz = z1 - o.z;
      const t = (qx * ez - qz * ex) / den, s = (qx * d.z - qz * d.x) / den;
      if (t <= 0 || t >= (best?.t ?? far) || s < 0 || s > 1) continue;
      const y = o.y + d.y * t - y0;
      if (y < from || y > top) continue;
      best = { t, x: o.x + d.x * t, z: o.z + d.z * t, wall: true };
    }
    if (best?.wall) { // onto the floor just before it
      const h = Math.hypot(d.x, d.z);
      if (h > 1e-6) {
        best.x -= (d.x / h) * 0.05;
        best.z -= (d.z / h) * 0.05;
      }
    }
    // the items shown: each the box it takes
    if (f.furnished) {
      for (const it of f.items) {
        const t = this.#hitItem(it, y0, o, d);
        if (t !== null && t < (best?.t ?? Infinity)) best = { t, x: o.x + d.x * t, z: o.z + d.z * t, item: it.id };
      }
    }
    return best;
  }

  /** Where a ray (origin o, direction d) meets an item's box, standing on a floor at y0: the
   * ray's t, or null. */
  #hitItem(it, y0, o, d) {
    const [u0, v0, u1, v1, top] = itemExtent(it);
    // its own frame: across (-fn, -fx) and ahead (fx, -fn) in x and z, up from its bottom
    const rx = o.x - it.x, rz = o.z + it.n;
    const ou = -rx * it.fn - rz * it.fx, ov = rx * it.fx - rz * it.fn, ow = o.y - (y0 + it.y);
    const du = -d.x * it.fn - d.z * it.fx, dv = d.x * it.fx - d.z * it.fn, dw = d.y;
    let near = 0, far = Infinity;
    for (const [p, q, lo, hi] of [[ou, du, u0, u1], [ov, dv, v0, v1], [ow, dw, 0, top]]) {
      if (Math.abs(q) < 1e-12) {
        if (p < lo || p > hi) return null;
        continue;
      }
      let t0 = (lo - p) / q, t1 = (hi - p) / q;
      if (t0 > t1) [t0, t1] = [t1, t0];
      near = Math.max(near, t0);
      far = Math.min(far, t1);
      if (near > far) return null;
    }
    return near > 0 ? near : null;
  }

  /** Whether a point of a floor is on its slab (in its outline, or in a room). */
  #onSlab(f, x, z) {
    const n = -z;
    return f.plan.outline.some((rings) => inside(rings[0], x, n)) || Boolean(this.#spaceAt(f, x, z, true));
  }

  /** The point of a floor's level under a point of the screen (where an item carried
   * across it is), or null. */
  #onLevel(f, clientX, clientY) {
    this.#caster.setFromCamera(this.#ndc(clientX, clientY), this.#camera);
    const { origin: o, direction: d } = this.#caster.ray;
    const t = (f.elevation + this.#offset(f) - o.y) / d.y;
    return d.y < -1e-9 && t > 0 ? { x: o.x + d.x * t, z: o.z + d.z * t } : null;
  }

  // ---- editing: items given, a ghost, items carried ---------------------------------------

  /** Replace one floor's furniture and equipment, building nothing else again: ``items``,
   * each { id, type, x, y, rotation } in the building's own frame (metres of its drawings;
   * rotation: degrees counter-clockwise, its front its own -y, as Studio keeps them), with
   * ``width``, ``depth``, ``height`` (m), ``mount``, ``elevation``, ``color`` and ``grade``
   * where they are not its type's in the package's catalogue. They are drawn again the next
   * frame (in milliseconds, for thousands); the walker bumps into them at once. Needs the
   * building's placement (format 0.7). Whether the floor is built. */
  setFloorItems(floorId, items) {
    const f = this.#floors.get(floorId);
    if (!f || !this.#placement()) return false;
    f.given = items.map((g) => ({ ...g }));
    this.#furnish(f);
    this.#applyVisibility();
    this.#relight();
    this.#remark();
    return true;
  }

  /** A floor's items made again from those given (setFloorItems). */
  #furnish(f) {
    for (const meshes of Object.values(f.itemMeshes)) {
      for (const m of meshes) {
        m.removeFromParent();
        m.traverse((o) => o.geometry?.dispose()); // (its lines along edges with it)
      }
    }
    f.itemMeshes = {};
    f.itemsEdged = null;
    f.bakedItems = null;
    f.itemObstacles = null;
    setItems(f.plan, f.given.map((g) => this.#itemOf(f, g)));
    f.items = f.plan.items;
    f.itemIds = f.items.map((i) => i.id);
  }

  /** An item given in the building's own frame, as the floor plans its items. */
  #itemOf(f, g) {
    const t = this.#pkg?.itemType?.(g.type) ?? null;
    const p = { type: g.type, mount: g.mount ?? t?.mount ?? "floor",
      local: { x_m: g.x, y_m: g.y, rotation_deg: g.rotation ?? 0 },
      width_m: g.width ?? t?.width, depth_m: g.depth ?? t?.depth, height_m: g.height ?? t?.height,
      elevation_m: g.elevation !== undefined ? g.elevation : t?.elevation ?? null };
    return planItem(g.id, p, { origin: this.#origin, placement: this.#placement(), wallHeight: f.plan.wallHeight,
      type: { color: g.color ?? t?.color, grade: g.grade ?? t?.grade } });
  }

  /** Show where an item would go (placed, or carried): see-through over its floor, green,
   * or red when it may not go there (``ok: false``), its footprint outlined, with the
   * lines it is drawn to (``guides``: [[x, y], [x, y]] each). ``spec``: an item as
   * setFloorItems takes one (no ID needed), on ``floor`` (default: the floor shown, or
   * walked on). Null takes it away. */
  ghost(spec) {
    this.#aimFrom = null; // (walking: the ring under the pointer, not with a ghost)
    if (this.#ghost) {
      this.#ghost.removeFromParent();
      this.#ghost.traverse((o) => o.geometry?.dispose());
      this.#ghost = null;
    }
    if (!spec) return;
    const f = this.#floors.get(spec.floor ?? (this.#mode === "walk" ? this.#walkFloor : this.#floor ?? this.#topShown()?.id));
    const it = f && this.#placement() ? this.#itemOf(f, { id: "ghost", ...spec }) : null;
    if (!it) return;
    const look = spec.ok === false ? this.#ghostLook.refused : this.#ghostLook.ok;
    const group = new THREE.Group();
    group.name = "ghost";
    for (const p of buildItems({ elevation: f.elevation, items: [it] }, "detailed", this.#o)) {
      const mesh = new THREE.Mesh(p.geometry, look.solid);
      mesh.renderOrder = 6;
      group.add(mesh);
    }
    const y = f.elevation + 0.02;
    const v = ([x, z]) => new THREE.Vector3(x, y, z);
    const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => v(itemPoint(it, (a * it.width) / 2, (b * it.depth) / 2)));
    const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring), look.line);
    outline.renderOrder = 7;
    group.add(outline);
    const guides = (spec.guides ?? []).map(([a, b]) => [this.worldPoint(a), this.worldPoint(b)]).filter(([p, q]) => p && q);
    if (guides.length) {
      const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(
        guides.flatMap(([p, q]) => [v([p.x, p.z]), v([q.x, q.z])])), this.#ghostLook.guide);
      lines.renderOrder = 7;
      group.add(lines);
    }
    f.group.add(group);
    this.#ghost = group;
  }

  /** Mark lightly what a click would act on (not the choice's highlight): ``{ floor: id }``
   * a space's or zone's floor; ``{ walls: id }`` the faces of a space's walls towards it (a
   * zone's: its space's); ``{ item: id }`` an item; null: nothing. As a page shows, following
   * the pointer (hover), what painting or choosing there would do. */
  mark(target) {
    const key = target ? JSON.stringify(target) : "";
    if (this.#mark && this.#mark.userData.key === key && this.#mark.parent) return;
    if (!target && !this.#mark) return;
    this.#aimFrom = null; // (walking: the ring under the pointer, not with a mark)
    if (this.#mark) {
      this.#mark.removeFromParent();
      this.#mark.traverse((o) => o.geometry?.dispose());
      this.#mark = null;
    }
    if (!target) return;
    this.#markLook ??= {
      fill: new THREE.MeshBasicMaterial({ color: 0x3d7bff, transparent: true, opacity: 0.26, depthWrite: false, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      edge: new THREE.MeshBasicMaterial({ color: 0x3d7bff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false,
        side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      item: new THREE.MeshBasicMaterial({ color: 0x3d7bff, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false }),
    };
    const group = new THREE.Group();
    const add = (geometry, look, order) => {
      if (!geometry) return;
      const mesh = new THREE.Mesh(geometry, look);
      mesh.renderOrder = order;
      mesh.raycast = () => {};
      group.add(mesh);
    };
    let floor = null;
    if (target.item) {
      const found = this.#findItem(target.item);
      if (found) {
        floor = found.floor;
        add(itemBox(found.floor.plan, found.item), this.#markLook.item, 4);
      }
    } else if (target.floor) {
      // the floor, tinted, its edge drawn: seen whatever it is finished in
      const found = this.#findSpace(target.floor);
      if (found) {
        floor = found.floor;
        const y = found.floor.elevation + 0.025;
        add(flat(found.space.rings, y), this.#markLook.fill, 4);
        const edges = found.space.rings.map((rings) => ribbon(rings[0].map(([x, n]) => [x, -n]).concat([[rings[0][0][0], -rings[0][0][1]]]), y + 0.004, 0.07));
        add(edges.length > 1 ? mergeGeometries(edges) : edges[0], this.#markLook.edge, 5);
        if (edges.length > 1) for (const e of edges) e.dispose();
      }
    } else if (target.walls) {
      const found = this.#findSpace(target.walls);
      if (found) {
        floor = found.floor;
        add(this.#wallFaces(found.floor, found.space.space ?? found.space.id), this.#markLook.fill, 4);
      }
    }
    if (!floor || !group.children.length) return;
    group.name = "mark";
    group.userData.key = key;
    floor.group.add(group);
    this.#mark = group;
  }

  #markLook = null;

  /** The faces of a floor's walls towards a space (as they are finished: their ``_room``),
   * a little off them; or null. */
  #wallFaces(f, spaceId) {
    const index = f.rooms?.indexOf(spaceId) ?? -1;
    if (index < 0) return null;
    const out = [];
    for (const mesh of f.pieces) {
      if (mesh.userData.material !== "wall" || !mesh.visible) continue; // (the walls shown: full, or cut low)
      const g = mesh.geometry, room = g.getAttribute("_room"), pos = g.getAttribute("position"), nor = g.getAttribute("normal");
      if (!room || !pos) continue;
      const idx = g.index, n = idx ? idx.count : pos.count;
      for (let i = 0; i + 2 < n; i += 3) {
        if (room.getX(idx ? idx.getX(i) : i) !== index) continue;
        for (let k = 0; k < 3; k++) {
          const v = idx ? idx.getX(i + k) : i + k, off = 0.006;
          out.push(pos.getX(v) + (nor ? nor.getX(v) * off : 0), pos.getY(v) + (nor ? nor.getY(v) * off : 0), pos.getZ(v) + (nor ? nor.getZ(v) * off : 0));
        }
      }
    }
    return out.length ? new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(out, 3)) : null;
  }

  /** Let items be carried across their floor by a drag (not by default): in the dollhouse
   * view any item shown; walking, the item chosen (a drag elsewhere looks round). The world
   * says where they are dragged (itemdragstart, itemdrag, itemdragend, each { id, floor, x,
   * z, local, altKey, shiftKey }) and the page moves them (setFloorItems, ghost) as it
   * decides. A press that does not move stays a click. */
  setDraggable(on) {
    this.#draggable = Boolean(on);
    if (!on) this.#renderer.domElement.style.cursor = "";
  }

  get draggable() { return this.#draggable; }

  /** A space or zone corrected (any of ``name``, ``number``, ``type``, ``hidden``,
   * ``ignored``, ``floor_finish``, ``wall_finish``, as the package's properties): its label
   * changed at once; its finishes at once, in place (its floor's triangles, or its walls'
   * faces, drawn in the finish's material: nothing built again); its floor built again
   * when its type or whether it is shown changed. Whether it is in the world. */
  updateSpace(id, props) {
    const feature = this.#pkg?.get(id);
    const f = feature ? this.#floors.get(feature.properties.floor_id) : null;
    if (!f) return false;
    const p = feature.properties;
    const tucked = () => Boolean(p.hidden || p.ignored);
    const was = { type: p.type, tucked: tucked(), floor: p.floor_finish ?? null, wall: p.wall_finish ?? null, name: p.name,
      number: p.number };
    for (const k of ["name", "number", "type", "hidden", "ignored", "floor_finish", "wall_finish"]) {
      if (k in props) p[k] = props[k] ?? (k.endsWith("_finish") ? null : props[k]);
    }
    if (p.type !== was.type || tucked() !== was.tucked) {
      this.#rebuildFloor(f.id);
      return true;
    }
    // its finishes before the next frame (many rooms changed at once: their floor dressed once)
    const kinds = this.#toDress.get(f) ?? new Set();
    if ((p.floor_finish ?? null) !== was.floor) kinds.add("floor");
    if ((p.wall_finish ?? null) !== was.wall) kinds.add("wall");
    if (kinds.size) this.#toDress.set(f, kinds);
    const s = f.spaces.find((u) => u.id === id);
    if (s && (p.name !== was.name || p.number !== was.number)) {
      Object.assign(s, { name: p.name, number: p.number });
      const label = this.#label(s);
      label.position.copy(s.label.position);
      s.label.removeFromParent(); // (its element with it)
      s.label = label;
      if (label.element.textContent) f.group.add(label);
      this.#applyVisibility();
    }
    return true;
  }

  /** What a space's or zone's floor and walls are in, as shown: { floor, wall } (codes of
   * ../finishes.js; a zone's walls are its space's), or null for an ID not in the world. */
  finishOf(id) {
    const p = this.#pkg?.get(id)?.properties;
    if (!p || (p.kind !== "space" && p.kind !== "zone")) return null;
    const space = p.kind === "zone" ? this.#pkg.get(p.space_id)?.properties ?? null : null;
    return { floor: floorFinish(p, space), wall: wallFinish(space ?? p) };
  }

  /** See-through walls and rooms coloured by type. */
  setXray(on) {
    this.#xray = Boolean(on);
    this.#applyVisibility();
  }

  /** Walls cut low, as on a plan, in the dollhouse view. */
  setCutaway(on) {
    this.#cutaway = Boolean(on);
    this.#applyVisibility();
  }

  setLabels(on) {
    this.#o.labels = Boolean(on);
    this.#applyVisibility();
  }

  setShowHidden(on) {
    this.#o.showHidden = Boolean(on);
    this.#applyVisibility();
  }

  /** Space between floors in the dollhouse view, in meters. */
  setExplode(meters) {
    this.#o.explode = Math.max(0, Number(meters) || 0);
    this.#applyVisibility();
  }

  /** Furniture and equipment: shown (true), not drawn at all (false), or (null, the
   * default) shown when one floor is: on the floor shown on its own, on the walker's
   * floor, in a building of one floor. */
  setItems(on) {
    this.#o.items = on === null || on === undefined ? null : Boolean(on);
    this.#applyVisibility();
  }

  /** Whether furniture and equipment are drawn now. */
  get items() {
    return this.#o.items ?? this.#shownFloors() <= 1;
  }

  // ---- doors -------------------------------------------------------------------------

  /** Shut a door (``open`` false) or open it, by its ID (the opening's): it swings, about
   * its hinge, unless ``instant``. Shut, it is in the walker's way. Whether the world has
   * that door (one with a leaf, in the building shown). */
  setDoorOpen(id, open, { instant = false } = {}) {
    const found = this.#findDoor(id);
    if (!found) return false;
    this.#setDoor(found.floor, found.door, Boolean(open), instant);
    return true;
  }

  /** Whether a door is open (as asked: it may be swinging still), or null for an ID the
   * world has no door of. */
  doorOpen(id) {
    return this.#findDoor(id)?.door.open ?? null;
  }

  /** Open a door if it is shut, shut it if open: its new state, or null for no such door. */
  toggleDoor(id) {
    const found = this.#findDoor(id);
    if (!found) return null;
    this.#setDoor(found.floor, found.door, !found.door.open);
    return found.door.open;
  }

  /** Doors, when walking: "auto" (the default), a shut door opens when the walker walks
   * into it; "manual", it stays shut until opened (a click or E at it, or setDoorOpen). */
  setDoors(mode) {
    if (!DOOR_MODES.has(mode)) return;
    this.#o.doors = mode;
    this.#walker.gates = mode !== "auto"; // (a glide goes through doors that open as walked into)
  }

  /** "auto" or "manual" (setDoors). */
  get doors() { return this.#o.doors; }

  /** Walking: the door E works (useDoor): the door under the pointer, within reach, else
   * the nearest ahead within reach: { id, open, under } (under: the pointer's); else null. */
  get aimedDoor() {
    const a = this.#aimed;
    return a ? { id: a.door.id, open: a.door.open, under: a.under } : null;
  }

  /** Walking: open the door under the pointer (within reach) if it is shut, shut it if open;
   * else the nearest ahead within reach (as E does). { id, open } (its new state), or null
   * when there is none. */
  useDoor() {
    if (this.#mode !== "walk" || this.#paused) return null;
    const aimed = this.#aimNow();
    if (!aimed) return null;
    this.#setDoor(aimed.floor, aimed.door, !aimed.door.open);
    return { id: aimed.door.id, open: aimed.door.open };
  }

  /** A door of the building shown, by its ID: { floor, door }, or null. */
  #findDoor(id) {
    if (!id) return null;
    for (const floor of this.#floors.values()) {
      const door = floor.doors.byId.get(id);
      if (door) return { floor, door };
    }
    return null;
  }

  /** A door asked to be open or shut (swinging, unless ``instant``); doorchange, when that
   * is a change. */
  #setDoor(f, door, open, instant = false) {
    const changed = f.doors.set(door, open, instant);
    if (f.doors.moving.size) this.#swinging.add(f.doors);
    if (door.id) {
      if (open) this.#shut.delete(door.id);
      else this.#shut.add(door.id);
    }
    this.#shadowsDirty = true;
    this.#aimFrom = null; // (aimed at again: its hint says what it does now)
    if (changed) this.#emit("doorchange", { id: door.id, open, floor: f.id });
    return changed;
  }

  /** The door key (E), walking: the door under the pointer, else the nearest ahead,
   * opened or shut (its key taken: the page sees it was, defaultPrevented); not a key typed
   * into a field of the page, nor one the page took first. */
  #onKey = (e) => {
    if (!this.#o.doorKey || e.code !== this.#o.doorKey || e.repeat || e.ctrlKey || e.metaKey || e.altKey || this.#mode !== "walk"
      || this.#paused || e.defaultPrevented) return;
    if (e.target?.closest?.("input, textarea, select, [contenteditable], dialog[open]")) return;
    if (this.useDoor()) e.preventDefault();
  };

  /** Walking: the door E works, worked out now ({ floor, door, under }), or null. */
  #aimNow() {
    this.#aimFrom = null;
    this.#aimFrame();
    return this.#aimed;
  }

  /** The door under a point of the screen on a walker's floor, within reach, and nearer
   * than anything else there (``hit``: #pointOn's, if known): { door, t }, or null. A door
   * open is looked through, not on: its leaf is what is on it. */
  #doorUnder(f, clientX, clientY, hit = this.#pointOn(clientX, clientY)) {
    this.#caster.setFromCamera(this.#ndc(clientX, clientY), this.#camera);
    const { origin, direction } = this.#caster.ray;
    const got = f.doors.aim(origin, direction, f.elevation, DOOR.reach, f.obstacles, { through: false });
    return got && (!hit || got.t <= hit.t + 0.05) ? got : null;
  }

  /** Walking, each frame (again only when the view, the pointer or a door moved): what is
   * under the pointer, said as it changes (hover); the door E works (dooraim), its hint by
   * the pointer when it is under it; the ring on the floor where a double-click would go;
   * and the pointer's look over the view. */
  #aimFrame() {
    const f = this.#mode === "walk" && !this.#paused ? this.#floors.get(this.#walkFloor) : null;
    const cam = this.#camera, at = f ? this.#pointer : null;
    const busy = this.#walker.looking ? "look" : this.#carry ? "carry" : this.#walker.gliding ? "glide" : "";
    if (f) {
      cam.updateMatrixWorld();
      const view = cam.matrixWorld.elements, was = this.#aimFrom;
      if (was && was.floor === f && was.x === at?.x && was.y === at?.y && was.busy === busy && view.every((v, i) => v === was.view[i])) return;
      this.#aimFrom = { floor: f, view: view.slice(), x: at?.x, y: at?.y, busy };
    } else this.#aimFrom = null;
    // under the pointer (not while the view is dragged or an item carried)
    const looks = at && busy !== "look" && busy !== "carry";
    const hit = looks ? this.#pointOn(at.x, at.y) : null;
    const under = looks ? this.#doorUnder(f, at.x, at.y, hit) : null;
    let aimed = under ? { floor: f, door: under.door, under: true } : null;
    if (f && !aimed) {
      const ahead = f.doors.ahead(cam.position, cam.getWorldDirection(this.#look), DOOR.reach, f.obstacles);
      aimed = ahead ? { floor: f, door: ahead, under: false } : null;
    }
    this.#aimed = aimed;
    const said = aimed ? `${aimed.door.id}:${aimed.door.open}:${aimed.under}` : "";
    if (said !== this.#aimSaid) {
      this.#aimSaid = said;
      this.#element.classList.toggle("sp3d-door-aim", Boolean(aimed?.under));
      this.#emit("dooraim", aimed ? { id: aimed.door.id, open: aimed.door.open, under: aimed.under } : { id: null, open: null, under: false });
    }
    this.#sayHover(hit ? { ...hit.point, door: under ? { id: under.door.id, open: under.door.open } : null } : null);
    this.#placeHint();
    this.#placeRing(hit && !under && !hit.point.item && !hit.point.wall && !busy ? hit.point : null);
    if (f) {
      this.#renderer.domElement.style.cursor = busy === "look" || busy === "carry" ? "grabbing" : under || hit?.point.item ? "pointer" : "";
    }
  }

  /** hover, when what is under the pointer changed: its floor, space, room, item, wall or
   * door (or whether that door is open); null when nothing is (the pointer gone). */
  #sayHover(now) {
    const key = now ? [now.floor, now.space, now.room, now.item, now.wall, now.door?.id, now.door?.open].join("|") : "";
    this.#hovered = now;
    if (key === this.#hoverSaid) return;
    this.#hoverSaid = key;
    this.#emit("hover", now);
  }

  /** Walking: what is under the pointer ({ ...pointAt, door }), as hover said it last; null
   * when nothing is (or the pointer is not over the view). */
  get hovered() { return this.#hovered; }

  /** The hint by the pointer: on a door within reach, what E or a click does to it. */
  #placeHint() {
    const hint = this.#hint, a = this.#aimed, at = this.#pointer;
    if (this.#flashUntil > performance.now()) return; // (a word said for a moment: #flash)
    if (!a?.under || !at) {
      hint.style.display = "none";
      return;
    }
    const key = this.#o.doorKey ? ` (${this.#o.doorKey.replace(/^Key|^Digit/, "")})` : "";
    hint.textContent = `${a.door.open ? "Close" : "Open"} door${key}`;
    this.#hintAt(at.x, at.y);
  }

  /** The hint shown by a point of the screen, inside the view. */
  #hintAt(x, y) {
    const hint = this.#hint, r = this.#element.getBoundingClientRect();
    hint.style.display = "block";
    const w = hint.offsetWidth, h = hint.offsetHeight;
    hint.style.left = `${Math.max(4, Math.min(r.width - w - 4, x - r.left + 14))}px`;
    hint.style.top = `${Math.max(4, Math.min(r.height - h - 4, y - r.top + 18))}px`;
  }

  #flashUntil = 0;
  #flashTimer = 0;

  /** A word by a point of the screen, for a moment (a glide refused). */
  #flash(text, x, y) {
    this.#hint.textContent = text;
    this.#hintAt(x, y);
    this.#flashUntil = performance.now() + 1400;
    clearTimeout(this.#flashTimer);
    this.#flashTimer = setTimeout(() => {
      this.#flashUntil = 0;
      this.#placeHint();
    }, 1400);
  }

  /** The ring on the floor under the pointer, walking (where a double-click would glide):
   * at ``p`` ({ x, z } on the walker's floor), or none. Not while a ghost or a mark shows
   * what a click would do. */
  #placeRing(p) {
    const f = this.#floors.get(this.#walkFloor);
    if (!p || !f || this.#ghost || this.#mark || this.#mode !== "walk") {
      if (this.#ring) this.#ring.visible = false;
      return;
    }
    if (!this.#ring) {
      const ring = new THREE.Group();
      ring.name = "walk-ring";
      const part = (inner, outer, color, opacity, y) => {
        const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity,
          depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
        m.rotation.x = -Math.PI / 2;
        m.position.y = y;
        m.renderOrder = 9;
        m.raycast = () => {};
        ring.add(m);
      };
      part(0.2, 0.235, 0x000000, 0.22, 0); // a soft dark rim: seen on a light floor
      part(0.16, 0.2, 0xffffff, 0.9, 0.001);
      part(0, 0.16, 0xffffff, 0.16, 0.001);
      this.#scene.add(ring);
      this.#ring = ring;
    }
    const d = Math.hypot(p.x - this.#camera.position.x, p.z - this.#camera.position.z);
    this.#ring.scale.setScalar(Math.max(0.8, Math.min(2.4, d / 5)));
    this.#ring.position.set(p.x, f.elevation + 0.012, p.z);
    this.#ring.visible = true;
  }

  /** Walking, each frame: a shut door walked into opened (doors "auto"; gliding, one in
   * the glide's way), and what is under the pointer and the door E works (#aimFrame). */
  #walkDoors() {
    const f = this.#floors.get(this.#walkFloor), intent = this.#walker.intent;
    if (f && intent && this.#o.doors === "auto") {
      const p = this.#camera.position, look = this.#walker.gliding ? intent : this.#camera.getWorldDirection(this.#look);
      const door = f.doors.bumped(p.x, p.z, intent, { x: look.x, z: look.z });
      if (door) this.#setDoor(f, door, true);
    }
    this.#aimFrame();
  }

  /** The doors swinging moved on (each frame a tenth of a second at most, so that a swing
   * is seen however slowly frames come), their shadows drawn again. */
  #swing(dt) {
    for (const doors of this.#swinging) {
      doors.step(Math.min(dt, 0.1));
      if (!doors.moving.size) this.#swinging.delete(doors);
    }
    this.#shadowsDirty = true;
    this.#aimFrom = null;
  }

  /** Select a space, a zone or an item (highlight it); in the walk view, go there. */
  select(id, { go = true } = {}) {
    const found = id ? this.#findSpace(id) ?? this.#findItem(id) : null;
    this.#highlight(found);
    this.#selected = found ? id : null;
    if (found && go) {
      const { x, z } = found.space?.centre ?? found.at;
      if (this.#mode === "walk") this.#walkTo(found.floor.id, x, z);
      else {
        if (this.#floor && this.#floor !== found.floor.id) this.setFloor(found.floor.id);
        this.#flyTo({ x, z }, found.floor.elevation + this.#offset(found.floor), found.space?.size ?? 4);
      }
    }
    this.#emit("select", { id: this.#selected, feature: found ? this.#pkg.get(id) : null });
  }

  /** Go up (+1) or down (−1) a floor, from where the walker stands. */
  changeFloor(step) {
    const list = this.#floorList();
    const current = this.#walkFloor ? list.findIndex((f) => f.id === this.#walkFloor) : -1;
    const next = list[current + step];
    if (!next) return false;
    const p = this.#camera.position;
    this.#walkTo(next.id, p.x, p.z);
    this.#floor = next.id;
    this.#applyVisibility();
    this.#emit("floorchange", { id: next.id });
    return true;
  }

  /** Whether the walker stands where floors can be changed: stairs or a lift, or
   * anywhere in a building whose drawings show neither. */
  get atStairs() {
    const f = this.#floors.get(this.#walkFloor);
    const here = f && this.#spaceAt(f, this.#camera.position.x, this.#camera.position.z);
    if (here && VERTICAL.has(here.type)) return true;
    return ![...this.#floors.values()].some((f) => f.spaces.some((s) => VERTICAL.has(s.type)));
  }

  /** The floor the walker is on. */
  get walkFloor() { return this.#walkFloor; }

  /** Longitude/latitude → the world's local meters: x east, z south. */
  toLocal([lon, lat]) {
    const [x, n] = localOf(this.#origin, [lon, lat]);
    return { x, z: -n };
  }

  /** A floor's plan in local meters (x east, z south), for a minimap: its walls,
   * spaces, items (their footprints) and what the walker bumps into besides them
   * ([x1, z1, x2, z2] each). */
  plan(floorId) {
    const f = this.#floors.get(floorId);
    if (!f) return null;
    const xz = (ring) => ring.map(([x, n]) => [x, -n]);
    return {
      walls: f.wallRings.map(xz),
      spaces: f.spaces.filter((s) => this.#o.showHidden || !s.tucked)
        .map((s) => ({ id: s.id, type: s.type, name: s.name, rings: s.rings.flat(1).map(xz) })),
      items: f.items.map((i) => ({ id: i.id, type: i.type, mount: i.mount, color: i.color,
        ring: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => itemPoint(i, (a * i.width) / 2, (b * i.depth) / 2)) })),
      obstacles: f.obstacles.segments,
      doors: f.doors.plan(),
      bounds: f.bounds,
    };
  }

  // ---- a way through the building ---------------------------------------------

  /** The way shown (showRoute), or null. */
  get route() { return this.#route?.route ?? null; }

  /** Draw a way (as route() in navigation.js finds it, format 0.8): over each floor it
   * walks on, a softly glowing ribbon a little over the floor, chevrons flowing along it the
   * way it goes; through each lift or stairs a glowing column, an arrow up or down on it;
   * a ring pulsing at its start ("You are here": `startLabel`), a pin over its end, its
   * room lit and its card (`endLabel`: by default its name and floor); seen through what is
   * in front of it. With `animate` (unless reduced motion is asked for) it rises out of the
   * floor from its start to its end. Over the whole building the floors it does not walk
   * on fade back, and those above it are left out; on a way of several floors, those but
   * the one it starts on (or the step shown: showStep) fade too, so that it shows through
   * them. Rooms' labels other than its own (its start, the corridors it goes along) are
   * not shown meanwhile. Null: none. With `fit`, the camera frames it; with `fly`, it goes
   * along it (flyRoute). Its
   * colours (CSS colours): `color`, `casing` (its rim), `arrow` (its chevrons), `start`,
   * `end`. Floors are named by `floorName` (default: their names in the package). */
  showRoute(route, { fly = false, fit = false, animate = true, startLabel = null, endLabel, floorName, ...colours } = {}) {
    this.clearRoute();
    const placement = this.#pkg?.manifest.placements?.[this.#building];
    if (!route || !placement || !route.legs?.some((leg) => this.#floors.has(leg.floor_id))) return Promise.resolve();
    // a point of the building's drawings, in the world: x east, z south
    const at = ([x, y]) => {
      const [wx, n] = localOf(this.#origin, toLonLat(placement, [x, y]));
      return [wx, -n];
    };
    const css = {};
    for (const key of Object.keys(ROUTE.colours)) {
      const c = new THREE.Color(ROUTE.colours[key]);
      try {
        if (colours[key] !== undefined && colours[key] !== null) c.set(colours[key]);
      } catch {
        // not a colour: the default
      }
      css[key] = `#${c.getHexString()}`;
    }
    const nameOf = floorName ?? ((id) => this.#pkg.get(id)?.properties.name ?? id);
    const shown = { route, options: { startLabel, endLabel, floorName, ...colours }, css, legs: [], links: [], objects: [],
      materials: [], tags: [], keep: new Set(), off: new Set(), start: null, end: null, active: 0, total: 0, clock: 0,
      reveal: null, multi: new Set(route.legs.map((l) => l.floor_id)).size > 1 };
    const keep = (m) => {
      shown.materials.push(m);
      return m;
    };
    const add = (object, name, parent, order = ROUTE.order) => {
      object.name = name;
      object.renderOrder = order;
      object.traverse((o) => { o.renderOrder = order; });
      parent.add(object);
      shown.objects.push(object);
      return object;
    };
    const steps = route.steps ?? [];
    route.legs.forEach((leg, i) => {
      const f = this.#floors.get(leg.floor_id);
      if (!f) return;
      const points = leg.points.map(at);
      const smooth = smoothed(points);
      const y = f.elevation + ROUTE_SIZE.lift;
      const entry = { index: i, floor: f, points, smooth, y, mesh: null, materials: [], length: 0, offset: shown.total };
      if (smooth.length > 1) {
        const geometry = ribbon(smooth, y);
        const material = keep(lineMaterial({ color: css.color, edge: css.casing, chevron: css.arrow }));
        entry.mesh = add(new THREE.Mesh(geometry, material), `route:leg:${i}`, f.group);
        entry.materials.push(material);
        entry.length = geometry.userData.length;
      }
      shown.total += entry.length;
      shown.legs.push(entry);
    });
    // between floors: a column through the lift or stairs, from where one leg ends to where the next starts
    for (let i = 0; i + 1 < shown.legs.length; i++) {
      const a = shown.legs[i], b = shown.legs[i + 1], change = route.changes[a.index];
      const up = change?.direction ? change.direction === "up" : b.floor.elevation >= a.floor.elevation;
      const material = keep(columnMaterial({ color: css.color, chevron: css.arrow, up }));
      const mesh = add(new THREE.Mesh(new THREE.CylinderGeometry(ROUTE_SIZE.column, ROUTE_SIZE.column, 1, 28, 1, true), material),
        `route:link:${i}`, this.#buildingGroup);
      const arrow = add(arrowMesh(css.color, up), `route:arrow:${i}`, this.#buildingGroup, ROUTE.order + 1);
      keep(arrow.material);
      const ride = RIDE_WORDS[change?.by];
      const label = tag(`${ride ? `${ride} ${up ? "up" : "down"}` : up ? "Up" : "Down"} to ${nameOf(b.floor.id)}`, null, "change", css,
        up ? "↑" : "↓");
      label.name = `route:tag:change:${i}`;
      this.#buildingGroup.add(label);
      shown.tags.push(label);
      const height = Math.abs(b.y - a.y);
      shown.links.push({ a, b, from: a.points[a.points.length - 1], to: b.points[0], mesh, arrow, label, up, materials: [material],
        offset: a.offset + a.length, length: height });
      shown.total += height;
      // the lift's or stairs' own label: the column's tag says it
      const fa = this.#spaceAt(a.floor, ...a.points[a.points.length - 1]), fb = this.#spaceAt(b.floor, ...b.points[0]);
      for (const s of [fa, fb]) if (s) shown.off.add(s.id);
      // (legs after a column count from where it ends)
      for (const later of shown.legs.slice(i + 1)) later.offset += height;
    }
    // its start: a disc in a white rim, two rings pulsing out of it, and its label
    const first = shown.legs[0];
    if (first && first.index === 0) {
      const [x, z] = first.points[0];
      const g = new THREE.Group();
      g.position.set(x, first.y + 0.01, z);
      const ringLook = keep(markMaterial(css.start, 0));
      const pulses = [0, 1].map(() => {
        const m = new THREE.Mesh(ringGeometry(0.82, 1, 56), ringLook.clone());
        keep(m.material);
        g.add(m);
        return m;
      });
      g.add(new THREE.Mesh(discGeometry(0.62), keep(markMaterial("#ffffff", 0.98))), new THREE.Mesh(discGeometry(0.44), keep(markMaterial(css.start, 1))));
      g.children.forEach((c, k) => { c.position.y = k * 0.004; });
      add(g, "route:start", first.floor.group, ROUTE.order + 2);
      shown.start = { group: g, pulses };
      if (startLabel) {
        const t = tag(startLabel, null, "start", css);
        t.position.set(0, 1.25, 0);
        t.name = "route:tag:start";
        g.add(t);
        shown.tags.push(t);
      }
      // the room it starts in: its label, unless the start's own says where it is
      const place = steps[0]?.kind === "start" ? steps[0].place : null;
      const here = (place && first.floor.spaces.find((s) => s.id === place)) ?? this.#spaceAt(first.floor, x, z);
      if (here && !startLabel) shown.keep.add(here.id);
    }
    // its end: a pin over it, a ring pulsing under it, its room lit, its card
    const last = shown.legs[shown.legs.length - 1];
    if (last && last.index === route.legs.length - 1) {
      const [x, z] = last.points[last.points.length - 1];
      const arrive = steps.find((s) => s.kind === "arrive");
      const room = (arrive?.place && last.floor.spaces.find((s) => s.id === arrive.place)) ?? this.#spaceAt(last.floor, x, z);
      const g = new THREE.Group();
      g.position.set(x, last.y, z);
      const halo = new THREE.Mesh(ringGeometry(0.8, 1, 56), keep(markMaterial(css.end, 0)));
      halo.position.y = 0.01;
      const pin = pinMesh(css.end);
      pin.traverse((o) => { if (o.material) keep(o.material); });
      g.add(halo, pin);
      add(g, "route:end", last.floor.group, ROUTE.order + 3);
      if (room) {
        const lit = add(new THREE.Mesh(flat(room.rings, last.floor.elevation + 0.03), keep(markMaterial(css.color, 0.24))), "route:room",
          last.floor.group, ROUTE.order - 2);
        const edges = room.rings.map((rings) => ribbon(rings[0].map(([px, pn]) => [px, -pn]).concat([[rings[0][0][0], -rings[0][0][1]]]),
          last.floor.elevation + 0.035, 0.12));
        const edge = add(new THREE.Mesh(mergeGeometries(edges), keep(markMaterial(css.color, 0.9))), "route:room:edge", last.floor.group,
          ROUTE.order - 1);
        for (const e of edges) e.dispose();
        shown.room = { lit, edge, id: room.id };
      }
      const text = endLabel === undefined ? (room ? [room.name, room.number && room.number !== room.name ? room.number : ""]
        .filter(Boolean).join(" ") || null : null) : endLabel;
      if (text) {
        const where = endLabel === undefined ? nameOf(last.floor.id) : null;
        const [title, ...rest] = text.split(" · ");
        const t = tag(title, rest.length ? rest.join(" · ") : where, "end", css);
        t.position.set(0, 2.35, 0);
        t.name = "route:tag:end";
        g.add(t);
        shown.tags.push(t);
        if (room) shown.off.add(room.id);
      } else if (room) shown.keep.add(room.id);
      shown.end = { group: g, pin, halo, drop: 0 };
    }
    // the corridors it goes along: their labels kept
    for (const s of steps) if (s.kind === "walk" && s.along) shown.keep.add(s.along);
    for (const id of shown.off) shown.keep.delete(id);
    this.#route = shown;
    if (animate && this.#motion()) {
      shown.reveal = { t: 0, seconds: Math.min(2.4, 1.2 + shown.total / 140) };
      this.#revealRoute(0);
    } else this.#revealRoute(1);
    this.#applyVisibility();
    if (fit && !fly && shown.legs.length) { // the whole way framed
      const ys = shown.legs.map((l) => l.y + l.floor.group.position.y);
      this.#frameRoute(shown.legs.flatMap((l) => l.points), Math.min(...ys), Math.max(...ys) - Math.min(...ys), animate);
    }
    return fly ? this.flyRoute() : Promise.resolve();
  }

  /** Whether things move: unless the system asks for reduced motion. */
  #motion() {
    return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }

  /** The way drawn in as far as `p` (0 to 1) of it: its legs and columns in order, its
   * end's pin dropping in once it is there. */
  #revealRoute(p) {
    const shown = this.#route;
    if (!shown) return;
    const metres = p >= 1 ? Infinity : easeInOut(p) * shown.total;
    for (const l of shown.legs) for (const m of l.materials) m.uniforms.uReveal.value = p >= 1 ? 1e6 : metres - l.offset;
    for (const k of shown.links) {
      const f = p >= 1 ? 1 : Math.max(0, Math.min(1, (metres - k.offset) / (k.length || 1)));
      for (const m of k.materials) m.uniforms.uReveal.value = f;
      k.arrow.visible = f >= 1 && k.mesh.visible;
      k.label.visible = f >= 1 && k.mesh.visible;
    }
    if (shown.end) {
      const there = p >= 1 || metres >= shown.total - 0.3;
      if (there && !shown.end.shown) {
        shown.end.shown = true;
        shown.end.drop = p >= 1 && !shown.reveal ? 1 : 0;
      }
      shown.end.group.visible = Boolean(shown.end.shown);
      if (shown.room) shown.room.lit.visible = shown.room.edge.visible = Boolean(shown.end.shown);
      for (const t of shown.tags) if (t.name === "route:tag:end") t.visible = Boolean(shown.end.shown);
    }
    this.#labelsMoved = true;
  }

  /** A frame of the way's animation: chevrons and bands flowing, its start's rings
   * pulsing, its end's pin bobbing and its ring pulsing, and, while it draws in, that. */
  #animateRoute(dt) {
    const shown = this.#route;
    if (!shown) return;
    // a tenth of a second at most a frame, as the walker: after a long frame (shaders
    // made on first showing it, a slow or busy machine) the way still rises in, not at once
    dt = Math.min(dt, 0.1);
    const moving = this.#motion();
    shown.clock += moving ? dt : 0;
    const t = shown.clock;
    for (const m of shown.materials) if (m.uniforms?.uTime) m.uniforms.uTime.value = t;
    if (shown.reveal) {
      shown.reveal.t += dt;
      const p = Math.min(1, shown.reveal.t / shown.reveal.seconds);
      if (p >= 1) shown.reveal = null;
      this.#revealRoute(p);
    }
    // the marks as big on the screen far off as near: no smaller than their size, nor
    // more than a few times it
    const cam = this.#camera.position, v = new THREE.Vector3();
    for (const g of [shown.start?.group, shown.end?.group, ...shown.links.map((l) => l.arrow)]) {
      if (!g) continue;
      g.getWorldPosition(v);
      const k = Math.min(2.4, Math.max(1, v.distanceTo(cam) / 38));
      g.scale.set(k, k, k);
    }
    if (shown.start) {
      shown.start.pulses.forEach((ring, k) => {
        const phase = moving ? (t / 2.2 + k * 0.5) % 1 : 0.35;
        const s = 0.62 + phase * 1.15;
        ring.scale.set(s, 1, s);
        ring.material.opacity = moving ? 0.5 * (1 - phase) ** 1.6 : 0.3 * (1 - k);
      });
    }
    if (shown.end?.shown) {
      const e = shown.end;
      if (e.drop < 1) e.drop = Math.min(1, e.drop + dt / 0.55);
      const d = e.drop;
      const fall = d < 1 ? (1 - easeOutBack(d)) * 2.2 : 0;
      const bob = moving ? Math.sin(t * 2.4) * 0.09 : 0;
      e.pin.position.y = 0.32 + fall + bob;
      const phase = moving ? (t / 2.6) % 1 : 0.4;
      const s = 0.5 + phase * 1.2;
      e.halo.scale.set(s, 1, s);
      e.halo.material.opacity = d * (moving ? 0.55 * (1 - phase) ** 1.4 : 0.35);
    }
  }

  /** The way's legs as the camera goes along it: the one it is on (and the rides to and
   * from it) clear, the others faded; all clear with null. */
  #fadeRoute(leg) {
    const shown = this.#route;
    if (!shown) return;
    const set = (m, o) => {
      m.opacity = o;
      if (m.uniforms?.uOpacity) m.uniforms.uOpacity.value = o;
    };
    shown.legs.forEach((l, i) => {
      for (const m of l.materials) set(m, leg === null || i === leg ? 0.96 : ROUTE.faded);
    });
    shown.links.forEach((l, i) => {
      for (const m of l.materials) set(m, leg === null || i === leg || i + 1 === leg ? 0.9 : ROUTE.faded);
    });
  }

  /** Take the way away (and stop going along it). */
  clearRoute() {
    this.#endTour("stopped");
    const shown = this.#route;
    this.#route = null;
    if (!shown) return;
    for (const o of [...shown.objects, ...shown.tags.filter((t) => !shown.objects.some((g) => g === t.parent))]) {
      o.removeFromParent();
      o.traverse((c) => {
        c.geometry?.dispose();
        if (c.isCSS2DObject) c.element.remove();
      });
    }
    for (const m of shown.materials) m.dispose();
    this.#stepNow = null;
    this.#applyVisibility();
  }

  /** The step shown (showStep, or where the camera has got to going along the way), or null. */
  get routeStep() { return this.#stepNow; }

  /** Show a step of the way (route()'s `steps`): its floor clear (the way's other floors
   * faded), the camera framing it: the start and its first metres, a walk whole, the lift
   * or stairs (both floors), the destination and its room. Says so ("routestep"). */
  showStep(index, { animate = true } = {}) {
    const shown = this.#route, steps = shown?.route.steps ?? [];
    if (!shown || !Number.isInteger(index) || index < 0 || index >= steps.length) return;
    if (this.#tour) this.#endTour("stopped");
    const legs = stepLegs(shown.route), leg = legs[index], step = steps[index];
    const entry = shown.legs.find((l) => l.index === leg);
    this.#stepNow = index;
    this.#emit("routestep", { index, step, leg, floor_id: shown.route.legs[leg]?.floor_id ?? null });
    if (!entry) return;
    this.#setActiveLeg(shown.legs.indexOf(entry));
    const pts = [];
    const near = 14;
    const lengths = lengthsOf(entry.points), total = lengths[lengths.length - 1];
    const part = (a, b) => entry.points.filter((_, i) => lengths[i] >= a && lengths[i] <= b)
      .concat([along(entry.points, lengths, a), along(entry.points, lengths, b)].map((p) => [p.x, p.z]));
    if (step.kind === "start") pts.push(...part(0, near));
    else if (step.kind === "take") {
      pts.push(...part(total - near, total));
      const next = shown.legs[shown.legs.indexOf(entry) + 1];
      if (next) pts.push(next.points[0]);
    } else if (step.kind === "arrive") {
      pts.push(...part(total - near, total));
      const room = shown.room && entry.floor.spaces.find((s) => s.id === shown.room.id);
      for (const r of room?.rings ?? []) for (const [x, n] of r[0]) pts.push([x, -n]);
    } else pts.push(...entry.points);
    const y = entry.y + entry.floor.group.position.y;
    const rise = step.kind === "take" ? shown.legs[shown.legs.indexOf(entry) + 1]?.y ?? entry.y : entry.y;
    this.#frameRoute(pts, y, rise - entry.y, animate);
  }

  /** Show a leg of the way (its walking on one floor) whole, its floor clear. */
  showLeg(index, { animate = true } = {}) {
    const shown = this.#route, entry = shown?.legs.find((l) => l.index === index);
    if (!entry) return;
    if (this.#tour) this.#endTour("stopped");
    this.#setActiveLeg(shown.legs.indexOf(entry));
    this.#frameRoute(entry.points, entry.y + entry.floor.group.position.y, 0, animate);
  }

  /** The leg whose floor is clear, the way's other floors faded (on a way of several),
   * and its other legs faded too: a step, or the camera going along it, is on this one. */
  #setActiveLeg(i) {
    const shown = this.#route;
    if (!shown) return;
    this.#fadeRoute(i);
    if (shown.active === i) return;
    shown.active = i;
    this.#applyVisibility();
  }

  /** The camera framing points of a floor at height y (and up `rise` more): seen from
   * the way it looks now, from above, fitting them; a jump without motion. */
  #frameRoute(points, y, rise, animate) {
    if (this.#mode === "walk") this.setMode("dollhouse");
    const box = new THREE.Box3();
    for (const [x, z] of points) box.expandByPoint(new THREE.Vector3(x, y, z)).expandByPoint(new THREE.Vector3(x, y + rise, z));
    if (box.isEmpty()) return;
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(4, Math.hypot(size.x, size.z) / 2 + 2, size.y / 2 + 2);
    const fov = (this.#camera.fov * Math.PI) / 180;
    const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * this.#camera.aspect));
    const dist = radius / Math.sin(fit / 2) * 1.05;
    const dir = this.#camera.position.clone().sub(this.#orbit.target);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0.6, 0, 0.8);
    dir.normalize().multiplyScalar(Math.cos(0.9)); // from about 52° above
    dir.y = Math.sin(0.9);
    const to = centre.clone().addScaledVector(dir.normalize(), dist);
    if (animate && this.#motion()) {
      this.#flight = { from: this.#camera.position.clone(), to, fromT: this.#orbit.target.clone(), toT: centre, t: 0 };
    } else {
      this.#flight = null;
      this.#camera.position.copy(to);
      this.#orbit.target.copy(centre);
      this.#orbit.update();
    }
  }

  /** Take the camera along the way shown, in the dollhouse view of the whole building: on
   * a smooth line just behind and above where it has got to, looking ahead, slower at
   * turns and off and onto each floor; at each lift or stairs it stops, rises (or sinks)
   * with the column to the next floor, which comes clear as the one left fades; it ends
   * framing the destination. About `seconds` long (default: as long as the way is, 8 to
   * 20 s). Without motion (reduced motion asked for) the camera goes to the destination at
   * once. Resolves when it is there (or stopped: stopRoute, clearRoute). */
  flyRoute({ seconds } = {}) {
    return this.playRoute({ seconds, restart: true });
  }

  /** Go along the way (flyRoute), or on again after pauseRoute; says how far it has got
   * ("routeprogress"; "routestep" at each step) and when it plays, pauses, stops or ends
   * ("routeplay"). */
  playRoute({ seconds, restart = false } = {}) {
    const shown = this.#route;
    if (!shown) return Promise.resolve();
    if (this.#tour && !restart) {
      if (this.#tour.paused) {
        this.#tour.paused = false;
        this.#emit("routeplay", { state: "playing" });
      }
      return this.#tour.promise;
    }
    if (this.#tour) this.#endTour("stopped");
    if (this.#mode === "walk") this.setMode("dollhouse");
    if (this.#floor) this.setFloor(null);
    const legs = shown.legs.filter((l) => l.smooth.length > 1 || l.points.length);
    if (!legs.length) return Promise.resolve();
    const walking = legs.reduce((sum, l) => sum + l.length, 0);
    const wanted = seconds ?? Math.min(20, Math.max(8, walking / 6));
    const rides = (legs.length - 1) * 2.95 + 1.6;
    const walk = Math.max(1.5, Math.min(14, walking / Math.max(2, wanted - rides)));
    const tour = tourOf(legs.map((l) => ({ points: l.points, y: l.y + l.floor.group.position.y })), walk);
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    this.#tour = { tour, t: 0, legs, paused: false, resolve, promise, part: -1, look: null, step: -1, metres: 0, walking };
    this.#flight = null;
    this.#emit("routeplay", { state: "playing" });
    if (!this.#motion()) { // no motion: there at once
      this.#tour.t = tour.seconds;
    }
    return promise;
  }

  /** Pause going along the way (playRoute goes on from there). */
  pauseRoute() {
    if (!this.#tour || this.#tour.paused) return;
    this.#tour.paused = true;
    this.#emit("routeplay", { state: "paused" });
  }

  /** Stop going along the way: the camera stays where it is. */
  stopRoute() {
    this.#endTour("stopped");
  }

  /** Whether the camera is going along the way ("playing") or paused there, or null. */
  get routePlay() {
    return this.#tour ? (this.#tour.paused ? "paused" : "playing") : null;
  }

  #endTour(how = "stopped") {
    const tour = this.#tour;
    this.#tour = null;
    if (!tour) return;
    this.#fadeRoute(null);
    this.#emit("routeplay", { state: how });
    tour.resolve();
  }

  /** A frame of the camera's tour: where it has got to on the way, and the camera there. */
  #tourFrame(dt) {
    const tour = this.#tour, shown = this.#route;
    if (tour.paused) return; // (the view is the page's meanwhile: it may be turned round)
    tour.t = Math.min(tour.tour.seconds, tour.t + dt);
    const { parts } = tour.tour;
    let k = parts.findIndex((p) => tour.t < p.start + p.seconds);
    if (k < 0) k = parts.length - 1;
    const part = parts[k], local = tour.t - part.start, legs = tour.legs;
    const leg = legs[part.leg];
    let look, ahead, metres = 0;
    if (part.kind === "walk") {
      const s = walkedAt(part, local);
      const p = along(part.points, part.lengths, s), q = along(part.points, part.lengths, s + 5);
      look = new THREE.Vector3(p.x, part.y, p.z);
      ahead = new THREE.Vector3(q.x, part.y, q.z);
      metres = s;
      if (tour.part !== k) this.#setActiveLeg(shown.legs.indexOf(leg));
    } else if (part.kind === "ride") {
      const a = legs[part.leg], b = legs[part.leg + 1];
      const f = easeInOut(Math.min(1, local / part.seconds));
      const [x0, z0] = a.points[a.points.length - 1], [x1, z1] = b.points[0];
      const y0 = a.y + a.floor.group.position.y, y1 = b.y + b.floor.group.position.y;
      look = new THREE.Vector3(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, z0 + (z1 - z0) * f);
      ahead = null;
      metres = a.length;
      if (f > 0.5) this.#setActiveLeg(shown.legs.indexOf(b));
      // turning, as it rides, to the way the next leg sets off (by the shorter way round)
      const lengths = lengthsOf(b.points), off = along(b.points, lengths, Math.min(5, lengths[lengths.length - 1]));
      const to = new THREE.Vector3(off.x - x1, 0, off.z - z1);
      tour.rideFrom ??= (tour.heading ?? to).clone();
      if (to.lengthSq() > 1e-6) {
        const a1 = Math.atan2(tour.rideFrom.z, tour.rideFrom.x);
        let turn = Math.atan2(to.z, to.x) - a1;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        const angle = a1 + turn * f;
        tour.heading = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      }
    } else if (part.kind === "hold") {
      const l = legs[part.leg], after = parts[k - 1]?.kind === "ride";
      const [x, z] = after ? l.points[0] : l.points[l.points.length - 1];
      look = new THREE.Vector3(x, l.y + l.floor.group.position.y, z);
      metres = after ? 0 : l.length;
    } else { // the end: the destination framed
      const l = legs[legs.length - 1];
      const [x, z] = l.points[l.points.length - 1];
      look = new THREE.Vector3(x, l.y + l.floor.group.position.y, z);
      metres = l.length;
      this.#setActiveLeg(shown.legs.indexOf(l));
    }
    if (part.kind !== "ride") tour.rideFrom = null;
    // the way it heads, smoothed: the camera behind and above, looking a little ahead
    if (ahead) {
      const dir = ahead.clone().sub(look).setY(0);
      if (dir.lengthSq() > 1e-6) {
        dir.normalize();
        tour.heading = tour.heading ? tour.heading.lerp(dir, 1 - Math.exp(-dt * 2.2)).normalize() : dir;
      }
    }
    tour.heading ??= new THREE.Vector3(0, 0, -1);
    const end = part.kind === "end";
    const f = end ? easeInOut(Math.min(1, local / part.seconds)) : 0;
    const back = 10 + f * 3, high = 8 + f * 6; // ending: further back and higher, the room framed
    const target = look.clone().addScaledVector(tour.heading, ahead ? 2.5 * (1 - f) : 0);
    const want = target.clone().addScaledVector(tour.heading, -back).add(new THREE.Vector3(0, high, 0));
    const done = tour.t >= tour.tour.seconds;
    const k1 = done ? 1 : 1 - Math.exp(-dt * 3.2), k2 = done ? 1 : 1 - Math.exp(-dt * 4.5);
    this.#camera.position.lerp(want, tour.part < 0 ? Math.max(k1, 0.08) : k1);
    this.#orbit.target.lerp(target, k2);
    // how far: the walking before this leg, and on it
    const before = legs.slice(0, part.leg).reduce((sum, l) => sum + l.length, 0);
    const total = tour.walking;
    const at = Math.min(total, before + metres);
    this.#emit("routeprogress", { metres: Math.round(at * 100) / 100, total: Math.round(total * 100) / 100,
      fraction: total > 0 ? at / total : 1, leg: leg?.index ?? 0, step: this.#tourStep(part), floor_id: leg?.floor.id ?? null });
    tour.part = k;
    if (done) {
      this.#orbit.target.copy(target);
      this.#endTour("ended");
    }
  }

  /** The step the tour is at: its start before it moves off, the walk of its leg, the ride
   * at a lift or stairs, the arrival at the end; said when it changes. */
  #tourStep(part) {
    const shown = this.#route, steps = shown?.route.steps ?? [];
    if (!steps.length) return null;
    const legs = stepLegs(shown.route), leg = this.#tour.legs[part.leg]?.index ?? 0;
    const on = (kind) => steps.findIndex((s, i) => s.kind === kind && legs[i] === leg);
    let i;
    if (part.kind === "end") i = steps.length - 1;
    else if (part.kind === "ride" || (part.kind === "hold" && this.#tour.tour.parts[this.#tour.tour.parts.indexOf(part) + 1]?.kind === "ride")) i = on("take");
    else if (leg === 0 && this.#tour.t < 0.6 && steps[0].kind === "start") i = 0;
    else i = on("walk");
    if (i < 0) i = legs.findIndex((l) => l === leg);
    if (i >= 0 && i !== this.#stepNow) {
      this.#stepNow = i;
      this.#emit("routestep", { index: i, step: steps[i], leg: legs[i], floor_id: shown.route.legs[legs[i]]?.floor_id ?? null });
    }
    return i >= 0 ? i : null;
  }

  /** The way's columns between floors where the floors are now (one apart from the
   * other in the exploded view), and shown when both floors are; their arrows at their
   * ends, their tags at their feet. */
  #placeRoute() {
    for (const link of this.#route?.links ?? []) {
      const a = new THREE.Vector3(link.from[0], link.a.y + link.a.floor.group.position.y, link.from[1]);
      const b = new THREE.Vector3(link.to[0], link.b.y + link.b.floor.group.position.y, link.to[1]);
      const length = a.distanceTo(b);
      link.mesh.visible = link.a.floor.group.visible && link.b.floor.group.visible && length > 1e-3;
      link.mesh.position.copy(a).add(b).multiplyScalar(0.5);
      link.mesh.scale.set(1, Math.max(length, 1e-3), 1);
      link.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      for (const m of link.materials) m.uniforms.uHeight.value = length; // (its uv from where it leaves to where it gets)
      // its arrow head where it gets to: over it, pointing up; or on it, pointing down
      link.arrow.position.copy(b).add(new THREE.Vector3(0, link.up ? 0.6 : 0.05, 0));
      link.label.position.copy(a).add(new THREE.Vector3(0, 0.9, 0));
      const revealed = (link.materials[0]?.uniforms.uReveal.value ?? 1) >= 1;
      link.arrow.visible = link.mesh.visible && revealed;
      link.label.visible = link.mesh.visible && revealed;
    }
  }

  /** Where the walker is: x, z (local meters), heading (radians) and floor. */
  get player() {
    const dir = new THREE.Vector3();
    this.#camera.getWorldDirection(dir);
    const h = Math.hypot(dir.x, dir.z) || 1;
    return { x: this.#camera.position.x, z: this.#camera.position.z, dx: dir.x / h, dz: dir.z / h,
      floor: this.#walkFloor };
  }

  destroy() {
    this.#destroyed = true;
    this.#endTour();
    this.#renderer.setAnimationLoop(null);
    window.removeEventListener("keydown", this.#onKey, true);
    this.#walker.dispose();
    this.#orbit.dispose();
    if (this.#buildingGroup) this.#dispose(this.#buildingGroup);
    this.#post?.dispose();
    this.#painter.dispose();
    for (const m of this.#looks.values()) m.dispose();
    this.#sun.shadow.map?.dispose();
    this.#scene.environment?.dispose();
    this.#renderer.dispose();
    this.#element.replaceChildren();
  }

  // ---- building the world ------------------------------------------------------

  #walkFloor = null;

  #floorList() {
    return this.#pkg ? this.#pkg.floorsOf(this.#building).filter((f) => this.#floors.has(f.id)) : [];
  }

  #buildBuilding(buildingId, { keepOrigin = false } = {}) {
    const pkg = this.#pkg;
    const floors = pkg.floorsOf(buildingId);
    if (!keepOrigin || !this.#origin) this.#origin = originOf(pkg, buildingId); // kept: the view stays where it was
    const group = new THREE.Group();
    group.name = buildingId;
    for (const floor of floors) {
      const built = this.#buildFloor(floor);
      this.#floors.set(floor.id, built);
      group.add(built.group);
    }
    const all = [...this.#floors.values()];
    const bounds = all.length ? all.reduce((b, f) => b.union(f.bounds3), new THREE.Box3()) : new THREE.Box3();
    this.#bounds = bounds;
    // The ground, a little wider than the building.
    const size = bounds.isEmpty() ? new THREE.Vector3(40, 0, 40) : bounds.getSize(new THREE.Vector3());
    const centre = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 20);
    const fogFar = span * 10 + 150;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(fogFar * 1.5, 64), this.#materials.ground());
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(centre.x, (all[0]?.elevation ?? 0) - this.#o.slab - 0.02, centre.z);
    ground.receiveShadow = true;
    ground.renderOrder = -1; // drawn first, out of the depth the occlusion reads (Materials.ground)
    group.add(ground);
    this.#ground = ground;
    this.#placeSun(centre, span);
    this.#scene.fog = new THREE.Fog(this.#o.fog ?? STYLES[this.#style].fog, span * 4, fogFar);
    this.#camera.far = Math.max(3000, fogFar * 1.6);
    this.#camera.updateProjectionMatrix();
    return group;
  }

  #bounds = new THREE.Box3();

  /** Read a building's pre-built floors (world/<floor-id>.glb), each kept when it
   * was built from this package, by this builder, in this frame, with these options;
   * otherwise (or unreadable) the floor is built here. */
  async #readBaked(pkg, buildingId) {
    const baked = this.#baked;
    const floors = pkg.floorsOf(buildingId).filter((f) => !baked.has(f.id) && pkg.hasWorld(f.id));
    const origin = originOf(pkg, buildingId);
    const o = this.#o;
    const matches = (x, floor) => x && x.floor_id === floor.id && x.project_id === pkg.project.id
      && x.export_sequence === pkg.manifest.export?.sequence && x.builder === BUILDER
      && Object.keys(GEOMETRY).every((k) => x.options?.[k] === o[k])
      && ["lon", "lat", "kx", "ky"].every((k) => Math.abs(x.origin?.[k] - origin[k]) <= 1e-9 * Math.max(1, Math.abs(origin[k])));
    try {
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      const loader = new GLTFLoader();
      await Promise.all(floors.map(async (floor) => {
        let gltf = null;
        try {
          gltf = await loader.parseAsync(await pkg.world(floor.id), "");
        } catch (e) {
          console.warn(`StoreyPathWorld: ${floor.id}'s pre-built 3D could not be read, so it is built here: ${e.message}`);
        }
        baked.set(floor.id, gltf && matches(gltf.scene.userData.storeypath, floor) ? gltf : null);
      }));
    } catch (e) {
      console.warn(`StoreyPathWorld: no glTF loader, so floors are built here: ${e.message}`);
      for (const f of floors) baked.set(f.id, null);
    }
  }

  /** A pre-built floor's pieces, room IDs, obstacles and doors, as buildPieces gives them;
   * its items' pieces by form, as buildItems gives them, and the IDs they index. */
  #bakedPieces(gltf) {
    const pieces = [], obstacles = [], items = { detailed: [], light: [] };
    gltf.scene.traverse((m) => {
      const d = m.userData;
      if (m.isLineSegments && d.name === "obstacles") {
        const p = m.geometry.getAttribute("position");
        for (let i = 0; i + 1 < p.count; i += 2) obstacles.push([p.getX(i), p.getZ(i), p.getX(i + 1), p.getZ(i + 1)]);
        m.geometry.dispose();
      } else if (m.isMesh && d.material) {
        const piece = { name: d.name ?? m.name, material: d.material, view: d.view, type: d.type, hidden: d.hidden,
          geometry: m.geometry };
        if (d.material === "item") items[d.form === "light" ? "light" : "detailed"].push({ ...piece, form: d.form });
        else pieces.push(piece);
      }
      if (m.material) m.material.dispose(); // the file's own: the world's are used
    });
    const x = gltf.scene.userData.storeypath;
    return { pieces, rooms: x.rooms, obstacles, doors: x.doors ?? [], items: { ids: x.items ?? [], ...items } };
  }

  /** The material a piece is drawn with: its finishes' (one a group of its triangles), or
   * by what it is. */
  #material({ material, type, finishes }) {
    const m = this.#materials;
    if (finishes?.length) return finishes.length === 1 ? m.finish(finishes[0]) : finishes.map((code) => m.finish(code));
    if (material === "floor") return m.floor(type);
    if (material === "volume") return m.volume(TYPE_COLORS[type] || TYPE_COLORS.unspecified);
    return m[material] instanceof THREE.Material ? m[material] : m.wallPlain;
  }

  #buildFloor(floor) {
    const o = this.#o;
    const plan = planFloor(this.#pkg, floor, this.#origin, o);
    const baked = this.#baked.get(floor.id);
    const { pieces, rooms, obstacles, items, doors } = baked ? this.#bakedPieces(baked) : buildPieces(plan, o);
    if (baked) this.#baked.delete(floor.id); // its geometry is the floor's now: read again when built again
    const e = plan.elevation;
    pieces.push(...cutPieces(pieces, e, o));
    const group = new THREE.Group();
    group.name = floor.id;
    const built = { id: floor.id, group, elevation: e, height: plan.height, ordinal: plan.ordinal, prebuilt: Boolean(baked),
      spaces: [], pieces: [], rooms, wallRings: plan.wallRings, bounds: plan.bounds, bounds3: new THREE.Box3(),
      // the furniture and equipment: as planned, the IDs their geometry indexes, the
      // pre-built pieces of each form, and each form's meshes once shown
      plan, items: plan.items, itemIds: items?.ids ?? plan.items.map((i) => i.id), bakedItems: items ?? null,
      itemMeshes: {}, itemObstacles: null };

    // slab, walls, floors, doors and windows: one mesh a piece, its floors and walls drawn
    // a finish at a time
    for (const p of pieces) {
      const mesh = this.#mesh(p);
      mesh.visible = p.view !== "walk" && p.view !== "xray";
      group.add(mesh);
      built.pieces.push(mesh);
    }
    this.#dress(built);

    // the label of each space and zone in use
    for (const u of plan.units) {
      const label = this.#label(u);
      label.position.set(u.label[0], e + 0.25, -u.label[1]);
      if (label.element.textContent) group.add(label);
      built.spaces.push({ id: u.id, space: u.space, type: u.type, name: u.name, number: u.number, tucked: u.tucked,
        rings: u.rings, label, centre: u.centre, size: u.size });
    }
    // its doors (open as the plan draws them; those asked to be shut, shut), in the walker's way while shut
    const meshOf = (name) => built.pieces.find((m) => m.name === name);
    built.doors = new FloorDoors(doors, { door: meshOf("door"), handle: meshOf("handle") });
    for (const d of built.doors.doors) if (d.id && this.#shut.has(d.id)) built.doors.set(d, false, true);
    built.obstacles = new Obstacles(obstacles, built.doors.gates);

    if (Number.isFinite(plan.bounds[0])) {
      built.bounds3.set(new THREE.Vector3(plan.bounds[0], e - o.slab, plan.bounds[1]),
        new THREE.Vector3(plan.bounds[2], e + plan.wallHeight, plan.bounds[3]));
    }
    return built;
  }

  /** A floor's floors and walls (or ``which``: "floor" or "wall") drawn a finish at a time:
   * each triangle in the finish of the room it is of (a floor, its space's or zone's; a
   * wall's face, the room it faces, else the exterior's), in groups, each a material. */
  #dress(f, which = null) {
    const memo = (of) => {
      const known = new Map();
      return (i) => {
        if (!known.has(i)) known.set(i, of(f.rooms[i]));
        return known.get(i);
      };
    };
    const at = { floor: memo((id) => this.#floorFinishOf(id)), wall: memo((id) => this.#wallFinishOf(id)) };
    for (const mesh of f.pieces) {
      const kind = mesh.userData.material;
      if ((kind !== "floor" && kind !== "wall") || (which && which !== kind)) continue;
      const codes = groupByFinish(mesh.geometry, at[kind]);
      if (!codes) continue;
      mesh.userData.finishes = codes;
      if (!mesh.userData.faded) mesh.material = this.#material(mesh.userData);
    }
  }

  /** The floors whose rooms' finishes changed (updateSpace), dressed again. */
  #dressChanged() {
    if (!this.#toDress.size) return;
    for (const [f, kinds] of this.#toDress) {
      if (this.#floors.get(f.id) === f) this.#dress(f, kinds.size === 2 ? null : [...kinds][0]);
    }
    this.#toDress.clear();
  }

  /** The finish a space's or zone's floor shows (its own, its space's, else its type's). */
  #floorFinishOf(id) {
    const p = id ? this.#pkg?.get(id)?.properties : null;
    if (!p) return defaultFinish("floor", "unspecified");
    return floorFinish(p, p.kind === "zone" ? this.#pkg.get(p.space_id)?.properties ?? null : null);
  }

  /** The finish of the walls of a space (a wall's face facing it); none: the exterior's. */
  #wallFinishOf(id) {
    const p = id ? this.#pkg?.get(id)?.properties : null;
    if (!p) return EXTERIOR;
    return wallFinish(p.kind === "zone" ? this.#pkg.get(p.space_id)?.properties ?? p : p);
  }

  /** A piece as a mesh, drawn with the world's material for it. */
  #mesh(p) {
    const mesh = new THREE.Mesh(p.geometry, this.#material(p));
    mesh.name = p.name;
    mesh.userData = { material: p.material, type: p.type, view: p.view, hidden: Boolean(p.hidden), form: p.form };
    mesh.castShadow = CASTS.has(p.material);
    mesh.receiveShadow = TAKES.has(p.material);
    mesh.renderOrder = ORDER[p.material] ?? 0;
    return mesh;
  }

  /** A floor's items in a form ("detailed" or "light"), made the first time they are
   * shown: from the pre-built file, or here. */
  #itemsIn(f, form) {
    if (!f.itemMeshes[form]) {
      const pieces = f.bakedItems?.[form]?.length ? f.bakedItems[form] : buildItems(f.plan, form, this.#o);
      f.itemMeshes[form] = pieces.map((p) => {
        const mesh = this.#mesh(p);
        f.group.add(mesh);
        return mesh;
      });
    }
    return f.itemMeshes[form];
  }

  /** What the walker bumps into on a floor: its walls, its shut doors, and its items when they are shown. */
  #obstaclesOf(f, items) {
    if (!items || !f.items.length) return f.obstacles;
    f.itemObstacles ??= new Obstacles([...f.obstacles.segments, ...f.plan.itemObstacles], f.obstacles.gates);
    return f.itemObstacles;
  }

  /** Highlight a space (``found``: its floor and space) or an item (its floor and
   * item), or none. */
  #highlight(found) {
    if (this.#lit) {
      this.#lit.removeFromParent();
      this.#lit.geometry.dispose();
      this.#lit = null;
    }
    if (!found) return;
    const geometry = found.item ? itemBox(found.floor.plan, found.item) : flat(found.space.rings, found.floor.elevation + 0.02);
    const lit = new THREE.Mesh(geometry, this.#materials.highlight);
    lit.name = "highlight";
    lit.renderOrder = 3;
    lit.userData.space = found.space ?? null;
    lit.visible = this.#o.showHidden || !found.space?.tucked;
    found.floor.group.add(lit);
    this.#lit = lit;
  }

  #label(p) {
    // The renderer sets the outer element's display to show and hide it, so the
    // layout lives on an inner one.
    const outer = document.createElement("div");
    const el = document.createElement("div");
    el.className = "sp3d-label"; // styled here; pages may restyle the class
    Object.assign(el.style, LABEL_STYLE);
    const name = p.name || "";
    const number = p.number && p.number !== p.name ? p.number : "";
    if (name) el.append(Object.assign(document.createElement("strong"), { textContent: name }));
    if (number) {
      const n = Object.assign(document.createElement("span"), { textContent: number });
      Object.assign(n.style, { fontWeight: "500", fontSize: "10px", color: "#5f6570" });
      el.append(n);
    }
    outer.append(el);
    return new CSS2DObject(outer);
  }

  // ---- what is shown -------------------------------------------------------------

  #offset(floor) {
    return this.#mode === "dollhouse" && !this.#floor ? floor.ordinal * this.#o.explode : 0;
  }

  /** How many floors are shown: walking, the walker's (the floors under it are seen
   * only through openings); otherwise one, or all. */
  #shownFloors() {
    return this.#mode === "walk" || this.#floor ? 1 : this.#floors.size;
  }

  #applyVisibility() {
    const walking = this.#mode === "walk";
    const wf = walking ? this.#floors.get(this.#walkFloor) : null;
    // furniture and equipment: detailed on one floor, a box each on more
    const one = this.#shownFloors() <= 1;
    const items = this.#o.items ?? one;
    const form = one ? "detailed" : "light";
    // a way shown, over the whole building: the floors above the highest it goes to are left out
    const top = !walking && !this.#floor && this.#route
      ? Math.max(...this.#route.legs.map((l) => l.floor.ordinal)) : Infinity;
    // a way over the whole building: the floors it does not walk on faded back; on a way of
    // several floors, those but the one it is at too (so that it shows through them)
    const way = !walking && !this.#floor ? this.#route : null;
    const onWay = way ? new Set(way.legs.map((l) => l.floor)) : null;
    const at = way?.multi ? way.legs[way.active]?.floor ?? null : null;
    const keepLabels = !walking && this.#route ? this.#route.keep : null;
    const faded = new Set();
    const s = STYLES[this.#style], q = QUALITY[this.#drawn];
    for (const f of this.#floors.values()) {
      // Walking: the floors up to yours, open to the sky. Dollhouse: one or all.
      const shown = walking ? Boolean(wf) && f.ordinal <= wf.ordinal : (!this.#floor || f.id === this.#floor) && f.ordinal <= top;
      f.group.visible = shown;
      if (shown && way && (!onWay.has(f) || (at && f !== at))) faded.add(f);
      f.group.position.y = this.#offset(f);
      const cut = !walking && this.#cutaway;
      const seen = ({ view, hidden }) => (this.#o.showHidden || !hidden) && (view === "full" ? !cut : view === "cut" ? cut
        : view === "walk" ? walking && f === wf : view === "xray" ? this.#xray : true);
      for (const m of f.pieces) m.visible = seen(m.userData);
      for (const s of f.spaces) {
        const visible = this.#o.showHidden || !s.tucked;
        s.labelOn = visible && this.#o.labels && !walking && (keepLabels ? keepLabels.has(s.id) : !this.#floor ? f === this.#topShown() : true);
        s.label.visible = s.labelOn; // (and, each frame, only where there is room for it: #placeLabels)
      }
      const furnished = items && shown && !faded.has(f) && (!walking || f === wf) && f.items.length > 0;
      f.furnished = furnished;
      if (furnished) this.#itemsIn(f, form);
      for (const [name, meshes] of Object.entries(f.itemMeshes)) {
        for (const m of meshes) m.visible = furnished && name === form && seen(m.userData);
      }
      if (f === wf) this.#walker.obstacles = this.#obstaclesOf(f, furnished);
      // the "model" look: lines along edges, made the first time a floor (its items) shows
      if (s.edges && shown) this.#edgesOf(f, furnished ? form : null);
      for (const mesh of [...f.pieces, ...Object.values(f.itemMeshes).flat()]) {
        for (const line of mesh.children) {
          line.visible = s.edges && !faded.has(f);
          line.material = this.#materials.edges;
        }
      }
    }
    this.#fadeFloors(faded);
    if (this.#lit) this.#lit.visible = this.#o.showHidden || !this.#lit.userData.space?.tucked;
    this.#labelsMoved = true;
    this.#placeRoute();
    const see = this.#xray ? 0.22 : 1;
    const m8 = this.#materials;
    for (const m of [m8.wall, ...m8.walls(), m8.wallPlain, m8.wallTop, m8.wallCut, m8.frame, m8.doorFrame, m8.door, m8.skirting,
      m8.handle, m8.sillBoard]) {
      m.transparent = this.#xray;
      m.opacity = see;
      m.depthWrite = !this.#xray;
    }
    // walking, lit as indoors: less sky (the ceiling keeps the sun out but at the
    // windows), and the nearest ceiling panels (#lightPanels)
    this.#hemi.intensity = walking ? s.walk.hemisphere * q.ambient : s.hemisphere[2];
    this.#scene.environmentIntensity = walking ? s.walk.environment * q.ambient : s.environment;
    this.#sun.intensity = walking ? s.walk.sun : s.sun[1];
    for (const light of this.#panelLights) light.visible = walking;
    this.#shadowsDirty = true;
  }

  /** Floors faded back (a light shell: no finishes, no shadows, no items), the others as
   * they are drawn. */
  #fadeFloors(faded) {
    for (const f of this.#floors.values()) {
      const on = faded.has(f);
      if (Boolean(f.faded) === on) continue;
      f.faded = on;
      for (const mesh of f.pieces) {
        const kind = mesh.userData.material;
        if (on) {
          mesh.userData.faded = true;
          mesh.material = FLOORISH.has(kind) ? this.#fadedLook.floor : this.#fadedLook.wall;
          mesh.castShadow = mesh.receiveShadow = false;
        } else {
          delete mesh.userData.faded;
          mesh.material = this.#material(mesh.userData);
          mesh.castShadow = CASTS.has(kind);
          mesh.receiveShadow = TAKES.has(kind);
        }
      }
    }
  }

  /** In the dollhouse view of all floors, labels show for the top floor only. */
  #topShown() {
    const list = [...this.#floors.values()];
    return list.length ? list.reduce((a, b) => (b.ordinal > a.ordinal ? b : a)) : null;
  }

  // ---- walking -----------------------------------------------------------------------

  /** Where walking starts: outside the front door, looking in; else in the main room. */
  #startPoint(floorId) {
    const f = this.#floors.get(floorId);
    if (!f) return { x: 0, z: 0 };
    const door = this.#frontDoor(f);
    if (door) return door;
    const prefer = ["lobby", "corridor", "living_room", "open_area", "room"];
    const pick = [...f.spaces].sort((a, b) => {
      const ia = prefer.indexOf(a.type), ib = prefer.indexOf(b.type);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || b.size - a.size;
    })[0];
    return pick ? { x: pick.centre.x, z: pick.centre.z } : { x: (f.bounds[0] + f.bounds[2]) / 2, z: (f.bounds[1] + f.bounds[3]) / 2 };
  }

  #frontDoor(f) {
    const prefer = ["lobby", "corridor", "living_room", "open_area"];
    const doors = [];
    for (const opening of this.#pkg.openings) {
      const op = opening.properties;
      if (op.floor_id !== f.id || op.type !== "door" || op.connects.length !== 1) continue;
      const space = f.spaces.find((s) => s.id === op.connects[0]);
      let mx, mn, nx, nn, len;
      if (op.span) {
        const [a, b] = op.span.map((c) => localOf(this.#origin, c));
        mx = (a[0] + b[0]) / 2; mn = (a[1] + b[1]) / 2;
        len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        nx = -(b[1] - a[1]) / len; nn = (b[0] - a[0]) / len;
      } else if (opening.geometry?.type === "Point" && space) {
        // no span (older packages): out is away from the middle of the room
        [mx, mn] = localOf(this.#origin, opening.geometry.coordinates);
        const dx = mx - space.centre.x, dn = mn + space.centre.z;
        const d = Math.hypot(dx, dn) || 1;
        nx = dx / d; nn = dn / d;
        len = op.width_m || 0.9;
      } else continue;
      // outside is the side of the door that no room covers
      const out = [1, -1].find((k) => !this.#spaceAt(f, mx + k * nx * 1.2, -(mn + k * nn * 1.2), true));
      if (out === undefined) continue;
      const rank = prefer.indexOf(space?.type);
      doors.push({ x: mx + out * nx * 2.2, z: -(mn + out * nn * 2.2), heading: Math.atan2(out * nx, -out * nn),
        rank: rank < 0 ? 99 : rank, len });
    }
    doors.sort((p, q) => p.rank - q.rank || q.len - p.len);
    return doors[0] ?? null;
  }

  #walkTo(floorId, x, z, heading) {
    const f = this.#floors.get(floorId);
    if (!f) return;
    this.#walkFloor = floorId;
    this.#walker.place(x, z, f.elevation, f.obstacles, heading);
    this.#room = null;
    this.#applyVisibility();
  }

  #spaceAt(f, x, z, all = false) {
    const n = -z;
    for (const s of f.spaces) {
      if (!all && !this.#o.showHidden && s.tucked) continue;
      for (const rings of s.rings) {
        if (inside(rings[0], x, n) && !rings.slice(1).some((h) => inside(h, x, n))) return s;
      }
    }
    return null;
  }

  #findSpace(id) {
    for (const floor of this.#floors.values()) {
      const space = floor.spaces.find((s) => s.id === id);
      if (space) return { floor, space };
    }
    return null;
  }

  /** An item: its floor, its plan, and where to go to it (before its front, for one
   * on the floor). */
  #findItem(id) {
    for (const floor of this.#floors.values()) {
      const item = floor.items.find((i) => i.id === id);
      if (!item) continue;
      const ahead = item.mount === "floor" ? item.depth / 2 + 0.9 : 0;
      return { floor, item, at: { x: item.x + item.fx * ahead, z: -(item.n + item.fn * ahead) } };
    }
    return null;
  }

  // ---- camera ------------------------------------------------------------------------

  #frameBuilding(animate) {
    const b = this.#bounds;
    if (b.isEmpty()) return;
    const centre = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z, size.y * 2) * 0.6 + 4;
    const to = new THREE.Vector3(centre.x + radius * 0.8, centre.y + radius * 0.75, centre.z + radius * 0.9);
    if (animate) this.#flight = { from: this.#camera.position.clone(), to, fromT: this.#orbit.target.clone(), toT: centre, t: 0 };
    else {
      this.#flight = null; // one under way would take the camera on elsewhere
      this.#camera.position.copy(to);
      this.#orbit.target.copy(centre);
      this.#orbit.update();
    }
  }

  #flyTo(centre, y, size) {
    const target = new THREE.Vector3(centre.x, y, centre.z);
    // from high up, so the room's walls do not hide it
    const dist = Math.max(12, size * 2.6);
    const dir = this.#camera.position.clone().sub(this.#orbit.target);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize().multiplyScalar(0.45);
    dir.y = 1;
    dir.normalize();
    this.#flight = { from: this.#camera.position.clone(), to: target.clone().addScaledVector(dir, dist),
      fromT: this.#orbit.target.clone(), toT: target, t: 0 };
  }

  #placeSun(centre, size) {
    const sun = this.#sun;
    sun.position.copy(centre).addScaledVector(this.#sunDir, size * 1.6);
    sun.target.position.copy(centre);
    this.#shadowAt = ""; // fitted again, next frame
  }

  /** The sun's shadow fitted closely round the floors shown (the walker's, walking), so
   * that its texels are as small as they can be; on a floor bigger than what is looked at,
   * round that (walking, round the walker), in steps. Drawn again only when it moved. */
  #fitSun() {
    const walking = this.#mode === "walk", wf = walking ? this.#floors.get(this.#walkFloor) : null;
    const box = this.#sunBox.makeEmpty(), floor = this.#floorBox;
    for (const f of this.#floors.values()) {
      if (!f.group.visible || (wf && f !== wf) || f.bounds3.isEmpty()) continue;
      floor.copy(f.bounds3);
      floor.min.y += f.group.position.y;
      floor.max.y += f.group.position.y;
      box.union(floor);
    }
    if (box.isEmpty()) return;
    // round what is looked at: a reach in steps of √2, its middle in quarters of it
    const focus = walking ? this.#camera.position : this.#orbit.target;
    const wide = walking ? SHADOW.walk : Math.max(SHADOW.least, this.#camera.position.distanceTo(this.#orbit.target) * SHADOW.orbit);
    const reach = SHADOW.least * Math.SQRT2 ** Math.ceil(Math.log2(wide / SHADOW.least) * 2);
    const step = reach / SHADOW.steps;
    const near = (lo, hi, at) => {
      const a = Math.max(lo, Math.floor((at - reach) / step) * step), b = Math.min(hi, Math.ceil((at + reach) / step) * step);
      return a < b ? [a, b] : [lo, hi];
    };
    const [x0, x1] = near(box.min.x, box.max.x, focus.x), [z0, z1] = near(box.min.z, box.max.z, focus.z);
    const at = [x0, x1, z0, z1, box.min.y, box.max.y].map((v) => v.toFixed(2)).join();
    if (at === this.#shadowAt) return;
    this.#shadowAt = at;
    const sun = this.#sun, cam = sun.shadow.camera;
    const centre = new THREE.Vector3((x0 + x1) / 2, (box.min.y + box.max.y) / 2, (z0 + z1) / 2);
    const away = Math.hypot(x1 - x0, box.max.y - box.min.y, z1 - z0) + 50;
    sun.target.position.copy(centre);
    sun.position.copy(centre).addScaledVector(this.#sunDir, away);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    cam.position.copy(sun.position);
    cam.lookAt(centre);
    cam.updateMatrixWorld();
    // the box's corners as the sun sees them (a little under the floor: what stands on it)
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = lo.clone().negate();
    for (let i = 0; i < 8; i++) {
      const v = new THREE.Vector3(i & 1 ? x1 : x0, i & 2 ? box.max.y : box.min.y - 0.5, i & 4 ? z1 : z0).applyMatrix4(cam.matrixWorldInverse);
      lo.min(v);
      hi.max(v);
    }
    Object.assign(cam, { left: lo.x - 1, right: hi.x + 1, bottom: lo.y - 1, top: hi.y + 1, near: Math.max(0.5, -hi.z - 10),
      far: -lo.z + 10 });
    cam.updateProjectionMatrix();
    this.#shadowsDirty = true;
  }

  #sunBox = new THREE.Box3(); // (each frame: kept, not made)
  #floorBox = new THREE.Box3();

  // ---- loop and input ----------------------------------------------------------------

  #frame() {
    this.#dressChanged();
    this.#timer.update();
    const dt = this.#timer.getDelta();
    if (this.#swinging.size) this.#swing(dt);
    if (this.#tour) this.#tourFrame(dt); // along the way: from behind and above where it has got to, looking ahead
    else if (this.#flight) {
      const f = this.#flight;
      f.t = Math.min(1, f.t + dt / 0.9);
      const k = f.t < 0.5 ? 2 * f.t * f.t : 1 - (-2 * f.t + 2) ** 2 / 2;
      this.#camera.position.lerpVectors(f.from, f.to, k);
      this.#orbit.target.lerpVectors(f.fromT, f.toT, k);
      if (f.t >= 1) this.#flight = null;
    }
    if (this.#mode === "walk") {
      this.#walker.update(dt);
      this.#walkDoors();
      const f = this.#floors.get(this.#walkFloor);
      if (f) {
        const here = this.#spaceAt(f, this.#camera.position.x, this.#camera.position.z);
        if (here !== this.#room) {
          this.#room = here;
          this.#emit("roomchange", { id: here?.id ?? null, type: here?.type ?? null, name: here?.name ?? null,
            number: here?.number ?? null, stairs: this.atStairs });
        }
      }
    } else {
      this.#orbit.update();
    }
    this.#animateRoute(dt);
    this.#lightPanels();
    this.#fitSun();
    if (this.#shadowsDirty) {
      this.#renderer.shadowMap.needsUpdate = true;
      this.#shadowsDirty = false;
    }
    if (this.#post) {
      // occlusion over metres close up; seen from afar, over a share of the distance
      const ao = STYLES[this.#style].ao;
      const far = this.#mode === "walk" ? 0 : this.#camera.position.distanceTo(this.#orbit.target);
      this.#post.setAo(ao, Math.min(4, Math.max(ao.radius, far * ao.overview)));
      this.#post.composer.render(dt);
    } else this.#renderer.render(this.#scene, this.#camera);
    this.#placeLabels();
    this.#timeHigh(dt);
  }

  /** Walking: the ceiling panels of the walker's room nearest them lit (spot lights
   * without shadows: none from another room, so none through a wall); outside a room,
   * those within a few metres. The lights stay in the scene (unlit), so that no material
   * is made again as the walker goes from room to room. */
  #lightPanels() {
    const lights = this.#panelLights;
    const f = this.#mode === "walk" ? this.#floors.get(this.#walkFloor) : null;
    if (!f || !lights.length) return;
    if (!f.panels) {
      f.panels = new Map();
      for (const q of ceilingPanels(f.plan)) f.panels.set(q.unit, [...(f.panels.get(q.unit) ?? []), q]);
    }
    const p = this.#camera.position, room = this.#room?.id;
    const near = (room ? f.panels.get(room) ?? [] : [...f.panels.values()].flat().filter((q) => Math.hypot(q.x - p.x, q.z - p.z) < 4))
      .map((q) => ({ q, d: (q.x - p.x) ** 2 + (q.z - p.z) ** 2 }))
      .sort((a, b) => a.d - b.d);
    const y = f.elevation + f.plan.wallHeight - 0.03, power = STYLES[this.#style].walk.panels;
    lights.forEach((light, i) => {
      const hit = near[i]?.q;
      light.intensity = hit ? power : 0;
      if (!hit) return;
      light.position.set(hit.x, y, hit.z);
      light.target.position.set(hit.x, f.elevation, hit.z);
    });
  }

  /** Auto: High's frames timed once the building has been shown a while; drawn slower
   * than SLOW_FRAME (the median), Low instead, from then on. */
  #timeHigh(dt) {
    const watch = this.#watch;
    if (!watch || !this.#floors.size || document.hidden) return;
    const now = performance.now();
    watch.since ??= now;
    if (now - watch.since < WATCH.after || dt <= 0) return;
    watch.times.push(dt * 1000);
    if (watch.times.length < WATCH.frames) return;
    this.#watch = null;
    const median = watch.times.sort((a, b) => a - b)[watch.times.length >> 1];
    if (median <= SLOW_FRAME || this.#quality !== "auto") return;
    this.#drawn = "low";
    this.#why = "slow";
    this.#applyLook();
  }

  /** The rooms' labels, placed again when the view moved (or what is shown changed): only
   * those of rooms on the screen and large enough on it to hold one (as the plan does),
   * so a floor of a thousand rooms moves as smoothly as one of ten. */
  #placeLabels() {
    const cam = this.#camera, view = cam.matrixWorld.elements, was = this.#labelView;
    const moved = !was || this.#labelsMoved || view.some((v, i) => v !== was[i]);
    if (!moved) return;
    this.#labelView = view.slice();
    this.#labelsMoved = false;
    const focal = (this.#renderer.domElement.clientHeight || 1) / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const v = new THREE.Vector3();
    for (const f of this.#floors.values()) {
      if (!f.group.visible) continue;
      for (const s of f.spaces) {
        if (!s.labelOn) continue;
        v.copy(s.label.position);
        v.y += f.group.position.y;
        const far = Math.max(v.distanceTo(cam.position), 1e-3);
        v.project(cam);
        s.label.visible = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15 && (s.size * focal) / far >= LABEL_ROOM;
      }
    }
    this.#labelRenderer.render(this.#scene, cam);
    if (this.#route) this.#unpileTags();
  }

  /** A way's tags and the labels it keeps, never over one another: of two that overlap, the
   * one that matters less is not shown (its end's card, then its start's, then its floor
   * changes', then rooms' labels). */
  #unpileTags() {
    const shown = this.#route, order = { end: 0, start: 1, change: 2 };
    const items = shown.tags.map((t) => ({ el: t.element.firstElementChild, rank: order[t.userData.routeTag] ?? 3, on: t.visible }));
    for (const f of this.#floors.values()) {
      if (!f.group.visible) continue;
      for (const s of f.spaces) if (s.labelOn && s.label.visible) items.push({ el: s.label.element.firstElementChild, rank: 3, on: true });
    }
    const placed = [];
    for (const it of items.filter((i) => i.on && i.el && i.el.parentElement.style.display !== "none").sort((a, b) => a.rank - b.rank)) {
      it.el.style.visibility = "";
      const r = it.el.getBoundingClientRect();
      if (placed.some((q) => r.left < q.right + 4 && r.right > q.left - 4 && r.top < q.bottom + 2 && r.bottom > q.top - 2)) {
        it.el.style.visibility = "hidden";
      } else placed.push(r);
    }
  }

  #resize() {
    const w = this.#element.clientWidth || 1, h = this.#element.clientHeight || 1;
    // High: up to 1.5 of the screen's pixels a CSS pixel, and not too many in all; Low: one
    const q = QUALITY[this.#drawn];
    const ratio = Math.min(window.devicePixelRatio || 1, q.pixelRatio, Math.sqrt(q.pixels / (w * h)));
    if (this.#renderer.getPixelRatio() !== ratio) this.#renderer.setPixelRatio(ratio);
    this.#renderer.setSize(w, h, false);
    this.#post?.composer.setPixelRatio(ratio);
    this.#post?.composer.setSize(w, h);
    this.#renderer.domElement.style.width = "100%";
    this.#renderer.domElement.style.height = "100%";
    this.#labelRenderer.setSize(w, h);
    this.#camera.aspect = w / h;
    this.#camera.updateProjectionMatrix();
    this.#labelsMoved = true;
  }

  /** The pointer on the view. In the dollhouse view a click (a press that does not move)
   * says ``pick``, which a page may cancel (preventDefault: it does something else with the
   * click, as placing an item there), else what was clicked is chosen; a right-click says
   * ``menu``. Walking (the walker tells a click from a drag that looks): a click at the
   * pointer says ``pick`` too, else the door there within reach is opened or shut (the pick
   * says which: ``door``) or what is there chosen (a room, once the click is not a
   * double-click's first); a double-click (a double tap) glides to the floor there; a right-click (a long press) says ``menu``. A press on an item that
   * moves, where items may be carried (setDraggable; walking, the item chosen): the item
   * dragged. */
  #pointerPicking() {
    const canvas = this.#renderer.domElement;
    let down = null, hover = 0;
    // An item taken up: before the orbit sees the press (this listens on the way down to it).
    this.#element.addEventListener("pointerdown", (e) => {
      if (!this.#draggable || this.#mode !== "dollhouse" || e.button !== 0 || e.target !== canvas) return;
      const p = this.pointAt(e.clientX, e.clientY);
      if (!p?.item) return;
      this.#orbit.enabled = false;
      this.#takeUp(e, p);
    }, true);
    const where = (e, [cx, cy] = [e.clientX, e.clientY]) => {
      const drag = this.#carry, at = this.#onLevel(drag.floor, cx, cy);
      return { id: drag.id, floor: drag.floor.id, x: at?.x ?? null, z: at?.z ?? null, local: at ? this.buildingPoint(at) : null,
        altKey: e.altKey, shiftKey: e.shiftKey };
    };
    canvas.addEventListener("pointermove", (e) => {
      if (this.#mode === "walk") this.#pointer = e.pointerType === "touch" ? null : { x: e.clientX, y: e.clientY };
      const drag = this.#carry;
      if (drag) {
        if (!drag.moved && Math.hypot(e.clientX - drag.at[0], e.clientY - drag.at[1]) <= LOOK.drag) return;
        if (!drag.moved) {
          drag.moved = true;
          this.#emit("itemdragstart", where(e, drag.at));
        }
        this.#emit("itemdrag", where(e));
        return;
      }
      // over an item that may be carried: the hand
      if (!this.#draggable || this.#mode !== "dollhouse" || e.buttons || hover) return;
      hover = requestAnimationFrame(() => {
        hover = 0;
        if (!this.#draggable || this.#mode !== "dollhouse") return;
        canvas.style.cursor = this.pointAt(e.clientX, e.clientY)?.item ? "grab" : "";
      });
    });
    canvas.addEventListener("pointerleave", () => { this.#pointer = null; });
    const putDown = (e, cancelled = false) => {
      const drag = this.#carry;
      if (!drag) return;
      const { moved } = drag;
      if (moved) this.#emit("itemdragend", { ...where(e), cancelled });
      this.#carry = null;
      this.#orbit.enabled = this.#mode === "dollhouse";
      if (moved) down = null; // not a click
    };
    canvas.addEventListener("pointerup", (e) => putDown(e));
    canvas.addEventListener("pointercancel", (e) => putDown(e, true));
    canvas.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
    canvas.addEventListener("pointerup", (e) => {
      if (this.#mode !== "dollhouse" || !down) return; // (walking: the walker's, below)
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]) > LOOK.drag;
      down = null;
      if (moved) return;
      if (e.button === 2) return this.#emit("menu", { ...(this.pointAt(e.clientX, e.clientY) ?? NOWHERE), door: null,
        clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType });
      if (e.button !== 0) return;
      const p = this.pointAt(e.clientX, e.clientY);
      const pick = new CustomEvent("pick", { cancelable: true, detail: { ...(p ?? NOWHERE), door: null, button: e.button,
        altKey: e.altKey, shiftKey: e.shiftKey, clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType } });
      this.dispatchEvent(pick);
      if (!pick.defaultPrevented) this.select(this.#clicked(e.clientX, e.clientY), { go: false });
    });
    // walking: what the walker says the pointer did
    const w = this.#walker;
    w.addEventListener("click", ({ detail }) => this.#walkClick(detail));
    w.addEventListener("double", ({ detail }) => this.#walkGlide(detail));
    w.addEventListener("menu", ({ detail: d }) => {
      if (this.#mode !== "walk") return;
      const f = this.#floors.get(this.#walkFloor), hit = this.#pointOn(d.clientX, d.clientY);
      const under = f ? this.#doorUnder(f, d.clientX, d.clientY, hit) : null;
      this.#emit("menu", { ...(hit?.point ?? NOWHERE), door: under ? under.door.id : null, clientX: d.clientX, clientY: d.clientY,
        pointerType: d.pointerType });
    });
    w.addEventListener("look", () => { this.#aimFrom = null; });
    w.addEventListener("glide", ({ detail }) => {
      this.#aimFrom = null;
      this.#emit("glide", detail);
    });
  }

  /** Walking: a click at a point of the screen. ``pick`` (cancelable) says what is there and
   * the door within reach there; else that door is opened or shut, or what is there chosen. */
  #walkClick({ clientX, clientY, button, altKey, shiftKey, pointerType }) {
    if (this.#mode !== "walk") return;
    const f = this.#floors.get(this.#walkFloor), hit = this.#pointOn(clientX, clientY);
    const under = f ? this.#doorUnder(f, clientX, clientY, hit) : null;
    const p = hit?.point ?? null;
    const pick = new CustomEvent("pick", { cancelable: true, detail: { ...(p ?? NOWHERE), door: under?.door.id ?? null, button,
      altKey, shiftKey, clientX, clientY, pointerType } });
    this.dispatchEvent(pick);
    clearTimeout(this.#choosing);
    if (pick.defaultPrevented) return;
    if (under) this.#setDoor(f, under.door, !under.door.open); // opened or shut, not chosen
    else if (p?.item) this.select(p.item, { go: false });
    // the floor's room: once it is not the first click of a double-click (which goes there)
    else this.#choosing = setTimeout(() => this.#mode === "walk" && this.select(p?.space ?? null, { go: false }), LOOK.double * 1000);
  }

  #choosing = 0; // walking: a room to be chosen, unless the click was a double-click's first

  /** Walking: a double-click (a double tap) glides to the floor there, as far as nothing is
   * in the way; refused (said by the pointer for a moment, and ``glide``) when something is
   * at once, or nothing of the walker's floor is there. */
  #walkGlide({ clientX, clientY }) {
    if (this.#mode !== "walk") return;
    clearTimeout(this.#choosing); // (its first click chose nothing: it goes there)
    const p = this.pointAt(clientX, clientY);
    const to = p && p.floor === this.#walkFloor ? this.#walker.glideTo(p.x, p.z) : null;
    if (to) return;
    this.#flash(p ? "Something is in the way" : "No floor there", clientX, clientY);
    this.#emit("glide", { state: "refused", x: p?.x ?? null, z: p?.z ?? null });
  }

  /** Walking: a press as it starts (the walker asks): on the item chosen, where items may
   * be carried, the item taken up (the press is not a look). */
  #claim(e) {
    if (!this.#draggable || this.#mode !== "walk" || !this.#selected) return false;
    const p = this.pointAt(e.clientX, e.clientY);
    if (!p?.item || p.item !== this.#selected) return false;
    this.#takeUp(e, p);
    return true;
  }

  /** An item taken up by a press at ``p`` (pointAt's): carried once the press moves. */
  #takeUp(e, p) {
    this.#carry = { id: p.item, floor: this.#floors.get(p.floor), at: [e.clientX, e.clientY], moved: false };
    try {
      this.#renderer.domElement.setPointerCapture?.(e.pointerId);
    } catch {
      // (a pointer no longer down)
    }
  }

  /** The room or item clicked in the dollhouse view: of the floor finishes and the items
   * shown (merged), the one the triangle hit is of. */
  #clicked(clientX, clientY) {
    this.#caster.setFromCamera(this.#ndc(clientX, clientY), this.#camera);
    const targets = [];
    for (const f of this.#floors.values()) {
      if (!f.group.visible) continue;
      for (const m of f.pieces) if (m.visible && m.userData.material === "floor") targets.push(m);
      for (const meshes of Object.values(f.itemMeshes)) for (const m of meshes) if (m.visible) targets.push(m);
    }
    const hit = this.#caster.intersectObjects(targets, false)[0];
    const floor = hit && [...this.#floors.values()].find((f) => f.group === hit.object.parent);
    const g = hit?.object.geometry;
    const id = !floor ? null : hit.object.userData.material === "item" ? floor.itemIds[g.getAttribute("_item").getX(hit.face.a)]
      : floor.rooms[g.getAttribute("_room")?.getX(hit.face.a)];
    return id ?? null;
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  #dispose(group) {
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.isCSS2DObject) o.element.remove();
    });
  }
}

/** The leg each step of a way is on: the start and walks on theirs, a ride on the leg it
 * leaves, the arrival on the last. */
function stepLegs(route) {
  let leg = 0;
  const last = Math.max(0, route.legs.length - 1);
  return (route.steps ?? []).map((s) => {
    if (s.kind === "arrive") return last;
    if (s.kind === "take") return Math.min(last, leg++);
    return Math.min(last, leg);
  });
}
