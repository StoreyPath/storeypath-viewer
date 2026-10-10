// The floor plan in plain SVG: no WebGL, no dependencies, for any machine (VDI
// desktops and kiosks without a GPU). One floor at a time: its spaces and zones,
// walls, doors with their swings, windows and openings, its furniture and
// equipment, with labels that stay upright and readable at any zoom, in any
// language and direction.
//
// The engine draws what it is given (setFloor: the floor model in types.ts) and
// leaves meaning to its host: the host says how each space looks (styleOf), what
// it is called (label), which spaces can be chosen (interactive) and what to do
// when one is (the "select" event). A way through the building (showRoute: a route
// as navigation.js finds it, format 0.8) is drawn over the floor it is on: a line
// that draws itself in and flows the way it goes, a "you are here" dot at its start,
// a pin and a card at its end (its room lit), and a badge where it changes floor; it
// can be stepped through (showStep) and played (playRoute: a dot walks it, floor by
// floor, the view following). A calm look for finding the way ("wayfinding": light
// rooms, quiet walls, muted labels but the way's own) and light or dark colours are
// the page's to ask for. Hooks for tests: the root carries data-cam (k,tx,ty), each
// space data-sp-id (and data-selected when chosen), each item data-sp-item, the pin
// data-sp-pin with data-plan-x/y, the route's lines data-sp-route (and how far drawn,
// data-sp-route-drawn) and its markers data-sp-route-start, -end, -change and -walker
// (with data-plan-x/y), its destination room data-sp-route-room.

import { TYPE_COLORS } from "./colors.js";
import { boundsOf, finite, inside, pathOf, poleOf, round, type Box } from "./geometry.js";
import { glyphOf, ROUTE_GLYPHS } from "./glyphs.js";
import { along, easeInOut, pointAt, rounded, thinned } from "./routegeom.js";
import type { Camera, FloorPlan, PlanItem, PlanOpening, PlanRoute, PlanRouteStep, PlanSpace, SpaceStyle, XY } from "./types.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const ARROW_PX = 72; // without motion: a route's arrows this far apart on the screen
const CORNER_PX = 14; // a route's corners rounded this much on the screen
const LINE_CLEAR = 9; // a label this far from a route's line (half its width with its halo)
const RIDES: Record<string, string> = { lift: "Lift", stairs: "Stairs", escalator: "Escalator", ramp: "Ramp" };
const AROUND: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0.7071, -0.7071], [-0.7071, -0.7071], [0.7071, 0.7071],
  [-0.7071, 0.7071], [0, -1], [0, 1]]; // where a route's marker may be set off its point, in order
const DRAG_PX = 4; // a press that moves less than this is a click
const ANIMATION_MS = 260;
const DRAW_MS = 1000; // a way drawing itself in
const FADE_MS = 320; // one floor fading into the next
const STEP_MS = 520; // the view going to a step
/** Playing a way: the pause at a floor change before and after the floor is shown, and
 * how wide (metres) the view is when it follows the walker. */
const PLAY = { before: 650, after: 500, wide: 42 };

export interface EngineOptions {
  /** A space's label, as lines (default: its name, then its number; else the text its drawing writes in it). */
  label?: (space: PlanSpace) => string | string[] | null;
  /** What a screen reader says for a space that can be chosen (default: its label and type). */
  ariaLabel?: (space: PlanSpace) => string | null;
  /** How a space looks (default: its type's colour). */
  styleOf?: (space: PlanSpace) => SpaceStyle | null;
  /** Which spaces can be clicked or chosen with the keyboard (default: all). */
  interactive?: (space: PlanSpace) => boolean;
  /** A colour per space type, over the defaults. */
  colors?: Record<string, string>;
  /** Animate pans and zooms (default: unless the system asks for reduced motion). */
  motion?: boolean;
  /** Pixels left round the floor when it is fitted. */
  padding?: number;
  /** The closest zoom, in pixels per metre. */
  maxScale?: number;
  /** Show labels. */
  labels?: boolean;
  /** Show the furniture and equipment (default: true). */
  items?: boolean;
  /** Whether items can be clicked or chosen with the keyboard (default: true); when
   * not, a click on one chooses the space under it. */
  interactiveItems?: boolean;
  /** Label size in pixels (set the font with CSS: .sp-labels). */
  labelSize?: number;
  /** What the plan is called, for screen readers. */
  title?: string;
  /** Its colours: "light", "dark", or "auto" (the default: as the system has them). */
  theme?: "auto" | "light" | "dark";
  /** Its look: "default" (each space in its type's colour) or "wayfinding" (calm, for
   * finding the way: light rooms with their type a faint tint, quiet walls and doors,
   * labels muted but the way's own: its start, its end and the places it goes through). */
  style?: "default" | "wayfinding";
}

/** How a route is drawn (showRoute). */
export interface ShowRouteOptions {
  /** A floor's name, for the markers where the route changes floor ("Up to First
   * floor") and its destination's card: by default its ID. */
  floorName?: (floorId: string) => string;
  /** Bring the route on the floor shown into view. */
  fit?: boolean;
  /** The plan's look while the route is shown (the engine's own `style` again after). */
  style?: "default" | "wayfinding";
  /** Draw it in (about a second, its end's pin dropping in as it gets there), then let
   * dots flow along it the way it goes. Default: unless motion is off (the `motion`
   * option, or the system asks for reduced motion: then it is drawn at once, still,
   * arrows along it the way it goes). */
  animate?: boolean;
  /** The dots flowing along it (default: true; never without motion). */
  flow?: boolean;
  /** Its start's label ("You are here"); none by default. */
  startLabel?: string | null;
  /** Its destination's card: by default the name of the room it ends in and its floor
   * ("OFFICE 205 · Floor 2"); null: none (the room's own label then shows). */
  endLabel?: string | null;
  /** What a floor change's tag says, where the way leaves a floor ("to") and where it
   * comes onto one ("from"): by default "Up to Floor 2", "From Ground floor". */
  changeLabel?: (change: PlanRoute["changes"][number], side: "to" | "from") => string;
  /** The spaces whose labels stay clear on a calm plan (default: the way's start and
   * the places it goes through: its lifts and stairs, the corridors it walks along). */
  landmarks?: Iterable<string>;
  /** Another floor's plan, for the engine to show it itself: when a floor change's badge
   * is clicked, a step on another floor is shown, or playing goes on to the next floor
   * (a short cross-fade). Without it a "routefloor" event asks the page, which shows the
   * floor with setFloor. */
  floorPlan?: (floorId: string) => FloorPlan | null | Promise<FloorPlan | null>;
}

/** Playing a way (playRoute). */
export interface PlayRouteOptions {
  /** Metres a second (default: the whole way in about ten seconds, 3 to 14 m/s). */
  speed?: number;
  /** From its start again, rather than from where it was paused. */
  restart?: boolean;
  /** The view follows the walker, framing each floor's part (default: true). */
  follow?: boolean;
}

/** A step of the way shown: the "routestep" event's detail. */
export interface RouteStepDetail {
  index: number;
  step: PlanRouteStep | null;
  /** The leg it is on (its floor's walking). */
  leg: number;
  floor_id: string | null;
}

/** How far a way has been played: the "routeprogress" event's detail. */
export interface RouteProgressDetail {
  /** Metres walked of `total` (the walking alone: rides take no metres). */
  metres: number;
  total: number;
  fraction: number;
  leg: number;
  step: number | null;
  floor_id: string | null;
  /** Where the walker is, in the floor's metres. */
  at: XY;
}

export interface SelectDetail {
  id: string | null;
  /** The space or zone chosen, or the item: one of them, or neither. */
  space: PlanSpace | null;
  item: PlanItem | null;
}

/** How an item is drawn, by its type code's first part (DESK-MANAGER is a desk);
 * others by how they are mounted. */
const ITEM_KINDS: Record<string, string> = { DESK: "desk", SOFA: "sofa", TV: "tv", SCREEN: "tv", COPIER: "copier",
  PRINTER: "copier", ACCESS: "ap", BED: "bed", KIOSK: "kiosk" };
/** What goes with a desk, by the grade it is for: visitors' chairs across it
 * (armchairs for the president's), a return at its side (an L-shaped desk), a
 * cabinet behind its chair, and a high-backed chair. Studio's 3D draws the same. */
interface DeskSet { visitors: number; armchairs?: boolean; return?: boolean; cabinet?: boolean; executive?: boolean }
const DESK_SETS: Record<string, DeskSet> = {
  junior: { visitors: 0 },
  senior: { visitors: 0, return: true },
  section_head: { visitors: 1, return: true },
  manager: { visitors: 2, return: true },
  director: { visitors: 2, return: true, cabinet: true, executive: true },
  c_level: { visitors: 2, return: true, cabinet: true, executive: true },
  president: { visitors: 2, armchairs: true, return: true, cabinet: true, executive: true },
};
const itemKind = (it: PlanItem): string =>
  ITEM_KINDS[(it.type ?? "").split("-")[0]!] ?? (it.mount === "ceiling" ? "round" : "plain");
const fine = (v: number): number => Math.round(v * 1e4) / 1e4;

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

export class FloorPlanEngine extends EventTarget {
  readonly element: HTMLElement;
  readonly svg: SVGSVGElement;
  private opts: EngineOptions;
  private colors: Record<string, string>;
  private plan: FloorPlan | null = null;
  private readonly world: SVGGElement;
  /** The plan and the layers over it, in one box: the plan's <svg>, then the way's line,
   * its marks and the labels, each an <svg> of its own over it (so that what moves on one
   * is drawn again alone: the way's flowing dots do not paint the whole plan again). */
  private readonly box: HTMLDivElement;
  private readonly overlays: SVGSVGElement[];
  private readonly layers: Record<"outline" | "units" | "containers" | "items" | "selection" | "walls" | "openings" | "route", SVGGElement>;
  private readonly routeMarks: SVGGElement;
  private readonly labelLayer: SVGGElement;
  private readonly pinLayer: SVGGElement;
  private paths = new Map<string, SVGPathElement>();
  private labels = new Map<string, { text: SVGTextElement; width: number; height: number; at?: XY }>();
  private measured = false;
  private spaces = new Map<string, PlanSpace>();
  private items = new Map<string, { item: PlanItem; shape: SVGGElement; outline: string }>();
  private boxes = new Map<string, Box>();
  private markers = new Map<string, XY>();
  private floorBox: Box = [0, 0, 1, 1];
  private cam: Camera = { k: 1, tx: 0, ty: 0 };
  private ySign = -1;
  private minScale = 0.01;
  private chosen: string | null = null;
  private lit: Set<string> | null = null;
  private dim = true;
  private pinned: string | null = null;
  private frame = 0;
  private moving = false; // the view is moving to where it was asked to go
  private fitted = false;
  private size = { w: 0, h: 0 };
  private readonly observer: ResizeObserver;
  private pointers = new Map<number, XY>();
  private press: { start: XY; cam: Camera; moved: boolean; target: EventTarget | null } | null = null;
  private pinch: { distance: number; mid: XY; cam: Camera } | null = null;
  private readonly routeLine: SVGGElement; // a way's line, in screen space
  private routed: Routed | null = null; // the way shown
  private routeView: RouteView | null = null; // its parts on the floor shown
  private drawn = 1; // how much of it is drawn in (1: all)
  private drawStart = 0;
  private stepNow: number | null = null; // the step shown (showStep), or playing
  private playing: Playing | null = null;
  private loop = 0; // the way's animation frame
  private labelsOff = new Set<string>(); // labels a marker says instead (the destination's card)

