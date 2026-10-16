// Reading StoreyPath packages (*.storeypath): a ZIP of GeoJSON, JSON and CSV files.
// The format is described in spec/FORMAT.md.

import JSZip from "jszip";

import { isLandId } from "./ids.js";
import { isSealed, unseal } from "./sealed.js";

export const FORMAT = "storeypath-package";
/** The format version this viewer reads, any patch of it (spec/FORMAT.md, "Versioning"). */
export const FORMAT_VERSION = "0.12";
export const SUPPORTED_MAJOR_VERSION = Number(FORMAT_VERSION.split(".")[0]);

const VERSION = /^(\d+)\.(\d+)(\.\d+)?([-+][0-9A-Za-z.-]+)?$/;

/** Refuses a package's format version this viewer does not read: one that is not a
 * version, one of another major version, or (before 1.0, where a minor version may
 * change what a package means) one of a newer minor version, saying to update the
 * viewer. Older versions, and newer patches (properties added), are read. */
export function checkVersion(version) {
  const m = typeof version === "string" ? VERSION.exec(version) : null;
  if (!m) throw new Error(`The package's format version ${JSON.stringify(version) ?? "(none)"} is not a version this viewer can read.`);
  const major = Number(m[1]), minor = Number(m[2]);
  const [MAJOR, MINOR] = FORMAT_VERSION.split(".").map(Number);
  if (major > MAJOR || (major === MAJOR && MAJOR === 0 && minor > MINOR)) {
    throw new Error(`This package is format ${version}, newer than this viewer's ${FORMAT_VERSION}: update the viewer.`);
  }
  if (major !== MAJOR) throw new Error(`This package is format ${version}, older than this viewer reads (${MAJOR}.x).`);
}

const COLLECTIONS = ["location", "buildings", "floors", "spaces", "openings"];
const SINCE_0_3 = ["zones"]; // parts of open spaces; none in older packages
const SINCE_0_6 = ["items"]; // furniture and equipment; none in older packages
// a layout's package (0.12): the location's land and the buildings standing on it; a role
// the manifest does not list is not in the package (a building's package has neither)
const SINCE_0_12 = ["layout", "footprints"];

/**
 * Load a package from a URL, Blob, File or ArrayBuffer. One sealed with a password
 * (spec/SEALED.md, `.storeypath.enc`) is opened with ``password``: a string, or a
 * function giving one (asked only when the package is sealed); without it, or with the
 * wrong one, a SealedError whose ``needsPassword`` is true is thrown.
 * @param {string | URL | Blob | ArrayBuffer | Uint8Array} source
 * @param {{ password?: string | (() => string | Promise<string>) }} [options]
 * @returns {Promise<StoreyPathPackage>}
 */
