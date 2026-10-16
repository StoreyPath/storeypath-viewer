// A floor of a StoreyPath package (spec/FORMAT.md) as the engine's floor model:
// its zones and undivided spaces, and its furniture and equipment, in the
// building's local drawing metres (the drawing the way the architect drew it,
// whatever its bearing on the map). A location's layout (format 0.12, a layout's
// package) is a plan too, by its ID: its areas, boundary walls, gates, the footprints of
// the buildings standing on it and the items on it, in the site's metres.

import { LocalFrame, type Placement } from "./frame.js";
import type { Navigation } from "./navigation.js";
import type { FloorPlan, PlanFootprint, PlanItem, PlanOpening, PlanSpace, Polygon, XY } from "./types.js";

type LonLat = [number, number];

interface Geometry {
  type: string;
  coordinates: unknown;
}

interface Feature<P> {
  id: string;
  geometry: Geometry | null;
  properties: P;
}

interface FloorProps {
  building_id: string; name?: string; walls?: Geometry | null; parapets?: Geometry | null;
  /** 0 the ground floor, negative below it; a mezzanine's is its host's. Metres above the ground floor. */
  ordinal?: number; elevation?: number;
  /** What level of its building it is (format 0.11; absent before: "floor"): a storey, a
   * mezzanine standing in another floor of its building (its host, ``host_floor_id``),
   * ``above_host_m`` above it, or the building's roof as a level, open to the sky. */
  type?: "floor" | "mezzanine" | "roof"; host_floor_id?: string | null; above_host_m?: number | null;
}
interface SpaceProps {
  floor_id: string; type: string; name?: string | null; number?: string | null; drawing_label?: string | null;
  display_point: LonLat; zones?: string[]; hidden?: boolean; ignored?: boolean;
  /** A lift's, stairs', escalator's or ramp's stack (format 0.8): the same on every floor it serves. */
  stack?: string | null;
}
interface ZoneProps extends SpaceProps { space_id: string }
interface OpeningProps {
  floor_id: string; type: "door" | "window" | "opening" | "gate"; span?: LonLat[] | null; swings?: LonLat[][] | null;
  hidden?: boolean; ignored?: boolean;
}
/** A location's layout (format 0.12): its land, a level of the location (PROJECT-LOCATION-LAND-G00); its
 * geometry the plot. */
interface LayoutProps {
  kind?: "layout"; name?: string; location_id?: string; walls?: Geometry | null; wall_height_m?: number | null;
  north?: { bearing: number; from: string | null } | null;
}
/** A building standing on a layout (format 0.12): its outline, name and building. */
interface FootprintProps {
  kind?: "footprint"; layout_id: string; building_id?: string | null; name?: string | null; drawing_label?: string | null;
  display_point?: LonLat | null; hidden?: boolean; ignored?: boolean;
}
interface ItemProps {
  /** Its building's; on a layout (format 0.12) null, its floor the layout. */
  floor_id: string; building_id: string | null; type: string; category?: string; name?: string | null;
  mount?: "floor" | "wall" | "ceiling"; display_point: LonLat; heading: number; width_m: number; depth_m: number;
  /** Where it stands in its building's own frame (format 0.7): its middle, and its turn
   * counter-clockwise from facing -y. Moving the building on the map leaves it as it is. */
  local?: { x_m: number; y_m: number; rotation_deg: number } | null;
  /** The items placed or grouped together share it (format 0.10). */
  group?: string | null;
  /** The door it serves (format 0.10), and a camera's view: degrees across, metres far. */
  door_id?: string | null; view_deg?: number | null; range_m?: number | null;
}

/** What a package gives: its manifest and its features (as viewer/src/package.js loads them, or as read). */
export interface PackageLike {
  manifest: { placements?: Record<string, Placement> };
  floors: Feature<FloorProps>[];
  spaces: Feature<SpaceProps>[];
  zones?: Feature<ZoneProps>[];
  openings: Feature<OpeningProps>[];
  /** Furniture and equipment (format 0.6; placed in their building, 0.7), and the catalogue of their types. */
  items?: Feature<ItemProps>[];
  catalogue?: { types: { code: string; color?: string; grade?: string | null; shape?: string | null }[] } | null;
  /** The building's walking network (navigation.json, format 0.8), or null: route() finds the way on it. */
  navigation?: Navigation | null;
  /** A layout's package (format 0.12): its layout (layout.geojson), and the buildings standing on it
   * (footprints.geojson); its areas are spaces of the layout, its gates openings. */
  layouts?: Feature<LayoutProps>[];
  footprints?: Feature<FootprintProps>[];
  /** Buildings, for a footprint's name when the site plan gives it none (a system's own, given so). */
  buildings?: Feature<{ name?: string | null }>[];
}