  constructor(container: HTMLElement | string, options: EngineOptions = {}) {
    super();
    const element = typeof container === "string" ? document.querySelector<HTMLElement>(container) : container;
    if (!element) throw new Error(`FloorPlanEngine: container ${String(container)} not found`);
    this.element = element;
    this.opts = { padding: 24, maxScale: 400, labels: true, labelSize: 12, items: true, interactiveItems: true, ...options };
    this.colors = { ...TYPE_COLORS, ...options.colors };
    this.svg = svg("svg", { class: "sp-plan", role: "group", tabindex: 0, "aria-label": options.title ?? "Floor plan" });
    this.world = svg("g", { class: "sp-world" });
    this.layers = {
      outline: svg("g", { class: "sp-outline" }),
      units: svg("g", { class: "sp-units" }),
      containers: svg("g", { class: "sp-containers" }),
      items: svg("g", { class: "sp-items" }), // over the spaces, under the walls and the labels
      selection: svg("g", { class: "sp-selection" }),
      route: svg("g", { class: "sp-route-rooms" }), // a way's destination lit, under the walls
      walls: svg("g", { class: "sp-walls" }),
      openings: svg("g", { class: "sp-openings" }),
    };
    this.world.append(this.layers.outline, this.layers.units, this.layers.containers, this.layers.items, this.layers.selection,
      this.layers.route, this.layers.walls, this.layers.openings);
    // a way, in screen space (as wide, its corners as round and its dots as far apart at
    // any zoom): its line over the walls and doors, its marks over it; both under the labels
    this.routeLine = svg("g", { class: "sp-route" });
    this.routeMarks = svg("g", { class: "sp-route-marks" });
    this.labelLayer = svg("g", { class: "sp-labels", "aria-hidden": "true" });
    this.pinLayer = svg("g", { class: "sp-pin-layer" });
    this.svg.append(this.world);
    const over = (cls: string, ...children: SVGElement[]): SVGSVGElement => {
      const o = svg("svg", { class: `sp-plan sp-layer ${cls}` });
      o.append(...children);
      return o;
    };
    this.overlays = [over("sp-layer-route", this.routeLine), over("sp-layer-marks", this.routeMarks),
      over("sp-layer-labels", this.labelLayer, this.pinLayer)];
    this.overlays[0]!.setAttribute("aria-hidden", "true");
    this.overlays[2]!.setAttribute("aria-hidden", "true");
    this.box = document.createElement("div");
    this.box.className = "sp-plan-box";
    this.box.append(this.svg, ...this.overlays);
    this.looks();
    element.append(this.box);
    this.bind();
    this.observer = new ResizeObserver(() => this.resized());
    this.observer.observe(this.svg);
  }

  // ---- what is shown ----------------------------------------------------------

  /** Draw a floor; fitted unless `fit` is false (then the view stays); with `fade`, the
   * floor shown before fades out over it (unless motion is off). */
  setFloor(plan: FloorPlan, { fit = true, fade = false }: { fit?: boolean; fade?: boolean } = {}): void {
    if (fade && this.plan) this.crossfade();
    this.plan = plan;
    this.ySign = plan.yDown ? 1 : -1;
    if (!this.size.w) {
      const r = this.svg.getBoundingClientRect();
      if (r.width && r.height) this.size = { w: r.width, h: r.height };
    }
    for (const layer of Object.values(this.layers)) layer.replaceChildren();
    this.labelLayer.replaceChildren();
    this.paths.clear();
    this.labels.clear();
    this.spaces.clear();
    this.items.clear();
    this.boxes.clear();
    this.markers.clear();
    const d = plan.drawing ?? {};
    const box = boundsOf(d.outline ?? []);
    if (d.outline?.length) this.layers.outline.append(svg("path", { d: pathOf(d.outline) }));
    for (const s of plan.spaces) {
      if (!s.polygons.length) continue;
      this.spaces.set(s.id, s);
      const b = boundsOf(s.polygons);
      boundsOf(s.polygons, box);
      this.boxes.set(s.id, b);
      this.markers.set(s.id, s.marker && inside(s.polygons, s.marker) ? s.marker : poleOf(s.polygons, Math.max(0.02, (b[2] - b[0]) / 200)));
      const path = svg("path", { d: pathOf(s.polygons), "data-sp-id": s.id, "data-sp-kind": s.kind ?? "space" });
      if (this.interactive(s)) {
        path.setAttribute("tabindex", "0");
        path.setAttribute("role", "button");
        const said = this.opts.ariaLabel ? this.opts.ariaLabel(s) : this.lines(s).join(" ") || s.type || s.id;
        if (said) path.setAttribute("aria-label", said);
      }
      this.layers.units.append(path);
      this.paths.set(s.id, path);
      const lines = this.lines(s);
      if (lines.length) this.labels.set(s.id, this.makeLabel(lines));
    }
    this.measureLabels();
    for (const c of d.containers ?? []) this.layers.containers.append(svg("path", { d: pathOf(c.polygons), "data-sp-container": c.id }));
    if (d.walls?.length) this.layers.walls.append(svg("path", { class: "sp-wall", d: pathOf(d.walls) }));
    if (d.parapets?.length) this.layers.walls.append(svg("path", { class: "sp-parapet", d: pathOf(d.parapets) }));
    for (const o of d.openings ?? []) this.layers.openings.append(...this.drawOpening(o));
    for (const it of plan.items ?? []) this.drawItem(it);
    this.showItems();
    this.floorBox = finite(box) ? box : [0, 0, 1, 1];
    if (this.chosen && !this.spaces.has(this.chosen) && !this.items.has(this.chosen)) this.chosen = null;
    if (this.pinned && !this.spaces.has(this.pinned)) this.pinned = null;
    this.restyle();
    this.buildRoute();
    if (fit || !this.fitted) this.fit({ animate: false });
    else this.apply();
    this.dispatchEvent(new CustomEvent<{ id: string | null }>("floorchange", { detail: { id: plan.id ?? null } }));
  }

  /** Change options (a new styleOf, label, colours…) and draw again what they change. */
  setOptions(options: EngineOptions): void {
    this.opts = { ...this.opts, ...options };
    if (options.colors) this.colors = { ...TYPE_COLORS, ...options.colors };
    this.looks();
    if (this.plan && (options.label || options.ariaLabel || options.interactive || options.labelSize
      || options.interactiveItems !== undefined)) {
      this.setFloor(this.plan, { fit: false });
    } else {
      this.showItems();
      this.restyle();
      this.apply();
    }
  }

  /** Show the furniture and equipment, or not (a chosen item is let go). */
  setItems(on: boolean): void {
    this.opts.items = on;
    this.showItems();
  }

  get itemsShown(): boolean {
    return this.opts.items !== false;
  }

  /** Apply styleOf again (the host's data changed: blocks, occupants…). */
  restyle(): void {
    for (const [id, path] of this.paths) {
      const s = this.spaces.get(id)!;
      const style: SpaceStyle = this.opts.styleOf?.(s) ?? {};
      const classes = ["sp-unit", `sp-type-${s.type ?? "unspecified"}`];
      if (s.kind === "zone") classes.push("sp-zone");
      if (style.className) classes.push(style.className);
      if (this.lit) classes.push(this.lit.has(id) ? "sp-highlight" : this.dim ? "sp-dim" : "");
      if (id === this.chosen) classes.push("sp-selected");
      path.setAttribute("class", classes.filter(Boolean).join(" "));
      path.style.cssText = "";
      path.style.fill = style.fill ?? (style.className ? "" : this.colors[s.type ?? "unspecified"] ?? this.colors.unspecified ?? "");
      if (style.stroke) path.style.stroke = style.stroke;
      if (style.opacity !== undefined) path.style.opacity = String(style.opacity);
      if (style.style) path.style.cssText += `;${style.style}`;
      if (id === this.chosen) path.setAttribute("data-selected", "true");
      else path.removeAttribute("data-selected");
    }
    for (const [id, { shape }] of this.items) {
      shape.classList.toggle("sp-selected", id === this.chosen);
      if (id === this.chosen) shape.setAttribute("data-selected", "true");
      else shape.removeAttribute("data-selected");
    }
    // the chosen space's (or item's) outline over its neighbours' (a copy: moving the
    // space itself would take the keyboard focus off it)
    const d = this.chosen ? this.paths.get(this.chosen)?.getAttribute("d") ?? this.items.get(this.chosen)?.outline : undefined;
    this.layers.selection.replaceChildren(...(d ? [svg("path", { d })] : []));
  }

  // ---- choosing --------------------------------------------------------------

  get selected(): string | null {
    return this.chosen;
  }

  /** Choose a space or an item (or none). `focus`: bring it into view, panning only, or zooming to it. */
  select(id: string | null, { focus = false }: { focus?: false | "pan" | "zoom" } = {}): boolean {
    if (id !== null && !this.spaces.has(id) && !(this.items.has(id) && this.itemsShown)) return false;
    this.chosen = id;
    this.restyle();
    if (id && focus) this.focus(id, { zoom: focus === "zoom" });
    return true;
  }

  /** Bring out some spaces (and dim the rest), or none. */
  highlight(ids: Iterable<string> | null, { dim = true }: { dim?: boolean } = {}): void {
    this.lit = ids ? new Set(ids) : null;
    this.dim = dim;
    this.restyle();
  }

  /** A pin in a space (inside it, wherever its shape bends), or none. */
  setPin(id: string | null): void {
    this.pinned = id && this.spaces.has(id) ? id : null;
    this.drawPin();
  }

  // ---- a way through the building --------------------------------------------

  /** Draw a way (as route() in navigation.js finds it, or any PlanRoute) over the floor
   * shown: its line, drawn in and flowing the way it goes (`animate`), a "you are here"
   * dot at its start, a pin and a card at its end with its room lit, and a badge where it
   * changes floor ("Up to Floor 2": a click shows that floor). Kept when another floor
   * is shown: its legs on that floor are drawn then. Null: none. */
  showRoute(route: PlanRoute | null, options: ShowRouteOptions = {}): void {
    this.endPlay("stopped");
    this.stepNow = null;
    this.routed = route ? {
      route, options, floorName: options.floorName ?? ((id) => id),
      lengths: route.legs.map((l) => along(l.points)), stepLegs: stepLegsOf(route),
    } : null;
    this.drawn = route && (options.animate ?? true) && this.motion() ? 0 : 1;
    this.drawStart = performance.now();
    this.looks();
    this.buildRoute();
    this.placeLabels();
    this.placeRoute();
    if (route && options.fit) this.fitRoute();
    if (this.drawn < 1) this.kick();
  }

  /** Take the way away (and stop playing it). */
  clearRoute(): void {
    this.showRoute(null);
  }

  /** The way shown, or null. */
  get route(): PlanRoute | null {
    return this.routed?.route ?? null;
  }