export async function loadPackage(source, { password } = {}) {
  let data = source;
  if (typeof source === "string" || source instanceof URL) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Could not load ${source} (HTTP ${response.status})`);
    data = await response.blob();
  }
  const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer())
    : data instanceof Uint8Array ? data : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
  const zip = await JSZip.loadAsync(isSealed(bytes) ? await unseal(bytes, password) : bytes);
  const read = async (name) => {
    const file = zip.file(name);
    if (!file) throw new Error(`The package has no ${name}.`);
    return JSON.parse(await file.async("string"));
  };

  const manifest = await read("manifest.json");
  if (manifest.format !== FORMAT) throw new Error("This is not a StoreyPath package.");
  checkVersion(manifest.format_version);
  const collections = {};
  for (const role of COLLECTIONS) collections[role] = (await read(manifest.files[role])).features;
  for (const role of [...SINCE_0_3, ...SINCE_0_6, ...SINCE_0_12]) {
    collections[role] = manifest.files[role] ? (await read(manifest.files[role])).features : [];
  }
  collections.catalogue = manifest.files.catalogue ? await read(manifest.files.catalogue) : null;
  // the walking network (format 0.8), for finding the way: navigation.js
  collections.navigation = manifest.files.navigation ? await read(manifest.files.navigation) : null;
  return new StoreyPathPackage(manifest, collections, zip);
}

export class StoreyPathPackage {
  /** ``zip``: the archive, for the files read only when needed (the pre-built 3D). */
  constructor(manifest, { location, buildings, floors, spaces, openings, zones = [], items = [], catalogue = null,
    navigation = null, layout = [], footprints = [] }, zip = null) {
    this.manifest = manifest;
    this._zip = zip;
    this.locations = location;
    this.buildings = buildings;
    this.floors = floors;
    this.spaces = spaces; // what walls and doors enclose
    this.zones = zones; // the parts of open spaces, with no wall between them
    this.openings = openings;
    this.items = items; // furniture and equipment: desks, photocopiers, access points, …
    this.catalogue = catalogue; // the types of items (catalogue.json), or null
    // the building's walking network (navigation.json, format 0.8), or null: route()
    // in navigation.js finds the way on it
    this.navigation = navigation;
    // a location's layout (format 0.12, a layout's package): its land (layout.geojson: its
    // plot, boundary walls, north) and the buildings standing on it (footprints.geojson);
    // its areas are spaces of the layout, its gates openings, what is on it items. None in
    // a building's package
    this.layouts = layout;
    this.footprints = footprints;

    this.byId = new Map();
    for (const list of [location, buildings, floors, spaces, zones, openings, items, layout, footprints]) {
      for (const f of list) this.byId.set(f.id, f);
    }
    this._itemsByFloor = groupBy(items, (i) => i.properties.floor_id);
    this._itemTypes = new Map((catalogue?.types ?? []).map((t) => [t.code, t]));
    this._zonesBySpace = groupBy(zones, (z) => z.properties.space_id);
    // what is used: the zones of a space that has them, otherwise the space
    this.units = [...zones, ...spaces.filter((s) => !this._zonesBySpace.has(s.id))];
    this._unitsByFloor = groupBy(this.units, (u) => u.properties.floor_id);
    this._floorsByBuilding = groupBy(floors, (f) => f.properties.building_id);
    for (const list of this._floorsByBuilding.values()) list.sort(byLevel);
    this._footprintsByLayout = groupBy(footprints, (f) => f.properties.layout_id);
    this._spacesByFloor = groupBy(spaces, (s) => s.properties.floor_id);
    this._doorsBySpace = new Map();
    for (const o of openings) {
      for (const id of o.properties.connects) {
        if (!this._doorsBySpace.has(id)) this._doorsBySpace.set(id, []);
        this._doorsBySpace.get(id).push(o);
      }
    }
  }

  get project() {
    return this.manifest.project;
  }

  /** The feature with this ID, or null. */
  get(id) {
    return this.byId.get(id) ?? null;
  }

  /** The buildings the package holds when it is part of a project (format 0.4; from
   * 0.7, always one), or null for the whole project. A layout's package (0.12) holds
   * none: [] (its layout is ``layout``). */
  get scope() {
    return this.manifest.scope?.buildings ?? null;
  }

  /** Whether this is a layout's package (format 0.12, its scope's ``layout``): a location's
   * land, and no building. */
  get isLayout() {
    return typeof this.manifest.scope?.layout === "string";
  }

  /** The location's layout the package holds (format 0.12: its scope's), or null: a
   * building's package has none. */
  get layout() {
    const id = this.manifest.scope?.layout;
    return (id ? this.get(id) : null) ?? this.layouts[0] ?? null;
  }

  /** The land of the package's layout (format 0.12): PROJECT-LOCATION-LAND, the "building"
   * its layout is the one level of; null without a layout. */
  get landId() {
    const layout = this.layout;
    return layout ? landOf(layout.id) : null;
  }

  /** Whether the package holds a building: always, for the whole project; for a
   * part, when the building is in its scope. What is outside it is not in the
   * package, and its absence says nothing about it. A layout's package (0.12) holds its
   * layout (by its ID, or its land's) and no building. */
  holds(buildingId) {
    if (this.isLayout) return buildingId === this.manifest.scope.layout || buildingId === landOf(this.manifest.scope.layout);
    return this.scope === null || this.scope.includes(buildingId);
  }

  /** Whether a floor comes pre-built in 3D (format 0.5: world/<floor-id>.glb). */
  hasWorld(floorId) {
    return Boolean(this._worldFile(floorId));
  }

  /** A floor's pre-built 3D as binary glTF, or null when the package has none. */
  async world(floorId) {
    const file = this._worldFile(floorId);
    return file ? file.async("arraybuffer") : null;
  }

  _worldFile(floorId) {
    const dir = this.manifest.files?.world;
    return dir && this._zip ? this._zip.file(`${dir.endsWith("/") ? dir : dir + "/"}${floorId}.glb`) : null;
  }

  /** Whether an item type comes with its 3D model (format 0.9.2: ``models/<CODE>.glb``, as
   * the type's ``model`` says). */
  hasModel(code) {
    return Boolean(this._modelFile(code));
  }

  /** An item type's 3D model as binary glTF (spec/FORMAT.md, "Models"), or null when the
   * package has none for it. */
  async model(code) {
    const file = this._modelFile(code);
    return file ? file.async("arraybuffer") : null;
  }

  _modelFile(code) {
    const path = `models/${code}.glb`;
    return this._zip && this._itemTypes.get(code)?.model === path ? this._zip.file(path) : null;
  }

  /** Whether a floor comes with its drawing (format 0.11: the export carried the
   * drawings), as its source in the manifest says. */
  hasDrawing(floorId) {
    return Boolean(this._drawingFile(floorId));
  }

  /** A floor's drawing as drawn (spec/FORMAT.md, "Drawings"): its part of its drawing, a
   * drawing view (spec/DRAWING-VIEW.md) in the building's own metres, where floorPlan's
   * spaces are; as the package holds it (gzip: drawing/view.js's readDrawingView, or
   * DrawingView's open, read it). Null when the package has none. */
  async drawing(floorId) {
    const file = this._drawingFile(floorId);
    return file ? file.async("arraybuffer") : null;
  }

  _drawingFile(floorId) {
    const path = (this.manifest.sources ?? []).find((s) => s.floor_id === floorId)?.view;
    return path && this._zip ? this._zip.file(path) : null;
  }

  /** Floors of a building, lowest first: by ordinal, then elevation (a mezzanine, 0.11,
   * has its host's ordinal and stands above it: Ground, Mezzanine, First). */
  floorsOf(buildingId) {
    return this._floorsByBuilding.get(buildingId) ?? [];
  }

  /** The levels of a building (its floors, as floorsOf) or of a location's land (format
   * 0.12: its layout, its one level; by the land's ID, PROJECT-LOCATION-LAND, or the
   * layout's own). What a viewer shows a building or a land by. */
  levelsOf(id) {
    if (!isLandId(id)) return this.floorsOf(id);
    return this.layouts.filter((l) => l.id === id || landOf(l.id) === id);
  }

  /** A building's placement on the map (format 0.7, manifest.json → placements), or, for a
   * location's land, its layout or what is on it (0.12), the site's own (by the layout's
   * ID): the site's centre at its lon, lat, the site plan's up at its bearing. Null when
   * the package has none. */
  placementOf(id) {
    const placements = this.manifest.placements ?? {};
    if (placements[id]) return placements[id];
    if (!isLandId(id)) return null;
    const layout = this.layouts.find((l) => l.id === id || landOf(l.id) === landOf(id));
    return layout ? placements[layout.id] ?? null : null;
  }

  /** Where a building's own frame lies on its location's site (format 0.12: its
   * placement's ``site``: { x_m, y_m, rotation_deg }), or null: placed on the map by
   * itself, or a package before 0.12. */
  siteOf(buildingId) {
    return validSite(this.manifest.placements?.[buildingId]?.site) ?? null;
  }

  /** A point of a building's own frame ([x, y], metres of its drawings) in its site's
   * frame (format 0.12: metres from the site's centre, the site plan's up as y), through
   * its placement's ``site`` (toSite); null when it has none. A layout's points, and its
   * items' ``local``, are in the site's frame already. */
  sitePoint(buildingId, point) {
    const site = this.siteOf(buildingId);
    return site ? toSite(site, point) : null;
  }

  /** A footprint by its ID (format 0.12: where a building stands on its location's
   * layout), or null. */
  footprint(id) {
    const f = this.get(id);
    return f?.properties.kind === "footprint" ? f : null;
  }

  /** The footprints on a layout (format 0.12): the buildings standing on it, each its
   * outline as the site plan draws it and its building (``building_id``, or null). */
  footprintsOn(layoutId) {
    return this._footprintsByLayout.get(layoutId) ?? [];
  }

  /** The footprint a building stands on (format 0.12: one whose ``building_id`` is it, not
   * ignored in review), or null: none in this package (a building's package holds no
   * layout), or the site plan does not show it. */
  footprintOf(buildingId) {
    return this.footprints.find((f) => f.properties.building_id === buildingId && !f.properties.ignored) ?? null;
  }

  spacesOn(floorId) {
    return this._spacesByFloor.get(floorId) ?? [];
  }

  /** The zones a space is divided into (none when it is used as a whole). */
  zonesOf(spaceId) {
    return this._zonesBySpace.get(spaceId) ?? [];
  }

  /** What is used on a floor: the zones of spaces divided into zones, and the other spaces. */
  unitsOn(floorId) {
    return this._unitsByFloor.get(floorId) ?? [];
  }

  /** The furniture and equipment on a floor (format 0.6; none in older packages). An
   * item's ID says nothing of where it is: its properties do (from 0.7, ``local``:
   * where it stands in its building). */
  itemsOn(floorId) {
    return this._itemsByFloor.get(floorId) ?? [];
  }

  /** An item type of the catalogue by its code (an item's ``type``): its names,
   * category, size, mount, colour, shape, model (0.9.2: model()) and fields; or null. */
  itemType(code) {
    return this._itemTypes.get(code) ?? null;
  }

  /** The ground floor of a building: its floor of ordinal 0 that is a storey (format 0.11:
   * not a mezzanine on it, nor a roof), or its lowest floor. */
  groundFloor(buildingId) {
    const floors = this.floorsOf(buildingId);
    return floors.find((f) => f.properties.ordinal === 0 && floorType(f) === "floor") ?? floors[0] ?? null;
  }

  /**
   * Everything an ID says about where an object is:
   * PROJECT-LOCATION-BUILDING-FLOOR-OBJECT. An item's ID (an asset's tag,
   * 7K2Q-XM9F-4DP) says nothing of it: its floor does, and the item is the object.
   * On a location's land (format 0.12: its third segment LAND) there is no building:
   * ``building`` is null and its layout is its ``floor`` (an item on it likewise).
   */
  hierarchy(id) {
    const item = this.get(id);
    if (item?.properties.kind === "item") return { ...this.hierarchy(item.properties.floor_id), object: item };
    const segments = id.split("-");
    const at = (n) => (segments.length >= n ? this.get(segments.slice(0, n).join("-")) : null);
    return {
      project: this.manifest.project,
      location: at(2),
      building: isLandId(id) ? null : at(3),
      floor: at(4),
      object: segments.length === 5 ? this.get(id) : null,
    };
  }

  /** Doors of a space, each with the space on its other side (null for exits). */
  doorsOf(spaceId) {
    return (this._doorsBySpace.get(spaceId) ?? []).map((door) => {
      const other = door.properties.connects.find((c) => c !== spaceId);
      return { door, space: other ? this.get(other) : null };
    });
  }

  /**
   * Find spaces and zones (what is used) by name, number, ID or type. Options: type
   * (exact type), buildingId, floorId, limit.
   */
  search(query = "", { type, buildingId, floorId, limit = 50 } = {}) {
    const q = query.trim().toLowerCase();
    const hits = [];
    for (const s of this.units) {
      const p = s.properties;
      if (type && p.type !== type) continue;
      if (floorId && p.floor_id !== floorId) continue;
      if (buildingId && !p.floor_id.startsWith(buildingId + "-")) continue;
      if (q && ![p.name, p.number, s.id, p.type].some((v) => v && v.toLowerCase().includes(q))) continue;
      hits.push(s);
      if (hits.length >= limit) break;
    }
    return hits;
  }
}

/** A location's land (format 0.12) of a land's ID (its layout's, or what is on it):
 * PROJECT-LOCATION-LAND. */
function landOf(id) {
  return id.split("-").slice(0, 3).join("-");
}

/** A placement's ``site`` (format 0.12) as it must be, or null. */
function validSite(site) {
  return site && ["x_m", "y_m", "rotation_deg"].every((k) => Number.isFinite(site[k])) ? site : null;
}

/** A point of a building's own frame ([x, y], metres) in its site's frame (format 0.12),
 * by its placement's ``site``: its origin at (x_m, y_m), turned rotation_deg clockwise, so
 * (x, y) is at (x_m + x cos r + y sin r, y_m − x sin r + y cos r). */
export function toSite(site, [x, y]) {
  const r = (site.rotation_deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [site.x_m + x * c + y * s, site.y_m - x * s + y * c];
}

/** A point of a site's frame ([x, y], metres from its centre, format 0.12) in a building's
 * own frame, by its placement's ``site``: toSite turned back. */
export function fromSite(site, [x, y]) {
  const r = (site.rotation_deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = x - site.x_m, dy = y - site.y_m;
  return [dx * c - dy * s, dx * s + dy * c];
}

/** What level of its building a floor is (format 0.11, its `type`): "floor" (a storey),
 * "mezzanine" (standing in its host floor, over part of it) or "roof" (the building's
 * roof as a level, open to the sky). A floor of an older package, or of a type a later
 * version adds, is a "floor". */
export function floorType(floor) {
  const type = floor?.properties?.type;
  return type === "mezzanine" || type === "roof" ? type : "floor";
}

/** Floors in their building's order (format 0.11): by ordinal, then elevation, so a
 * mezzanine (its host's ordinal, above it) comes between its host and the floor above:
 * Ground, Mezzanine, First. Two at one elevation (two mezzanines on a floor) by ID, as Studio lists them. */
export function byLevel(a, b) {
  const p = a.properties, q = b.properties;
  return p.ordinal - q.ordinal || p.elevation - q.elevation || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function groupBy(items, key) {
  const map = new Map();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}