export interface FromPackageOptions {
  /** Spaces marked hidden in review: left out unless asked for (ignored ones always are). */
  showHidden?: boolean;
}

const ITEM_COLOR = "#8a8a8a"; // an item whose type the package does not describe (or not as #rrggbb)
/** The colours a package may give (catalogue.json): #rrggbb, nothing else reaches the page. */
const COLOR = /^#[0-9a-f]{6}$/i;
/** The grades a desk may be for (catalogue.json, format 0.7): no other reaches the page. */
const GRADES = new Set(["president", "c_level", "director", "manager", "section_head", "senior", "junior"]);
const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** What level of its building a floor is (format 0.11, its ``type``): a storey ("floor"), a
 * "mezzanine" or the "roof". A floor of an older package, or of a type a later version adds,
 * is a "floor". */
export function floorType(floor: Feature<FloorProps>): "floor" | "mezzanine" | "roof" {
  const type = floor.properties.type;
  return type === "mezzanine" || type === "roof" ? type : "floor";
}

/** Floors of one building in its order (format 0.11): by ordinal, then elevation, so a
 * mezzanine (its host's ordinal, above it) comes between its host and the floor above:
 * Ground, Mezzanine, First. Two at one elevation (two mezzanines on a floor) by ID, as Studio lists them. */