  /** The way on the floor shown in view (nothing when it is not on this floor). */
  fitRoute({ animate = true }: { animate?: boolean } = {}): void {
    const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const { points } of this.routeView?.legs ?? []) boundsOf([[points]], box);
    if (!finite(box)) return;
    const pad = 1; // metres round it, and room on the screen for its marks and tags
    this.fitBox([box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad], animate, false, 56);
  }

  /** The step shown (showStep, or where playing has got to), or null. */
  get routeStep(): number | null {
    return this.stepNow;
  }

  /** Show a step of the way (route()'s `steps`): its floor (cross-faded to, through
   * `floorPlan` or the page's "routefloor"), framed: the start and the first metres, a
   * walk whole, the lift or stairs to take, the destination and the way into it. Says
   * so ("routestep"). Resolves once it is shown. */
  async showStep(index: number, { animate = true }: { animate?: boolean } = {}): Promise<void> {
    const r = this.routed;
    const steps = r?.route.steps ?? [];
    if (!r || !Number.isInteger(index) || index < 0 || index >= steps.length) return;
    if (this.playing) this.endPlay("stopped");
    this.stepNow = index;
    const leg = r.stepLegs[index] ?? 0;
    this.emitStep();
    const floor = r.route.legs[leg]?.floor_id;
    if (!floor || !(await this.goToFloor(floor, "step", animate)) || this.stepNow !== index) return;
    this.svg.setAttribute("data-sp-route-step", String(index));
    this.frameStep(index, animate);
  }

  /** Show a leg of the way (its walking on one floor) whole, its floor cross-faded to. */
  async showLeg(index: number, { animate = true }: { animate?: boolean } = {}): Promise<void> {
    const r = this.routed, leg = r?.route.legs[index];
    if (!r || !leg) return;
    if (this.playing) this.endPlay("stopped");
    if (!(await this.goToFloor(leg.floor_id, "step", animate))) return;
    this.frameBox(this.legBox(index, 0, Infinity), animate);
  }

  /** Play the way: a dot walks it at a steady pace, floor by floor (a pause at each lift
   * or stairs, then the next floor cross-faded to), the view following it; says how far
   * it has got ("routeprogress", and "routestep" as it reaches each step) and when it
   * plays, pauses, stops or ends ("routeplay"). Again after pauseRoute: on from there.
   * Without motion, its steps one after another instead. Resolves when it ends or is
   * stopped. Other floors need `floorPlan` (or the page's "routefloor"). */
  playRoute({ speed, restart = false, follow = true }: PlayRouteOptions = {}): Promise<void> {
    const r = this.routed;
    if (!r || !r.route.legs.length) return Promise.resolve();
    const p = this.playing;
    if (p && !restart) {
      if (p.state === "paused") {
        p.state = "playing";
        p.last = performance.now();
        this.emitPlay("playing");
        this.kick();
      }
      return p.promise;
    }
    if (p) this.endPlay("stopped");
    const total = r.lengths.reduce((sum, l) => sum + (l[l.length - 1] ?? 0), 0);
    let resolve: () => void = () => {};
    const promise = new Promise<void>((res) => (resolve = res));
    this.playing = { state: "playing", steps: !this.motion(), leg: 0, s: 0, metres: 0, total,
      speed: speed && speed > 0 ? speed : Math.min(14, Math.max(3, total / 10)), phase: "begin", wait: 0,
      last: performance.now(), follow, k: 0, resolve, promise, step: -1 };
    this.drawn = 1;
    this.emitPlay("playing");
    this.kick();
    return promise;
  }

  /** Pause playing (playRoute goes on from there). */
  pauseRoute(): void {
    const p = this.playing;
    if (!p || p.state !== "playing") return;
    p.state = "paused";
    this.emitPlay("paused");
  }

  /** Stop playing: the walker taken away. */
  stopRoute(): void {
    this.endPlay("stopped");
  }

  /** Whether the way is "playing" or "paused", or null. */
  get routePlay(): "playing" | "paused" | null {
    return this.playing?.state ?? null;
  }

  /** Where a space's label and pin go: a point inside it (drawing metres). */
  markerOf(id: string): XY | null {
    return this.markers.get(id) ?? null;
  }

  // ---- the view --------------------------------------------------------------

  /** The view: screen = (x·k + tx, ±y·k + ty) in CSS pixels. */
  camera(): Camera {
    return { ...this.cam };
  }

  setCamera(cam: Camera, { animate = false }: { animate?: boolean } = {}): void {
    this.moveTo(cam, animate);
  }

  /** Where a point of the plan is on the screen (CSS pixels from the plan's corner). */
  toScreen(p: XY): XY {
    return [p[0] * this.cam.k + this.cam.tx, this.ySign * p[1] * this.cam.k + this.cam.ty];
  }

  toPlan(s: XY): XY {
    return [(s[0] - this.cam.tx) / this.cam.k, (s[1] - this.cam.ty) / (this.ySign * this.cam.k)];
  }

  /** The whole floor in view. */
  fit({ animate = true }: { animate?: boolean } = {}): void {
    this.fitBox(this.floorBox, animate, true);
  }

  /** Some spaces in view. */
  fitTo(ids: Iterable<string>, { animate = true }: { animate?: boolean } = {}): void {
    const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const id of ids) {
      const b = this.boxes.get(id);
      if (!b) continue;
      box[0] = Math.min(box[0], b[0]); box[1] = Math.min(box[1], b[1]);
      box[2] = Math.max(box[2], b[2]); box[3] = Math.max(box[3], b[3]);
    }
    if (finite(box)) this.fitBox(box, animate, false);
  }

  /** A space in view: its marker in the middle, at the same zoom; or zoomed to it. */
  focus(id: string, { zoom = false, animate = true }: { zoom?: boolean; animate?: boolean } = {}): void {
    if (zoom) return this.fitTo([id], { animate });
    const m = this.markers.get(id);
    if (!m) return;
    const { k } = this.cam;
    this.moveTo({ k, tx: this.size.w / 2 - k * m[0], ty: this.size.h / 2 - this.ySign * k * m[1] }, animate);
  }

  /** Zoom by a factor, keeping a screen point still (the middle unless given). */
  zoomBy(factor: number, at?: XY, { animate = false }: { animate?: boolean } = {}): void {
    const point: XY = at ?? [this.size.w / 2, this.size.h / 2];
    const k = this.clampScale(this.cam.k * factor);
    const p = this.toPlan(point);
    this.moveTo({ k, tx: point[0] - k * p[0], ty: point[1] - this.ySign * k * p[1] }, animate);
  }

  destroy(): void {
    this.endPlay("stopped");
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.loop);
    this.observer.disconnect();
    this.box.remove();
  }

  // ---- inside ----------------------------------------------------------------

  private interactive(s: PlanSpace): boolean {
    return this.opts.interactive ? this.opts.interactive(s) : true;
  }

  private lines(s: PlanSpace): string[] {
    if (this.opts.label) {
      const l = this.opts.label(s);
      return l === null ? [] : (Array.isArray(l) ? l : [l]).filter((x) => x && x.trim());
    }
    const name = s.name?.trim() ?? "";
    const number = s.number?.trim() ?? "";
    if (!name && !number) return s.label?.trim() ? [s.label.trim()] : [];
    return [name, number && number !== name ? number : ""].filter(Boolean);
  }

  private makeLabel(lines: string[]): { text: SVGTextElement; width: number; height: number } {
    const size = this.opts.labelSize ?? 12;
    const text = svg("text", { "text-anchor": "middle", "font-size": size });
    lines.forEach((line, i) => {
      const t = svg("tspan", { x: 0, dy: i === 0 ? `${(-(lines.length - 1) / 2) * 1.15 + 0.35}em` : "1.15em" });
      if (i > 0) t.setAttribute("class", "sp-label-sub");
      t.textContent = line;
      text.append(t);
    });
    this.labelLayer.append(text);
    // a first guess, until measured: the label shows only where its space is big enough
    const width = Math.max(...lines.map((l) => l.length)) * size * 0.62;
    return { text, width, height: lines.length * size * 1.2 };
  }

  /** The labels' real sizes, as the browser lays them out (once the plan is shown). */
  private measureLabels(): void {
    this.measured = false;
    if (!this.svg.isConnected) return;
    for (const label of this.labels.values()) {
      try {
        const box = label.text.getBBox();
        if (box.width > 0) {
          label.width = box.width + 4; // the halo
          label.height = box.height + 2;
          this.measured = true;
        }
      } catch {
        // not laid out (the plan is not shown): keep the guess
      }
    }
  }

  private drawOpening(o: PlanOpening): SVGElement[] {
    const out: SVGElement[] = [];
    const cls = o.type === "window" ? "sp-window" : o.type === "opening" ? "sp-way" : "sp-door";
    if (o.type === "door" && o.span && o.swings?.length) {
      for (const [h, q] of o.swings) {
        const from = (p: XY): number => Math.hypot(p[0] - h[0], p[1] - h[1]);
        const jamb = from(o.span[0]) > from(o.span[1]) ? o.span[0] : o.span[1]; // the other side
        const r = from(q);
        const k = r / (from(jamb) || 1);
        const shut: XY = [h[0] + (jamb[0] - h[0]) * k, h[1] + (jamb[1] - h[1]) * k];
        const sweep = (q[0] - h[0]) * (shut[1] - h[1]) - (q[1] - h[1]) * (shut[0] - h[0]) > 0 ? 1 : 0;
        out.push(svg("path", {
          class: "sp-door sp-swing", "data-sp-opening": o.id,
          d: `M${round(h[0])},${round(h[1])}L${round(q[0])},${round(q[1])}A${round(r)},${round(r)} 0 0 ${sweep} ${round(shut[0])},${round(shut[1])}`,
        }));
      }
    } else if (o.span) {
      out.push(svg("line", { class: cls, "data-sp-opening": o.id, x1: round(o.span[0][0]), y1: round(o.span[0][1]),
        x2: round(o.span[1][0]), y2: round(o.span[1][1]) }));
    }
    return out;
  }

  /** An item: its footprint in its colour, its front edge darker, and a mark of its
   * kind, drawn in its own frame (x along its width, y towards its front); round
   * ones (on the ceiling) a circle, upright on the screen whatever the plan's y. */
  private drawItem(it: PlanItem): void {
    const len = Math.hypot(it.front[0], it.front[1]) || 1;
    const f: XY = [it.front[0] / len, it.front[1] / len], u: XY = [-f[1], f[0]];
    const w = it.width, d = it.depth, kind = itemKind(it);
    const circle = kind === "ap" || kind === "round";
    const classes = ["sp-item", `sp-item-${kind}`, it.mount === "ceiling" && "sp-item-overhead",
      this.opts.interactiveItems === false && "sp-item-passive"];
    const g = svg("g", { class: classes.filter(Boolean).join(" "), "data-sp-item": it.id });
    const mark = (tag: "path" | "rect" | "line" | "circle", attrs: Record<string, string | number>, cls = "sp-item-mark") =>
      g.appendChild(svg(tag, { class: cls, ...attrs }));
    // its colour as one property's value, never as CSS of its own
    const body = (tag: "rect" | "circle", attrs: Record<string, string | number>): void => {
      mark(tag, attrs, "sp-item-body").style.fill = it.color ?? "";
    };
    let ring: XY[];
    if (circle) {
      const r = Math.max(Math.min(w, d) / 2, 0.3); // big enough to see
      g.setAttribute("transform", `translate(${round(it.at[0])},${round(it.at[1])}) scale(1,${this.ySign})`);
      body("circle", { r: round(r) });
      if (kind === "ap") { // a dot and two arcs over it: wifi
        const at = 0.35 * r;
        mark("circle", { cy: round(at), r: round(0.09 * r) }, "sp-item-dot");
        for (const q of [0.3 * r, 0.58 * r]) {
          const s = q * Math.SQRT1_2;
          mark("path", { d: `M${round(-s)},${round(at - s)}A${round(q)},${round(q)} 0 0 1 ${round(s)},${round(at - s)}` });
        }
      }
      ring = Array.from({ length: 24 }, (_, i): XY => [it.at[0] + r * Math.cos((i * Math.PI) / 12), it.at[1] + r * Math.sin((i * Math.PI) / 12)]);
    } else {
      g.setAttribute("transform", `matrix(${fine(u[0])} ${fine(u[1])} ${fine(f[0])} ${fine(f[1])} ${round(it.at[0])} ${round(it.at[1])})`);
      body("rect", { x: round(-w / 2), y: round(-d / 2), width: round(w), height: round(d) });
      if (kind === "desk") { // its chair, before it, and what goes with a desk of its grade
        const set = DESK_SETS[it.grade ?? ""] ?? DESK_SETS.junior!;
        // the return, at its side towards its user; the cabinet behind the chair
        if (set.return) body("rect", { x: round(w / 2 - Math.min(0.45, w / 3)), y: round(d / 2), width: round(Math.min(0.45, w / 3)), height: 0.8 });
        if (set.cabinet) body("rect", { x: round(-w * 0.45), y: round(d / 2 + 0.95), width: round(w * 0.9), height: 0.45 });
        const chair = (x: number, y: number, cw: number, cd: number, back: number) => { // its back at y + cd
          mark("rect", { x: round(x - cw / 2), y: round(y), width: round(cw), height: round(cd), rx: 0.08 }, "sp-item-chair");
          mark("rect", { x: round(x - cw / 2), y: round(y + cd - back), width: round(cw), height: round(back), rx: 0.04 }, "sp-item-chair sp-item-back");
        };
        if (set.executive) chair(0, d / 2 + 0.08, 0.6, 0.62, 0.14);
        else mark("rect", { x: -0.22, y: round(d / 2 + 0.1), width: 0.44, height: 0.42, rx: 0.1 }, "sp-item-chair");
        // visitors across it, facing its user: their backs away from it
        const vw = set.armchairs ? 0.7 : 0.46, vd = set.armchairs ? 0.62 : 0.46;
        const xs = set.visitors === 1 ? [0] : set.visitors === 2 ? [-1, 1].map((s) => s * Math.max(vw / 2 + 0.06, Math.min(w / 4, 0.6))) : [];
        for (const x of xs) {
          mark("rect", { x: round(x - vw / 2), y: round(-d / 2 - 0.15 - vd), width: round(vw), height: round(vd), rx: 0.08 }, "sp-item-chair sp-item-visitor");
          mark("rect", { x: round(x - vw / 2), y: round(-d / 2 - 0.15 - vd), width: round(vw), height: 0.12, rx: 0.04 }, "sp-item-chair sp-item-back");
        }
      } else if (kind === "sofa") { // its seat, between the arms and before the back
        const arm = Math.min(0.2, w / 6), back = Math.min(0.22, d / 3);
        mark("rect", { x: round(-w / 2 + arm), y: round(-d / 2 + back), width: round(w - 2 * arm), height: round(d - back) });
      } else if (kind === "tv") { // what it faces
        mark("path", { d: `M${round(-w * 0.3)},${round(d / 2)}L0,${round(d / 2 + Math.min(0.5, w * 0.3))}L${round(w * 0.3)},${round(d / 2)}` },
          "sp-item-mark sp-item-view");
      } else if (kind === "bed") { // its headboard, its pillows against it, and where the covers turn down
        const head = Math.min(0.08, d / 20), back = -d / 2 + head;
        mark("line", { x1: round(-w / 2), y1: round(back), x2: round(w / 2), y2: round(back) });
        const n = w >= 1.3 ? 2 : 1, gap = 0.08, pw = (w - 0.12 - gap * (n - 1)) / n;
        for (let i = 0; i < n; i++) {
          mark("rect", { x: round(-w / 2 + 0.06 + i * (pw + gap)), y: round(back + 0.06), width: round(pw), height: 0.4, rx: 0.08 });
        }
        mark("line", { x1: round(-w / 2), y1: round(back + 0.62), x2: round(w / 2), y2: round(back + 0.62) });
      } else if (kind === "kiosk") { // its screen along its front, and the way it faces
        const t = Math.min(0.08, d / 4), m = Math.min(0.06, w / 8);
        mark("rect", { x: round(-w / 2 + m), y: round(d / 2 - t), width: round(w - 2 * m), height: round(t) }, "sp-item-screen");
        mark("path", { d: `M${round(-w * 0.3)},${round(d / 2)}L0,${round(d / 2 + Math.min(0.5, w * 0.6))}L${round(w * 0.3)},${round(d / 2)}` },
          "sp-item-mark sp-item-view");
      } else if (kind === "copier") { // its lid
        const m = Math.min(0.08, w / 8, d / 8);
        mark("rect", { x: round(-w / 2 + m), y: round(-d / 2 + m), width: round(w - 2 * m), height: round((d - 2 * m) * 0.6) });
      }
      mark("line", { x1: round(-w / 2), y1: round(d / 2), x2: round(w / 2), y2: round(d / 2) }, "sp-item-front");
      ring = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([a, b]): XY => [
        it.at[0] + (a * w * u[0] + b * d * f[0]) / 2, it.at[1] + (a * w * u[1] + b * d * f[1]) / 2]);
    }
    const said = [it.name, it.type].find((x) => x) ?? it.id;
    if (this.opts.interactiveItems !== false) {
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", said);
    }
    const title = svg("title");
    title.textContent = said;
    g.prepend(title);
    this.layers.items.append(g);
    this.items.set(it.id, { item: it, shape: g, outline: pathOf([[[...ring, ring[0]!]]]) });
    this.markers.set(it.id, it.at);
    this.boxes.set(it.id, boundsOf([[ring]]));
  }

  /** The items' layer shown or not; a chosen item hidden is let go. */
  private showItems(): void {
    this.layers.items.style.display = this.itemsShown ? "" : "none";
    if (!this.itemsShown && this.chosen && this.items.has(this.chosen)) {
      this.chosen = null;
      this.restyle();
    }
  }

  // ---- a way: drawn, stepped through, played --------------------------------------

  /** Whether moves and the way are animated: as asked (`motion`), else unless the system
   * asks for reduced motion. */
  private motion(): boolean {
    return this.opts.motion ?? !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }

  /** The plan's look and colours as classes on it: its style (the way's, while one is
   * shown and asks for one), its theme, and whether it moves. */
  private looks(): void {
    const style = (this.routed && this.routed.options.style) || this.opts.style || "default";
    const theme = this.opts.theme ?? "auto";
    for (const el of [this.svg, ...this.overlays]) {
      const c = el.classList;
      c.toggle("sp-style-wayfinding", style === "wayfinding");
      c.toggle("sp-theme-light", theme === "light");
      c.toggle("sp-theme-dark", theme === "dark");
      c.toggle("sp-still", !this.motion());
    }
  }

  /** The unit (zone, or space with no zones) a point of the floor is in: the smallest. */
  private unitAt(p: XY): string | null {
    let best: string | null = null, area = Infinity;
    for (const [id, s] of this.spaces) {
      const b = this.boxes.get(id)!;
      if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3] || !inside(s.polygons, p)) continue;
      const a = (b[2] - b[0]) * (b[3] - b[1]);
      if (a < area) {
        area = a;
        best = id;
      }
    }
    return best;
  }

  /** A place a step names, as a unit of this floor (a zone, or a space with no zones). */
  private unitOf(place: string | null | undefined): string | null {
    return place && this.spaces.has(place) ? place : null;
  }

  /** The way's parts on the floor shown, made again (a way shown, or another floor): its
   * legs' lines, its markers, its destination lit, and the labels it keeps clear. */
  private buildRoute(): void {
    this.routeLine.replaceChildren();
    this.routeMarks.replaceChildren();
    this.layers.route.replaceChildren();
    this.routeLine.removeAttribute("data-sp-route");
    this.routeLine.removeAttribute("data-sp-route-drawn");
    this.svg.removeAttribute("data-sp-route-step");
    this.labelsOff.clear();
    for (const { text } of this.labels.values()) text.classList.remove("sp-label-strong");
    this.routeView = null;
    const r = this.routed, floor = this.plan?.id;
    if (!r || floor === undefined) return;
    const { legs, changes } = r.route;
    const steps = r.route.steps ?? [];
    const v: RouteView = { legs: [], start: null, end: null, changes: [], walker: null, room: null, instant: this.drawn >= 1 };
    legs.forEach((leg, index) => {
      if (leg.floor_id !== floor || !leg.points.length) return;
      const g = svg("g", { class: "sp-route-leg", "data-leg": index });
      const line = (cls: string, unit: boolean): SVGPathElement => g.appendChild(svg("path", unit ? { class: cls, pathLength: 1 } : { class: cls }));
      v.legs.push({ index, points: leg.points, g, halo: line("sp-route-halo", true), casing: line("sp-route-casing", true),
        core: line("sp-route-line", true), done: line("sp-route-done", true), flow: line("sp-route-flow", false),
        arrows: g.appendChild(svg("g", { class: "sp-route-arrows" })) });
      this.routeLine.append(g);
    });
    if (!v.legs.length) return;
    this.routeView = v;
    this.routeLine.setAttribute("data-sp-route", String(v.legs.length));
    const last = legs.length - 1;
    const strong = new Set<string>();
    const arrive = steps.find((s) => s.kind === "arrive");
    for (const lv of v.legs) {
      const first = lv.points[0]!, end = lv.points[lv.points.length - 1]!;
      if (lv.index === 0) {
        v.start = this.makeStart(first, r.options.startLabel ?? null);
        const at = this.unitOf(steps[0]?.kind === "start" ? steps[0].place : null) ?? this.unitAt(first);
        if (at) strong.add(at);
      }
      if (lv.index === last) {
        const room = this.unitOf(arrive?.place) ?? this.unitAt(end);
        const text = r.options.endLabel === undefined ? this.endText(room, legs[last]!.floor_id) : r.options.endLabel;
        v.end = this.makeEnd(end, text);
        if (room) {
          v.room = this.makeRoom(room);
          if (v.end.card) this.labelsOff.add(room);
          else strong.add(room);
        }
      }
      if (lv.index > 0 && changes[lv.index - 1]) v.changes.push(this.makeChange(changes[lv.index - 1]!, "from", first, lv.index - 1));
      if (lv.index < last && changes[lv.index]) v.changes.push(this.makeChange(changes[lv.index]!, "to", end, lv.index));
    }
    // the lifts and stairs: their badges say so; the corridors it goes along, clear
    for (const c of v.changes) {
      const at = this.unitAt(c.p);
      if (at) this.labelsOff.add(at);
    }
    for (const s of steps) {
      if (s.kind === "walk" && s.floor_id === floor) {
        const along = this.unitOf(s.along);
        if (along) strong.add(along);
      }
    }
    const keep = r.options.landmarks ? new Set(r.options.landmarks) : strong;
    for (const [id, { text }] of this.labels) text.classList.toggle("sp-label-strong", keep.has(id) && !this.labelsOff.has(id));
    // in order: the floor changes, the start, the end over them; the walker over all
    this.routeMarks.append(...v.changes.map((c) => c.g), ...(v.start ? [v.start.g] : []), ...(v.end ? [v.end.g] : []));
    if (this.playing) this.placeWalker();
    this.reveal();
  }

  /** What a destination's card says: its room's name and its floor. */
  private endText(room: string | null, floor: string): string | null {
    const s = room ? this.spaces.get(room) : null;
    const name = s ? this.lines(s).join(" ") : "";
    const where = this.routed?.floorName(floor) ?? floor;
    return name ? `${name} · ${where}` : where;
  }

  /** A mark's group at a point of the plan (placed on the screen by placeRoute). */
  private mark(cls: string, p: XY, attrs: Record<string, string | number> = {}): SVGGElement {
    return svg("g", { class: cls, "data-plan-x": round(p[0]), "data-plan-y": round(p[1]), ...attrs });
  }

  /** "You are here": a dot, a soft halo pulsing round it, and its label if any. */
  private makeStart(p: XY, label: string | null): MarkView & { chip: Chip | null } {
    const g = this.mark("sp-route-start", p, { "data-sp-route-start": "" });
    const dot = g.appendChild(svg("g", { class: "sp-route-start-mark sp-enter" }));
    dot.append(svg("circle", { class: "sp-route-start-pulse", r: 9 }), svg("circle", { class: "sp-route-start-halo", r: 15 }),
      svg("circle", { class: "sp-route-start-ring", r: 9 }), svg("circle", { class: "sp-route-start-dot", r: 5.5 }));
    titled(g, label ?? "Start");
    const chip = label ? this.makeChip(g, label, "sp-route-start-chip") : null;
    return { g, p, chip };
  }

  /** A tag of text on a rounded card, measured: its group, size and text. */
  private makeChip(parent: SVGGElement, text: string, cls: string, sub: string | null = null): Chip {
    const g = parent.appendChild(svg("g", { class: `sp-route-chip ${cls}` }));
    const inner = g.appendChild(svg("g", { class: "sp-route-chip-in sp-enter" }));
    const bg = inner.appendChild(svg("rect", { class: "sp-route-chip-bg", rx: 8, height: 24, y: -12 }));
    const t = inner.appendChild(svg("text", { class: "sp-route-chip-text", "dominant-baseline": "central", y: 0.5 }));
    const main = t.appendChild(svg("tspan", { class: "sp-route-chip-title" }));
    main.textContent = text;
    if (sub) {
      const s = t.appendChild(svg("tspan", { class: "sp-route-chip-sub" }));
      s.textContent = ` · ${sub}`;
    }
    let width = (text.length + (sub ? sub.length + 3 : 0)) * 6.6;
    try {
      const w = t.getComputedTextLength();
      if (w > 0) width = w;
    } catch {
      // not laid out (the plan is not shown): the guess
    }
    width = Math.ceil(width + 20);
    bg.setAttribute("width", String(width));
    t.setAttribute("x", "10");
    return { g, width, height: 24 };
  }

  /** The destination: a pin on its point, and a card naming it (or none). */
  private makeEnd(p: XY, text: string | null): MarkView & { pin: SVGGElement; leader: SVGLineElement; at: SVGCircleElement; card: Chip | null } {
    const g = this.mark("sp-route-end", p, { "data-sp-route-end": "" });
    const leader = g.appendChild(svg("line", { class: "sp-route-leader", x1: 0, y1: 0, x2: 0, y2: 0 }));
    const at = g.appendChild(svg("circle", { class: "sp-route-end-at", r: 4 }));
    const pin = g.appendChild(svg("g", { class: "sp-route-end-pin" }));
    const drop = svg("g", { class: "sp-route-end-drop sp-enter" });
    drop.append(svg("path", { class: "sp-route-end-body", d: "M0,0C-2.6,-6.5 -11,-11.5 -11,-20.5A11,11 0 1 1 11,-20.5C11,-11.5 2.6,-6.5 0,0Z" }),
      svg("circle", { class: "sp-route-end-dot", cx: 0, cy: -20.5, r: 4.4 }));
    pin.append(svg("ellipse", { class: "sp-route-end-shadow sp-enter", rx: 6.5, ry: 2.4 }), drop);
    titled(g, text ?? "Destination");
    let card: Chip | null = null;
    if (text) {
      const [title, ...rest] = text.split(" · ");
      card = this.makeChip(g, title!, "sp-route-card", rest.length ? rest.join(" · ") : null);
    }
    return { g, p, pin, leader, at, card };
  }

  /** A floor change: a round badge with the lift's or stairs' picture, and a tag saying
   * where it goes ("Up to Floor 2") or where it comes from; a button: it shows that floor. */
  private makeChange(c: PlanRoute["changes"][number], side: "to" | "from", p: XY, index: number): ChangeView {
    const r = this.routed!;
    const floor = side === "to" ? c.to_floor_id : c.from_floor_id;
    const text = r.options.changeLabel?.(c, side) ?? changeText(c, side, r.floorName);
    const ride = RIDES[c.by] ?? c.by;
    const said = side === "to" ? `${ride}: ${text}` : `${text}, by the ${c.by}`;
    const g = this.mark("sp-route-change", p, { "data-sp-route-change": side, "data-floor": floor, "data-change": index,
      role: "button", tabindex: 0, "aria-label": `${said}: show ${r.floorName(floor)}` });
    const leader = g.appendChild(svg("line", { class: "sp-route-leader", x1: 0, y1: 0, x2: 0, y2: 0 }));
    const badge = g.appendChild(svg("g", { class: "sp-route-badge sp-enter" }));
    badge.append(svg("circle", { class: "sp-route-badge-ring", r: 13 }),
      svg("path", { class: "sp-route-badge-glyph", d: glyphOf(c.by), transform: "translate(-7.2,-7.2) scale(0.6)" }));
    const dir = c.direction === "up" || c.direction === "down" ? c.direction : null;
    const chip = this.makeChip(g, text, "sp-route-change-chip");
    if (dir && side === "to") { // which way: an arrow before its words
      const arrow = svg("path", { class: "sp-route-chip-arrow", d: ROUTE_GLYPHS[dir]!, transform: "translate(8,-6) scale(0.5)" });
      const text = chip.g.querySelector("text")!;
      text.parentNode!.insertBefore(arrow, text);
      text.setAttribute("x", "24");
      chip.width += 14;
      chip.g.querySelector("rect")!.setAttribute("width", String(chip.width));
    }
    titled(g, said);
    return { g, p, side, change: c, floor, index, leader, chip };
  }

  /** The destination's room lit: tinted, outlined, and a ring pulsing out of it once. */
  private makeRoom(id: string): SVGGElement {
    const d = this.paths.get(id)?.getAttribute("d") ?? "";
    const g = svg("g", { class: "sp-route-room", "data-sp-route-room": id });
    g.append(svg("path", { class: "sp-route-room-fill", d }), svg("path", { class: "sp-route-room-pulse", d }),
      svg("path", { class: "sp-route-room-edge", d }));
    this.layers.route.append(g);
    return g;
  }

  /** The marks shown as far as the line is drawn in: the start and where the way comes
   * onto the floor at once; the end, its room and where it leaves the floor once the
   * line gets there. Shown at once (no dropping in) when it is not drawn in. */
  private reveal(): void {
    const v = this.routeView;
    if (!v) return;
    const there = this.drawn >= 0.96;
    const show = (el: Element | null, on: boolean): void => {
      if (!el || el.classList.contains("sp-in") === on) return;
      el.classList.toggle("sp-in", on);
      if (on && v.instant) el.classList.add("sp-instant");
    };
    show(v.start?.g ?? null, true);
    for (const c of v.changes) show(c.g, c.side === "from" || there);
    show(v.end?.g ?? null, there);
    show(v.room, there);
  }

  /** The way placed on the screen (the view moved, or it is drawing in): its lines
   * through the floor's points, rounded at corners, drawn in as far as it has got; its
   * marks beside the labels rather than over them; the walker where it has got to. */
  private placeRoute(): void {
    const v = this.routeView, r = this.routed;
    if (!v || !r) return;
    this.routeLine.setAttribute("data-sp-route-drawn", String(round(this.drawn)));
    const moving = this.motion() && (r.options.animate ?? true);
    const flowing = moving && (r.options.flow ?? true) && this.drawn >= 1;
    for (const lv of v.legs) {
      const screen = thinned(lv.points.map((p) => this.toScreen(p)), 0.75);
      const { d } = rounded(screen, CORNER_PX);
      for (const e of [lv.halo, lv.casing, lv.core, lv.done, lv.flow]) e.setAttribute("d", d);
      const dash = this.drawn < 1 ? `${round(this.drawn)} 2` : "";
      for (const e of [lv.halo, lv.casing, lv.core]) {
        if (dash) e.setAttribute("stroke-dasharray", dash);
        else e.removeAttribute("stroke-dasharray");
      }
      const done = this.doneOf(lv.index);
      if (done > 0) {
        lv.done.setAttribute("stroke-dasharray", `${round(done)} 2`);
        lv.done.style.display = "";
      } else lv.done.style.display = "none";
      lv.g.classList.toggle("sp-flowing", flowing);
      lv.arrows.replaceChildren(...(flowing || this.drawn < 1 ? [] : arrowsAlong(screen)));
    }
    this.placeMarks();
    this.reveal();
    if (this.playing) this.placeWalker();
  }

  /** The markers on the screen: the start on its point; the floor changes' badges on
   * theirs, their tags beside them where they cover the fewest labels; the destination's
   * pin on its point when its card names it (the room's label is then not shown), else
   * beside the labels with a short leader; its card over the pin, or beside it. */
  private placeMarks(): void {
    const v = this.routeView!;
    const labels: Box[] = [];
    for (const label of this.labels.values()) {
      if (!label.at || label.text.getAttribute("visibility") !== "visible") continue;
      const [sx, sy] = label.at;
      labels.push([sx - label.width / 2, sy - label.height / 2, sx + label.width / 2, sy + label.height / 2]);
    }
    const taken: Box[] = [];
    const line = this.routeOnScreen();
    const covered = (b: Box): number => [...labels, ...taken].reduce((sum, o) =>
      sum + Math.max(0, Math.min(b[2], o[2]) - Math.max(b[0], o[0])) * Math.max(0, Math.min(b[3], o[3]) - Math.max(b[1], o[1])), 0)
      + (line && crosses(line, [b[0] + LINE_CLEAR - 2, b[1] + LINE_CLEAR - 2, b[2] - LINE_CLEAR + 2, b[3] - LINE_CLEAR + 2]) ? 2400 : 0);
    /** Where a mark goes about its point s: tried in turn (offsets), the one covering
     * the fewest labels and marks, nearest first; ``boxOf(at)`` the box it takes there. */
    const spot = (s: XY, offsets: XY[], boxOf: (at: XY) => Box, cost = 4, order = false): XY => {
      let best: { at: XY; box: Box; score: number } | null = null;
      for (const [i, o] of offsets.entries()) {
        const at: XY = [s[0] + o[0], s[1] + o[1]];
        const box = boxOf(at);
        // a pixel further costs as much as `cost` square pixels of a label covered (or, in
        // order, each place after the first as much as 60 pixels further)
        const score = covered(box) + (order ? i * 60 : Math.hypot(o[0], o[1])) * cost;
        if (!best || score < best.score - 1e-9) best = { at, box, score };
      }
      taken.push(best!.box);
      return best!.at;
    };
    const around = (radii: number[]): XY[] => radii.flatMap((r) => (r === 0 ? [[0, 0] as XY] : AROUND.map(([x, y]): XY => [x * r, y * r])));
    const place = (g: SVGGElement, p: XY): XY => {
      const s = this.toScreen(p);
      g.setAttribute("transform", `translate(${round(s[0])},${round(s[1])})`);
      return s;
    };
    const lead = (line: SVGLineElement, to: XY): void => {
      const far = Math.hypot(to[0], to[1]) > 7;
      line.setAttribute("x2", String(far ? round(to[0]) : 0));
      line.setAttribute("y2", String(far ? round(to[1]) : 0));
    };
    if (v.start) {
      const s = place(v.start.g, v.start.p);
      taken.push([s[0] - 12, s[1] - 12, s[0] + 12, s[1] + 12]);
    }
    for (const c of v.changes) {
      const s = place(c.g, c.p);
      taken.push([s[0] - 15, s[1] - 15, s[0] + 15, s[1] + 15]);
    }
    if (v.start?.chip) { // its label over it, or beside it
      const { chip } = v.start, s = this.toScreen(v.start.p), w = chip.width;
      const at = spot(s, [[-w / 2, -30], [17, 0], [-w - 17, 0], [-w / 2, 30]], (a) => [a[0], a[1] - 12, a[0] + w, a[1] + 12], 4, true);
      chip.g.setAttribute("transform", `translate(${round(at[0] - s[0])},${round(at[1] - s[1])})`);
    }
    for (const c of v.changes) { // the tag beside its badge
      const s = this.toScreen(c.p), w = c.chip.width;
      const at = spot(s, [[19, 0], [-19 - w, 0], [-w / 2, -30], [-w / 2, 30], [19, -24], [-19 - w, -24], [19, 24], [-19 - w, 24]],
        (a) => [a[0], a[1] - 12, a[0] + w, a[1] + 12], 1);
      c.chip.g.setAttribute("transform", `translate(${round(at[0] - s[0])},${round(at[1] - s[1])})`);
      lead(c.leader, [0, 0]);
    }
    if (v.end) {
      const e = v.end, s = place(e.g, e.p);
      // the pin: on its point when its card names the room; else where it covers no label
      const pin = e.card ? s : spot(s, around([0, 26, 44, 64]), (a) => [a[0] - 11, a[1] - 32, a[0] + 11, a[1]]);
      if (e.card) taken.push([s[0] - 11, s[1] - 32, s[0] + 11, s[1]]);
      const to: XY = [pin[0] - s[0], pin[1] - s[1]];
      e.pin.setAttribute("transform", `translate(${round(to[0])},${round(to[1])})`);
      lead(e.leader, to);
      e.at.style.display = to[0] || to[1] ? "" : "none";
      if (e.card) {
        const w = e.card.width, head: XY = [pin[0], pin[1] - 20.5];
        const at = spot(head, [[-w / 2, -30], [16, 0], [-16 - w, 0], [-w / 2, 44]], (a) => [a[0], a[1] - 12, a[0] + w, a[1] + 12], 4, true);
        e.card.g.setAttribute("transform", `translate(${round(at[0] - s[0])},${round(at[1] - s[1])})`);
      }
    }
  }

  /** How much of a leg has been walked while playing (0 to 1). */
  private doneOf(leg: number): number {
    const p = this.playing, r = this.routed;
    if (!p || !r || p.steps) return 0;
    if (leg < p.leg) return 1;
    if (leg > p.leg) return 0;
    const total = r.lengths[leg]?.[r.lengths[leg]!.length - 1] ?? 0;
    return total > 0 ? Math.min(1, p.s / total) : 0;
  }

  /** The walker (playing) where it has got to, facing the way it goes. */
  private placeWalker(): void {
    const p = this.playing, r = this.routed, v = this.routeView;
    const leg = r?.route.legs[p?.leg ?? -1];
    if (!p || !r || !v || p.steps || !leg || leg.floor_id !== this.plan?.id) {
      v?.walker?.g.remove();
      if (v) v.walker = null;
      return;
    }
    if (!v.walker) {
      const g = this.mark("sp-route-walker", leg.points[0]!, { "data-sp-route-walker": "" });
      g.append(svg("circle", { class: "sp-route-walker-halo", r: 17 }), svg("circle", { class: "sp-route-walker-ring", r: 10.5 }));
      const arrow = g.appendChild(svg("path", { class: "sp-route-walker-arrow", d: "M0,-6.5L5,5.5L0,2.8L-5,5.5Z" }));
      v.walker = { g, p: leg.points[0]!, arrow };
      this.routeMarks.append(g);
    }
    const { at, dir } = pointAt(leg.points, r.lengths[p.leg]!, p.s);
    const s = this.toScreen(at);
    const angle = (Math.atan2(this.ySign * dir[1], dir[0]) * 180) / Math.PI + 90;
    v.walker.p = at;
    v.walker.g.setAttribute("data-plan-x", String(round(at[0])));
    v.walker.g.setAttribute("data-plan-y", String(round(at[1])));
    v.walker.g.setAttribute("transform", `translate(${round(s[0])},${round(s[1])})`);
    v.walker.arrow.setAttribute("transform", `rotate(${round(angle)})`);
  }

  /** The way's animation, a frame at a time while it draws in or plays; none otherwise. */
  private kick(): void {
    if (!this.loop) this.loop = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.loop = 0;
    let again = false;
    if (this.drawn < 1 && this.routed) {
      const t = Math.min(1, Math.max(0, (now - this.drawStart) / DRAW_MS));
      this.drawn = t >= 1 ? 1 : Math.min(0.999, easeInOut(t));
      this.placeRoute();
      again = this.drawn < 1;
    }
    const p = this.playing;
    if (p && p.state === "playing") {
      this.advance(p, now);
      again = again || this.playing === p;
    }
    if (again) this.kick();
  };

  /** Playing: on a frame's worth (a long gap, as in a hidden tab, counts as one frame). */
  private advance(p: Playing, now: number): void {
    const r = this.routed!;
    const dt = Math.min(100, Math.max(0, now - p.last));
    p.last = now;
    const legs = r.route.legs;
    const length = (i: number): number => r.lengths[i]?.[r.lengths[i]!.length - 1] ?? 0;
    if (p.steps) { // without motion: a step every so often
      p.wait -= dt;
      if (p.wait > 0 || p.phase === "switch") return;
      const next = p.step + 1;
      const steps = r.route.steps ?? [];
      if (next >= steps.length) return this.endPlay("ended");
      p.step = next;
      p.phase = "switch";
      void this.goToFloor(legs[r.stepLegs[next] ?? 0]!.floor_id, "play", false).then(() => {
        if (this.playing !== p) return;
        this.stepNow = next;
        this.svg.setAttribute("data-sp-route-step", String(next));
        this.frameStep(next, false);
        this.emitStep();
        p.phase = "walk";
        p.wait = 1600;
      });
      return;
    }
    switch (p.phase) {
      case "begin":
      case "switch": {
        if (p.wait === -1) return; // under way
        p.wait = -1;
        const leg = p.phase === "begin" ? 0 : p.leg + 1;
        void this.goToFloor(legs[leg]!.floor_id, "play", true).then((shown) => {
          if (this.playing !== p) return;
          if (!shown) return this.endPlay("stopped");
          p.leg = leg;
          p.s = 0;
          p.phase = "after";
          p.wait = leg === 0 ? 350 : PLAY.after;
          this.playView(p, true);
          this.buildRoute(); // (the walker on this floor)
          this.placeRoute();
        });
        return;
      }
      case "after":
        p.wait -= dt;
        if (p.wait <= 0) p.phase = "walk";
        break;
      case "walk": {
        const total = length(p.leg);
        p.s = Math.min(total, p.s + (p.speed * dt) / 1000);
        if (p.s >= total) {
          if (p.leg >= legs.length - 1) {
            this.progress(p);
            return this.endPlay("ended");
          }
          p.phase = "before";
          p.wait = PLAY.before;
        }
        break;
      }
      case "before":
        p.wait -= dt;
        if (p.wait <= 0) {
          p.phase = "switch";
          p.wait = 0;
        }
        break;
    }
    if (p.follow) this.playView(p, false, dt);
    this.placeRoute();
    this.progress(p);
  }

  /** Playing: the view on the walker. At a leg's start, its whole walking framed when it
   * fits at a comfortable zoom (the view then stays), else that zoom, following it. */
  private playView(p: Playing, start: boolean, dt = 0): void {
    const r = this.routed!, leg = r.route.legs[p.leg];
    if (!leg || leg.floor_id !== this.plan?.id || !this.size.w) return;
    const { w, h } = this.size, pad = this.opts.padding ?? 24;
    if (start) {
      const box = this.legBox(p.leg, 0, Infinity);
      const fitK = Math.min((w - 2 * pad) / Math.max(box[2] - box[0], 1e-6), (h - 2 * pad) / Math.max(box[3] - box[1], 1e-6));
      const easy = Math.min(w, h) / PLAY.wide;
      p.k = fitK >= easy * 0.8 ? 0 : this.clampScale(easy); // 0: framed whole, not followed
      if (!p.k) this.frameBox(box, true);
      else {
        const { at } = pointAt(leg.points, r.lengths[p.leg]!, 0);
        this.moveTo({ k: p.k, tx: w / 2 - p.k * at[0], ty: h / 2 - this.ySign * p.k * at[1] }, this.motion(), STEP_MS);
      }
      return;
    }
    if (!p.k || this.moving) return;
    const lengths = r.lengths[p.leg]!;
    const { at } = pointAt(leg.points, lengths, p.s + p.speed * 1.2); // a little ahead of it
    const k = this.cam.k;
    const want = { tx: w / 2 - k * at[0], ty: h / 2 - this.ySign * k * at[1] };
    const f = 1 - Math.exp(-dt / 450);
    this.cam = { k, tx: this.cam.tx + (want.tx - this.cam.tx) * f, ty: this.cam.ty + (want.ty - this.cam.ty) * f };
    this.apply();
  }

  /** Playing: how far it has got, and the step it is at (said when it changes). */
  private progress(p: Playing): void {
    const r = this.routed!;
    let before = 0;
    for (let i = 0; i < p.leg; i++) before += r.lengths[i]?.[r.lengths[i]!.length - 1] ?? 0;
    const metres = before + p.s;
    const leg = r.route.legs[p.leg]!;
    const step = playStep(r, p);
    if (step !== null && step !== this.stepNow) {
      this.stepNow = step;
      this.svg.setAttribute("data-sp-route-step", String(step));
      this.emitStep();
    }
    const { at } = pointAt(leg.points, r.lengths[p.leg]!, p.s);
    p.metres = metres;
    this.dispatchEvent(new CustomEvent<RouteProgressDetail>("routeprogress", { detail: { metres: round(metres), total: round(p.total),
      fraction: p.total > 0 ? round(metres / p.total) : 1, leg: p.leg, step, floor_id: leg.floor_id, at } }));
  }

  /** Playing ends: ended (got there), or stopped; the walker taken away. */
  private endPlay(how: "ended" | "stopped"): void {
    const p = this.playing;
    if (!p) return;
    this.playing = null;
    this.placeWalker();
    this.placeRoute();
    if (how === "ended" && this.routed?.route.steps?.length) { // there: the arrival framed
      this.stepNow = this.routed.route.steps.length - 1;
      this.svg.setAttribute("data-sp-route-step", String(this.stepNow));
      this.emitStep();
      if (!p.steps) this.frameStep(this.stepNow, true);
    }
    this.emitPlay(how);
    p.resolve();
  }

  private emitPlay(state: "playing" | "paused" | "stopped" | "ended"): void {
    this.svg.setAttribute("data-sp-route-play", state);
    this.dispatchEvent(new CustomEvent<{ state: string }>("routeplay", { detail: { state } }));
  }

  private emitStep(): void {
    const r = this.routed, i = this.stepNow;
    if (!r || i === null) return;
    const leg = r.stepLegs[i] ?? 0;
    this.dispatchEvent(new CustomEvent<RouteStepDetail>("routestep", { detail: { index: i, step: r.route.steps?.[i] ?? null, leg,
      floor_id: r.route.legs[leg]?.floor_id ?? null } }));
  }

  /** Another floor of the way shown: by the page ("routefloor", which it may cancel, then
   * showing it itself), else through `floorPlan`; cross-faded. Whether it is shown. */
  private async goToFloor(id: string, reason: "badge" | "step" | "play", fade: boolean): Promise<boolean> {
    if (this.plan?.id === id) return true;
    const ask = new CustomEvent<{ floor_id: string; reason: string }>("routefloor", { cancelable: true, detail: { floor_id: id, reason } });
    const before = this.plan;
    this.dispatchEvent(ask);
    if (this.plan?.id === id) return true; // the page showed it
    const get = this.routed?.options.floorPlan;
    if (ask.defaultPrevented || !get) return false;
    const plan = await get(id);
    if (!plan || !this.routed || this.plan !== before) return this.plan?.id === id;
    if (fade) this.crossfade();
    const drawn = this.drawn;
    this.setFloor(plan, { fit: false });
    this.drawn = drawn;
    return true;
  }

  /** The floor shown fades out over the next one (a copy of it, taken away after). */
  private crossfade(): void {
    if (!this.motion()) return;
    const top = this.overlays[2]!;
    for (const old of top.querySelectorAll(":scope > .sp-fade")) old.remove();
    const ghost = svg("g", { class: "sp-fade", "aria-hidden": "true" });
    for (const layer of [this.world, this.routeLine, this.routeMarks, this.labelLayer, this.pinLayer]) ghost.append(layer.cloneNode(true));
    for (const e of ghost.querySelectorAll("*")) {
      for (const a of [...e.attributes]) if (a.name.startsWith("data-sp") || a.name === "tabindex" || a.name === "role") e.removeAttribute(a.name);
    }
    top.append(ghost);
    const done = (): void => ghost.remove();
    ghost.addEventListener("animationend", done);
    setTimeout(done, FADE_MS + 400);
  }

  /** The part of a leg from `from` metres along it to `to`, as a box (the floor's metres). */
  private legBox(leg: number, from: number, to: number): Box {
    const r = this.routed!, l = r.route.legs[leg]!, lengths = r.lengths[leg]!;
    const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
    const add = (p: XY): void => {
      box[0] = Math.min(box[0], p[0]); box[1] = Math.min(box[1], p[1]);
      box[2] = Math.max(box[2], p[0]); box[3] = Math.max(box[3], p[1]);
    };
    const total = lengths[lengths.length - 1] ?? 0;
    const a = Math.max(0, from), b = Math.min(total, to);
    add(pointAt(l.points, lengths, a).at);
    add(pointAt(l.points, lengths, b).at);
    l.points.forEach((p, i) => { if (lengths[i]! >= a && lengths[i]! <= b) add(p); });
    return box;
  }

  /** A step framed: the start and the first metres from it; a walk whole; the lift or
   * stairs and the last metres to them; the destination, its room and the way into it. */
  private frameStep(index: number, animate: boolean): void {
    const r = this.routed!, step = r.route.steps?.[index];
    const leg = r.stepLegs[index] ?? 0;
    if (!step || r.route.legs[leg]?.floor_id !== this.plan?.id) return;
    const lengths = r.lengths[leg]!, total = lengths[lengths.length - 1] ?? 0;
    const near = 14; // metres of the way round a start, a ride or an end
    let box = step.kind === "start" ? this.legBox(leg, 0, near)
      : step.kind === "take" ? this.legBox(leg, total - near, total)
      : step.kind === "arrive" ? this.legBox(leg, total - near, total)
      : this.legBox(leg, 0, total);
    if (step.kind === "arrive") {
      const room = this.routeView?.room?.getAttribute("data-sp-route-room");
      const b = room ? this.boxes.get(room) : null;
      if (b) box = [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])];
    }
    this.frameBox(box, animate);
  }

  /** A box of the floor in view, with room round it for the way's marks, never closer
   * than a comfortable zoom (some 18 m across). */
  private frameBox(box: Box, animate: boolean): void {
    if (!finite(box) || !this.size.w) return;
    const { w, h } = this.size;
    const pad = 3;
    const b: Box = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
    const edge = (this.opts.padding ?? 24) + 24;
    let k = Math.min((w - 2 * edge) / Math.max(b[2] - b[0], 1e-6), (h - 2 * edge) / Math.max(b[3] - b[1], 1e-6));
    k = this.clampScale(Math.min(k, Math.min(w, h) / 18));
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    this.fitted = true;
    this.moveTo({ k, tx: w / 2 - k * cx, ty: h / 2 - this.ySign * k * cy }, animate && this.motion(), STEP_MS);
  }

  private drawPin(): void {
    this.pinLayer.replaceChildren();
    const id = this.pinned;
    const m = id ? this.markers.get(id) : null;
    if (!id || !m) return;
    const [sx, sy] = this.toScreen(m);
    const pin = svg("g", { class: "sp-pin", "data-sp-pin": id, "data-plan-x": round(m[0]), "data-plan-y": round(m[1]),
      transform: `translate(${round(sx)},${round(sy)})` });
    pin.append(svg("path", { d: "M0,0C-3,-7 -11,-12 -11,-20A11,11 0 1 1 11,-20C11,-12 3,-7 0,0Z" }), svg("circle", { cx: 0, cy: -20, r: 4.2 }));
    this.pinLayer.append(pin);
  }

  private fitBox(box: Box, animate: boolean, whole: boolean, extra = 0): void {
    const { w, h } = this.size;
    if (!w || !h) return;
    const pad = Math.min((this.opts.padding ?? 24) + extra, w / 4, h / 4);
    const bw = Math.max(box[2] - box[0], 1e-6), bh = Math.max(box[3] - box[1], 1e-6);
    let k = Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh);
    if (!Number.isFinite(k) || k <= 0) k = 1;
    if (whole) this.minScale = k / 4;
    k = this.clampScale(k);
    const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
    this.fitted = true;
    this.moveTo({ k, tx: w / 2 - k * cx, ty: h / 2 - this.ySign * k * cy }, animate);
  }

  private clampScale(k: number): number {
    return Math.min(Math.max(k, this.minScale), this.opts.maxScale ?? 400);
  }

  private moveTo(target: Camera, animate: boolean, ms = ANIMATION_MS): void {
    cancelAnimationFrame(this.frame);
    this.moving = false;
    if (!animate || !this.motion()) {
      this.cam = { ...target };
      this.apply();
      return;
    }
    this.moving = true;
    // zoom in a straight line in log scale, keeping the screen point that moves to
    // the middle on a straight path
    const from = { ...this.cam };
    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const k = Math.exp(Math.log(from.k) + (Math.log(target.k) - Math.log(from.k)) * e);
      const cFrom = [(this.size.w / 2 - from.tx) / from.k, (this.size.h / 2 - from.ty) / from.k];
      const cTo = [(this.size.w / 2 - target.tx) / target.k, (this.size.h / 2 - target.ty) / target.k];
      const cx = cFrom[0]! + (cTo[0]! - cFrom[0]!) * e, cy = cFrom[1]! + (cTo[1]! - cFrom[1]!) * e;
      this.cam = t < 1 ? { k, tx: this.size.w / 2 - k * cx, ty: this.size.h / 2 - k * cy } : { ...target };
      this.apply();
      if (t < 1) this.frame = requestAnimationFrame(step);
      else this.moving = false;
    };
    this.frame = requestAnimationFrame(step);
  }

  private apply(): void {
    const { k, tx, ty } = this.cam;
    this.world.setAttribute("transform", `matrix(${k} 0 0 ${this.ySign * k} ${tx} ${ty})`);
    this.svg.setAttribute("data-cam", `${round(k)},${round(tx)},${round(ty)}`);
    this.placeLabels();
    this.drawPin();
    this.placeRoute();
    this.dispatchEvent(new CustomEvent<Camera>("camerachange", { detail: this.camera() }));
  }

  private placeLabels(): void {
    const show = this.opts.labels !== false;
    const line = this.routeOnScreen();
    for (const [id, label] of this.labels) {
      const b = this.boxes.get(id)!;
      const m = this.markers.get(id)!;
      const fits = show && !this.labelsOff.has(id) && (b[2] - b[0]) * this.cam.k >= label.width * 1.05
        && (b[3] - b[1]) * this.cam.k >= label.height * 1.1;
      if (!fits) {
        label.text.setAttribute("visibility", "hidden");
        continue;
      }
      let [sx, sy] = this.toScreen(m);
      if (line) { // a way over it: moved off the line within its space, else not shown (but the way's own)
        const hw = label.width / 2, hh = label.height / 2;
        if (crosses(line, [sx - hw, sy - hh, sx + hw, sy + hh])) {
          const p = this.toScreen([b[0], b[1]]), q = this.toScreen([b[2], b[3]]);
          const room: Box = [Math.min(p[0], q[0]) + 2, Math.min(p[1], q[1]) + 2, Math.max(p[0], q[0]) - 2, Math.max(p[1], q[1]) - 2];
          const off = (d: number): XY[] => [[0, -d - hh], [0, d + hh], [-d - hw, 0], [d + hw, 0]];
          const tries = [LINE_CLEAR, LINE_CLEAR + 8, LINE_CLEAR + 18].flatMap(off);
          const clear = (slack: number) => tries.find(([dx, dy]) => {
            const box: Box = [sx + dx - hw, sy + dy - hh, sx + dx + hw, sy + dy + hh];
            return box[0] >= room[0] - slack && box[1] >= room[1] - slack && box[2] <= room[2] + slack && box[3] <= room[3] + slack
              && !crosses(line, box);
          });
          // the way's own (its corridor): just past a narrow room's edge, rather than on the line
          const moved = clear(0) ?? (label.text.classList.contains("sp-label-strong") ? clear(label.height + 4) : undefined);
          if (moved) {
            sx += moved[0];
            sy += moved[1];
          } else if (!label.text.classList.contains("sp-label-strong")) {
            label.text.setAttribute("visibility", "hidden");
            continue;
          }
        }
      }
      label.text.setAttribute("visibility", "visible");
      label.text.setAttribute("transform", `translate(${round(sx)},${round(sy)})`);
      label.at = [sx, sy];
    }
  }

  /** The way's line on the floor shown, on the screen: its segments [x1, y1, x2, y2]
   * and the box round them; null when none is shown here. */
  private routeOnScreen(): { segments: number[][]; box: Box } | null {
    const legs = this.routeView?.legs;
    if (!legs?.length) return null;
    const segments: number[][] = [];
    const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const { points } of legs) {
      const s = points.map((p) => this.toScreen(p));
      for (let i = 0; i < s.length; i++) {
        const [x, y] = s[i]!;
        box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
        if (i > 0) segments.push([s[i - 1]![0], s[i - 1]![1], x, y]);
      }
    }
    return segments.length ? { segments, box } : null;
  }

  private resized(): void {
    const r = this.svg.getBoundingClientRect();
    const w = r.width, h = r.height;
    if (!w || !h) return;
    const before = this.size;
    this.size = { w, h };
    if (!this.plan) return;
    if (!this.measured) this.measureLabels(); // drawn while hidden
    if (!this.fitted || !before.w) return this.fit({ animate: false });
    // the point in the middle stays in the middle: nothing drifts
    const c = this.toPlan([before.w / 2, before.h / 2]);
    const { k } = this.cam;
    this.cam = { k, tx: w / 2 - k * c[0], ty: h / 2 - this.ySign * k * c[1] };
    this.apply();
  }

  private wheel(e: WheelEvent): void {
    if (this.playing) this.playing.follow = false;
    const speed = e.deltaMode === 1 ? 0.05 : 0.0018;
    this.zoomBy(Math.exp(-e.deltaY * speed), this.local(e));
  }

  private local(e: { clientX: number; clientY: number }): XY {
    const r = this.svg.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private chooseFrom(target: EventTarget | null): void {
    const change = target instanceof Element ? target.closest<SVGGElement>("[data-sp-route-change]") : null;
    if (change) return this.changeClicked(change);
    const el = target instanceof Element ? target.closest("[data-sp-id], [data-sp-item]") : null;
    const item = this.items.get(el?.getAttribute("data-sp-item") ?? "")?.item ?? null;
    if (item) {
      this.select(item.id);
      this.dispatchEvent(new CustomEvent<SelectDetail>("select", { detail: { id: item.id, space: null, item } }));
      return;
    }
    const id = el?.getAttribute("data-sp-id") ?? null;
    const space = id ? this.spaces.get(id) ?? null : null;
    if (space && !this.interactive(space)) return;
    this.select(space ? space.id : null);
    this.dispatchEvent(new CustomEvent<SelectDetail>("select", { detail: { id: space?.id ?? null, space, item: null } }));
  }

  /** A floor change's badge clicked (or Enter on it): the floor it goes to (or comes
   * from) shown, the way there framed. */
  private changeClicked(g: SVGGElement): void {
    const floor = g.getAttribute("data-floor"), side = g.getAttribute("data-sp-route-change");
    const index = Number(g.getAttribute("data-change"));
    if (!floor || !this.routed) return;
    if (this.playing) this.endPlay("stopped");
    const leg = side === "to" ? index + 1 : index;
    void this.goToFloor(floor, "badge", true).then((shown) => {
      if (!shown || !this.routed) return;
      const lengths = this.routed.lengths[leg] ?? [0], total = lengths[lengths.length - 1] ?? 0;
      this.frameBox(side === "to" ? this.legBox(leg, 0, 18) : this.legBox(leg, total - 18, total), true);
    });
  }

  private bind(): void {
    const s = this.svg;
    // the way's marks' layer: its floor-change badges are buttons
    const marks = this.overlays[1]!;
    let down: XY | null = null;
    marks.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
    marks.addEventListener("pointerup", (e) => {
      const at = down;
      down = null;
      if (at && Math.hypot(e.clientX - at[0], e.clientY - at[1]) < DRAG_PX) this.chooseFrom(e.target);
    });
    marks.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target instanceof Element && e.target.hasAttribute("data-sp-route-change")) {
        e.preventDefault();
        this.chooseFrom(e.target);
      }
    });
    marks.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.wheel(e);
    }, { passive: false });
    // the view taken in hand while a way plays: it no longer follows the walker
    const hands = (): void => {
      if (this.playing) this.playing.follow = false;
    };
    s.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      this.pointers.set(e.pointerId, this.local(e));
      try {
        s.setPointerCapture(e.pointerId);
      } catch {
        // a pointer the browser does not track (made by a script): nothing to capture
      }
      if (this.pointers.size === 1) {
        this.press = { start: this.local(e), cam: this.camera(), moved: false, target: e.target };
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()] as [XY, XY];
        this.pinch = { distance: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], cam: this.camera() };
        if (this.press) this.press.moved = true;
      }
    });
    s.addEventListener("pointermove", (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const p = this.local(e);
      this.pointers.set(e.pointerId, p);
      if (this.pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()] as [XY, XY];
        const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const mid: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const c = this.pinch.cam;
        const k = this.clampScale(c.k * (distance / (this.pinch.distance || 1)));
        const at: XY = [(this.pinch.mid[0] - c.tx) / c.k, (this.pinch.mid[1] - c.ty) / (this.ySign * c.k)];
        this.moveTo({ k, tx: mid[0] - k * at[0], ty: mid[1] - this.ySign * k * at[1] }, false);
        return;
      }
      const press = this.press;
      if (!press) return;
      const dx = p[0] - press.start[0], dy = p[1] - press.start[1];
      if (!press.moved && Math.hypot(dx, dy) < DRAG_PX) return;
      press.moved = true;
      hands();
      s.classList.add("sp-dragging");
      this.moveTo({ k: press.cam.k, tx: press.cam.tx + dx, ty: press.cam.ty + dy }, false);
    });
    const end = (e: PointerEvent): void => {
      if (!this.pointers.delete(e.pointerId)) return;
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size > 0) return;
      const press = this.press;
      this.press = null;
      s.classList.remove("sp-dragging");
      if (press && !press.moved && e.type === "pointerup") this.chooseFrom(press.target);
    };
    s.addEventListener("pointerup", end);
    s.addEventListener("pointercancel", end);
    s.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.wheel(e);
    }, { passive: false });
    s.addEventListener("keydown", (e) => {
      const onSpace = e.target instanceof Element && (e.target.hasAttribute("data-sp-id") || e.target.hasAttribute("data-sp-item")
        || e.target.hasAttribute("data-sp-route-change"));
      if (onSpace && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        this.chooseFrom(e.target);
        return;
      }
      const pan = 40;
      const moves: Record<string, () => void> = {
        "+": () => this.zoomBy(1.25), "=": () => this.zoomBy(1.25), "-": () => this.zoomBy(0.8),
        "0": () => this.fit(), Home: () => this.fit(),
        ArrowLeft: () => this.moveTo({ ...this.cam, tx: this.cam.tx + pan }, false),
        ArrowRight: () => this.moveTo({ ...this.cam, tx: this.cam.tx - pan }, false),
        ArrowUp: () => this.moveTo({ ...this.cam, ty: this.cam.ty + pan }, false),
        ArrowDown: () => this.moveTo({ ...this.cam, ty: this.cam.ty - pan }, false),
      };
      const move = moves[e.key];
      if (move) {
        e.preventDefault();
        move();
      }
    });
  }
}

// ---- a way's parts and helpers ------------------------------------------------------

interface Routed {
  route: PlanRoute;
  options: ShowRouteOptions;
  floorName: (floorId: string) => string;
  /** Each leg's lengths along it (the floor's metres). */
  lengths: number[][];
  /** The leg each step is on. */
  stepLegs: number[];
}

/** A tag on a rounded card: its group, width and height. */
interface Chip { g: SVGGElement; width: number; height: number }
interface MarkView { g: SVGGElement; p: XY }
interface LegView {
  index: number;
  points: XY[];
  g: SVGGElement;
  halo: SVGPathElement;
  casing: SVGPathElement;
  core: SVGPathElement;
  done: SVGPathElement;
  flow: SVGPathElement;
  arrows: SVGGElement;
}
interface ChangeView extends MarkView {
  side: "to" | "from";
  change: PlanRoute["changes"][number];
  floor: string;
  index: number;
  leader: SVGLineElement;
  chip: Chip;
}
interface RouteView {
  legs: LegView[];
  start: (MarkView & { chip: Chip | null }) | null;
  end: (MarkView & { pin: SVGGElement; leader: SVGLineElement; at: SVGCircleElement; card: Chip | null }) | null;
  changes: ChangeView[];
  walker: (MarkView & { arrow: SVGPathElement }) | null;
  room: SVGGElement | null;
  /** Shown at once, not drawn in: its marks shown without dropping in. */
  instant: boolean;
}
interface Playing {
  state: "playing" | "paused";
  /** Without motion: its steps one after another. */
  steps: boolean;
  leg: number;
  /** Metres along the leg; along the whole way, of `total`. */
  s: number;
  metres: number;
  total: number;
  speed: number;
  phase: "begin" | "after" | "walk" | "before" | "switch";
  /** Milliseconds left of a pause (-1: a floor being shown). */
  wait: number;
  last: number;
  follow: boolean;
  /** The zoom it follows the walker at (0: the leg framed whole, not followed). */
  k: number;
  step: number;
  resolve: () => void;
  promise: Promise<void>;
}