export function byLevel(a: Feature<FloorProps>, b: Feature<FloorProps>): number {
  const p = a.properties, q = b.properties;
  return (p.ordinal ?? 0) - (q.ordinal ?? 0) || (p.elevation ?? 0) - (q.elevation ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** A package's floors, each building's in its order (byLevel), the buildings as the package
 * first lists them. */
export function inOrder<F extends Feature<FloorProps>>(floors: F[]): F[] {
  const first = new Map<string, number>();
  floors.forEach((f, i) => { if (!first.has(f.properties.building_id)) first.set(f.properties.building_id, i); });
  return [...floors].sort((a, b) => first.get(a.properties.building_id)! - first.get(b.properties.building_id)! || byLevel(a, b));
}

/** A floor of a package, ready to draw; or a location's layout (format 0.12), by its ID: its
 * areas, walls, gates, footprints and items, in the site's metres. */
export function floorFromPackage(pkg: PackageLike, floorId: string, options: FromPackageOptions = {}): FloorPlan {
  const layout = pkg.layouts?.find((l) => l.id === floorId);
  const floor = layout ?? pkg.floors.find((f) => f.id === floorId);
  if (!floor) throw new Error(`no floor ${floorId} in the package`);
  // (a layout is placed by the site's placement, by its own ID)
  const placedBy = layout ? layout.id : (floor as Feature<FloorProps>).properties.building_id;
  const placement = pkg.manifest.placements?.[placedBy];
  if (!placement) throw new Error(`no placement for ${placedBy}`);
  const frame = new LocalFrame(placement);
  const local = (p: LonLat): XY => frame.toLocal(p);
  const polygons = (g: Geometry | null | undefined): Polygon[] => {
    if (!g) return [];
    if (g.type === "Polygon") return [(g.coordinates as LonLat[][]).map((r) => r.map(local))];
    if (g.type === "MultiPolygon") return (g.coordinates as LonLat[][][]).map((p) => p.map((r) => r.map(local)));
    return [];
  };
  const shown = (p: { hidden?: boolean; ignored?: boolean }): boolean => !p.ignored && (options.showHidden || !p.hidden);

  const zonesOf = new Map<string, Feature<ZoneProps>[]>();
  for (const z of pkg.zones ?? []) {
    if (z.properties.floor_id !== floorId) continue;
    const list = zonesOf.get(z.properties.space_id) ?? [];
    list.push(z);
    zonesOf.set(z.properties.space_id, list);
  }
  const spaces: PlanSpace[] = [];
  const containers: { id: string; polygons: Polygon[] }[] = [];
  const unit = (f: Feature<SpaceProps>, kind: "space" | "zone", container: string | null): PlanSpace => ({
    id: f.id, kind, polygons: polygons(f.geometry), marker: local(f.properties.display_point), type: f.properties.type,
    name: f.properties.name ?? null, number: f.properties.number ?? null, label: f.properties.drawing_label ?? null, container,
    ...(f.properties.stack ? { stack: f.properties.stack } : {}),
  });
  for (const s of pkg.spaces) {
    if (s.properties.floor_id !== floorId || !shown(s.properties)) continue;
    const zones = zonesOf.get(s.id) ?? [];
    if (!zones.length) {
      spaces.push(unit(s, "space", null));
      continue;
    }
    containers.push({ id: s.id, polygons: polygons(s.geometry) });
    for (const z of zones) if (shown(z.properties)) spaces.push(unit(z, "zone", s.id));
  }
  const openings: PlanOpening[] = [];
  for (const o of pkg.openings) {
    const p = o.properties;
    if (p.floor_id !== floorId || !shown(p)) continue;
    const span = p.span && p.span.length === 2 ? ([local(p.span[0]!), local(p.span[1]!)] as [XY, XY]) : undefined;
    const swings = (p.swings ?? []).filter((s) => s.length === 2).map((s) => [local(s[0]!), local(s[1]!)] as [XY, XY]);
    openings.push({ id: o.id, type: p.type, ...(span ? { span } : {}), ...(swings.length ? { swings } : {}) });
  }
  // a layout's buildings (format 0.12): where each stands, named as the site plan names it
  const footprints: PlanFootprint[] = [];
  const buildingName = (id: string | null | undefined): string | null =>
    (id && pkg.buildings?.find((b) => b.id === id)?.properties.name) || null;
  for (const f of layout ? pkg.footprints ?? [] : []) {
    const p = f.properties;
    if (p.layout_id !== floorId || !shown(p)) continue;
    // named as the site plan names it, else as its building is (when given), else as written
    const name = p.name || buildingName(p.building_id) || p.drawing_label || null;
    footprints.push({ id: f.id, polygons: polygons(f.geometry), name, building: p.building_id ?? null,
      ...(p.display_point ? { marker: local(p.display_point) } : {}) });
  }
  // furniture and equipment: where each stands in the building and the way it faces
  // there (format 0.7: its rotation, counter-clockwise from -y); in older packages,
  // from the map: its point, and its heading from north to the drawing's own (its +y
  // is turned to the placement's bearing)
  const colors = new Map((pkg.catalogue?.types ?? []).filter((t) => typeof t.color === "string" && COLOR.test(t.color))
    .map((t) => [t.code, t.color]));
  const grades = new Map((pkg.catalogue?.types ?? []).filter((t) => typeof t.grade === "string" && GRADES.has(t.grade))
    .map((t) => [t.code, t.grade]));
  // how each type is drawn (format 0.9.1), as its catalogue says
  const shapes = new Map((pkg.catalogue?.types ?? []).filter((t) => typeof t.shape === "string").map((t) => [t.code, t.shape]));
  const items: PlanItem[] = [];
  for (const f of pkg.items ?? []) {
    const p = f.properties;
    if (p.floor_id !== floorId || !(p.local || p.display_point)) continue;
    let at: XY, front: XY;
    if (p.local) {
      const r = ((p.local.rotation_deg || 0) * Math.PI) / 180;
      at = [p.local.x_m, p.local.y_m];
      front = [Math.sin(r), -Math.cos(r)];
    } else {
      const a = (((p.heading ?? 0) - (placement.bearing || 0)) * Math.PI) / 180;
      at = local(p.display_point);
      front = [Math.sin(a), Math.cos(a)];
    }
    items.push({ id: f.id, type: p.type, category: p.category ?? "furniture", name: p.name ?? null, mount: p.mount ?? "floor",
      at, front, width: p.width_m || 1, depth: p.depth_m || 0.6, color: colors.get(p.type) ?? ITEM_COLOR,
      grade: grades.get(p.type) ?? null, shape: shapes.get(p.type) ?? null, door: p.door_id ?? null,
      view: positive(p.view_deg) && p.view_deg <= 360 ? { deg: p.view_deg, range: positive(p.range_m) ? p.range_m : null } : null });
  }
  return {
    id: floorId,
    spaces,
    items,
    drawing: {
      outline: polygons(floor.geometry),
      walls: polygons(floor.properties.walls),
      parapets: layout ? [] : polygons((floor as Feature<FloorProps>).properties.parapets),
      openings,
      containers,
      ...(layout ? { footprints } : {}),
    },
  };
}