/** The leg each step of a way is on: the start and walks on theirs, a ride on the leg it
 * leaves, the arrival on the last. */
function stepLegsOf(route: PlanRoute): number[] {
  let leg = 0;
  const last = Math.max(0, route.legs.length - 1);
  return (route.steps ?? []).map((s) => {
    if (s.kind === "arrive") return last;
    if (s.kind === "take") return Math.min(last, leg++);
    return Math.min(last, leg);
  });
}

/** The step a way being played is at: its start before it moves off; the walk of the
 * leg it walks; the ride at the end of a leg, before the next floor; the arrival. */
function playStep(r: Routed, p: Playing): number | null {
  const steps = r.route.steps ?? [];
  if (!steps.length) return null;
  const on = (kind: string): number => steps.findIndex((s, i) => s.kind === kind && r.stepLegs[i] === p.leg);
  if (p.phase === "before" || p.phase === "switch") {
    const take = on("take");
    if (take >= 0) return take;
  }
  if (p.leg === 0 && p.s < 0.5 && steps[0]?.kind === "start") return 0;
  const walk = on("walk");
  if (walk >= 0) return walk;
  const any = r.stepLegs.findIndex((l) => l === p.leg);
  return any >= 0 ? any : null;
}

/** What a floor change's tag says: "Up to Floor 2" where the way leaves the floor
 * ("Lift to Floor 2" when it does not say which way); "From Ground floor" where it comes onto one. */
function changeText(c: PlanRoute["changes"][number], side: "to" | "from", floorName: (id: string) => string): string {
  if (side === "from") return `From ${floorName(c.from_floor_id)}`;
  const way = c.direction === "up" ? "Up" : c.direction === "down" ? "Down" : RIDES[c.by] ?? c.by;
  return `${way} to ${floorName(c.to_floor_id)}`;
}

/** Arrows along a line on the screen, the way it goes, evenly, clear of its ends: for a
 * plan without motion, where no dots flow. */
function arrowsAlong(screen: XY[]): SVGElement[] {
  const out: SVGElement[] = [];
  const lengths = along(screen), length = lengths[lengths.length - 1] ?? 0;
  for (let at = length < ARROW_PX ? length / 2 : ARROW_PX / 2; at < length; at += ARROW_PX) {
    if (at < 14 || length - at < 14) continue;
    const { at: p, dir } = pointAt(screen, lengths, at);
    const angle = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
    out.push(svg("path", { class: "sp-route-arrow", d: "M-3,-3.5L1.5,0L-3,3.5", transform: `translate(${round(p[0])},${round(p[1])}) rotate(${round(angle)})` }));
  }
  return out;
}

/** An element with a title, for a pointer resting on it and screen readers. */
function titled<E extends SVGElement>(el: E, text: string): E {
  const t = svg("title");
  t.textContent = text;
  el.prepend(t);
  return el;
}

/** Whether a way's line (its segments on the screen) passes within LINE_CLEAR of a box. */
function crosses(line: { segments: number[][]; box: Box }, b: Box): boolean {
  const c = LINE_CLEAR, x0 = b[0] - c, y0 = b[1] - c, x1 = b[2] + c, y1 = b[3] + c;
  if (line.box[0] > x1 || line.box[2] < x0 || line.box[1] > y1 || line.box[3] < y0) return false;
  for (const [ax, ay, bx, by] of line.segments) { // clipped to the box (Liang-Barsky): does anything remain?
    let t0 = 0, t1 = 1;
    const dx = bx! - ax!, dy = by! - ay!;
    const clip = (p: number, q: number): boolean => {
      if (p === 0) return q >= 0;
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
      return true;
    };
    if (clip(-dx, ax! - x0) && clip(dx, x1 - ax!) && clip(-dy, ay! - y0) && clip(dy, y1 - ay!)) return true;
  }
  return false;
}
