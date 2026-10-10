// node test/run.mjs (after npm run build): the built module, the builder (where items
// stand) and the baker in Node, then in headless Chrome with WebGL drawn in software: a conformance package
// opened, its floors and rooms built, a room chosen by a click and by select, its
// items drawn when asked for (or when one floor is shown), chosen by a click and
// bumped into by the walker, the same package pre-built (world/) shown the same,
// and the WebGL check telling a software renderer from a graphics card.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch, movedEast, repack, serve, wrapped } from "../../svg/test/harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const packages = join(root, "../../spec/conformance/packages");

// the builder and the package reader as the baker runs them: "three", "three/addons/…"
// and "jszip" are the vendored copies
const vendor = pathToFileURL(join(root, "../vendor/")).href;
register(`data:text/javascript,${encodeURIComponent(`
  const to = (s) => s === "three" ? "three/three.module.js" : s.startsWith("three/addons/") ? "three/" + s.slice(6)
    : s === "jszip" ? "jszip.mjs" : null;
  export async function resolve(specifier, context, next) {
    const path = to(specifier);
    return path ? { url: ${JSON.stringify(vendor)} + path, shortCircuit: true } : next(specifier, context);
  }`)}`);
const { FORMAT_VERSION, loadPackage } = await import("../../src/package.js");
const { BUILDER, buildItems, buildPieces, ceilingPanels, groupByFinish, inside, itemExtent, kindOf, originOf, planFloor, roomFinder,
  setItems, tableChairs, toLocal } = await import("../../src/world/build.js");
const { FINISHES, EXTERIOR, defaultFinish, finishOf, floorFinish, wallFinish } = await import("../../src/finishes.js");
const { finishes, seedOf } = await import("../../src/world/finishes.js");
const { TYPE_COLORS } = await import("../../src/theme.js");
const { toLonLat } = await import("../../src/world/frame.js");
const { qualityFor } = await import("../../src/world/gpu.js");
const { isItemId } = await import("../../src/ids.js");

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const truly = (v, what) => {
  if (!v) throw new Error(what);
};

// ---- in Node ------------------------------------------------------------------

test("the WebGL check says no where there is no document", async () => {
  const { webglSupport } = await import("../dist/support.js");
  const r = webglSupport();
  truly(r.ok === false && r.reason === "no-webgl", JSON.stringify(r));
});

test("the module carries three.js and JSZip: it imports nothing", () => {
  const code = readFileSync(join(root, "dist/world.js"), "utf8");
  truly(!/\bimport\s*[\s{*"']/.test(code.replace(/import\.meta/g, "")), "dist/world.js imports another module");
  truly(!/\bfrom\s*["'][^"'\s]+["']\s*;/.test(code), "dist/world.js imports another module"); // not a message's "from"
  truly(!/\bimport\s*\(/.test(code), "dist/world.js loads another module");
});

// spec/FORMAT.md, "Versioning": a reader reads its own major version, not newer than it
test("a package of a newer minor version, or of no version, is refused; older ones and newer patches are read", async () => {
  const path = join(packages, "campus-hq.storeypath");
  const version = (await loadPackage(readFileSync(path))).manifest.format_version;
  truly(version.split(".").slice(0, 2).join(".") === FORMAT_VERSION, `the viewer reads ${FORMAT_VERSION}, the conformance packages are ${version}`);
  const said = async (version) => {
    const bytes = repack(path, (files) => { files.get("manifest.json").format_version = version; });
    return loadPackage(bytes).then((pkg) => (pkg.manifest.format_version === version ? "read" : "read, another version"),
      (e) => e.message);
  };
  for (const v of ["0.9.0", "0.9.12", "0.9", "0.8.0", "0.7.0", "0.6.0", "0.3.1", "0.9.1-rc.1", "0.9.0+build.5"]) {
    truly(await said(v) === "read", `${v}: ${await said(v)}`);
  }
  for (const v of ["0.10.0", "0.10", "0.99.0", "0.10.0-rc1", "1.0.0", "2.7.0"]) {
    const want = `This package is format ${v}, newer than this viewer's 0.9: update the viewer.`;
    truly(await said(v) === want, `${v}: ${await said(v)}`);
  }
  for (const v of ["", ".7", "0x0.7", "0.7.", "v0.7.0", "0.8a.0", "0.7.0.1", " 0.7.0", "0.7.0\n", "0.7.0-", "-1.7",
    "٠.٧", "０.７", 0.7, null, undefined]) {
    truly(/is not a version this viewer can read/.test(await said(v)), `${JSON.stringify(v)}: ${await said(v)}`);
  }
});

/** A binary glTF's JSON. */
const gltfJSON = (glb) => JSON.parse(glb.toString("utf8", 20, 20 + glb.readUInt32LE(12)));

test("the baker writes each floor as binary glTF: its pieces, rooms, obstacles and doors", async () => {
  const out = mkdtempSync(join(tmpdir(), "sp-bake-"));
  try {
    execFileSync(process.execPath, [join(root, "bake.mjs"), join(packages, "simple-office.storeypath"), out]);
    const files = readdirSync(out);
    truly(files.length === 1 && files[0].endsWith("-F00.glb"), `files: ${files}`);
    const glb = readFileSync(join(out, files[0]));
    truly(glb.toString("latin1", 0, 4) === "glTF", "not binary glTF");
    const json = gltfJSON(glb);
    const x = json.scenes[0].extras.storeypath;
    truly(x.floor_id === files[0].slice(0, -4) && x.export_sequence === 1 && x.options.cutHeight === 1.25
      && x.origin.kx > 100000 && x.rooms.length >= 17, JSON.stringify({ ...x, rooms: x.rooms.length }));
    const node = (name) => json.nodes.find((n) => n.name === name);
    for (const name of ["slab", "wall", "wallTop", "floor:office", "volume:office", "ceiling", "door", "doorFrame",
      "glass", "frame", "heads", "sills", "floor:shaft:hidden", "obstacles", "skirting", "trim", "handle", "sillBoard",
      "lights"]) truly(node(name), `no ${name}`);
    truly(!node("wallLow") && !node("wallCut"), "the walls cut low are made from the full ones, not stored");
    truly(x.builder === BUILDER && BUILDER === 5, `builder ${x.builder}`);
    truly(node("lights").extras.view === "walk" && node("trim").extras.view === "full" && !node("skirting").extras.view,
      "panels show walking, architraves not in the cutaway, skirting always");
    // boxes (frames, doors, skirting, …) share their corners and have no normals: flat-shaded, as items are
    for (const name of ["door", "skirting", "handle"]) {
      const attributes = json.meshes[node(name).mesh].primitives[0].attributes;
      truly(attributes.NORMAL === undefined && attributes.TEXCOORD_0 === undefined, `${name}: ${Object.keys(attributes)}`);
    }
    const office = node("floor:office");
    truly(office.extras.material === "floor" && office.extras.type === "office" && !office.extras.view, JSON.stringify(office.extras));
    truly(json.meshes[office.mesh].primitives[0].attributes._ROOM !== undefined, "floors say whose room each vertex is");
    truly(node("floor:shaft:hidden").extras.hidden === true && node("wall").extras.view === "full", "hidden, view");
    truly(json.meshes[node("obstacles").mesh].primitives[0].mode === 1, "obstacles are lines");
    // the doors: each leaf's runs of the door's and handles' vertices, as the file has them (builder 5)
    const vertices = (name) => json.accessors[json.meshes[node(name).mesh].primitives[0].attributes.POSITION].count;
    const leaves = x.doors.flatMap((d) => d.leaves);
    truly(x.doors.length >= 10 && x.doors.every((d) => d.id && d.span.length === 4 && d.top > 2 && d.leaves.length >= 1), "doors");
    truly(leaves.reduce((n, l) => n + l.door[1], 0) === vertices("door") && leaves.reduce((n, l) => n + l.handle[1], 0) === vertices("handle")
      && leaves.every((l) => l.hinge.length === 2 && l.length > 0.5 && Number.isFinite(l.open) && Number.isFinite(l.shut)),
    `leaves: ${JSON.stringify(leaves[0])}, ${vertices("door")} vertices`);
    // what the walker bumps into: the walls' edges and the windows, no leaf
    const pkg = await loadPackage(readFileSync(join(packages, "simple-office.storeypath")));
    const plan = planFloor(pkg, pkg.floors[0], x.origin);
    const walls = plan.wallRings.reduce((n, r) => n + r.length - 1, 0), windows = plan.ways.filter((w) => w.type === "window").length;
    truly(json.accessors[json.meshes[node("obstacles").mesh].primitives[0].attributes.POSITION].count === 2 * (walls + windows),
      "obstacles: open leaves among them");
    // the same package, the same files
    execFileSync(process.execPath, [join(root, "bake.mjs"), join(packages, "simple-office.storeypath"), join(out, "again")]);
    truly(readFileSync(join(out, "again", files[0])).equals(glb), "baked twice, not the same");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

for (const name of ["campus", "campus-hq"]) test(`the baker writes a floor's items apart, a box each, with the IDs they index (${name})`, () => {
  const out = mkdtempSync(join(tmpdir(), "sp-bake-"));
  try {
    execFileSync(process.execPath, [join(root, "bake.mjs"), join(packages, `${name}.storeypath`), out]);
    const json = gltfJSON(readFileSync(join(out, readdirSync(out).find((f) => f.endsWith("-HQ-F00.glb")))));
    const x = json.scenes[0].extras.storeypath;
    const held = { campus: 9, "campus-hq": 10 }[name]; // campus-hq: and a kiosk
    // an item's ID: an asset's tag (format 0.8), the project's number before (campus: 0.6)
    const itemId = name === "campus" ? (id) => /^[A-Z0-9]+-I\d{6}$/.test(id) : isItemId;
    truly(x.builder === 5 && x.items.length === held && x.items.every(itemId), JSON.stringify(x.items));
    const node = (name) => json.nodes.find((n) => n.name === name);
    // drawn in detail, they are built from their templates (in milliseconds), not read
    truly(!node("items") && !node("items:high"), "the detailed items are not in the file");
    const want = { "items:light": { form: "light" }, "items:light:high": { view: "full", form: "light" } };
    for (const [name, extras] of Object.entries(want)) {
      const n = node(name);
      truly(n && n.extras.material === "item" && n.extras.view === extras.view && n.extras.form === extras.form,
        `${name}: ${JSON.stringify(n?.extras)}`);
      const attributes = json.meshes[n.mesh].primitives[0].attributes;
      truly(attributes._ITEM !== undefined && attributes.COLOR_0 !== undefined && attributes.NORMAL === undefined,
        `${name}: ${Object.keys(attributes)}`); // flat-shaded: no normals to store
    }
    const upper = gltfJSON(readFileSync(join(out, readdirSync(out).find((f) => f.endsWith("-HQ-F02.glb")))));
    truly(upper.scenes[0].extras.storeypath.items.length === 0 && !upper.nodes.some((n) => n.name.startsWith("items")),
      "a floor with no items has no item pieces");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

/** Metres between two points [x, n]. */
const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test("a building's frame goes on the map as Studio's does, to a millimetre", () => {
  const { tolerance_m: tolerance, vectors } = JSON.parse(readFileSync(join(packages, "../localframe.json"), "utf8"));
  for (const v of vectors) {
    const [lon, lat] = toLonLat(v.placement, v.local);
    const metres = [(lon - v.lonlat[0]) * 111320 * Math.cos((lat * Math.PI) / 180), (lat - v.lonlat[1]) * 110574];
    truly(Math.hypot(...metres) <= tolerance, `${v.local}: ${metres} m off`);
  }
});

test("across the antimeridian a building's frame is as anywhere: longitudes in (-180, 180]", () => {
  const { tolerance_m: tolerance, vectors } = JSON.parse(readFileSync(join(packages, "../localframe.json"), "utf8"));
  let across = 0;
  for (const v of vectors) {
    for (const at of [179.9999, -179.9999]) { // the same building turned round the earth to stand there
      const [lon, lat] = toLonLat({ ...v.placement, lon: at }, v.local);
      truly(lon > -180 && lon <= 180, `${v.local} at ${at}°: longitude ${lon}`);
      const want = [wrapped(v.lonlat[0] + at - v.placement.lon), v.lonlat[1]];
      const metres = [wrapped(lon - want[0]) * 111320 * Math.cos((lat * Math.PI) / 180), (lat - want[1]) * 110574];
      truly(Math.hypot(...metres) <= tolerance, `${v.local} at ${at}°: ${metres} m off`);
      if (Math.sign(lon) !== Math.sign(at)) across++;
    }
  }
  truly(across > 0, "no point across the antimeridian");
});

// format 0.7: a package a building, each item placed in its building (`local`);
// campus-hq-2 is the same building after it was moved on the map (shifted, turned 15°)
const HQ =(await loadPackage(readFileSync(join(packages, "campus-hq.storeypath")))).buildings[0].id; // remade samples are new projects
/** Each item of a package's building as the world plans it, with what the package says of it. */
const planned = async (name) => {
  const pkg = await loadPackage(readFileSync(join(packages, `${name}.storeypath`)));
  const origin = originOf(pkg, HQ), placement = pkg.manifest.placements[HQ];
  const items = new Map();
  for (const floor of pkg.floorsOf(HQ)) {
    for (const it of planFloor(pkg, floor, origin).items) items.set(it.id, { it, p: pkg.get(it.id).properties });
  }
  return { pkg, origin, placement, items };
};
/** A point of the world's plan back in the building's drawings: the point its placement
 * puts there (Newton's method), and a direction there turned back by its bearing. */
const inBuilding = ({ origin, placement }, [x, n]) => {
  const world = (p) => toLocal(origin, toLonLat(placement, p));
  let p = [placement.x, placement.y];
  for (let i = 0; i < 6; i++) {
    const f = world(p), ax = world([p[0] + 1, p[1]]), ay = world([p[0], p[1] + 1]);
    const [a, c, b, d] = [ax[0] - f[0], ax[1] - f[1], ay[0] - f[0], ay[1] - f[1]], det = a * d - b * c;
    const ex = x - f[0], en = n - f[1];
    p = [p[0] + (d * ex - b * en) / det, p[1] + (a * en - c * ex) / det];
  }
  return p;
};
const turnedBack = ({ placement }, [fx, fn]) => {
  const b = (placement.bearing * Math.PI) / 180;
  return [fx * Math.cos(b) - fn * Math.sin(b), fx * Math.sin(b) + fn * Math.cos(b)];
};

test("a 0.7 package, one building: each item stands where `local` puts it, through the building's placement", async () => {
  const hq = await planned("campus-hq");
  truly(hq.pkg.buildings.length === 1 && hq.pkg.scope.length === 1 && hq.pkg.scope[0] === HQ, `one building: ${hq.pkg.scope}`);
  truly(hq.items.size === hq.pkg.items.length, `every item: ${hq.items.size} of ${hq.pkg.items.length}`);
  for (const [id, { it, p }] of hq.items) {
    const r = (p.local.rotation_deg * Math.PI) / 180;
    const at = inBuilding(hq, [it.x, it.n]), front = turnedBack(hq, [it.fx, it.fn]);
    truly(apart(at, [p.local.x_m, p.local.y_m]) <= 1e-6, `${id} at ${at}, its local point ${p.local.x_m},${p.local.y_m}`);
    truly(apart(front, [Math.sin(r), -Math.cos(r)]) <= 1e-9, `${id} faces ${front}, turned ${p.local.rotation_deg}°`);
    // where the package puts it on the map: its point (rounded to a centimetre) and heading
    truly(apart([it.x, it.n], toLocal(hq.origin, p.display_point)) <= 0.01, `${id}: its point on the map is elsewhere`);
    const h = (p.heading * Math.PI) / 180;
    truly(apart([it.fx, it.fn], [Math.sin(h), Math.cos(h)]) <= 1e-9, `${id}: not its heading on the map`);
  }
});

test("a building moved on the map: its items stand where they stood in it, facing the same way", async () => {
  const [hq, moved] = await Promise.all([planned("campus-hq"), planned("campus-hq-2")]);
  truly(moved.placement.bearing - hq.placement.bearing === 15 && moved.placement.lon !== hq.placement.lon, "moved");
  for (const [id, { it, p }] of moved.items) {
    const was = hq.items.get(id);
    truly(was, `${id} was there before`);
    truly(apart(inBuilding(moved, [it.x, it.n]), inBuilding(hq, [was.it.x, was.it.n])) <= 1e-6
      && apart(inBuilding(moved, [it.x, it.n]), [p.local.x_m, p.local.y_m]) <= 1e-6, `${id} stands elsewhere in the building`);
    truly(apart(turnedBack(moved, [it.fx, it.fn]), turnedBack(hq, [was.it.fx, was.it.fn])) <= 1e-9, `${id} faces another way`);
    // on the map, it turned with the building
    const turned = ((Math.atan2(it.fx, it.fn) - Math.atan2(was.it.fx, was.it.fn)) * 180) / Math.PI;
    truly(Math.abs(((turned + 540) % 360) - 180 - 15) < 1e-9, `${id} turned ${turned}° on the map`);
  }
});

test("with no `local` (before 0.7) an item is placed by its point and heading on the map: the same place", async () => {
  const hq = await planned("campus-hq");
  for (const i of hq.pkg.items) delete i.properties.local;
  for (const floor of hq.pkg.floorsOf(HQ)) {
    for (const it of planFloor(hq.pkg, floor, hq.origin).items) {
      const want = hq.items.get(it.id).it;
      truly(apart([it.x, it.n], [want.x, want.n]) <= 0.01 && apart([it.fx, it.fn], [want.fx, want.fn]) <= 1e-9,
        `${it.id}: ${JSON.stringify([it.x, it.n, it.fx, it.fn])} vs ${JSON.stringify([want.x, want.n, want.fx, want.fn])}`);
    }
  }
});

test("a desk is built with what goes with its grade: visitors' chairs, a return, a credenza, an executive chair", async () => {
  const seen = {}; // a type's desk, as built: what is round it, in its own frame
  for (const name of ["campus-hq", "campus-annex"]) {
    const pkg = await loadPackage(readFileSync(join(packages, `${name}.storeypath`)));
    const b = pkg.buildings[0].id;
    for (const floor of pkg.floorsOf(b)) {
      const plan = planFloor(pkg, floor, originOf(pkg, b));
      const g = buildItems(plan).find((p) => p.name === "items")?.geometry;
      if (!g) continue;
      const item = g.getAttribute("_item"), pos = g.getAttribute("position");
      plan.items.forEach((it, k) => {
        if (!it.type.startsWith("DESK-")) return;
        const at = []; // [across, ahead, up]
        for (let i = 0; i < item.count; i++) {
          if (item.getX(i) !== k) continue;
          const x = pos.getX(i) - it.x, n = -pos.getZ(i) - it.n;
          at.push([-x * it.fn + n * it.fx, x * it.fx + n * it.fn, pos.getY(i) - plan.elevation - it.y]);
        }
        const d = it.depth, [a0, b0, a1, b1, top] = itemExtent(it), front = at.filter(([, ahead]) => ahead < -d / 2 - 0.2);
        seen[it.type] = {
          return: at.some(([, ahead, up]) => ahead > d / 2 + 0.75 && ahead < d / 2 + 0.85 && up > it.height - 0.05),
          cabinet: at.some(([, ahead]) => ahead > d / 2 + 1.3),
          visitors: !front.length ? 0 : Math.max(...front.map(([across]) => Math.abs(across))) < 0.3 ? 1 : 2, // (in the middle, or two)
          armchairs: front.some(([, ahead]) => ahead < -d / 2 - 0.75),
          executive: at.some(([, , up]) => up > 1.15),
          // what a click or the walker meets: all of it
          within: at.every(([across, ahead, up]) => across >= a0 - 1e-3 && across <= a1 + 1e-3 && ahead >= b0 - 1e-3
            && ahead <= b1 + 1e-3 && up >= -1e-3 && up <= top + 1e-3),
        };
      });
    }
  }
  const of = (has) => ({ return: false, cabinet: false, visitors: 0, armchairs: false, executive: false, within: true, ...has });
  const want = { "DESK-DIRECTOR": of({ return: true, cabinet: true, visitors: 2, executive: true }), "DESK-JUNIOR": of({}),
    "DESK-MANAGER": of({ return: true, visitors: 2 }),
    "DESK-PRESIDENT": of({ return: true, cabinet: true, visitors: 2, armchairs: true, executive: true }),
    "DESK-SECTION-HEAD": of({ return: true, visitors: 1 }), "DESK-SENIOR": of({ return: true }) };
  const got = Object.fromEntries(Object.entries(seen).sort(([a], [b]) => a.localeCompare(b)));
  truly(JSON.stringify(got) === JSON.stringify(want), `by grade: ${JSON.stringify(got)}`);
});

// the catalogue's meeting tables: [seats, length, across] (Studio's catalogue.py)
const TABLES = [[4, 1.2, 1.2], [6, 1.8, 0.9], [8, 2.4, 1.2], [12, 3.6, 1.4], [14, 4.2, 1.4], [16, 4.8, 1.5]];

test("a meeting table is built with its chairs round it, as many as its size seats, facing it; a board table's high-backed", async () => {
  const got = {};
  for (const [seats, w, d] of TABLES) {
    const it = { id: "T", type: `MEETING-TABLE-${seats}`, mount: "floor", x: 0, n: 0, fx: 0, fn: 1, width: w, depth: d, height: 0.75,
      color: "#a8845e", grade: null, y: 0 };
    const g = buildItems({ elevation: 0, items: [it] }).find((p) => p.name === "items").geometry, pos = g.getAttribute("position");
    const at = []; // [across, ahead, up]: its own frame (here facing the drawing's +y)
    for (let i = 0; i < pos.count; i++) at.push([-pos.getX(i), -pos.getZ(i), pos.getY(i)]);
    const { at: chairs, board } = tableChairs(w, d), [a0, b0, a1, b1, top] = itemExtent(it);
    got[seats] = {
      chairs: chairs.length,
      // each clear of the table: a seat where it stands, its back's top on the far side from the table
      seated: chairs.every(([x, z, turn]) => {
        const ox = -Math.sin(turn), oz = Math.cos(turn), near = at.filter(([u, v]) => Math.hypot(u - x, v - z) < 0.45);
        return (Math.abs(x) > w / 2 || Math.abs(z) > d / 2) && near.some(([, , y]) => y > 0.4 && y < 0.5)
          && near.some(([u, v, y]) => y > 0.95 && (u - x) * ox + (v - z) * oz > 0.15);
      }),
      board,
      high: at.some(([, , y]) => y > 1.15),
      // what a click or the walker meets: all of it
      within: at.every(([u, v, y]) => u >= a0 - 1e-3 && u <= a1 + 1e-3 && v >= b0 - 1e-3 && v <= b1 + 1e-3 && y >= -1e-3 && y <= top + 1e-3),
    };
  }
  const want = Object.fromEntries(TABLES.map(([seats, w]) => [seats, { chairs: seats, seated: true, board: w >= 3.6, high: w >= 3.6, within: true }]));
  truly(JSON.stringify(got) === JSON.stringify(want), `by size: ${JSON.stringify(got)}`);
  const narrow = tableChairs(1.6, 0.6).at;
  truly(narrow.length === 4 && narrow.every(([x]) => Math.abs(x) < 0.8), `a narrow table has none at its ends: ${JSON.stringify(narrow)}`);
});

test("a type's shape (0.9.1) says how it is drawn, whatever its code; none, or one not known, its code does; a box is a box", async () => {
  const drawn = (type, shape, w, d) => {
    const it = { id: "T", type, mount: "floor", x: 0, n: 0, fx: 0, fn: 1, width: w, depth: d, height: 0.75, color: "#a8845e", grade: null,
      shape, y: 0 };
    const g = buildItems({ elevation: 0, items: [it] }).find((p) => p.name === "items").geometry;
    return { kind: kindOf(it), vertices: g.getAttribute("position").count, extent: itemExtent(it).map((v) => Math.round(v * 1000) / 1000) };
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const desk = drawn("WORKSTATION-A", "desk", 1.4, 0.7), junior = drawn("DESK-JUNIOR", null, 1.4, 0.7);
  truly(desk.kind === "DESK" && same(desk, junior), `a workstation shaped as a desk, drawn as one: ${JSON.stringify([desk, junior])}`);
  const conf = drawn("CONF-10", "meeting_table", 3.0, 1.2), meeting = drawn("MEETING-TABLE-X", null, 3.0, 1.2);
  truly(conf.kind === "MEETING" && same(conf, meeting) && tableChairs(3.0, 1.2).at.length === 10,
    `a conference table shaped as a meeting table, its ten chairs round it: ${JSON.stringify([conf, meeting])}`);
  const box = drawn("DESK-MANAGER", "box", 1.8, 0.9);
  truly(box.kind === "plain" && box.vertices === 8 && same(box.extent, [-0.9, -0.45, 0.9, 0.45, 0.75]), `a desk shaped as a box: ${JSON.stringify(box)}`);
  const unknown = drawn("SOFA", "hammock", 2, 0.9), sofa = drawn("SOFA", null, 2, 0.9);
  truly(sofa.kind === "SOFA" && same(unknown, sofa), `a shape not known: by its code: ${JSON.stringify([unknown, sofa])}`);
  truly(drawn("LOCKER-TALL", null, 0.6, 0.5).kind === "plain" && kindOf({ type: "X", shape: "constructor" }) === "plain"
    && kindOf({ type: "TOSTRING" }) === "plain", "a code it does not know, and no shape: a box");
  // a 0.9.1 package: the floor's items have their types' shapes; a 0.9.0 package's, none
  const f0 = (pkg) => planFloor(pkg, pkg.floorsOf(HQ).find((f) => f.id.endsWith("-F00")), originOf(pkg, HQ));
  const shaped = await loadPackage(repack(join(packages, "campus-hq.storeypath"), (files) => {
    files.get("manifest.json").format_version = "0.9.1";
    for (const t of files.get("catalogue.json").types) if (t.code === "DESK-DIRECTOR") t.shape = "box";
  }));
  const director = f0(shaped).items.find((i) => i.type === "DESK-DIRECTOR");
  const plain = f0(await loadPackage(readFileSync(join(packages, "campus-hq.storeypath"))));
  truly(director?.shape === "box" && kindOf(director) === "plain" && plain.items.every((i) => i.shape === null),
    `the package's shapes: ${director?.shape}, ${plain.items.map((i) => i.shape)}`);
});

test("a wayfinding kiosk: a plinth, a post and a head, its screen ahead, as tall as its type, seen in the cutaway", async () => {
  const pkg = await loadPackage(readFileSync(join(packages, "campus-hq.storeypath")));
  const plan = planFloor(pkg, pkg.floorsOf(HQ).find((f) => f.id.endsWith("-F00")), originOf(pkg, HQ));
  const k = plan.items.findIndex((i) => i.type === "KIOSK");
  truly(k >= 0 && plan.items[k].height === 1.7, "a kiosk on the ground floor, 1.7 m tall");
  const pieces = buildItems(plan);
  const of = (name) => {
    const g = pieces.find((p) => p.name === name)?.geometry;
    const at = [];
    for (let i = 0; g && i < g.getAttribute("_item").count; i++) if (g.getAttribute("_item").getX(i) === k) at.push(i);
    return { g, at };
  };
  const { g, at } = of("items"), high = of("items:high");
  // a plinth, a post and a head, bevelled (24 corners each), and its screen (a box: 8)
  truly(at.length === 3 * 24 + 8 && high.at.length === 0, `below the cut: ${at.length} vertices, ${high.at.length} above it`);
  const top = Math.max(...at.map((i) => g.getAttribute("position").getY(i)));
  truly(Math.abs(top - (plan.elevation + 1.7)) < 1e-4, `its top at ${top}`);
  const color = g.getAttribute("color");
  truly(at.some((i) => color.getX(i) < 0.01 && color.getY(i) < 0.01), "its screen, dark");
});

/** The ground floor of campus-hq, planned. */
const hqGround = async () => {
  const pkg = await loadPackage(readFileSync(join(packages, "campus-hq.storeypath")));
  return { pkg, plan: planFloor(pkg, pkg.floorsOf(HQ).find((f) => f.id.endsWith("-F00")), originOf(pkg, HQ)) };
};
/** A piece's triangles. */
const triangles = (p) => (p.geometry.index ? p.geometry.index.count : p.geometry.getAttribute("position").count) / 3;

test("a floor's details: skirting along its walls, architraves and lever handles on its doors, boards on its sills, ceiling panels in its rooms", async () => {
  const { plan } = await hqGround();
  const pieces = Object.fromEntries(buildPieces(plan).pieces.map((p) => [p.name, p]));
  // each door: its frame (three boxes); a box each side up and over it (4 faces each: not against the wall, nor under);
  // three boxes a handle, each side of each leaf; each window's sill (a box, its faces the wall's: 4 faces) and its
  // board (5 faces: not underneath)
  const doors = triangles(pieces.doorFrame) / 36, windows = triangles(pieces.sills) / 8;
  truly(doors > 5 && triangles(pieces.trim) === doors * 6 * 8, `${doors} doors, ${triangles(pieces.trim)} architraves' triangles`);
  truly(triangles(pieces.handle) % 72 === 0 && triangles(pieces.handle) >= doors * 72, `handles: ${triangles(pieces.handle)} triangles`);
  truly(windows > 5 && triangles(pieces.sillBoard) === windows * 10, `${windows} windows, boards: ${triangles(pieces.sillBoard)}`);
  truly(triangles(pieces.skirting) > 100, "skirting");
  // panels: in rooms (not in shafts or lifts), wholly inside them, each its face down alone
  const panels = ceilingPanels(plan);
  truly(triangles(pieces.lights) === panels.length * 2 && panels.length > 20, `${panels.length} panels`);
  for (const q of panels) {
    const u = plan.units.find((v) => v.id === q.unit);
    truly(u && !["shaft", "elevator"].includes(u.type) && u.rings.some((r) => inside(r[0], q.x, -q.z)), `a panel at ${q.x},${q.z} in ${q.unit}`);
  }
  truly(ceilingPanels(plan) === panels, "worked out once a plan");
});

/** An angle in (−π, π]. */
const wrapAngle = (a) => a - 2 * Math.PI * Math.ceil((a - Math.PI) / (2 * Math.PI));
/** A leaf's free edge, lying at angle ``a`` (radians counter-clockwise from east: (cos a, −sin a) in x and z). */
const edgeAt = (leaf, a) => [leaf.hinge[0] + Math.cos(a) * leaf.length, leaf.hinge[1] - Math.sin(a) * leaf.length];
/** Where a point [x, z] is along a door's span (0 to 1 between its jambs) and how far off it. */
const onSpan = ([x1, z1, x2, z2], [x, z]) => {
  const ex = x2 - x1, ez = z2 - z1, l2 = ex * ex + ez * ez;
  const s = ((x - x1) * ex + (z - z1) * ez) / l2;
  return { s, off: Math.abs((x - x1) * ez - (z - z1) * ex) / Math.sqrt(l2) };
};

test("doors: each leaf a run of the door's and handles' vertices of its own, its hinge, how it lies open and shut; an open leaf is not in the walker's way", async () => {
  const { plan } = await hqGround();
  const { pieces, obstacles, doors } = buildPieces(plan);
  const door = pieces.find((p) => p.name === "door").geometry, handle = pieces.find((p) => p.name === "handle").geometry;
  const swung = plan.ways.filter((w) => w.type === "door" && w.leaves.length);
  truly(doors.length === swung.length && doors.length > 20 && doors.every((d, i) => d.id === swung[i].id),
    `${doors.length} doors of ${swung.length}`);
  // the runs: in order, one after another, the whole of each piece (8 corners a leaf, 6 boxes of handles)
  let v = 0, h = 0;
  for (const d of doors) {
    truly(d.top === 2.1 && d.leaves.length === 1, `${d.id}: ${JSON.stringify(d)}`);
    for (const l of d.leaves) {
      truly(l.door[0] === v && l.door[1] === 8 && l.handle[0] === h && l.handle[1] === 48, `${d.id}: runs ${l.door} ${l.handle}`);
      v += l.door[1];
      h += l.handle[1];
      // its corners along the line it lies on, open, from its hinge out to its length
      const pos = door.getAttribute("position"), c = Math.cos(l.open), s = Math.sin(l.open);
      for (let i = l.door[0]; i < l.door[0] + l.door[1]; i++) {
        const px = pos.getX(i) - l.hinge[0], pz = pos.getZ(i) - l.hinge[1];
        const along = px * c - pz * s, across = px * s + pz * c;
        truly(Math.abs(across) < 0.03 && along > 0 && along < l.length + 1e-6, `${d.id}: a corner ${along},${across} off its line`);
      }
      // shut: along its span, from its hinge's jamb across to the other; drawn open at a right angle
      const shut = edgeAt(l, l.shut), at = onSpan(d.span, shut), hinge = onSpan(d.span, l.hinge);
      truly(at.off < 0.06 && at.s > 0.85 && at.s < 1.05 && hinge.s < 0.05 && hinge.off < 0.06, `${d.id}: shut ${JSON.stringify([hinge, at])}`);
      truly(Math.abs(Math.abs(wrapAngle(l.open - l.shut)) - Math.PI / 2) < 0.1, `${d.id}: opens ${wrapAngle(l.open - l.shut)}`);
    }
  }
  truly(v === door.getAttribute("position").count && h === handle.getAttribute("position").count && door.index, "the runs are the pieces");
  // in the walker's way: the walls' edges and the windows, not one open leaf
  const edges = plan.wallRings.reduce((n, r) => n + r.length - 1, 0), windows = plan.ways.filter((w) => w.type === "window").length;
  truly(obstacles.length === edges + windows, `${obstacles.length} obstacles: ${edges} walls' edges, ${windows} windows`);
  for (const d of doors) {
    for (const l of d.leaves) {
      const tip = edgeAt(l, l.open);
      truly(!obstacles.some(([x1, z1, x2, z2]) => Math.hypot(x2 - tip[0], z2 - tip[1]) < 0.01 || Math.hypot(x1 - tip[0], z1 - tip[1]) < 0.01),
        `${d.id}: its leaf is in the way`);
    }
  }
  // the lines along edges, built alone: the same doors, each leaf's run of lines (12 a box)
  const lined = buildPieces(plan, { only: "edges" }).doors;
  let e = 0;
  truly(lined.length === doors.length && lined.every((d, i) => d.id === doors[i].id && d.leaves.every((l, k) => {
    const ok = l.edges[0] === e && l.edges[1] === 24 && JSON.stringify(l.hinge) === JSON.stringify(doors[i].leaves[k].hinge);
    e += 24;
    return ok;
  })), "the lines' runs");
});

test("doors drawn without their swings: one leaf into the room it serves, or two meeting in the middle; two swings drawn, two leaves", async () => {
  const { plan } = await hqGround();
  const swings = new Map(plan.ways.map((w) => [w, w.leaves]));
  for (const w of plan.ways) w.leaves = [];
  const wide = plan.ways.find((w) => w.type === "door" && Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) > 1.3);
  const { doors } = buildPieces(plan);
  truly(doors.length === swings.size - [...swings.keys()].filter((w) => w.type !== "door").length, `${doors.length} doors`);
  for (const d of doors) {
    const len = Math.hypot(d.span[2] - d.span[0], d.span[3] - d.span[1]);
    truly(d.leaves.length === (len > 1.3 ? 2 : 1), `${d.id}: ${d.leaves.length} leaves, ${len.toFixed(2)} m`);
    // shut, they close the span: one from jamb to jamb, two each to the middle
    const tips = d.leaves.map((l) => onSpan(d.span, edgeAt(l, l.shut)));
    if (d.leaves.length === 2) truly(tips.every((t) => Math.abs(t.s - 0.5) < 0.01 && t.off < 0.01), `${d.id}: ${JSON.stringify(tips)}`);
    else truly(Math.abs(tips[0].s - 1) < 0.01 && tips[0].off < 0.01, `${d.id}: ${JSON.stringify(tips)}`);
  }
  truly(wide && doors.find((d) => d.id === wide.id).leaves.length === 2, "the wide door: two leaves");
  // a double door drawn: two swings, from each jamb, each half its width
  const [a, b] = [wide.a, wide.b], len = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / len, nn = (b[0] - a[0]) / len;
  wide.leaves = [[a, [a[0] + nx * len / 2, a[1] + nn * len / 2]], [b, [b[0] + nx * len / 2, b[1] + nn * len / 2]]];
  const double = buildPieces(plan).doors.find((d) => d.id === wide.id);
  const tips = double.leaves.map((l) => onSpan(double.span, edgeAt(l, l.shut)));
  truly(double.leaves.length === 2 && tips.every((t) => Math.abs(t.s - 0.5) < 0.02 && t.off < 0.06)
    && double.leaves.every((l) => Math.abs(Math.abs(wrapAngle(l.open - l.shut)) - Math.PI / 2) < 0.01), `drawn double: ${JSON.stringify(tips)}`);
});

test("lines along edges (the model look): only when asked for, the same when built alone; none on floors or glass", async () => {
  const { plan } = await hqGround();
  truly(buildPieces(plan).pieces.every((p) => !p.edges) && buildItems(plan).every((p) => !p.edges), "lines only when asked for");
  const both = buildPieces(plan, { edges: true }).pieces, alone = buildPieces(plan, { only: "edges" }).pieces;
  const lines = (pieces) => Object.fromEntries(pieces.filter((p) => p.edges).map((p) => [p.name, Array.from(p.edges)]));
  truly(JSON.stringify(lines(both)) === JSON.stringify(lines(alone)), "built alone, other lines");
  truly(alone.every((p) => !p.geometry), "built alone: no geometry");
  const names = Object.keys(lines(alone)).sort();
  truly(JSON.stringify(names) === JSON.stringify(["door", "doorFrame", "frame", "sillBoard", "slab", "wall"]), `lines on ${names}`);
  const items = buildItems(plan, "detailed", { only: "edges" });
  truly(items.length && items.every((p) => p.edges.length % 6 === 0 && p.edges.length > 0 && !p.geometry), "the items' lines");
});

test("items of a kind and size are copies of one template: a thousand desks in milliseconds", async () => {
  const { plan } = await hqGround();
  const desk = plan.items.find((i) => i.type === "DESK-MANAGER");
  setItems(plan, Array.from({ length: 1000 }, (_, k) => ({ ...desk, id: `D${k}`, x: desk.x + (k % 40) * 3, n: desk.n + Math.floor(k / 40) * 3 })));
  buildItems(plan); // (warmed up)
  const t = performance.now();
  const [piece] = buildItems(plan);
  const took = performance.now() - t;
  const one = triangles(piece) / 1000;
  truly(Number.isInteger(one) && one > 300, `${one} triangles a desk`);
  truly(took < 60, `a thousand desks in ${took.toFixed(1)} ms`);
});

test("auto: Low on a software, virtual or integrated renderer; High on a graphics card", () => {
  const low = { software: ["ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
    "llvmpipe (LLVM 15.0.7, 256 bits)", "Microsoft Basic Render Driver", "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)"],
  virtual: ["VMware SVGA 3D", "ANGLE (VMware, Inc., VMware SVGA 3D Direct3D11 vs_5_0 ps_5_0, D3D11)", "Parallels Display Adapter (WDDM)",
    "Citrix Indirect Display Adapter"],
  integrated: ["ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)", "Mesa Intel(R) Iris(R) Xe Graphics (TGL GT2)",
    "Intel(R) HD Graphics 4000", "ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", "Mali-G78", "Adreno (TM) 650"] };
  for (const [why, names] of Object.entries(low)) {
    for (const name of names) truly(JSON.stringify(qualityFor(name)) === JSON.stringify({ quality: "low", why }), `${name}: ${JSON.stringify(qualityFor(name))}`);
  }
  for (const name of ["ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)", "Apple GPU",
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)", "NVIDIA RTX PRO 6000 Blackwell/PCIe/SSE2",
    "ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)", "AMD Radeon Pro 5500M OpenGL Engine",
    "ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", "", null]) {
    truly(qualityFor(name).quality === "high", `${name}: ${JSON.stringify(qualityFor(name))}`);
  }
});

test("a catalogue colour that is not #rrggbb is not used: the item takes the default colour", async () => {
  const given = { COPIER: "red;fill:url(https://attacker.example/beacon.svg#a)", "ACCESS-POINT": "#1F9D8B", SOFA: "rgb(1, 2, 3)",
    TV: "#abc", "BED-KING": "#3b6ea5\n", "DESK-DIRECTOR": 0x8a6238, "DESK-SENIOR": "url(#a)", "DESK-JUNIOR": "#3b6ea5 " };
  const pkg = await loadPackage(repack(join(packages, "campus-hq.storeypath"), (files) => {
    for (const t of files.get("catalogue.json").types) if (t.code in given) t.color = given[t.code];
  }));
  const colors = {};
  for (const floor of pkg.floorsOf(HQ)) for (const it of planFloor(pkg, floor, originOf(pkg, HQ)).items) colors[it.type] = it.color;
  const got = Object.keys(given).map((type) => colors[type]);
  truly(JSON.stringify(got) === JSON.stringify(["#8a8a8a", "#1F9D8B", "#8a8a8a", "#8a8a8a", "#8a8a8a", "#8a8a8a", "#8a8a8a", "#8a8a8a"]),
    `colours: ${JSON.stringify(got)}`);
});

/** The same, numbers to a tolerance; or where they differ. */
const unlike = (a, b, tolerance, where = "") => {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= tolerance ? null : `${where}: ${a} vs ${b}`;
  if (a && b && typeof a === "object" && typeof b === "object") {
    if (Object.keys(a).join() !== Object.keys(b).join()) return `${where}: ${Object.keys(a)} vs ${Object.keys(b)}`;
    for (const k of Object.keys(a)) {
      const d = unlike(a[k], b[k], tolerance, `${where}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${where}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
};

test("a building across the antimeridian is built as anywhere else, a building's width across", async () => {
  const path = join(packages, "campus-hq.storeypath");
  const hq = await loadPackage(readFileSync(path)), origin = originOf(hq, HQ);
  const across = await loadPackage(movedEast(path, 180 - origin.lon)); // its middle at 180°
  const there = originOf(across, HQ);
  const lons = [];
  const visit = (c) => (typeof c[0] === "number" ? lons.push(c[0]) : c.forEach(visit));
  for (const f of across.floorsOf(HQ)) visit(f.geometry.coordinates);
  truly(lons.some((lon) => lon > 179.999) && lons.some((lon) => lon < -179.999), "across it");
  truly(Math.abs(wrapped(there.lon - 180)) < 1e-9 && there.lon > -180 && there.lon <= 180 && there.lat === origin.lat
    && there.kx === origin.kx, `its origin: ${JSON.stringify(there)}, here ${JSON.stringify(origin)}`);
  let items = 0;
  for (const floor of hq.floorsOf(HQ)) {
    const plan = planFloor(across, across.get(floor.id), there), want = planFloor(hq, floor, origin);
    const d = unlike(plan, want, 1e-6, floor.id);
    truly(!d, `${floor.id} is built elsewhere ${d}`);
    items += plan.items.length;
  }
  truly(items === hq.items.length, `its items: ${items} of ${hq.items.length}`);
});


// ---- finishes (format 0.9) ----------------------------------------------------------

test("the finishes: the spec's list as it is, a painter for each, a default of its kind for every type", async () => {
  const spec = JSON.parse(readFileSync(join(root, "../../spec/finishes.json"), "utf8"));
  truly(JSON.stringify(FINISHES) === JSON.stringify(spec), "viewer/src/finishes.js is not spec/finishes.json: node spec/finishes.mjs");
  const { viewerModule } = await import("../../../spec/finishes.mjs");
  truly(readFileSync(join(root, "../src/finishes.js"), "utf8") === viewerModule(spec), "viewer/src/finishes.js was edited by hand");
  const kinds = new Set(finishes().kinds), groups = new Map(FINISHES.groups.map((g) => [g.code, g.applies]));
  const codes = new Set();
  for (const f of FINISHES.finishes) {
    truly(!codes.has(f.code) && kinds.has(f.paint.kind) && groups.get(f.group) === f.applies && f.name && f.name_ar
      && /^#[0-9a-f]{6}$/.test(f.tone) && f.code.startsWith(`${f.applies.toUpperCase()}-`) && finishOf(f.code) === f, f.code);
    codes.add(f.code);
  }
  truly(codes.size >= 40 && codes.size <= 60, `${codes.size} finishes`);
  for (const type of Object.keys(TYPE_COLORS)) {
    truly(finishOf(defaultFinish("floor", type))?.applies === "floor" && finishOf(defaultFinish("wall", type))?.applies === "wall", type);
  }
  truly(finishOf(EXTERIOR)?.applies === "wall" && defaultFinish("floor", "a later type") === defaultFinish("floor", "unspecified"),
    "the exterior, an unknown type");
});

test("every finish paints an image that tiles, near its tone, with its roughness in its normal map's alpha", () => {
  const f = finishes(), n = 128, slow = [];
  for (const fin of FINISHES.finishes) {
    const t = performance.now();
    const r = f.paint(fin.paint.kind, fin.paint, fin.size_m, seedOf(fin.code), n, true);
    slow.push([fin.code, performance.now() - t]);
    truly(r.color.length === n * n * 4 && r.normal.length === n * n * 4, `${fin.code}: sizes`);
    const c = r.color;
    // the step across each edge, against the largest step within: no seam a tile wider than the rest
    const step = (a, b, down) => {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        const i = down ? (k * n + a) * 4 : (a * n + k) * 4, j = down ? (k * n + b) * 4 : (b * n + k) * 4;
        sum += Math.abs(c[i] - c[j]) + Math.abs(c[i + 1] - c[j + 1]) + Math.abs(c[i + 2] - c[j + 2]);
      }
      return sum / n;
    };
    for (const down of [true, false]) {
      let most = 0;
      for (let a = 0; a + 1 < n; a++) most = Math.max(most, step(a, a + 1, down));
      truly(step(n - 1, 0, down) <= most * 1.1 + 2, `${fin.code}: a seam ${down ? "across" : "down"} (${step(n - 1, 0, down).toFixed(1)} vs ${most.toFixed(1)})`);
    }
    const mean = [0, 1, 2].map((k) => { let m = 0; for (let i = 0; i < n * n; i++) m += c[i * 4 + k]; return m / (n * n); });
    const tone = [1, 3, 5].map((k) => parseInt(fin.tone.slice(k, k + 2), 16));
    truly(mean.every((v, k) => Math.abs(v - tone[k]) <= 14), `${fin.code}: ${mean.map(Math.round)} is not its tone ${tone}`);
    let alpha = 0;
    for (let i = 3; i < r.normal.length; i += 4) alpha += r.normal[i];
    truly(alpha > 0 && r.color.every((v, i) => i % 4 !== 3 || v === 255), `${fin.code}: roughness in alpha, colour opaque`);
  }
  const slowest = slow.sort((a, b) => b[1] - a[1])[0];
  truly(slowest[1] < 200, `${slowest[0]} took ${slowest[1].toFixed(0)} ms at ${n} px`);
});

test("a room's finishes: its own, a zone's space's, its type's; a code not known, or for the other side, its type's", () => {
  truly(floorFinish({ type: "office" }) === defaultFinish("floor", "office") && wallFinish({ type: "restroom" }) === "WALL-TILE-WHITE",
    "as its type");
  truly(floorFinish({ type: "office", floor_finish: "FLOOR-CARPET-NAVY" }) === "FLOOR-CARPET-NAVY"
    && wallFinish({ type: "office", wall_finish: "WALL-STONE" }) === "WALL-STONE", "its own");
  const space = { type: "open_area", floor_finish: "FLOOR-WOOD-OAK" };
  truly(floorFinish({ type: "corridor" }, space) === "FLOOR-WOOD-OAK" && floorFinish({ type: "corridor", floor_finish: "FLOOR-RUBBER" }, space)
    === "FLOOR-RUBBER" && floorFinish({ type: "corridor" }, { type: "office" }) === defaultFinish("floor", "corridor"), "a zone");
  truly(floorFinish({ type: "lobby", floor_finish: "FLOOR-LATER-ONE" }) === defaultFinish("floor", "lobby")
    && wallFinish({ type: "lobby", wall_finish: "FLOOR-CARPET-NAVY" }) === defaultFinish("wall", "lobby"), "not known");
});

test("each face of a wall is the room it faces: both sides of a wall between two rooms, the outside none", async () => {
  const pkg = await loadPackage(readFileSync(join(packages, "campus-hq.storeypath")));
  for (const floor of pkg.floorsOf(HQ)) {
    const plan = planFloor(pkg, floor, originOf(pkg, HQ));
    const { pieces, rooms } = buildPieces(plan);
    const wall = pieces.find((q) => q.name === "wall").geometry, find = roomFinder(plan.rooms);
    const pos = wall.getAttribute("position"), nor = wall.getAttribute("normal"), room = wall.getAttribute("_room");
    const faced = new Set();
    let both = 0, outside = 0;
    for (let v = 0; v < pos.count; v += 3) { // each triangle: the room a little off it is the one it says
      const x = (pos.getX(v) + pos.getX(v + 1) + pos.getX(v + 2)) / 3, z = (pos.getZ(v) + pos.getZ(v + 1) + pos.getZ(v + 2)) / 3;
      const nx = nor.getX(v), nz = nor.getZ(v), id = rooms[room.getX(v)];
      truly(room.getX(v) === room.getX(v + 1) && room.getX(v) === room.getX(v + 2), "a triangle of two rooms");
      const off = (d) => find(x + nx * d, -(z + nz * d));
      const here = off(0.05) ?? off(0.25);
      truly((here?.id ?? undefined) === id, `${floor.id}: a face at ${x.toFixed(2)},${z.toFixed(2)} says ${id}, faces ${here?.id}`);
      if (!id) {
        outside++;
        continue;
      }
      faced.add(id);
      // behind it, through the wall: another room (or the outside), never its own
      const behind = [0.12, 0.2, 0.3, 0.45].map((d) => off(-plan.thickness - d)).find(Boolean);
      if (behind && behind.id !== id) both++;
    }
    truly(plan.rooms.every((r) => faced.has(r.id)), `${floor.id}: rooms no wall faces: ${plan.rooms.filter((r) => !faced.has(r.id)).map((r) => r.id)}`);
    truly(both > 100 && outside > 50, `${floor.id}: ${both} faces with another room behind them, ${outside} outside`);
  }
});

test("a piece drawn a finish at a time: its triangles ordered by finish, in groups; moved again in place", async () => {
  const { plan } = await hqGround();
  const { pieces, rooms } = buildPieces(plan);
  const g = pieces.find((q) => q.name === "wall").geometry;
  const tris = g.getAttribute("position").count / 3;
  const typeOf = (i) => (rooms[i] ? plan.rooms.find((r) => r.id === rooms[i])?.type ?? "zone" : "outside");
  const codes = groupByFinish(g, typeOf);
  truly(codes.length > 3 && g.groups.length === codes.length && g.index.count === tris * 3, `groups ${g.groups.length}`);
  const index = g.index, room = g.getAttribute("_room");
  for (const [k, grp] of g.groups.entries()) { // every triangle of a group is of its finish
    for (let i = grp.start; i < grp.start + grp.count; i += 3) truly(typeOf(room.getX(index.getX(i))) === codes[k], "a triangle elsewhere");
  }
  const array = index.array, seen = new Set(Array.from(array, (v, i) => (i % 3 === 0 ? v : -1)).filter((v) => v >= 0));
  truly(seen.size === tris, "every triangle once");
  // one room's walls in another finish: the same index, its triangles moved
  const office = plan.rooms.find((r) => r.type === "office").id;
  const again = groupByFinish(g, (i) => (rooms[i] === office ? "NAVY" : typeOf(i)));
  truly(g.index.array === array && again.includes("NAVY") && g.groups.length === again.length, "moved in place");
  truly(groupByFinish(g, () => "ONE").length === 1 && g.groups.length === 0, "one finish: no groups");
});

// ---- in Chrome ----------------------------------------------------------------

const PAGE = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}#w,#v{width:900px;height:600px}</style>
<div id="w"></div><div id="v"></div>
<script src="/jszip.min.js"></script>
<script>
  // walking never takes the mouse: any ask for it is counted (and none should be)
  window.locks = 0;
  const lock = Element.prototype.requestPointerLock;
  Element.prototype.requestPointerLock = function (...args) {
    window.locks++;
    return lock?.apply(this, args);
  };
</script>
<script type="module">
  import * as sp from "/dist/world.js";
  // every world made here, so that none draws between tests (drawn in software, an idle
  // world would keep a CPU busy): paused after each test, drawing again before the next
  const worlds = new Set();
  class World extends sp.StoreyPathWorld {
    constructor(...args) {
      super(...args);
      worlds.add(this);
    }
    destroy() {
      worlds.delete(this);
      super.destroy();
    }
  }
  window.sp = { ...sp, StoreyPathWorld: World };
  window.idle = (on) => worlds.forEach((w) => (on ? w.pause() : w.resume()));
  window.frames = (n = 2) => new Promise((res) => {
    const step = () => (n-- > 0 ? requestAnimationFrame(step) : res());
    step();
  });
  // what a world shows: each floor's meshes (triangles, bounds), its labels, and the picture
  window.look = async (world, floor = null) => {
    world.setFloor(floor);
    world.select(null, { go: false });
    await window.frames();
    const pieces = {};
    for (const f of world.package.floorsOf(world.building)) {
      world.scene.getObjectByName(f.id).traverse((m) => {
        if (!m.isMesh) return;
        const g = m.geometry;
        g.computeBoundingBox();
        pieces[f.id + " " + m.name] = { tris: (g.index ? g.index.count : g.getAttribute("position").count) / 3,
          box: [...g.boundingBox.min.toArray(), ...g.boundingBox.max.toArray()], visible: m.visible };
      });
    }
    const r = world.renderer;
    r.render(world.scene, world.camera);
    const gl = r.getContext();
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const labels = [...document.querySelectorAll("#" + world.renderer.domElement.parentElement.id + " .sp3d-label")]
      .map((l) => l.textContent).sort();
    const obstacles = world.package.floorsOf(world.building).map((f) => world.plan(f.id).obstacles);
    return { pieces, pixels, labels, obstacles, calls: r.info.render.calls, prebuilt: world.prebuilt };
  };
  // ---- doors: where to stand by one, walking by frames, and a swing seen to its end ----
  const insideRing = (ring, x, z) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
  };
  const crosses = ([ax, az], [bx, bz], [cx, cz], [dx, dz]) => {
    const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
    if (Math.abs(d) < 1e-12) return false;
    const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d, u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  window.crosses = crosses;
  window.insideRing = insideRing;
  /** A door of a floor's plan (the world's plan(floor).doors) with room each side of it: from
   * far metres before its span's middle to as far behind, in rooms, nothing of the
   * floor's in the way but the door; pick: which of those (by default the first). Its
   * middle, the way across it towards the side its first leaf opens to (n), and its ID. */
  window.doorWithRoom = (world, floor, far = 1.5, pick = (d) => true) => {
    const plan = world.plan(floor);
    const inRoom = (x, z) => plan.spaces.some((s) => s.rings.some((r) => insideRing(r, x, z)));
    for (const d of plan.doors) {
      const [[x1, z1], [x2, z2]] = d.span, m = [(x1 + x2) / 2, (z1 + z2) / 2], l = Math.hypot(x2 - x1, z2 - z1);
      let n = [-(z2 - z1) / l, (x2 - x1) / l];
      const [[hx, hz], [tx, tz]] = d.leaves[0];
      if (((hx + tx) / 2 - m[0]) * n[0] + ((hz + tz) / 2 - m[1]) * n[1] < 0) n = [-n[0], -n[1]];
      const a = [m[0] - n[0] * far, m[1] - n[1] * far], b = [m[0] + n[0] * far, m[1] + n[1] * far];
      if (!inRoom(...a) || !inRoom(...b) || plan.obstacles.some(([p, q, r, s]) => crosses(a, b, [p, q], [r, s])) || !pick(d)) continue;
      return { id: d.id, m, n, span: d.span, leaves: d.leaves };
    }
    return null;
  };
  /** Walking on floor: stand at (x, z), looking at (tx, tz) (and pitch radians up; down, below 0). */
  window.standAt = async (world, floor, [x, z], [tx, tz], pitch = 0) => {
    const heading = Math.atan2(-(tx - x), -(tz - z));
    if (world.mode !== "walk" || world.walkFloor !== floor) {
      world.setMode("dollhouse");
      world.setMode("walk", { at: { x, z }, floor, heading });
    } else world.camera.position.set(x, world.camera.position.y, z);
    world.camera.rotation.set(pitch, heading, 0, "YXZ");
    await window.frames(2);
  };
  /** Walk ahead until far metres on, or stopped (a few frames without going on); how far
   * it went. By frames, not by the clock: drawn in software, frames are slow, and each
   * moves the walker a tenth of a second's walk at most. */
  window.walkAhead = async (world, far) => {
    const from = world.player, gone = () => (world.player.x - from.x) * from.dx + (world.player.z - from.z) * from.dz;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    const until = performance.now() + 60000;
    let best = 0, still = 0;
    for (let n = 0; gone() < far && performance.now() < until; n++) {
      await window.frames(1);
      const d = gone();
      still = d > best + 0.001 ? 0 : still + 1;
      best = Math.max(best, d);
      if (n > 10 && still >= 8) break;
    }
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
    return gone();
  };
  /** A point of the world (local metres; y up) on the screen: client pixels. */
  window.screenOf = (world, x, y, z) => {
    world.camera.updateMatrixWorld();
    const p = world.camera.position.clone().set(x, y, z).project(world.camera);
    const box = world.renderer.domElement.getBoundingClientRect();
    return [box.left + ((p.x + 1) / 2) * box.width, box.top + ((1 - p.y) / 2) * box.height];
  };
  /** The way the view looks: its yaw and pitch (radians). */
  window.angles = (world) => {
    const q = world.camera.quaternion;
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
    const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (q.w * q.x - q.y * q.z))));
    return { yaw, pitch };
  };
  /** Frames until the view stops turning (an eased drag, a fling); how many it took. */
  window.still = async (world, most = 200) => {
    let was = null;
    for (let i = 0; i < most; i++) {
      const now = [...world.camera.quaternion.toArray(), ...world.camera.position.toArray()]; // turned and moved
      if (was && now.every((v, k) => Math.abs(v - was[k]) < 1e-6)) return i;
      was = now;
      await window.frames(1);
    }
    return most;
  };
  /** The pointer gone from the view (as when it leaves it). */
  window.away = (world) => world.renderer.domElement.dispatchEvent(new PointerEvent("pointerleave"));
  /** Frames until a glide is over (what glide said last), or none was under way. */
  window.glided = async (world, most = 400) => {
    for (let i = 0; i < most; i++) {
      const last = window.glides?.at(-1);
      if (last && last.state !== "going") return { ...last, frames: i };
      await window.frames(1);
    }
    return { state: "timeout", frames: most };
  };
  /** Frames until a door of a floor is still; how many it was seen swinging. */
  window.settled = async (world, floor, id) => {
    let moving = 0;
    for (let i = 0; i < 400; i++) {
      if (!world.plan(floor).doors.find((d) => d.id === id).moving) break;
      moving++;
      await window.frames(1);
    }
    return moving;
  };
  /** How far a door's leaves are from lying shut: the most any free edge or hinge is off its span. */
  window.offSpan = (door) => {
    const [[x1, z1], [x2, z2]] = door.span, ex = x2 - x1, ez = z2 - z1, l = Math.hypot(ex, ez);
    return Math.max(...door.leaves.flat().map(([x, z]) => Math.abs((x - x1) * ez - (z - z1) * ex) / l));
  };
  window.ready = true;
</script>`;

/** campus-hq with double doors on its ground floor: a door drawn with two leaves (its swing
 * split in two, one from each jamb), and its wide door (1.8 m) drawn without its swing (the
 * builder gives it two leaves). Their IDs in DOUBLE. */
const DOUBLE = {};
const doubleDoors = repack(join(packages, "campus-hq.storeypath"), (files) => {
  const name = files.get("manifest.json").files.openings ?? "openings.geojson";
  const metres = ([a, b]) => Math.hypot((b[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * 110540);
  const doors = files.get(name).features.filter((f) => f.properties.type === "door" && f.properties.floor_id.endsWith("-F00")
    && f.properties.swings?.length === 1 && f.properties.span);
  const wide = doors.find((f) => metres(f.properties.span) > 1.3);
  const drawn = doors.find((f) => f !== wide && f.properties.connects.length === 2 && metres(f.properties.span) > 0.85);
  delete wide.properties.swings;
  const [a, b] = drawn.properties.span, [[h, tip]] = drawn.properties.swings, half = [(tip[0] - h[0]) / 2, (tip[1] - h[1]) / 2];
  drawn.properties.swings = [[a, [a[0] + half[0], a[1] + half[1]]], [b, [b[0] + half[0], b[1] + half[1]]]];
  Object.assign(DOUBLE, { wide: wide.id, drawn: drawn.id });
});

const file = (name) => readFileSync(join(packages, name));
const server = await serve(root, { "/page.html": PAGE, "/simple-office.storeypath": file("simple-office.storeypath"),
  "/campus.storeypath": file("campus.storeypath"), "/simple-office-world.storeypath": file("simple-office-world.storeypath"),
  "/campus-world.storeypath": file("campus-world.storeypath"), "/campus-hq.storeypath": file("campus-hq.storeypath"),
  "/campus-hq-2.storeypath": file("campus-hq-2.storeypath"), "/campus-hq-doors.storeypath": doubleDoors,
  "/jszip.min.js": readFileSync(join(root, "../vendor/jszip.min.js")) });
const page = await launch({ webgl: true });
// Input that must arrive together (a double-click, a double tap, a finger's first move) is
// sent at once, each command not waiting for the one before's answer: on CI, drawn in
// software, an answer can take longer than a double-click, or than a long press.
const together = (...calls) => Promise.all(calls.map((call) => call()));
const doubleClick = (x, y) => together(
  () => page.mouse("mouseMoved", x, y),
  () => page.mouse("mousePressed", x, y, { down: true }),
  () => page.mouse("mouseReleased", x, y),
  () => page.mouse("mousePressed", x, y, { down: true, params: { clickCount: 2 } }),
  () => page.mouse("mouseReleased", x, y, { params: { clickCount: 2 } }));
await page.open(`${server.url}/page.html`, 900, 600);
await page.run(async () => {
  for (let i = 0; i < 100 && !window.ready; i++) await new Promise((r) => setTimeout(r, 50));
});

test("the WebGL check refuses a software renderer", async () => {
  const r = await page.run(() => window.sp.webglSupport());
  truly(r.ok === false && (r.reason === "software" || r.reason === "no-webgl"), JSON.stringify(r));
});

test("the package reader reads items and their catalogue; an older package has none", async () => {
  const r = await page.run(async () => {
    const pkg = await window.sp.loadPackage("/campus.storeypath");
    const floor = pkg.floorsOf(pkg.buildings[0].id)[0].id;
    const on = pkg.itemsOn(floor);
    const copier = on.find((i) => i.properties.type === "COPIER");
    const where = pkg.hierarchy(copier.id);
    const old = await window.sp.loadPackage("/simple-office.storeypath");
    return { items: pkg.items.length, counted: pkg.manifest.counts.items, on: on.length,
      floors: on.every((i) => i.properties.floor_id === floor), got: pkg.get(copier.id) === copier,
      copier: pkg.itemType("COPIER"), none: pkg.itemType("SPACESHIP"), types: pkg.catalogue.types.length,
      where: [where.building?.id, where.floor?.id, where.object?.id], floor, id: copier.id,
      old: [old.items.length, old.catalogue, old.itemsOn(old.floors[0].id).length, old.itemType("COPIER")] };
  });
  truly(r.items === r.counted && r.items === 16 && r.on === 9 && r.floors && r.got, JSON.stringify(r));
  truly(r.copier.mount === "floor" && r.copier.color === "#3b6ea5" && r.copier.fields.some((f) => f.owner === "system")
    && r.none === null && r.types >= 11, JSON.stringify(r.copier));
  truly(r.where[1] === r.floor && r.where[0] === r.floor.split("-").slice(0, 3).join("-") && r.where[2] === r.id,
    `an item's place is its floor's: ${r.where}`);
  truly(JSON.stringify(r.old) === JSON.stringify([0, null, 0, null]), `older: ${JSON.stringify(r.old)}`);
});

test("a package opens as a world: its floor, rooms and labels", async () => {
  const r = await page.run(async () => {
    const world = new window.sp.StoreyPathWorld("#w");
    window.world = world;
    const loaded = new Promise((res) => world.addEventListener("load", (e) => res(e.detail.package.project.id), { once: true }));
    const pkg = await world.open("/simple-office.storeypath");
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const floor = pkg.floorsOf(world.building)[0].id;
    const plan = world.plan(floor);
    return { project: await loaded, building: world.building, floors: pkg.floorsOf(world.building).length,
      spaces: plan.spaces.length, walls: plan.walls.length, canvas: !!document.querySelector("#w canvas"),
      labels: [...document.querySelectorAll("#w .sp3d-label")].map((l) => l.textContent) };
  });
  truly(r.floors === 1 && r.canvas, JSON.stringify(r));
  truly(r.spaces >= 16 && r.walls > 0, `rooms and walls: ${JSON.stringify(r)}`);
  truly(r.labels.some((l) => l.includes("F0-301")), `labels: ${r.labels.slice(0, 5)}`);
});

test("select highlights a room and says which", async () => {
  const r = await page.run(async () => {
    const world = window.world;
    const office = world.package.units.find((u) => u.properties.number === "F0-302");
    const said = new Promise((res) => world.addEventListener("select", (e) => res(e.detail), { once: true }));
    world.select(office.id, { go: false });
    const d = await said;
    return { id: office.id, said: d.id, number: d.feature?.properties.number, selected: world.selected };
  });
  truly(r.said === r.id && r.selected === r.id && r.number === "F0-302", JSON.stringify(r));
});

test("a click on a room chooses it", async () => {
  // where the room's label point is on the screen, as the camera sees it now
  const at = await page.run(async () => {
    const world = window.world;
    world.select(null, { go: false });
    const office = world.package.units.find((u) => u.properties.number === "F0-315");
    const { x, z } = world.toLocal(office.properties.display_point);
    const cam = world.camera;
    const p = cam.position.clone().set(x, 0.05, z).project(cam); // just above the ground floor
    const box = world.renderer.domElement.getBoundingClientRect();
    return { id: office.id, x: box.left + ((p.x + 1) / 2) * box.width, y: box.top + ((1 - p.y) / 2) * box.height };
  });
  await page.click(at.x, at.y);
  const got = await page.run(() => window.world.selected);
  truly(got === at.id, `clicked ${got} at ${Math.round(at.x)},${Math.round(at.y)}, want ${at.id}`);
});

test("another building's package replaces the first", async () => {
  const r = await page.run(async () => {
    const pkg = await window.world.open("/campus.storeypath");
    return { project: pkg.project.id, buildings: pkg.buildings.length, building: window.world.building };
  });
  truly(r.buildings === 2 && r.building, JSON.stringify(r));
});

test("a floor is drawn in a few dozen draw calls, not some for each room", async () => {
  const r = await page.run(async () => {
    const world = window.world;
    await world.open("/simple-office.storeypath");
    const seen = await window.look(world);
    const floor = world.package.floorsOf(world.building)[0].id;
    return { calls: seen.calls, rooms: world.plan(floor).spaces.length };
  });
  // before: a floor, a highlight and a volume a room, and the rest
  truly(r.rooms >= 16 && r.calls <= 40, JSON.stringify(r));
});

/** Pixels that differ by more than a little, of all. */
const differing = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > 8 || Math.abs(a[i + 1] - b[i + 1]) > 8 || Math.abs(a[i + 2] - b[i + 2]) > 8) n++;
  }
  return n / (a.length / 4);
};
/** The same meshes, as many triangles, in the same places. */
const samePieces = (live, baked, mode) => {
  const names = Object.keys(live).sort();
  truly(JSON.stringify(names) === JSON.stringify(Object.keys(baked).sort()), `${mode}: meshes `
    + `${names.filter((n) => !(n in baked))} built here only, ${Object.keys(baked).filter((n) => !(n in live))} pre-built only`);
  for (const n of names) {
    truly(live[n].tris === baked[n].tris && live[n].visible === baked[n].visible, `${mode}: ${n}: ${JSON.stringify([live[n], baked[n]])}`);
    truly(live[n].box.every((v, i) => Math.abs(v - baked[n].box[i]) < 1e-4), `${mode}: ${n} is elsewhere: ${live[n].box} ${baked[n].box}`);
  }
};

for (const name of ["simple-office", "campus"]) {
  test(`${name}, pre-built, looks as it does built here`, async () => {
    const look = async (pkg, mode) => {
      const r = await page.run(async (pkg, mode) => {
        const world = window.world;
        world.setItems(mode === "items" ? true : null); // every floor's items, a box each
        await world.open(pkg);
        world.setXray(mode === "xray");
        world.setShowHidden(mode === "hidden");
        world.setExplode(mode === "explode" ? 4 : 0);
        world.setMode(mode === "walk" ? "walk" : "dollhouse");
        // one floor (the lowest), its items detailed; in the cutaway, those below the cut
        const floor = mode === "floor" || mode === "floor-cut" ? world.package.floorsOf(world.building)[0].id : null;
        world.setCutaway(mode === "cutaway" || mode === "floor-cut");
        const seen = await window.look(world, floor);
        world.setMode("dollhouse");
        return { ...seen, pixels: Array.from(seen.pixels) };
      }, pkg, mode);
      return r;
    };
    for (const mode of ["dollhouse", "cutaway", "xray", "hidden", "explode", "walk", "items", "floor", "floor-cut"]) {
      const live = await look(`/${name}.storeypath`, mode);
      const baked = await look(`/${name}-world.storeypath`, mode);
      truly(live.prebuilt.length === 0 && baked.prebuilt.length >= 1, `pre-built: ${live.prebuilt} / ${baked.prebuilt}`);
      samePieces(live.pieces, baked.pieces, mode);
      truly(JSON.stringify(live.labels) === JSON.stringify(baked.labels), "labels differ");
      const walls = (o) => o.flat(2);
      truly(walls(live.obstacles).length > 100 && walls(live.obstacles).length === walls(baked.obstacles).length
        && walls(live.obstacles).every((v, i) => Math.abs(v - walls(baked.obstacles)[i]) < 1e-4), "the walker bumps into other things");
      const colours = new Set();
      for (let i = 0; i < live.pixels.length; i += 4 * 97) colours.add(live.pixels.slice(i, i + 3).join());
      truly(colours.size > 50, `${mode}: the picture is nearly blank (${colours.size} colours)`);
      const d = differing(live.pixels, baked.pixels);
      truly(d < 0.002, `${mode}: ${(d * 100).toFixed(2)}% of the picture differs`);
    }
    await page.run(() => {
      window.world.setCutaway(false);
      window.world.setXray(false);
      window.world.setShowHidden(false);
      window.world.setExplode(0);
      window.world.setItems(null);
    });
  });
}

test("on a pre-built floor, a click and select choose and highlight a room", async () => {
  const r = await page.run(async () => {
    const world = window.world;
    await world.open("/simple-office-world.storeypath");
    await window.frames();
    const office = world.package.units.find((u) => u.properties.number === "F0-302");
    world.select(office.id, { go: false });
    const lit = world.scene.getObjectByName("highlight");
    lit.geometry.computeBoundingBox();
    const { x, z } = world.toLocal(office.properties.display_point);
    const clicked = world.package.units.find((u) => u.properties.number === "F0-315");
    const p = world.toLocal(clicked.properties.display_point);
    const q = world.camera.position.clone().set(p.x, 0.05, p.z).project(world.camera);
    const box = world.renderer.domElement.getBoundingClientRect();
    return { prebuilt: world.prebuilt.length, selected: world.selected === office.id, lit: lit.visible,
      inside: lit.geometry.boundingBox.containsPoint({ x, y: lit.geometry.boundingBox.min.y, z }),
      id: clicked.id, at: [box.left + ((q.x + 1) / 2) * box.width, box.top + ((1 - q.y) / 2) * box.height] };
  });
  truly(r.prebuilt === 1 && r.selected && r.lit && r.inside, JSON.stringify(r));
  await page.click(r.at[0], r.at[1]);
  const got = await page.run(() => window.world.selected);
  truly(got === r.id, `clicked ${got}, want ${r.id}`);
});

test("another building's pre-built floors are read when it is shown", async () => {
  const r = await page.run(async () => {
    const world = window.world;
    const pkg = await world.open("/campus-world.storeypath");
    const first = world.prebuilt.slice();
    const other = pkg.buildings[1].id;
    await world.setBuilding(other);
    const floors = pkg.floorsOf(other).map((f) => f.id);
    world.setFloor(floors[1]);
    return { first, floors, prebuilt: world.prebuilt, floor: world.floor };
  });
  truly(r.first.length >= 2 && r.floors.every((f) => r.prebuilt.includes(f)) && r.floor === r.floors[1], JSON.stringify(r));
});

test("items are drawn only when asked for, or when one floor is shown: detailed on one, a box each on more", async () => {
  const r = await page.run(async () => {
    const world = window.world;
    await world.open("/campus.storeypath");
    const floors = world.package.floorsOf(world.building).map((f) => f.id);
    const seen = () => {
      const meshes = {};
      world.scene.traverse((m) => {
        if (m.isMesh && m.name.startsWith("items")) meshes[`${m.parent.name.split("-").pop()} ${m.name}`] = m.visible;
      });
      return { items: world.items, meshes };
    };
    const all = seen();
    world.setFloor(floors[0]);
    const one = seen();
    world.setCutaway(true);
    const cut = seen();
    world.setCutaway(false);
    world.setItems(false);
    const off = seen();
    world.setFloor(null);
    world.setItems(true);
    const every = seen();
    world.setItems(null);
    const auto = seen();
    return { all, one, cut, off, every, auto };
  });
  const shown = (s) => Object.keys(s.meshes).filter((k) => s.meshes[k]).sort().join(", ");
  truly(!r.all.items && Object.keys(r.all.meshes).length === 0, `all floors: none made ${JSON.stringify(r.all)}`);
  truly(r.one.items && shown(r.one) === "F00 items, F00 items:high", `one floor: ${JSON.stringify(r.one)}`);
  truly(shown(r.cut) === "F00 items", `cut low: those below the cut ${JSON.stringify(r.cut)}`);
  truly(!r.off.items && shown(r.off) === "", `asked not to: ${JSON.stringify(r.off)}`);
  truly(r.every.items && shown(r.every) === "F00 items:light, F00 items:light:high, F01 items:light, F01 items:light:high",
    `asked for, every floor: ${JSON.stringify(r.every)}`);
  truly(!r.auto.items && shown(r.auto) === "", `as before: ${JSON.stringify(r.auto)}`);
});

test("a floor full of items costs a few draw calls", async () => {
  const r = await page.run(async () => {
    const world = window.world;
    await world.open("/campus.storeypath");
    const floor = world.package.floorsOf(world.building)[0].id;
    world.setItems(false);
    const off = (await window.look(world, floor)).calls;
    world.setItems(true);
    const on = (await window.look(world, floor)).calls;
    world.setItems(null);
    return { off, on };
  });
  truly(r.on > r.off && r.on - r.off <= 4, JSON.stringify(r)); // two pieces, and their shadows
});

for (const name of ["campus", "campus-world", "campus-hq", "campus-hq-2"]) {
  test(`${name}: a click on an item chooses it, and select highlights it`, async () => {
    const at = await page.run(async (name) => {
      const world = window.world;
      await world.open(`/${name}.storeypath`);
      const floor = world.package.floorsOf(world.building)[0];
      world.setFloor(floor.id);
      const desk = world.package.itemsOn(floor.id).find((i) => i.properties.type === "DESK-DIRECTOR");
      world.select(desk.id); // the view goes to it
      await window.still(world); // (its flight over: by frames, not the clock)
      const lit = world.scene.getObjectByName("highlight");
      lit.geometry.computeBoundingBox();
      const { x, z } = world.toLocal(desk.properties.display_point);
      const y = floor.properties.elevation + desk.properties.height_m;
      const inside = lit.geometry.boundingBox.containsPoint({ x, y, z });
      world.select(null, { go: false });
      await window.frames();
      const p = world.camera.position.clone().set(x, y, z).project(world.camera);
      const box = world.renderer.domElement.getBoundingClientRect();
      window.said = new Promise((res) => world.addEventListener("select", (e) => res(e.detail), { once: true }));
      return { id: desk.id, prebuilt: world.prebuilt.length, inside, building: world.building, scope: world.package.scope,
        x: box.left + ((p.x + 1) / 2) * box.width, y: box.top + ((1 - p.y) / 2) * box.height };
    }, name);
    truly(at.inside && (name === "campus-world" ? at.prebuilt > 0 : at.prebuilt === 0), JSON.stringify(at));
    truly(name.startsWith("campus-hq") ? JSON.stringify(at.scope) === JSON.stringify([at.building]) : at.scope === null,
      `its building: ${JSON.stringify(at)}`); // a package of 0.7 holds one
    await page.click(at.x, at.y);
    const got = await page.run(async () => {
      const d = await window.said;
      return { id: d.id, kind: d.feature?.properties.kind, type: d.feature?.properties.type, selected: window.world.selected };
    });
    truly(got.id === at.id && got.selected === at.id && got.kind === "item" && got.type === "DESK-DIRECTOR",
      `clicked ${JSON.stringify(got)}, want ${at.id}`);
  });
}

test("the walker bumps into desks, not into access points", async () => {
  const r = await page.run(async () => {
    const world = window.world;
    await world.open("/campus.storeypath");
    const floor = world.package.floorsOf(world.building)[0];
    const items = world.package.itemsOn(floor.id);
    world.setMode("walk");
    // stand at `from`, look along (dx, dz), walk until `far` metres that way or stopped;
    // how far it went. By frames, not by the clock: each frame moves the walker at most
    // a tenth of a second's walk, so where frames are slow (drawn in software) a second
    // of the clock walks less far.
    const walk = async (from, dx, dz, far) => {
      world.camera.position.set(from.x, world.camera.position.y, from.z);
      world.camera.rotation.set(0, Math.atan2(-dx, -dz), 0, "YXZ");
      const gone = () => (world.player.x - from.x) * dx + (world.player.z - from.z) * dz;
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
      const until = performance.now() + 60000;
      let best = 0, still = 0;
      for (let n = 0; gone() < far && performance.now() < until; n++) {
        await window.frames(1);
        const d = gone();
        still = d > best + 0.001 ? 0 : still + 1;
        best = Math.max(best, d);
        if (n > 10 && still >= 8) break; // stopped: something in the way
      }
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
      return gone();
    };
    const facing = (item) => { // where its front faces, and along its width, in x and z
      const h = (item.properties.heading * Math.PI) / 180;
      return { front: [Math.sin(h), -Math.cos(h)], across: [-Math.cos(h), -Math.sin(h)] };
    };
    const desk = items.find((i) => i.properties.type === "DESK-DIRECTOR");
    const c = world.toLocal(desk.properties.display_point), { front } = facing(desk);
    const behind = desk.properties.depth_m / 2 + 1.0; // a metre behind it (its front is towards a window), walking at it
    const toDesk = await walk({ x: c.x - front[0] * behind, z: c.z - front[1] * behind }, front[0], front[1], 3);
    const ap = items.find((i) => i.properties.type === "ACCESS-POINT");
    const copier = items.find((i) => i.properties.type === "COPIER"); // in the same corridor, along it
    const a = world.toLocal(ap.properties.display_point), { across } = facing(copier);
    const underAp = await walk({ x: a.x - across[0] * 1.5, z: a.z - across[1] * 1.5 }, across[0], across[1], 2.2);
    world.setMode("dollhouse");
    return { toDesk, room: 1.0 - 0.22, underAp };
  });
  truly(r.toDesk > 0.3 && r.toDesk < r.room + 0.05, `walked ${r.toDesk.toFixed(2)} m at the desk, ${r.room} m from it`);
  truly(r.underAp > 2, `walked ${r.underAp.toFixed(2)} m under the access point`);
});

test("pre-built floors are used only as they were built: this export, this builder, these sizes", async () => {
  const r = await page.run(async () => {
    // other sizes: built here
    const other = new window.sp.StoreyPathWorld("#v", { cutHeight: 1.0 });
    await other.open("/campus-world.storeypath");
    const sized = other.prebuilt.length;
    other.destroy();
    // a file of an earlier export: built here
    const zip = await window.JSZip.loadAsync(await (await fetch("/campus-world.storeypath")).arrayBuffer());
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    manifest.export.sequence += 1;
    zip.file("manifest.json", JSON.stringify(manifest));
    await window.world.open(await zip.generateAsync({ type: "arraybuffer" }));
    const stale = window.world.prebuilt.length;
    // the files with their extras changed: as written, then of an older builder (before
    // 2, they had no items), which are built here
    const rewritten = async (change) => {
      const zip = await window.JSZip.loadAsync(await (await fetch("/campus-world.storeypath")).arrayBuffer());
      for (const name of Object.keys(zip.files).filter((n) => n.endsWith(".glb"))) {
        const glb = new Uint8Array(await zip.file(name).async("arraybuffer"));
        const length = new DataView(glb.buffer).getUint32(12, true);
        const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)));
        change(json.scenes[0].extras.storeypath);
        const text = new TextEncoder().encode(JSON.stringify(json).padEnd(Math.ceil(JSON.stringify(json).length / 4) * 4));
        const out = new Uint8Array(20 + text.length + glb.length - 20 - length);
        out.set(glb.subarray(0, 20));
        out.set(text, 20);
        out.set(glb.subarray(20 + length), 20 + text.length);
        new DataView(out.buffer).setUint32(8, out.length, true);
        new DataView(out.buffer).setUint32(12, text.length, true);
        zip.file(name, out);
      }
      await window.world.open(await zip.generateAsync({ type: "arraybuffer" }));
      return window.world.prebuilt.length;
    };
    const same = await rewritten(() => {});
    const old = await rewritten((x) => delete x.builder);
    const two = await rewritten((x) => (x.builder = 2)); // before the details and the finer furniture
    window.world.setFloor(window.world.package.floors[0].id);
    const furnished = window.world.scene.getObjectByName("items") !== undefined;
    return { sized, stale, same, old, two, furnished, floors: window.world.plan(window.world.package.floors[0].id) !== null };
  });
  truly(r.sized === 0 && r.stale === 0 && r.same >= 2 && r.old === 0 && r.two === 0 && r.furnished && r.floors, JSON.stringify(r));
});

// format 0.8: the way through a building (route(), the module both viewers share)
const routes = JSON.parse(readFileSync(join(root, "../../spec/conformance/routes.json"), "utf8"));

test("the world's module finds the conformance ways as Studio does, on the network its reader reads", async () => {
  const cases = routes.routes.filter((c) => c.package === "campus-hq.storeypath");
  const r = await page.run(async (cases) => {
    const pkg = await window.sp.loadPackage("/campus-hq.storeypath");
    const old = await window.sp.loadPackage("/campus.storeypath");
    const sorted = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
    const wrong = [];
    for (const c of cases) {
      const got = window.sp.route(pkg, c.from, c.to, { accessible: c.accessible });
      for (const key of ["nodes", "legs", "changes", "steps"]) {
        if (sorted(got?.[key]) !== sorted(c.expect[key])) wrong.push(`${c.name}: its ${key}`);
      }
    }
    const lifts = pkg.spaces.filter((s) => s.properties.type === "elevator");
    return { wrong, nodes: pkg.navigation?.nodes.length ?? 0, old: old.navigation,
      stacks: new Set(lifts.map((s) => s.properties.stack)).size, lifts: lifts.length };
  }, cases);
  truly(r.wrong.length === 0 && cases.length >= 5, r.wrong.join("; "));
  truly(r.nodes > 200 && r.old === null, `the network read: ${r.nodes} nodes; an older package's: ${r.old}`);
  truly(r.lifts === 6 && r.stacks === 2, `two lifts through three floors: ${JSON.stringify(r)}`);
});

test("a way is drawn over each floor it walks on, through the lift between them, and taken away", async () => {
  const lifted = routes.routes.find((c) => c.package === "campus-hq.storeypath" && c.accessible && c.expect.changes.length);
  const r = await page.run(async (c) => {
    const THREE_Y = (o) => { o.geometry.computeBoundingBox(); return o.geometry.boundingBox; };
    const world = new window.sp.StoreyPathWorld("#v");
    const pkg = await world.open("/campus-hq.storeypath");
    const way = window.sp.route(pkg, c.from, c.to, { accessible: true });
    await world.showRoute(way);
    await window.frames();
    const named = (prefix) => {
      const out = [];
      world.scene.traverse((o) => { if (o.name.startsWith(prefix)) out.push(o); });
      return out;
    };
    const legs = named("route:leg:"), links = named("route:link:"), start = named("route:start")[0], end = named("route:end")[0];
    const floors = pkg.floorsOf(world.building);
    const elevation = (id) => floors.find((f) => f.id === id).properties.elevation;
    const first = pkg.navigation.nodes.find((n) => n.id === way.nodes[0]);
    const firstAt = world.toLocal(first.lonlat);
    const legOn = legs.map((m) => [m.parent.name, Math.round((THREE_Y(m).min.y - elevation(m.parent.name)) * 100) / 100]);
    const startFloor = start.parent.name, endFloor = end.parent.name, linkSpan = links[0] ? links[0].scale.y : 0;
    const seen = () => ({ legs: named("route:leg:").map((m) => m.parent.visible), link: links[0]?.visible,
      top: floors.map((f) => world.scene.getObjectByName(f.id).visible) });
    const all = seen();
    world.setFloor(way.legs[0].floor_id);
    const one = seen();
    world.setFloor(null);
    // the camera along the way: the floor it is not on faded meanwhile, clear again after
    const opacity = () => named("route:leg:").map((m) => m.material.opacity);
    // (looked at every frame while it flies: where frames are slow, a few of them may take
    // longer than the whole flight)
    let landed = false, during = null;
    const flying = world.flyRoute({ seconds: 3 }).then(() => (landed = true));
    while (!landed) {
      await window.frames(1);
      const o = opacity();
      if (!during && Math.min(...o) < 0.5) during = o;
    }
    during ??= opacity();
    await flying;
    const after = opacity();
    // again, from where the first ended: how far along the way the camera goes, frame by
    // frame (where it ends depends on the frames, as the first's: it may end where that
    // one did). A long flight, ended here once it has been seen to move: drawn in
    // software, one frame can take longer than a short flight, which then ends in it.
    const before = world.camera.position.clone();
    let moved = 0, flown = false;
    const again = world.flyRoute({ seconds: 60 }).then(() => (flown = true));
    const until = performance.now() + 60000;
    while (!flown && moved <= 1 && performance.now() < until) {
      await window.frames(1);
      moved = Math.max(moved, world.camera.position.distanceTo(before));
    }
    world.clearRoute(); // ends the flight too
    await again;
    const target = { x: world.camera.position.x, y: world.camera.position.y };
    world.clearRoute();
    await window.frames();
    const left = named("route:").length;
    // the page's colours
    await world.showRoute(way, { color: "#ff0000", casing: "rgb(0, 0, 255)", end: "nonsense" });
    const leg = named("route:leg:0")[0].material.uniforms;
    let pin = null;
    named("route:end")[0].traverse((o) => { if (!pin && o.isMesh && o.material.emissive) pin = o.material; });
    const colours = [leg.uColor.value.getHexString(), leg.uEdge.value.getHexString(), pin.color.getHexString()];
    world.clearRoute();
    const shown = floors.map((f) => world.scene.getObjectByName(f.id).visible);
    world.destroy();
    return { legs: legOn, links: links.length, start: [start.position.x - firstAt.x, start.position.z - firstAt.z],
      startFloor, endFloor, wayFloors: way.legs.map((l) => l.floor_id), all, one, moved, left, during, after, colours,
      shown, linkSpan, rise: elevation(way.legs[1].floor_id) - elevation(way.legs[0].floor_id), target };
  }, lifted);
  truly(JSON.stringify(r.legs) === JSON.stringify(r.wayFloors.map((f) => [f, 0.14])), `a ribbon over each floor: ${JSON.stringify(r.legs)}`);
  truly(r.links === 1 && Math.abs(r.linkSpan - r.rise) < 0.05, `through the lift: ${r.links}, ${r.linkSpan} m of ${r.rise}`);
  truly(Math.hypot(...r.start) < 0.05 && r.startFloor === r.wayFloors[0] && r.endFloor === r.wayFloors.at(-1),
    `its start at the kiosk, its end upstairs: ${JSON.stringify(r)}`);
  truly(JSON.stringify(r.all) === JSON.stringify({ legs: [true, true], link: true, top: [true, true, false] }),
    `the floors it goes to, not the one above: ${JSON.stringify(r.all)}`);
  truly(JSON.stringify(r.one) === JSON.stringify({ legs: [true, false], link: false, top: [true, false, false] }),
    `one floor shown: its leg alone: ${JSON.stringify(r.one)}`);
  truly(r.moved > 1, `the camera went along it: ${r.moved}`);
  truly(r.during.length === 2 && Math.min(...r.during) < 0.5 && Math.max(...r.during) > 0.9
    && r.after.every((o) => o > 0.9), `the floor it is not on faded as it goes: ${r.during} then ${r.after}`);
  truly(JSON.stringify(r.colours) === JSON.stringify(["ff0000", "0000ff", "e5484d"]), `the page's colours: ${r.colours}`);
  truly(r.left === 0 && JSON.stringify(r.shown) === "[true,true,true]", `taken away, every floor shown again: ${r.left}, ${r.shown}`);
});

// what a way is drawn with, as the camera goes along it, and the floors round it
const upstairs = routes.routes.find((c) => c.package === "campus-hq.storeypath" && !c.accessible && c.expect.changes[0]?.by === "stairs");
const level = routes.routes.find((c) => c.package === "campus-hq.storeypath" && !c.expect.changes?.length && c.from !== c.to); // (on one floor: no rides)
/** A world (#v) with campus-hq open, whole, cut away, and a way shown on it: ``options``
 * showRoute's; events of the way in window.events. */
const withWay = (options = {}, c = upstairs) => page.run(async (options, c) => {
  window.wayWorld?.destroy();
  const world = (window.wayWorld = new window.sp.StoreyPathWorld("#v"));
  const pkg = await world.open("/campus-hq.storeypath");
  world.setFloor(null);
  world.setCutaway(true);
  window.events = [];
  for (const type of ["routestep", "routeplay", "routeprogress"]) world.addEventListener(type, (e) => window.events.push([type, e.detail]));
  const way = window.sp.route(pkg, c.from, c.to, { accessible: c.accessible });
  window.wayNow = way;
  await world.showRoute(way, options);
  await window.frames(2);
  return { floors: way.legs.map((l) => l.floor_id), steps: way.steps.map((s) => s.kind), to: way.to };
}, options, c);
const named = (prefix) => page.run((prefix) => {
  const out = [];
  window.wayWorld.scene.traverse((o) => { if (o.name.startsWith(prefix)) out.push(o.name); });
  return out;
}, prefix);

test("a way rises in from its start, its end's pin shown once it gets there; chevrons flow along it, frame by frame", async () => {
  await withWay({ animate: true });
  const r = await page.run(async () => {
    const world = window.wayWorld;
    const leg = world.scene.getObjectByName("route:leg:0").material.uniforms, end = world.scene.getObjectByName("route:end");
    const seen = [];
    for (let i = 0; i < 1500; i++) { // by frames: drawn in software, they are few
      seen.push([leg.uReveal.value, end.visible, leg.uTime.value]);
      if (seen.at(-1)[0] > 1e5 && i > 2) break;
      await window.frames(1);
    }
    return seen;
  });
  const reveal = r.map((x) => x[0]);
  // (frames drawn in software are slow: the first seen may be some metres on, but short of its end)
  truly(reveal[0] < 30 && reveal.some((v) => v > reveal[0] && v < 1e5) && reveal.at(-1) > 1e5 && reveal.every((v, i) => i === 0 || v >= reveal[i - 1]),
    `drawn in, never back: ${reveal.slice(0, 8)}`);
  truly(r.filter((x) => x[0] < 3).every((x) => !x[1]) && r.at(-1)[1], "the end's pin once the way is there");
  truly(r.at(-1)[2] > r[0][2], `the chevrons' clock goes on: ${r[0][2]} then ${r.at(-1)[2]}`);
});

test("without motion (reduced motion asked for) a way is there at once, and going along it is there at once", async () => {
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  try {
    await withWay({ animate: true });
    const r = await page.run(async () => {
      const world = window.wayWorld;
      const reveal = world.scene.getObjectByName("route:leg:0").material.uniforms.uReveal.value;
      const end = world.scene.getObjectByName("route:end");
      let done = false;
      const flying = world.flyRoute().then(() => (done = true));
      for (let i = 0; i < 20 && !done; i++) await window.frames(1);
      await flying;
      const p = world.camera.position.clone();
      end.getWorldPosition(p);
      return { reveal, end: end.visible, done, near: world.camera.position.distanceTo(p),
        plays: window.events.filter(([t]) => t === "routeplay").map(([, d]) => d.state) };
    });
    truly(r.reveal > 1e5 && r.end && r.done && r.near < 40, `at once, the destination framed: ${JSON.stringify(r)}`);
    truly(JSON.stringify(r.plays) === '["playing","ended"]', `said: ${r.plays}`);
  } finally {
    await page.send("Emulation.setEmulatedMedia", { features: [] });
  }
});

test("while a way is shown, rooms' labels but its own are not; its tags say where it starts, ends and changes floor", async () => {
  await withWay({ startLabel: "You are here", animate: false });
  const r = await page.run(() => {
    const world = window.wayWorld;
    const rooms = [...document.querySelectorAll("#v .sp3d-label")].filter((l) => l.parentElement.style.display !== "none").map((l) => l.textContent);
    const tags = Object.fromEntries([...document.querySelectorAll("#v .sp3d-route-tag")].map((t) => [t.className.split(" ")[1], t.textContent]));
    world.clearRoute();
    return { rooms, tags };
  });
  truly(r.rooms.length > 0 && r.rooms.every((t) => t.startsWith("CORRIDOR")), `the corridors it goes along alone: ${r.rooms}`);
  truly(r.tags["sp3d-route-start"] === "You are here" && r.tags["sp3d-route-end"] === "OFFICE 112· Floor 1"
    && r.tags["sp3d-route-change"] === "↑Stairs up to Floor 1", JSON.stringify(r.tags));
  const after = await page.run(async () => {
    await window.frames(2);
    return [...document.querySelectorAll("#v .sp3d-label")].filter((l) => l.parentElement.style.display !== "none").length;
  });
  truly(after > 5, `taken away: the rooms' labels again (${after})`);
});

test("a way over several floors: rooms' labels and its tags on the floor it is at alone, none from a floor under it (shown through it), its end's card over it too; switched as the camera goes up the stairs", async () => {
  // what is said (shown: where on the screen, and over what else, the renderer decides),
  // and the floor each is on (a floor change's tag: the floor it leaves); the floor clear
  // (the one the way is at), frame by frame
  const look = (floors) => page.run(async (floors) => {
    const world = window.wayWorld;
    const levels = Object.fromEntries(world.package.floorsOf(world.building).map((f) => [f.id, f.properties.elevation]));
    window.said = () => {
      const out = [];
      world.scene.traverse((o) => {
        if (!o.isCSS2DObject) return;
        for (let p = o; p; p = p.parent) if (!p.visible) return;
        let floor = o.name.startsWith("route:tag:change:") ? floors[Number(o.name.split(":")[3])] : null;
        for (let p = o; p && !floor; p = p.parent) if (p.name in levels) floor = p.name;
        out.push({ what: o.name.startsWith("route:tag:") ? o.name.split(":")[2] : "room", floor, level: levels[floor] });
      });
      return out;
    };
    window.clear = () => floors.find((id) => !world.scene.getObjectByName(id).children.some((m) => m.userData.faded));
    window.wrong = () => { // said under the floor clear, or over it but for its end
      const at = window.clear(), level = levels[at];
      return window.said().filter((s) => s.floor !== at && (s.level < level || s.what !== "end"));
    };
  }, floors);
  const up = await withWay({ startLabel: "You are here", animate: false });
  await look(up.floors);
  const r = await page.run(async () => {
    const world = window.wayWorld;
    await window.frames(2);
    const overview = { at: window.clear(), said: window.said().map((s) => s.what), wrong: window.wrong() };
    let ended = false;
    world.playRoute({ seconds: 6 }).then(() => (ended = true));
    const wrong = [], ats = [];
    let above = null;
    for (let i = 0; i < 3000 && !ended; i++) {
      await window.frames(1);
      const at = window.clear();
      if (ats.at(-1) !== at) ats.push(at);
      wrong.push(...window.wrong().map((w) => ({ ...w, at, frame: i })));
      if (!above && ats.length > 1) above = window.said().map((s) => s.what);
    }
    const n = window.wayNow.steps.length;
    world.showStep(n - 1, { animate: false });
    await window.frames(2);
    const end = { said: window.said().map((s) => s.what), wrong: window.wrong() };
    world.showStep(0, { animate: false });
    await window.frames(2);
    const start = { said: window.said().map((s) => s.what), wrong: window.wrong() };
    return { overview, ended, ats, wrong: wrong.slice(0, 5), above, end, start };
  });
  const [ground, first] = up.floors;
  truly(r.overview.at === ground && !r.overview.wrong.length && ["start", "change", "end"].every((w) => r.overview.said.includes(w)),
    `at its start: its tags, nothing said off its floor but its end: ${JSON.stringify(r.overview)}`);
  truly(r.ended && JSON.stringify(r.ats) === JSON.stringify([ground, first]), `the camera went up: ${JSON.stringify(r.ats)}`);
  truly(r.wrong.length === 0, `nothing said off the floor it is at as it goes: ${JSON.stringify(r.wrong)}`);
  truly(r.above && !r.above.includes("start") && !r.above.includes("change") && r.above.includes("end"),
    `up the stairs: what was said below gone, its end's card: ${JSON.stringify(r.above)}`);
  truly(!r.end.wrong.length && r.end.said.includes("end") && !r.end.said.includes("start"), `its last step: ${JSON.stringify(r.end)}`);
  truly(!r.start.wrong.length && ["start", "change", "end"].every((w) => r.start.said.includes(w)), `its first step: ${JSON.stringify(r.start)}`);
  // down the stairs: its end, under the floor it starts on, is not said until it is there
  const down = await withWay({ startLabel: "You are here", animate: false }, { from: upstairs.to, to: upstairs.from, accessible: false });
  await look(down.floors);
  const d = await page.run(async () => {
    const world = window.wayWorld;
    await window.frames(2);
    const overview = { said: window.said().map((s) => s.what), wrong: window.wrong() };
    world.showStep(window.wayNow.steps.length - 1, { animate: false });
    await window.frames(2);
    const end = { said: window.said().map((s) => s.what), wrong: window.wrong() };
    world.clearRoute();
    return { overview, end };
  });
  truly(down.floors[0] !== down.floors.at(-1) && !d.overview.wrong.length && d.overview.said.includes("start") && !d.overview.said.includes("end"),
    `going down, at its start: its end's card, under it, not said: ${JSON.stringify(d.overview)}`);
  truly(!d.end.wrong.length && d.end.said.includes("end") && !d.end.said.includes("start"), `going down, its last step: ${JSON.stringify(d.end)}`);
});

test("over the whole building, floors a way does not walk on fade back; on one of several floors, the others but the one it is at; as drawn again after", async () => {
  const shown = await withWay();
  const r = await page.run((floors) => {
    const world = window.wayWorld;
    const state = () => Object.fromEntries(world.package.floorsOf(world.building).map((f) => {
      const g = world.scene.getObjectByName(f.id);
      const pieces = g.children.filter((m) => m.isMesh && m.userData.material);
      return [f.id, { visible: g.visible, faded: pieces.length > 0 && pieces.every((m) => m.userData.faded), shadows: pieces.some((m) => m.castShadow) }];
    }));
    const overview = state();
    world.showStep(window.wayNow.steps.length - 1, { animate: false }); // the end: its floor clear
    const end = state();
    world.setFloor(floors[0]);
    const one = state();
    world.setFloor(null);
    world.clearRoute();
    return { overview, end, one, cleared: state() };
  }, shown.floors);
  const [ground, up] = shown.floors;
  truly(!r.overview[ground].faded && r.overview[ground].shadows && r.overview[up].faded && !r.overview[up].shadows, `at its start: ${JSON.stringify(r.overview)}`);
  truly(r.end[ground].faded && !r.end[up].faded, `at its end: ${JSON.stringify(r.end)}`);
  truly(!r.one[ground].faded && !r.one[up].visible, `one floor shown: as it is: ${JSON.stringify(r.one)}`);
  truly(Object.values(r.cleared).every((f) => f.visible && !f.faded), `taken away: every floor as drawn: ${JSON.stringify(r.cleared)}`);
});

test("showStep frames each step of a way and says so; the step's leg clear, the others faded", async () => {
  const shown = await withWay();
  const r = await page.run(async (n) => {
    const world = window.wayWorld;
    const out = [];
    for (let i = 0; i < n; i++) {
      world.showStep(i, { animate: false });
      await window.frames(1);
      const legs = [0, 1].map((k) => world.scene.getObjectByName(`route:leg:${k}`).material.opacity);
      out.push({ step: world.routeStep, target: [world.target.x, world.target.z], legs });
    }
    return { out, said: window.events.filter(([t]) => t === "routestep").map(([, d]) => [d.index, d.leg]) };
  }, shown.steps.length);
  const take = shown.steps.indexOf("take");
  truly(JSON.stringify(r.said) === JSON.stringify(shown.steps.map((s, i) => [i, s === "arrive" || i > take ? 1 : 0])), `said: ${JSON.stringify(r.said)}`);
  truly(r.out.every((o, i) => o.step === i), "the step shown");
  truly(r.out.every((o, i) => (i > take || shown.steps[i] === "arrive" ? o.legs[1] > 0.9 && o.legs[0] < 0.5 : o.legs[0] > 0.9 && o.legs[1] < 0.5)),
    `its leg clear: ${JSON.stringify(r.out.map((o) => o.legs))}`);
  const moved = r.out.slice(1).some((o, i) => Math.hypot(o.target[0] - r.out[i].target[0], o.target[1] - r.out[i].target[1]) > 2);
  truly(moved, "each framed where it is");
});

test("playing a way: the camera along it, saying how far and which step; paused, played on, stopped; the walk drawn every frame", async () => {
  const shown = await withWay();
  const r = await page.run(async () => {
    const world = window.wayWorld;
    const playing = world.playRoute({ seconds: 6 });
    let ended = false;
    playing.then(() => (ended = true));
    for (let i = 0; i < 6 && !ended; i++) await window.frames(1);
    world.pauseRoute();
    const at = window.events.filter(([t]) => t === "routeprogress").length;
    const cam = world.camera.position.clone();
    await window.frames(4);
    const paused = { state: world.routePlay, progress: window.events.filter(([t]) => t === "routeprogress").length - at,
      still: world.camera.position.distanceTo(cam) < 1e-6 };
    world.playRoute();
    const until = performance.now() + 120000;
    while (!ended && performance.now() < until) await window.frames(1);
    const progress = window.events.filter(([t]) => t === "routeprogress").map(([, d]) => d.fraction);
    const again = world.playRoute({ seconds: 30 });
    await window.frames(3);
    world.stopRoute();
    await again;
    return { ended, paused, first: progress[0], last: progress.at(-1), rising: progress.every((f, i) => i === 0 || f >= progress[i - 1] - 1e-6),
      steps: [...new Set(window.events.filter(([t]) => t === "routestep").map(([, d]) => d.index))],
      plays: window.events.filter(([t]) => t === "routeplay").map(([, d]) => d.state), after: world.routePlay };
  });
  truly(r.ended && r.rising && r.first < 0.2 && r.last > 0.99, `along it to its end: ${JSON.stringify(r)}`);
  truly(r.paused.state === "paused" && r.paused.progress === 0 && r.paused.still, `paused: ${JSON.stringify(r.paused)}`);
  truly(JSON.stringify(r.steps) === JSON.stringify(shown.steps.map((_, i) => i)), `each step in turn: ${r.steps}`);
  truly(JSON.stringify(r.plays) === JSON.stringify(["playing", "paused", "playing", "ended", "playing", "stopped"]) && r.after === null, `said: ${r.plays}`);
});

test("playing a way after a long frame (a slow or busy machine): its start said first, the tour not past it; later long frames not slowed", async () => {
  await withWay({}, level); // (one floor: the tour walks all along, nothing held)
  const r = await page.run(async () => {
    const world = window.wayWorld, progress = () => window.events.filter(([t]) => t === "routeprogress").map(([, d]) => d.fraction);
    const late = (ms) => { const until = performance.now() + ms; while (performance.now() < until); }; // (the page busy)
    window.events.length = 0;
    world.playRoute({ seconds: 6 });
    late(1200); // its first frame comes 1.2 s late
    await window.frames(2);
    const steps = window.events.filter(([t]) => t === "routestep").map(([, d]) => d.index), first = progress()[0];
    const before = progress().at(-1);
    late(2000); // and a later one
    await window.frames(1);
    const after = progress().at(-1);
    world.stopRoute();
    return { steps, first, later: after - before };
  });
  // (a 6 s way on one floor, 4.4 s of it walking: 2 s of it some 0.4 of the way, 0.1 s some 0.02)
  truly(r.steps[0] === 0 && r.first < 0.1 && r.later > 0.15, `its start first, then as long as each frame takes: ${JSON.stringify(r)}`);
});

test("a way's pin and start keep their size on the screen far off: scaled with the distance, never below their own", async () => {
  await withWay();
  const r = await page.run(async () => {
    const world = window.wayWorld, end = world.scene.getObjectByName("route:end");
    const near = world.camera.position.clone();
    end.getWorldPosition(near);
    world.camera.position.set(near.x + 4, near.y + 6, near.z + 4);
    world.camera.lookAt(near);
    await window.frames(2);
    const close = end.scale.x;
    world.camera.position.set(near.x + 60, near.y + 70, near.z + 60);
    await window.frames(2);
    const far = end.scale.x;
    world.destroy();
    window.wayWorld = null;
    return { close, far };
  });
  truly(r.close === 1 && r.far > 2, `scaled: ${JSON.stringify(r)}`);
});

// ---- editing on top of the world: what is aimed at, items given, a ghost, items carried ----

/** Open a package as the world of the page (#w), its lowest floor shown on its own; with
 * ``over``, the view gone over that room (its number), looking down into it. */
const openFloor = (pkg, over = null) => page.run(async (pkg, over) => {
  const world = window.world;
  world.setMode("dollhouse");
  world.setDraggable(false);
  await world.open(pkg);
  const floor = world.package.floorsOf(world.building)[0].id;
  world.setFloor(floor);
  if (over) {
    world.select(world.package.unitsOn(floor).find((u) => u.properties.number === over).id);
    await window.still(world); // (its flight over: by frames, not the clock)
    world.select(null, { go: false });
  }
  await window.frames(3);
  return floor;
}, pkg, over);

test("a point of the building's own frame goes into the world and back, as its items stand", async () => {
  const r = await page.run(async () => {
    const world = window.world;
    await world.open("/campus-hq.storeypath");
    let off = 0, back = 0;
    for (const it of world.package.items) {
      const { x_m, y_m } = it.properties.local;
      const p = world.worldPoint([x_m, y_m]), q = world.toLocal(it.properties.display_point);
      off = Math.max(off, Math.hypot(p.x - q.x, p.z - q.z)); // display points are rounded to 1e-7°
      const b = world.buildingPoint(p);
      back = Math.max(back, Math.hypot(b[0] - x_m, b[1] - y_m));
    }
    const old = await window.sp.loadPackage("/simple-office.storeypath");
    await world.open("/simple-office.storeypath");
    return { off, back, items: world.package.items.length, old: [world.worldPoint([0, 0]), world.buildingPoint({ x: 0, z: 0 })], placements: old.manifest.placements ?? null };
  });
  truly(r.off < 0.02 && r.back < 1e-6, JSON.stringify(r));
  truly(r.placements !== null || (r.old[0] === null && r.old[1] === null), `no placement, no frame: ${JSON.stringify(r.old)}`);
});

test("pointAt: the room, the item and the wall in the way, in the building's own frame; given no point, at the middle of the view", async () => {
  const floor = await openFloor("/campus-hq.storeypath", "005");
  const r = await page.run(async (floor) => {
    const world = window.world;
    const screen = (x, y, z) => {
      const p = world.camera.position.clone().set(x, y, z).project(world.camera);
      const box = world.renderer.domElement.getBoundingClientRect();
      return [box.left + ((p.x + 1) / 2) * box.width, box.top + ((1 - p.y) / 2) * box.height];
    };
    const elevation = world.package.get(floor).properties.elevation;
    const office = world.package.unitsOn(floor).find((u) => u.properties.number === "005");
    const o = world.toLocal(office.properties.display_point);
    const atOffice = world.pointAt(...screen(o.x, elevation, o.z));
    // seen from over it, the oblique view of a whole floor: the near wall in the way
    const desk = world.package.itemsOn(floor).find((i) => i.properties.type === "DESK-MANAGER");
    world.select(desk.id);
    await window.still(world); // the camera's flight over: by frames, not the clock (slow on CI)
    world.select(null, { go: false });
    const d = world.worldPoint([desk.properties.local.x_m, desk.properties.local.y_m]);
    const atDesk = world.pointAt(...screen(d.x, elevation + desk.properties.height_m, d.z));
    // walking in the office, looking level: the wall ahead; looking down: the floor 1.6 m below the eye
    world.setMode("walk", { at: o, heading: 0 });
    await window.frames();
    const level = world.pointAt();
    world.camera.rotation.set(-0.6, 0, 0, "YXZ");
    const down = world.pointAt();
    const eye = world.player;
    world.setMode("dollhouse");
    return { office: office.id, atOffice, desk: desk.id, atDesk, level, down, eye, want: [o.x, o.z],
      local: world.buildingPoint({ x: o.x, z: o.z }) };
  }, floor);
  const near = (a, b, tol) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
  truly(r.atOffice?.space === r.office && r.atOffice.floor === floor && near([r.atOffice.x, r.atOffice.z], r.want, 0.05)
    && near(r.atOffice.local, r.local, 0.05), `the office: ${JSON.stringify(r.atOffice)} want ${r.want}`);
  truly(r.atDesk?.item === r.desk, `the desk: ${JSON.stringify(r.atDesk)}`);
  truly(r.level && r.level.space === r.office && !r.level.item, `walking, level: the office's wall ahead ${JSON.stringify(r.level)}`);
  const ahead = Math.hypot(r.down.x - r.eye.x, r.down.z - r.eye.z);
  truly(r.down.space === r.office && Math.abs(ahead - 1.6 / Math.tan(0.6)) < 0.05, `looking down: ${ahead.toFixed(2)} m ahead ${JSON.stringify(r.down)}`);
});

test("pick says what a click is on; cancelled, nothing is chosen", async () => {
  const floor = await openFloor("/campus-hq.storeypath", "006");
  const at = await page.run(async (floor) => {
    const world = window.world;
    world.select(null, { go: false });
    const office = world.package.unitsOn(floor).find((u) => u.properties.number === "006");
    const o = world.toLocal(office.properties.display_point);
    const p = world.camera.position.clone().set(o.x, world.package.get(floor).properties.elevation, o.z).project(world.camera);
    const box = world.renderer.domElement.getBoundingClientRect();
    window.picks = [];
    window.cancel = (e) => { window.picks.push(e.detail); e.preventDefault(); };
    world.addEventListener("pick", window.cancel);
    return { id: office.id, x: box.left + ((p.x + 1) / 2) * box.width, y: box.top + ((1 - p.y) / 2) * box.height };
  }, floor);
  await page.click(at.x, at.y);
  const cancelled = await page.run(() => {
    window.world.removeEventListener("pick", window.cancel);
    return { picks: window.picks, selected: window.world.selected };
  });
  await page.click(at.x, at.y);
  const chosen = await page.run(() => window.world.selected);
  truly(cancelled.picks.length === 1 && cancelled.picks[0].space === at.id && cancelled.picks[0].local && cancelled.picks[0].door === null
    && cancelled.selected === null,
    `cancelled: ${JSON.stringify(cancelled)}`);
  truly(chosen === at.id, `then chosen: ${chosen}, want ${at.id}`);
});

test("setFloorItems: an item given a shape (0.9.1) is drawn as it, whatever its type's code; given none, as its type says", async () => {
  const floor = await openFloor("/campus-hq.storeypath");
  const r = await page.run(async (floor) => {
    const world = window.world;
    const one = world.package.itemsOn(floor).find((i) => i.properties.type.startsWith("DESK-"));
    const at = { x: one.properties.local.x_m, y: one.properties.local.y_m, rotation: one.properties.local.rotation_deg };
    // the vertices drawn for the floor's first item, over its items' meshes
    const drawn = () => {
      let n = 0;
      world.scene.getObjectByName(floor).traverse((m) => {
        const k = m.name.startsWith("items") ? m.geometry?.getAttribute("_item") : null;
        for (let i = 0; k && i < k.count; i++) if (k.getX(i) === 0) n++;
      });
      return n;
    };
    const given = async (g) => {
      world.setFloorItems(floor, [{ id: one.id, ...at, ...g }]);
      await window.frames();
      return drawn();
    };
    return { desk: await given({ type: one.properties.type }), box: await given({ type: one.properties.type, shape: "box" }),
      none: await given({ type: one.properties.type, shape: null }), locker: await given({ type: "LOCKER-TALL" }),
      lockerAsDesk: await given({ type: "LOCKER-TALL", shape: "desk" }) };
  }, floor);
  truly(r.box === 8 && r.locker === 8 && r.desk > 100 && r.none === r.desk && r.lockerAsDesk > 100, `drawn: ${JSON.stringify(r)}`);
});

test("setFloorItems replaces one floor's items and builds nothing else again; select finds them where they are", async () => {
  const floor = await openFloor("/campus-hq.storeypath");
  const r = await page.run(async (floor) => {
    const world = window.world;
    const wall = () => world.scene.getObjectByName(floor).getObjectByName("wall");
    const before = wall(), upper = world.scene.getObjectByName(world.package.floorsOf(world.building)[1].id).children.slice();
    const given = world.package.itemsOn(floor).slice(0, 3).map((i) => ({ id: i.id, type: i.properties.type,
      x: i.properties.local.x_m, y: i.properties.local.y_m, rotation: i.properties.local.rotation_deg }));
    given[0].x += 1.5; // moved
    given.push({ id: "P-I999999", type: "SOFA", x: 160, y: 60, rotation: 90 }); // a new one
    const t0 = performance.now();
    world.setFloorItems(floor, given);
    await window.frames();
    const took = performance.now() - t0;
    const plan = world.plan(floor);
    world.select(given[0].id, { go: false });
    const lit = world.scene.getObjectByName("highlight");
    lit.geometry.computeBoundingBox();
    const at = world.worldPoint([given[0].x, given[0].y]);
    const inside = lit.geometry.boundingBox.containsPoint({ x: at.x, y: lit.geometry.boundingBox.min.y + 0.1, z: at.z });
    world.select("P-I999999", { go: false });
    return { items: plan.items.map((i) => i.id), same: wall() === before,
      others: world.scene.getObjectByName(world.package.floorsOf(world.building)[1].id).children.every((c, k) => c === upper[k]),
      inside, sofa: world.selected, took, meshes: world.scene.getObjectByName(floor).children.filter((m) => m.name.startsWith("items")).length };
  }, floor);
  truly(r.items.length === 4 && r.items.includes("P-I999999") && r.same && r.others && r.meshes >= 1, JSON.stringify(r));
  truly(r.inside && r.sofa === "P-I999999", `found where they are: ${JSON.stringify(r)}`);
});

test("a ghost shows where an item would go: green, red when refused, with its guides; null takes it away", async () => {
  const floor = await openFloor("/campus-hq.storeypath");
  const r = await page.run(async (floor) => {
    const world = window.world;
    const seen = () => {
      const g = world.scene.getObjectByName("ghost");
      return g ? { parent: g.parent.name, meshes: g.children.filter((c) => c.isMesh).length,
        lines: g.children.filter((c) => c.isLine).map((c) => c.type), color: g.children[0].material.color.getHexString() } : null;
    };
    world.ghost({ type: "DESK-MANAGER", x: 150, y: 52, rotation: 90, guides: [[[149, 50], [151, 50]]] });
    const ok = seen();
    world.ghost({ type: "DESK-MANAGER", x: 150, y: 52, rotation: 90, ok: false });
    const refused = seen();
    world.ghost(null);
    return { ok, refused, gone: seen(), floor };
  }, floor);
  truly(r.ok?.parent === floor && r.ok.meshes >= 1 && r.ok.lines.includes("LineLoop") && r.ok.lines.includes("LineSegments")
    && r.ok.color === "0ca678", `green: ${JSON.stringify(r.ok)}`);
  truly(r.refused?.color === "e03131" && !r.refused.lines.includes("LineSegments") && r.gone === null, JSON.stringify(r));
});

test("items are carried by a drag where they may be (itemdrag…), and the view does not turn; else it does", async () => {
  const floor = await openFloor("/campus-hq.storeypath", "001");
  const at = await page.run(async (floor) => {
    const world = window.world;
    const desk = world.package.itemsOn(floor).find((i) => i.properties.type === "DESK-DIRECTOR");
    const d = world.worldPoint([desk.properties.local.x_m, desk.properties.local.y_m]);
    const p = world.camera.position.clone().set(d.x, world.package.get(floor).properties.elevation + desk.properties.height_m, d.z)
      .project(world.camera);
    const box = world.renderer.domElement.getBoundingClientRect();
    window.dragged = [];
    for (const type of ["itemdragstart", "itemdrag", "itemdragend"]) {
      world.addEventListener(type, (e) => window.dragged.push({ type, ...e.detail }));
    }
    window.camera0 = world.camera.position.toArray();
    world.setDraggable(true);
    return { id: desk.id, x: box.left + ((p.x + 1) / 2) * box.width, y: box.top + ((1 - p.y) / 2) * box.height };
  }, floor);
  await page.drag([at.x, at.y], [at.x + 90, at.y + 30]);
  const carried = await page.run(async () => {
    await window.frames();
    const moved = Math.hypot(...window.world.camera.position.toArray().map((v, i) => v - window.camera0[i]));
    const r = { events: window.dragged.map((e) => e.type), first: window.dragged[0], last: window.dragged.at(-1), moved };
    window.dragged = [];
    window.world.setDraggable(false);
    return r;
  });
  await page.drag([at.x, at.y], [at.x + 90, at.y + 30]);
  const turned = await page.run(async () => {
    await new Promise((r) => setTimeout(r, 300));
    return { events: window.dragged.length, moved: Math.hypot(...window.world.camera.position.toArray().map((v, i) => v - window.camera0[i])) };
  });
  const e = carried.events;
  truly(e[0] === "itemdragstart" && e.at(-1) === "itemdragend" && e.filter((t) => t === "itemdrag").length >= 4
    && carried.first.id === at.id && carried.last.id === at.id && carried.moved < 1e-6, JSON.stringify(carried));
  const step = Math.hypot(carried.last.local[0] - carried.first.local[0], carried.last.local[1] - carried.first.local[1]);
  truly(step > 1 && step < 30, `carried ${step.toFixed(2)} m`);
  truly(turned.events === 0 && turned.moved > 0.1, `not draggable: the view turns ${JSON.stringify(turned)}`);
});

test("updateSpace: a new name at once, a new type builds that floor again (and no other)", async () => {
  const floor = await openFloor("/campus-hq.storeypath");
  const r = await page.run(async (floor) => {
    const world = window.world;
    const office = world.package.unitsOn(floor).find((u) => u.properties.number === "007");
    const wall = () => world.scene.getObjectByName(floor).getObjectByName("wall");
    const upper = world.scene.getObjectByName(world.package.floorsOf(world.building)[1].id);
    const before = wall();
    world.updateSpace(office.id, { name: "Board room" });
    await window.frames();
    const labels = [...document.querySelectorAll("#w .sp3d-label")].map((l) => l.textContent);
    const named = wall() === before;
    world.select(office.id, { go: false });
    world.updateSpace(office.id, { type: "meeting_room" });
    await window.frames();
    const finish = world.scene.getObjectByName(floor).getObjectByName("floor:meeting_room");
    const rooms = [];
    const g = finish.geometry, ids = g.getAttribute("_room");
    const floorOf = world.scene.getObjectByName(floor);
    return { named, labels: labels.filter((l) => l.includes("Board room")), rebuilt: wall() !== before,
      upper: world.scene.getObjectByName(world.package.floorsOf(world.building)[1].id) === upper,
      selected: world.selected, lit: Boolean(world.scene.getObjectByName("highlight")),
      inFinish: ids ? new Set(Array.from(ids.array)).size : 0, id: office.id, type: world.package.get(office.id).properties.type };
  }, floor);
  truly(r.named && r.labels.length === 1, `named at once: ${JSON.stringify(r)}`);
  truly(r.rebuilt && r.upper && r.selected === r.id && r.lit && r.type === "meeting_room" && r.inFinish >= 2, JSON.stringify(r));
});

test("reload builds again the floors asked for, where they are: the view, the floor shown and the choice kept", async () => {
  const floor = await openFloor("/campus-hq.storeypath");
  const r = await page.run(async (floor) => {
    const world = window.world;
    const floors = world.package.floorsOf(world.building).map((f) => f.id);
    const group = (id) => world.scene.getObjectByName(id);
    const kept = group(floors[0]), redone = group(floors[1]);
    const office = world.package.unitsOn(floor).find((u) => u.properties.number === "005");
    world.select(office.id, { go: false });
    // the view still first (the floor's opening may still be moving it, where frames are slow)
    let camera = null;
    for (let i = 0; i < 100; i++) {
      const now = world.camera.position.toArray();
      if (camera && now.every((v, k) => Math.abs(v - camera[k]) < 1e-4)) break;
      camera = now;
      await window.frames(2);
    }
    const said = new Promise((res) => world.addEventListener("reload", (e) => res(e.detail.floors), { once: true }));
    await world.reload("/campus-hq-2.storeypath", { floors: [floors[1]] });
    return { kept: group(floors[0]) === kept, redone: group(floors[1]) !== redone, said: await said, floor: world.floor,
      selected: world.selected === office.id, camera: world.camera.position.toArray().every((v, i) => Math.abs(v - camera[i]) < 1e-3), // (a view fitted again moves metres)
      want: floors[1] };
  }, floor);
  truly(r.kept && r.redone && JSON.stringify(r.said) === JSON.stringify([r.want]) && r.floor === floor && r.selected && r.camera,
    JSON.stringify(r));
});

test("walking from a point of a floor, then back to the dollhouse view as it was; pause stops drawing", async () => {
  const floor = await openFloor("/campus-hq.storeypath");
  const r = await page.run(async (floor) => {
    const world = window.world;
    const office = world.package.unitsOn(floor).find((u) => u.properties.number === "005");
    const o = world.toLocal(office.properties.display_point);
    // the view still, as an orbit dragged before leaves it turning a little while
    let camera = null;
    for (let i = 0; i < 100; i++) {
      const now = world.camera.position.toArray();
      if (camera && now.every((v, k) => Math.abs(v - camera[k]) < 1e-4)) break;
      camera = now;
      await window.frames(2);
    }
    const rooms = [];
    world.addEventListener("roomchange", (e) => rooms.push(e.detail.id));
    world.setMode("walk", { at: o, heading: 1 });
    await window.frames(3);
    const p = world.player;
    world.setMode("dollhouse", { back: true });
    const there = () => world.camera.position.toArray().every((v, i) => Math.abs(v - camera[i]) < 1e-2);
    for (let i = 0; i < 40 && !there(); i++) await new Promise((r) => setTimeout(r, 100));
    const back = there();
    // where no room is (far outside): in the nearest room
    world.setMode("walk", { at: { x: o.x + 500, z: o.z } });
    await window.frames(3);
    const outside = world.room?.id ?? null;
    world.setMode("dollhouse");
    const frames = () => world.renderer.info.render.frame;
    world.pause();
    const f0 = frames();
    await new Promise((r) => setTimeout(r, 200));
    const paused = frames() - f0;
    world.resume();
    await window.frames(3);
    return { id: office.id, at: [p.x, p.z], want: [o.x, o.z], rooms, outside, back, paused, drawn: frames() - f0 };
  }, floor);
  truly(Math.hypot(r.at[0] - r.want[0], r.at[1] - r.want[1]) < 1e-6 && r.rooms.includes(r.id), JSON.stringify(r));
  truly(r.outside !== null && r.back, `outside: in a room ${r.outside}; back: ${r.back}`);
  truly(r.paused === 0 && r.drawn >= 2, `paused: ${r.paused} frames; resumed: ${r.drawn}`);
});

test("a way shown stays shown when a floor it walks on is built again (a room's new type, reload)", async () => {
  const lifted = routes.routes.find((c) => c.package === "campus-hq.storeypath" && c.accessible && c.expect.changes.length);
  const r = await page.run(async (c) => {
    const world = window.world;
    world.setMode("dollhouse");
    const pkg = await world.open("/campus-hq.storeypath");
    world.setFloor(null);
    const way = window.sp.route(pkg, c.from, c.to, { accessible: true });
    await world.showRoute(way, { color: "#ff0000" });
    const legs = () => {
      const out = [];
      world.scene.traverse((o) => { if (o.name.startsWith("route:leg:")) out.push(o); });
      return out.map((m) => ({ floor: m.parent.name, live: world.scene.getObjectByName(m.parent.name) === m.parent,
        color: m.material.uniforms.uColor.value.getHexString() })).sort((x, y) => x.floor.localeCompare(y.floor));
    };
    const before = legs();
    const room = pkg.unitsOn(way.legs[0].floor_id).find((u) => u.properties.type === "office");
    world.updateSpace(room.id, { type: "meeting_room" });
    const retyped = legs();
    await world.reload("/campus-hq.storeypath", { floors: [way.legs[1].floor_id] });
    const reloaded = legs();
    world.clearRoute();
    return { before, retyped, reloaded, route: world.route };
  }, lifted);
  const same = (a) => JSON.stringify(a) === JSON.stringify(r.before) && a.every((l) => l.live && l.color === "ff0000");
  truly(r.before.length === 2 && same(r.retyped) && same(r.reloaded) && r.route === null, JSON.stringify(r));
});

// ---- the looks and qualities ---------------------------------------------------------

/** In the page: what a world draws, as seen on its canvas (the frame after the next one,
 * read before the page shows it): how many colours, of a sample of its pixels. */
const PICTURE = `async (world) => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const c = world.renderer.domElement, out = document.createElement("canvas");
  out.width = c.width;
  out.height = c.height;
  const ctx = out.getContext("2d");
  ctx.drawImage(c, 0, 0);
  const px = ctx.getImageData(0, 0, out.width, out.height).data, colours = new Set();
  for (let i = 0; i < px.length; i += 4 * 97) colours.add(px[i] + "," + px[i + 1] + "," + px[i + 2]);
  return colours.size;
}`;

test("the look: real, at the quality the machine gets (Low here: a software renderer); High and the model when asked, building nothing again", async () => {
  const r = await page.run(async (PICTURE) => {
    const picture = eval(PICTURE);
    const world = new window.sp.StoreyPathWorld("#v");
    const said = [];
    world.addEventListener("lookchange", (e) => said.push(e.detail));
    const first = world.look;
    const pkg = await world.open("/campus-hq.storeypath");
    const floor = pkg.floorsOf(world.building)[0].id;
    world.setFloor(floor);
    await world.ready();
    const meshes = () => {
      const out = {};
      world.scene.getObjectByName(floor).traverse((m) => {
        // (a piece drawn a finish at a time has a material a finish)
        if (m.isMesh && m.userData.material) out[m.name] = { geometry: m.geometry.uuid, material: [].concat(m.material).map((x) => x.uuid).join(),
          lines: m.children.filter((l) => l.isLineSegments && l.visible).length };
      });
      return out;
    };
    const office = () => world.scene.getObjectByName(floor).getObjectByName("floor:office").material;
    const real = { meshes: meshes(), finished: Boolean(office().map), colours: await picture(world) };
    world.setStyle("model");
    await world.ready();
    const model = { meshes: meshes(), clay: [].concat(world.scene.getObjectByName(floor).getObjectByName("wall").material).every((m) => !m.map),
      colours: await picture(world) };
    world.setQuality("high");
    await world.ready();
    const high = { look: world.look, colours: await picture(world) };
    world.setStyle("real");
    world.setQuality("low");
    const back = { meshes: meshes(), look: world.look };
    world.setQuality("auto");
    const auto = world.look;
    world.setStyle("cartoon"); // not a look: as it was
    world.setQuality("ultra");
    const kept = world.look;
    world.destroy();
    // asked for at the start
    const given = new window.sp.StoreyPathWorld("#v", { style: "model", quality: "high" });
    const asked = given.look;
    given.destroy();
    const wrong = new window.sp.StoreyPathWorld("#v", { style: "cartoon", quality: "ultra" });
    const defaults = wrong.look;
    wrong.destroy();
    return { first, real, model, high, back, auto, kept, asked, defaults, said };
  }, PICTURE);
  const look = (style, quality, drawn, why = null) => JSON.stringify({ style, quality, drawn, why });
  truly(JSON.stringify(r.first) === look("real", "auto", "low", "software"), `at first: ${JSON.stringify(r.first)}`);
  truly(r.real.finished && r.real.colours > 40, `real: painted finishes, a picture of ${r.real.colours} colours`);
  // nothing built again: the same geometry, other materials; the model's lines along edges
  const names = Object.keys(r.real.meshes);
  truly(names.length > 20 && names.every((n) => r.model.meshes[n]?.geometry === r.real.meshes[n].geometry
    && r.back.meshes[n]?.geometry === r.real.meshes[n].geometry), "built again");
  truly(names.filter((n) => r.model.meshes[n].material !== r.real.meshes[n].material).length >= names.length - 2, "the same materials");
  truly(r.model.meshes.wall.lines === 1 && r.model.meshes.items.lines === 1 && r.model.meshes.door.lines === 1 && r.model.clay,
    `model: lines along edges ${JSON.stringify(r.model.meshes.wall)}`);
  truly(names.every((n) => r.real.meshes[n].lines === 0 && r.back.meshes[n].lines === 0), "real: no lines");
  truly(r.model.colours > 20 && r.high.colours > 20, `pictures of ${r.model.colours} and ${r.high.colours} colours`);
  truly(JSON.stringify(r.high.look) === look("model", "high", "high"), JSON.stringify(r.high.look));
  truly(JSON.stringify(r.back.look) === look("real", "low", "low") && JSON.stringify(r.auto) === look("real", "auto", "low", "software")
    && JSON.stringify(r.kept) === JSON.stringify(r.auto), `${JSON.stringify(r.back.look)} ${JSON.stringify(r.auto)} ${JSON.stringify(r.kept)}`);
  truly(r.said.map((l) => `${l.style}:${l.quality}`).join() === "model:auto,model:high,real:high,real:low,real:auto", JSON.stringify(r.said));
  truly(JSON.stringify(r.asked) === look("model", "high", "high") && JSON.stringify(r.defaults) === look("real", "auto", "low", "software"),
    `${JSON.stringify(r.asked)} ${JSON.stringify(r.defaults)}`);
});

test("walking: the ceiling keeps the sun out, and the panels nearest the walker light its room; none orbiting", async () => {
  const r = await page.run(async () => {
    const world = new window.sp.StoreyPathWorld("#v");
    const pkg = await world.open("/campus-hq.storeypath");
    const floor = pkg.floorsOf(world.building)[0].id;
    const room = world.plan(floor).spaces.find((s) => s.type === "office");
    const xs = room.rings.flat(1).map((p) => p[0]), zs = room.rings.flat(1).map((p) => p[1]);
    const at = { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
    const lights = () => {
      const out = [];
      world.scene.traverse((o) => { if (o.isSpotLight) out.push({ on: o.visible, lit: o.intensity > 0, x: o.position.x, z: o.position.z }); });
      return out;
    };
    const orbiting = lights();
    world.setMode("walk", { at, floor });
    await window.frames(3);
    const walking = lights(), here = world.room?.id ?? null;
    const ceiling = world.scene.getObjectByName(floor).getObjectByName("ceiling");
    const panels = world.scene.getObjectByName(floor).getObjectByName("lights");
    const shown = { ceiling: ceiling.visible && ceiling.castShadow, panels: panels.visible };
    world.setMode("dollhouse");
    const after = lights();
    world.destroy();
    return { orbiting, walking, after, here, room: room.id, shown, rings: room.rings };
  });
  const inRoom = (l) => r.rings.some((ring) => ring.length && (() => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > l.z) !== (zj > l.z) && l.x < ((xj - xi) * (l.z - zi)) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
  })());
  truly(r.orbiting.length === 4 && r.orbiting.every((l) => !l.on) && r.after.every((l) => !l.on), `orbiting: ${JSON.stringify(r.orbiting)}`);
  truly(r.here === r.room && r.walking.every((l) => l.on) && r.walking.some((l) => l.lit)
    && r.walking.filter((l) => l.lit).every(inRoom), `walking in ${r.here}: ${JSON.stringify(r.walking)}`);
  truly(r.shown.ceiling && r.shown.panels, JSON.stringify(r.shown));
});

test("the way, a ghost, items given and a choice in the model look at High quality", async () => {
  const lifted = routes.routes.find((c) => c.package === "campus-hq.storeypath" && c.accessible && c.expect.changes.length);
  const r = await page.run(async (c, PICTURE) => {
    const picture = eval(PICTURE);
    const world = new window.sp.StoreyPathWorld("#v", { style: "model", quality: "high" });
    const pkg = await world.open("/campus-hq.storeypath");
    await world.ready();
    const floor = pkg.floorsOf(world.building)[0].id;
    world.setFloor(null);
    await world.showRoute(window.sp.route(pkg, c.from, c.to, { accessible: true }));
    const route = [];
    world.scene.traverse((o) => { if (o.name.startsWith("route:leg:")) route.push(o.visible && o.parent.visible); });
    world.setFloor(floor);
    const desk = pkg.itemsOn(floor).find((i) => i.properties.type.startsWith("DESK-"));
    const { x_m: x, y_m: y } = desk.properties.local;
    world.ghost({ type: desk.properties.type, x: x + 3, y, ok: false });
    const ghost = world.scene.getObjectByName("ghost");
    const given = world.setFloorItems(floor, [{ id: desk.id, type: desk.properties.type, x: x + 1, y, rotation: 0 }]);
    await window.frames(2);
    const items = world.scene.getObjectByName(floor).getObjectByName("items");
    const lines = items.children.filter((l) => l.isLineSegments && l.visible).length;
    world.select(desk.id, { go: false });
    const lit = world.scene.getObjectByName("highlight");
    const aimed = world.pointAt();
    const colours = await picture(world);
    world.destroy();
    return { route, ghost: Boolean(ghost?.parent), given, lines, lit: Boolean(lit?.visible), aimed: aimed?.floor === floor, colours };
  }, lifted, PICTURE);
  truly(r.route.length === 2 && r.route.every(Boolean) && r.ghost && r.given && r.lines === 1 && r.lit && r.aimed && r.colours > 20,
    JSON.stringify(r));
});


test("finishes in 3D: each room's floor and walls as the package says; changed in place, nothing built again", async () => {
  const floor = await openFloor("/campus-hq.storeypath");
  const r = await page.run(async (floor) => {
    const world = window.world;
    const group = world.scene.getObjectByName(floor);
    const finishesOf = (name) => [].concat(group.getObjectByName(name).material).map((m) => m.userData.finish);
    const lobby = world.package.spacesOn(floor).find((s) => s.properties.type === "lobby" && s.properties.floor_finish);
    const office = world.package.spacesOn(floor).find((s) => s.properties.floor_finish === "FLOOR-CARPET-NAVY");
    const plain = world.package.spacesOn(floor).find((s) => s.properties.type === "office" && !s.properties.floor_finish);
    const before = { lobby: finishesOf("floor:lobby"), offices: finishesOf("floor:office"), walls: finishesOf("wall"),
      geometry: group.getObjectByName("wall").geometry.uuid, finishOf: world.finishOf(office.id) };
    world.updateSpace(plain.id, { floor_finish: "FLOOR-WOOD-WALNUT", wall_finish: "WALL-PAINT-TERRACOTTA" });
    await window.frames(2);
    const after = { offices: finishesOf("floor:office"), walls: finishesOf("wall"), geometry: group.getObjectByName("wall").geometry.uuid,
      same: group.getObjectByName(floor) === null, finishOf: world.finishOf(plain.id) };
    world.updateSpace(plain.id, { floor_finish: null, wall_finish: null });
    await window.frames(2);
    const back = { offices: finishesOf("floor:office"), walls: finishesOf("wall") };
    // the model look: tinted by the finishes' tones
    world.setStyle("model");
    const model = finishesOf("wall");
    world.setStyle("real");
    return { before, after, back, model, lobby: lobby.properties.floor_finish };
  }, floor);
  truly(r.before.lobby.includes("FLOOR-MARBLE-WHITE") && r.lobby === "FLOOR-MARBLE-WHITE", `the lobby: ${r.before.lobby}`);
  truly(r.before.offices.includes("FLOOR-CARPET-NAVY") && r.before.offices.includes("FLOOR-CARPET-BLUEGREY"), `offices: ${r.before.offices}`);
  for (const code of ["WALL-STONE", "WALL-PAPER-LINEN", "WALL-WOOD-SLATS", "WALL-TILE-MOSAIC", "WALL-PAINT-WHITE"]) {
    truly(r.before.walls.includes(code), `walls: ${r.before.walls} (no ${code})`);
  }
  truly(JSON.stringify(r.before.finishOf) === JSON.stringify({ floor: "FLOOR-CARPET-NAVY", wall: "WALL-PAPER-LINEN" }), JSON.stringify(r.before.finishOf));
  truly(r.after.offices.includes("FLOOR-WOOD-WALNUT") && r.after.walls.includes("WALL-PAINT-TERRACOTTA")
    && r.after.geometry === r.before.geometry, `changed in place: ${JSON.stringify(r.after)}`);
  truly(JSON.stringify(r.after.finishOf) === JSON.stringify({ floor: "FLOOR-WOOD-WALNUT", wall: "WALL-PAINT-TERRACOTTA" }), "finishOf");
  truly(r.back.offices.join() === r.before.offices.join() && r.back.walls.sort().join() === r.before.walls.sort().join(), "back as it was");
  truly(r.model.length === r.before.walls.length, "the model look: a material a finish too");
});

test("painting: a wall aimed at says so, and which room is on its side; a floor, its room; Alt goes with the click", async () => {
  const floor = await openFloor("/campus-hq.storeypath");
  const r = await page.run(async (floor) => {
    const world = window.world;
    const office = world.package.spacesOn(floor).find((s) => s.properties.floor_finish === "FLOOR-CARPET-NAVY");
    const o = world.toLocal(office.properties.display_point);
    // walking in the office, looking level at its wall: the office's side of it
    world.setMode("walk", { at: o, heading: 0 });
    await window.frames();
    const wall = world.pointAt();
    world.camera.rotation.set(-0.9, 0, 0, "YXZ");
    const ground = world.pointAt();
    world.setMode("dollhouse");
    // a click on its floor, from above, Alt held: the pick says so
    world.select(office.id);
    await window.still(world); // (its flight over: by frames, not the clock)
    world.select(null, { go: false });
    const p = world.camera.position.clone().set(o.x, world.package.get(floor).properties.elevation, o.z).project(world.camera);
    const box = world.renderer.domElement.getBoundingClientRect();
    window.painted = [];
    window.paintPick = (e) => { window.painted.push(e.detail); e.preventDefault(); };
    world.addEventListener("pick", window.paintPick);
    return { id: office.id, wall, ground, x: box.left + ((p.x + 1) / 2) * box.width, y: box.top + ((1 - p.y) / 2) * box.height };
  }, floor);
  truly(r.wall?.wall === true && r.wall.room === r.id && r.wall.space === r.id, `the wall: ${JSON.stringify(r.wall)}`);
  truly(r.ground?.wall === false && r.ground.space === r.id && r.ground.room === r.id, `the floor: ${JSON.stringify(r.ground)}`);
  await page.click(r.x, r.y, { altKey: true });
  const picked = await page.run(() => {
    window.world.removeEventListener("pick", window.paintPick);
    return { picks: window.painted, selected: window.world.selected };
  });
  const p = picked.picks[0];
  truly(picked.picks.length === 1 && p.space === r.id && p.wall === false && p.altKey === true && picked.selected === null,
    `the click: ${JSON.stringify(picked)}`);
});

// ---- doors: walking through, opened and shut -----------------------------------------------

/** The walker in the page's world on campus-hq's ground floor (``pkg``: or another package),
 * items not drawn (nothing in the way but walls and doors), doors as drawn ("auto"). */
const doorFloor = (pkg = "/campus-hq.storeypath") => page.run(async (pkg) => {
  const world = (window.world ??= new window.sp.StoreyPathWorld("#w"));
  world.setMode("dollhouse");
  world.setItems(false);
  world.setDoors("auto");
  await world.open(pkg); // (its doors as drawn)
  const floor = world.package.floorsOf(world.building)[0].id;
  window.doorEvents = [];
  if (!world.doorsHeard) world.addEventListener("doorchange", (e) => window.doorEvents.push(e.detail));
  world.doorsHeard = true;
  return floor;
}, pkg);

test("an open leaf is not in the walker's way: it walks right through where one stands (across a passage, it shut it off)", async () => {
  const floor = await doorFloor();
  const r = await page.run(async (floor) => {
    const world = window.world;
    const plan = world.plan(floor);
    // a leaf with room each side of it along a wall: the walk crosses it at its middle
    for (const d of plan.doors) {
      const [[hx, hz], [tx, tz]] = d.leaves[0], l = Math.hypot(tx - hx, tz - hz);
      const m = [(hx + tx) / 2, (hz + tz) / 2], n = [-(tz - hz) / l, (tx - hx) / l];
      const a = [m[0] - n[0] * 0.9, m[1] - n[1] * 0.9], b = [m[0] + n[0] * 0.9, m[1] + n[1] * 0.9];
      const inRoom = (x, z) => plan.spaces.some((s) => s.rings.some((ring) => window.insideRing(ring, x, z)));
      const walls = plan.walls.some((ring) => ring.some((p, i) => i > 0 && window.crosses(a, b, ring[i - 1], p)));
      if (!inRoom(...a) || !inRoom(...b) || walls) continue;
      await window.standAt(world, floor, a, b);
      const gone = await window.walkAhead(world, 1.8);
      return { id: d.id, gone, across: window.crosses(a, b, [hx, hz], [tx, tz]), events: window.doorEvents.length };
    }
    return null;
  }, floor);
  truly(r && r.across, `a leaf with room each side: ${JSON.stringify(r)}`);
  truly(r.gone > 1.75 && r.events === 0, `walked ${r.gone.toFixed(2)} m of 1.8 through ${r.id}'s leaf`);
});

test("E at the door ahead, or a click on the door under the pointer, shuts it, swinging, and opens it again; its hint by the pointer; out of reach, or in the dollhouse view, nothing", async () => {
  const floor = await doorFloor();
  const r = await page.run(async (floor) => {
    const world = window.world;
    window.away(world);
    const door = window.doorWithRoom(world, floor);
    const { m, n } = door;
    // 1.2 m before it, on the side its leaf does not open to, looking at its middle (the pointer not on the view)
    await window.standAt(world, floor, [m[0] - n[0] * 1.2, m[1] - n[1] * 1.2], m);
    window.aims = [];
    world.addEventListener("dooraim", (e) => window.aims.push(e.detail));
    await window.frames(2);
    window.state = { door, aimed: world.aimedDoor, hint: document.querySelector("#w .sp3d-door-hint").style.display,
      marked: document.querySelector("#w").classList.contains("sp3d-door-aim") };
    return window.state;
  }, floor);
  // the door ahead: E works it; no hint (none is by the pointer)
  truly(r.aimed?.id === r.door.id && r.aimed.open && r.aimed.under === false && r.hint === "none" && !r.marked, `ahead: ${JSON.stringify(r)}`);
  await page.key("e", "KeyE", 69);
  const shut = await page.run(async (floor) => {
    const world = window.world, id = window.state.door.id;
    const asked = world.doorOpen(id), moving = await window.settled(world, floor, id);
    const d = world.plan(floor).doors.find((x) => x.id === id);
    await window.frames(2);
    return { asked, moving, off: window.offSpan(d), open: d.open, events: window.doorEvents.slice(), aims: window.aims.slice() };
  }, floor);
  truly(shut.asked === false && shut.open === false && shut.off < 0.07, `shut: ${JSON.stringify(shut)}`);
  truly(shut.moving >= 3, `seen swinging over ${shut.moving} frames`); // half a second, a tenth a frame at most
  truly(JSON.stringify(shut.events) === JSON.stringify([{ id: r.door.id, open: false, floor }]), JSON.stringify(shut.events));
  truly(shut.aims.at(-1)?.id === r.door.id && shut.aims.at(-1)?.open === false, `said shut: ${JSON.stringify(shut.aims)}`);
  // the pointer on its leaf, shut across the middle of the view: the door under it, its hint by the pointer
  await page.mouse("mouseMoved", 450, 330);
  const under = await page.run(async () => {
    const world = window.world;
    await window.frames(2);
    const hint = document.querySelector("#w .sp3d-door-hint");
    return { aimed: world.aimedDoor, hint: hint.style.display !== "none" ? hint.textContent : null, left: parseFloat(hint.style.left),
      top: parseFloat(hint.style.top), marked: document.querySelector("#w").classList.contains("sp3d-door-aim"),
      cursor: world.renderer.domElement.style.cursor, hovered: world.hovered?.door ?? null };
  });
  truly(under.aimed?.id === r.door.id && under.aimed.under && under.hint === "Open door (E)" && under.marked && under.cursor === "pointer"
    && under.hovered?.id === r.door.id && under.hovered.open === false, `under the pointer: ${JSON.stringify(under)}`);
  truly(Math.abs(under.left - 464) < 2 && Math.abs(under.top - 348) < 2, `the hint by the pointer: ${under.left}, ${under.top}`);
  // a click on it (the mouse never taken): opened again, the pick saying which door, nothing chosen
  await page.run(() => {
    window.picks = [];
    window.world.addEventListener("pick", (e) => window.picks.push(e.detail));
  });
  await page.click(450, 330);
  const clicked = await page.run(async (floor) => {
    const world = window.world, id = window.state.door.id;
    const asked = world.doorOpen(id), moving = await window.settled(world, floor, id);
    const d = world.plan(floor).doors.find((x) => x.id === id);
    return { asked, moving, leaves: d.leaves, drawn: window.state.door.leaves, picks: window.picks.map((p) => p.door), selected: world.selected,
      events: window.doorEvents.length, locked: document.pointerLockElement !== null };
  }, floor);
  const near = (a, b) => a.flat(2).every((v, i) => Math.abs(v - b.flat(2)[i]) < 1e-4);
  truly(clicked.asked === true && clicked.moving >= 3 && near(clicked.leaves, clicked.drawn) && clicked.events === 2 && !clicked.locked,
    `opened again, as drawn: ${JSON.stringify(clicked)}`);
  truly(JSON.stringify(clicked.picks) === JSON.stringify([r.door.id]) && clicked.selected === null, `the pick: ${JSON.stringify(clicked)}`);
  // open, it is looked through: the pointer there is on what is beyond it, not on the door
  const through = await page.run(async () => {
    await window.frames(2);
    return { aimed: window.world.aimedDoor, hint: document.querySelector("#w .sp3d-door-hint").style.display };
  });
  truly(through.aimed?.id === r.door.id && through.aimed.under === false && through.hint === "none", `open, looked through: ${JSON.stringify(through)}`);
  // out of reach (its middle 2.5 m off), or in the dollhouse view: E does nothing to it
  const far = await page.run(async (floor) => {
    const world = window.world, { m, n } = window.state.door;
    window.away(world);
    await window.standAt(world, floor, [m[0] - n[0] * 2.5, m[1] - n[1] * 2.5], m);
    return { aimed: world.aimedDoor };
  }, floor);
  await page.key("e", "KeyE", 69);
  const ofIt = () => window.doorEvents.filter((e) => e.id === window.state.door.id).length;
  const dollhouse = await page.run(async (ofIt) => {
    const world = window.world;
    await window.frames(2);
    const walking = eval(ofIt)();
    world.setMode("dollhouse");
    await window.frames(1);
    return { walking, aimed: world.aimedDoor, hint: document.querySelector("#w .sp3d-door-hint").style.display,
      marked: document.querySelector("#w").classList.contains("sp3d-door-aim") };
  }, ofIt.toString());
  await page.key("e", "KeyE", 69);
  const after = await page.run(async () => {
    await window.frames(2);
    return { events: window.doorEvents.length, open: window.world.doorOpen(window.state.door.id) };
  });
  truly(far.aimed?.id !== r.door.id && dollhouse.walking === 2, `out of reach: ${JSON.stringify(far)} ${JSON.stringify(dollhouse)}`);
  truly(dollhouse.aimed === null && dollhouse.hint === "none" && !dollhouse.marked && after.open === true,
    `dollhouse: ${JSON.stringify(dollhouse)} ${JSON.stringify(after)}`);
});

test("a shut door is in the walker's way; walked into, it opens by itself (auto); manual, it stays shut", async () => {
  const floor = await doorFloor();
  const walk = (mode) => page.run(async (floor, mode) => {
    const world = window.world;
    world.setDoors(mode);
    const door = window.doorWithRoom(world, floor);
    world.setDoorOpen(door.id, false, { instant: true });
    window.doorEvents.length = 0;
    const { m, n } = door;
    await window.standAt(world, floor, [m[0] - n[0] * 1.5, m[1] - n[1] * 1.5], m);
    const gone = await window.walkAhead(world, 3);
    await window.settled(world, floor, door.id);
    return { gone, open: world.doorOpen(door.id), events: window.doorEvents.slice(), mode: world.doors };
  }, floor, mode);
  const auto = await walk("auto");
  truly(auto.mode === "auto" && auto.gone > 2.9 && auto.open === true && auto.events.length === 1 && auto.events[0].open === true,
    `auto: ${JSON.stringify(auto)}`);
  const manual = await walk("manual");
  // stopped at the door: its span less the walker's reach (22 cm), and a little
  truly(manual.mode === "manual" && manual.gone > 1.1 && manual.gone < 1.5 - 0.2 && manual.open === false && manual.events.length === 0,
    `manual: ${JSON.stringify(manual)}`);
  await page.run(() => window.world.setDoors("auto"));
});

test("doors: setDoorOpen, doorOpen, toggleDoor and doorchange; kept when the floor is built again, as drawn in another package", async () => {
  const floor = await doorFloor();
  const r = await page.run(async (floor) => {
    const world = window.world;
    const ids = world.plan(floor).doors.map((d) => d.id), id = ids[2];
    const first = world.doorOpen(id);
    const toggled = world.toggleDoor(id);
    const again = world.setDoorOpen(id, false); // no change: no event
    const events = window.doorEvents.slice();
    const unknown = [world.doorOpen("NOPE"), world.toggleDoor("NOPE"), world.setDoorOpen("NOPE", false), world.doorOpen(null)];
    await window.settled(world, floor, id);
    world.setDoors("sideways"); // not a mode: as it was
    const mode = world.doors;
    // built again (a reload): still shut, at once
    await world.reload("/campus-hq.storeypath");
    const reloaded = world.plan(floor).doors.find((d) => d.id === id);
    const others = world.plan(floor).doors.filter((d) => d.id !== id).every((d) => d.open);
    // the model look's lines made with it shut: shut too
    world.setStyle("model");
    world.setFloor(floor);
    await window.frames(2);
    const mesh = world.scene.getObjectByName(floor).getObjectByName("door");
    const lines = mesh.children.find((l) => l.isLineSegments).geometry.getAttribute("position");
    const d = reloaded, [[x1, z1], [x2, z2]] = d.span, ex = x2 - x1, ez = z2 - z1, l = Math.hypot(ex, ez);
    let shutLines = 0;
    for (let i = 0; i < lines.count; i++) {
      const x = lines.getX(i), z = lines.getZ(i);
      const s = ((x - x1) * ex + (z - z1) * ez) / (l * l), off = Math.abs((x - x1) * ez - (z - z1) * ex) / l;
      if (s > -0.05 && s < 1.05 && off < 0.08) shutLines++; // (a box's lines: its corners; drawn open, those near the hinge 6 cm off it)
    }
    world.setStyle("real");
    world.setFloor(null);
    // another package opened: its doors as drawn
    await world.open("/campus-hq.storeypath");
    const fresh = world.doorOpen(id);
    return { first, toggled, again, events, unknown, mode, reloaded: { open: reloaded.open, moving: reloaded.moving, off: window.offSpan(reloaded) },
      others, shutLines, fresh, floor };
  }, floor);
  truly(r.first === true && r.toggled === false && r.again === true && r.events.length === 1 && r.events[0].open === false
    && r.events[0].floor === r.floor, JSON.stringify(r));
  truly(JSON.stringify(r.unknown) === "[null,null,false,null]" && r.mode === "auto", `unknown doors: ${JSON.stringify(r.unknown)}`);
  truly(r.reloaded.open === false && !r.reloaded.moving && r.reloaded.off < 0.07 && r.others, `reloaded: ${JSON.stringify(r.reloaded)}`);
  truly(r.shutLines >= 20, `the model's lines of the leaf lie shut: ${r.shutLines} of 24`);
  truly(r.fresh === true, "another package: as drawn");
});

test("double doors: two leaves each, drawn so or made for a wide door drawn without its swing; shut, they meet in the middle and close it", async () => {
  const floor = await doorFloor("/campus-hq-doors.storeypath");
  const r = await page.run(async (floor, ids) => {
    const world = window.world;
    world.setDoors("manual");
    const out = {};
    for (const [kind, id] of Object.entries(ids)) {
      const before = world.plan(floor).doors.find((d) => d.id === id);
      world.setDoorOpen(id, false);
      const moving = await window.settled(world, floor, id);
      const d = world.plan(floor).doors.find((x) => x.id === id);
      const [[x1, z1], [x2, z2]] = d.span, mid = [(x1 + x2) / 2, (z1 + z2) / 2];
      out[kind] = { leaves: before.leaves.length, moving, off: window.offSpan(d), meet: d.leaves.map(([, tip]) => Math.hypot(tip[0] - mid[0], tip[1] - mid[1])) };
    }
    // walking into the drawn one, shut: in the way
    const door = window.doorWithRoom(world, floor, 1.5, (d) => d.id === ids.drawn);
    if (door) {
      await window.standAt(world, floor, [door.m[0] - door.n[0] * 1.5, door.m[1] - door.n[1] * 1.5], door.m);
      out.gone = await window.walkAhead(world, 3);
    }
    world.setDoors("auto");
    world.setMode("dollhouse");
    return out;
  }, floor, DOUBLE);
  for (const kind of ["drawn", "wide"]) {
    const d = r[kind];
    truly(d.leaves === 2 && d.moving >= 3 && d.off < 0.07 && d.meet.every((m) => m < 0.06), `${kind}: ${JSON.stringify(d)}`);
  }
  truly(r.gone > 1.1 && r.gone < 1.3, `walked ${r.gone} m at the shut double door`);
});

test("a pre-built floor's doors swing in its own geometry, shut where the floor built here shuts them; one pre-built by builder 4 is built here", async () => {
  const r = await page.run(async () => {
    const world = (window.world ??= new window.sp.StoreyPathWorld("#w"));
    world.setMode("dollhouse");
    const shutOn = async (pkg) => {
      await world.open(pkg);
      const floor = world.package.floorsOf(world.building)[0].id;
      const ids = world.plan(floor).doors.map((d) => d.id);
      const mesh = world.scene.getObjectByName(floor).getObjectByName("door"), pos = mesh.geometry.getAttribute("position");
      const before = Array.from(pos.array), version = pos.version;
      world.setDoorOpen(ids[0], false);
      await window.settled(world, floor, ids[0]);
      const after = Array.from(mesh.geometry.getAttribute("position").array);
      const moved = after.filter((v, i) => Math.abs(v - before[i]) > 0.1).length;
      const d = world.plan(floor).doors.find((x) => x.id === ids[0]);
      return { prebuilt: world.prebuilt.includes(floor), ids, leaves: d.leaves, off: window.offSpan(d), moved, written: mesh.geometry.getAttribute("position").version > version,
        same: mesh.geometry.getAttribute("position") === pos };
    };
    const baked = await shutOn("/simple-office-world.storeypath");
    const live = await shutOn("/simple-office.storeypath");
    // the same files, said to be of builder 4: built here, their doors as well
    const zip = await window.JSZip.loadAsync(await (await fetch("/simple-office-world.storeypath")).arrayBuffer());
    for (const name of Object.keys(zip.files).filter((n) => n.endsWith(".glb"))) {
      const glb = new Uint8Array(await zip.file(name).async("arraybuffer"));
      const length = new DataView(glb.buffer).getUint32(12, true);
      const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)));
      json.scenes[0].extras.storeypath.builder = 4;
      delete json.scenes[0].extras.storeypath.doors;
      const text = new TextEncoder().encode(JSON.stringify(json).padEnd(Math.ceil(JSON.stringify(json).length / 4) * 4));
      const out = new Uint8Array(20 + text.length + glb.length - 20 - length);
      out.set(glb.subarray(0, 20));
      out.set(text, 20);
      out.set(glb.subarray(20 + length), 20 + text.length);
      new DataView(out.buffer).setUint32(8, out.length, true);
      new DataView(out.buffer).setUint32(12, text.length, true);
      zip.file(name, out);
    }
    const four = await shutOn(await zip.generateAsync({ type: "arraybuffer" }));
    return { baked, live, four };
  });
  truly(r.baked.prebuilt && !r.live.prebuilt && !r.four.prebuilt, `pre-built: ${r.baked.prebuilt} ${r.live.prebuilt} ${r.four.prebuilt}`);
  truly(JSON.stringify(r.baked.ids) === JSON.stringify(r.live.ids) && r.baked.ids.length > 10, "the same doors");
  for (const k of ["baked", "live", "four"]) {
    truly(r[k].off < 0.07 && r[k].moved >= 4 && r[k].written && r[k].same, `${k}: shut in place ${JSON.stringify(r[k])}`);
  }
  truly(r.baked.leaves.flat(2).every((v, i) => Math.abs(v - r.live.leaves.flat(2)[i]) < 1e-3), "shut elsewhere than built here");
});

test("no door swinging, nothing to do a frame: the leaves not written again, the shadows not drawn again; while one swings, they are", async () => {
  const floor = await doorFloor();
  const r = await page.run(async (floor) => {
    const world = window.world;
    const door = window.doorWithRoom(world, floor);
    await window.standAt(world, floor, [door.m[0] - door.n[0] * 1.5, door.m[1] - door.n[1] * 1.5], door.m);
    // the shadows drawn: the shadow map's renders that draw (it skips those not asked for)
    const sm = world.renderer.shadowMap, render = sm.render;
    let shadows = 0;
    sm.render = function (...args) {
      if (sm.needsUpdate) shadows++;
      return render.apply(this, args);
    };
    const pos = () => world.scene.getObjectByName(floor).getObjectByName("door").geometry.getAttribute("position").version;
    await window.frames(4); // (settled after standing there)
    const still = { shadows, version: pos() };
    await window.frames(8);
    const idle = { shadows: shadows - still.shadows, written: pos() - still.version };
    world.setDoorOpen(door.id, false);
    const swung = await window.settled(world, floor, door.id);
    const moving = { shadows: shadows - still.shadows - idle.shadows, written: pos() - still.version };
    const done = { shadows, version: pos() };
    await window.frames(8);
    const after = { shadows: shadows - done.shadows, written: pos() - done.version };
    sm.render = render;
    world.setDoorOpen(door.id, true, { instant: true });
    world.setMode("dollhouse");
    return { idle, swung, moving, after };
  }, floor);
  truly(r.idle.shadows === 0 && r.idle.written === 0 && r.after.shadows === 0 && r.after.written === 0, `still: ${JSON.stringify(r)}`);
  truly(r.moving.shadows >= r.swung && r.moving.written >= r.swung && r.swung >= 3, `swinging: ${JSON.stringify(r)}`);
});

// ---- walking with the mouse free: a drag looks, a click acts where the pointer is ------------

/** The walker on campus-hq's ground floor with its items, standing in a room before one of
 * them (a desk the room's middle is at least 1.4 m from), looking at it; the pointer gone.
 * The desk, its room, where it is on the screen, and where the walker stands. */
const beforeADesk = () => page.run(async () => {
  const world = (window.world ??= new window.sp.StoreyPathWorld("#w"));
  world.setMode("dollhouse");
  world.setDraggable(false);
  world.setDoors("auto");
  if (world.package?.project.id !== "campus-hq" || !world.package.itemsOn(world.package.floorsOf(world.building)[0].id).length) {
    await world.open("/campus-hq.storeypath");
  }
  world.setItems(true);
  const floor = world.package.floorsOf(world.building)[0].id, pkg = world.package;
  const desks = pkg.itemsOn(floor).filter((i) => i.properties.type.startsWith("DESK") && i.properties.space_id);
  const elevation = pkg.get(floor).properties.elevation, eye = 1.6;
  for (const desk of desks) {
    const space = pkg.get(desk.properties.space_id);
    const o = world.toLocal(space.properties.display_point);
    const d = world.worldPoint([desk.properties.local.x_m, desk.properties.local.y_m]);
    const far = Math.hypot(d.x - o.x, d.z - o.z);
    if (far < 2 || far > 3.2) continue;
    // looking down between the desk and the floor a metre ahead: both on the screen
    const top = desk.properties.height_m * 0.6;
    const pitch = -(Math.atan2(eye - top, far) + Math.atan2(eye, 1)) / 2;
    window.away(world);
    await window.standAt(world, floor, [o.x, o.z], [d.x, d.z], pitch);
    world.select(null, { go: false });
    await window.frames(2);
    const at = window.screenOf(world, d.x, elevation + top, d.z);
    const p = world.pointAt(...at);
    if (p?.item !== desk.id) continue; // (another item in the way: the next desk)
    // a point of its floor a metre ahead, towards it
    const ahead = [o.x + ((d.x - o.x) / far) * 1, o.z + ((d.z - o.z) / far) * 1];
    const mid = window.screenOf(world, ahead[0], elevation, ahead[1]);
    const q = world.pointAt(...mid);
    if (q?.item || q?.space !== space.id) continue;
    return { floor, desk: desk.id, room: space.id, at, mid, ahead, stand: [o.x, o.z], d: [d.x, d.z], pitch };
  }
  return null;
});

test("walking, a drag looks round (the scene held under the pointer, eased); a click does not turn the view; looking up and down stops short", async () => {
  const r = await beforeADesk();
  truly(r, "a desk to stand before");
  const before = await page.run(() => ({ ...window.angles(window.world), k: (window.world.camera.fov * Math.PI) / 180 / 600 }));
  // dragged 120 px right: the view turns left by what keeps the scene under the pointer
  await page.drag([300, 200], [420, 200], 12);
  const turned = await page.run(async () => {
    const frames = await window.still(window.world);
    return { ...window.angles(window.world), frames, picks: window.world.selected, locked: document.pointerLockElement !== null };
  });
  const want = 120 * before.k;
  const dyaw = turned.yaw - before.yaw;
  truly(dyaw > want * 0.95 && dyaw < want + 1.2 && Math.abs(turned.pitch - before.pitch) < 0.01, `turned ${dyaw.toFixed(4)} rad, want ${want.toFixed(4)}`);
  truly(turned.frames >= 1 && turned.picks === null && !turned.locked, `eased over frames, nothing chosen: ${JSON.stringify(turned)}`);
  // a click (a press that moves 3 px: still a click) does not turn it
  await page.mouse("mouseMoved", 500, 500);
  await page.mouse("mousePressed", 500, 500, { down: true });
  await page.mouse("mouseMoved", 503, 500, { down: true });
  await page.mouse("mouseReleased", 503, 500);
  const clicked = await page.run(async () => {
    await window.still(window.world);
    return window.angles(window.world);
  });
  truly(Math.abs(clicked.yaw - turned.yaw) < 1e-6 && Math.abs(clicked.pitch - turned.pitch) < 1e-6, `a click turned it: ${JSON.stringify(clicked)}`);
  // dragged far down: it looks up, short of straight up
  await page.drag([450, 50], [450, 590], 6);
  await page.drag([450, 50], [450, 590], 6);
  await page.drag([450, 50], [450, 590], 6);
  const up = await page.run(async () => {
    await window.still(window.world);
    return window.angles(window.world);
  });
  truly(up.pitch > 1.3 && up.pitch <= 1.4501, `looking up: ${up.pitch}`);
  await page.drag([450, 590], [450, 50], 6);
  await page.drag([450, 590], [450, 50], 6);
  await page.drag([450, 590], [450, 50], 6);
  await page.drag([450, 590], [450, 50], 6);
  await page.drag([450, 590], [450, 50], 6);
  await page.drag([450, 590], [450, 50], 6);
  const down = await page.run(async () => {
    await window.still(window.world);
    return window.angles(window.world);
  });
  truly(down.pitch < -1.3 && down.pitch >= -1.4501, `looking down: ${down.pitch}`);
});

test("walking, a click acts where the pointer is: an item there chosen, the floor's room chosen, a wall said with the room on its side (Alt with it)", async () => {
  const r = await beforeADesk();
  truly(r, "a desk to stand before");
  await page.run(() => {
    window.picks = [];
    window.world.addEventListener("pick", (e) => window.picks.push(e.detail));
  });
  await page.click(...r.at);
  const item = await page.run(async () => {
    await window.frames(1);
    return { selected: window.world.selected, pick: window.picks.at(-1) };
  });
  truly(item.selected === r.desk && item.pick.item === r.desk && item.pick.floor === r.floor && item.pick.door === null
    && Math.abs(item.pick.clientX - r.at[0]) < 1, `the desk: ${JSON.stringify(item)}`);
  await page.click(...r.mid);
  const room = await page.run(async (room) => {
    // (a room is chosen once the click is not a double-click's first: a moment later)
    const first = window.world.selected;
    for (let i = 0; i < 400 && window.world.selected !== room; i++) await window.frames(1);
    return { first, selected: window.world.selected, pick: window.picks.at(-1) };
  }, r.room);
  truly(room.first !== r.room && room.selected === r.room && room.pick.space === r.room && !room.pick.item && !room.pick.wall,
    `the room, a moment later: ${JSON.stringify(room)}`);
  // turned to the wall nearest it, level: the wall at the pointer, the room on its side (cancelled: a page paints it)
  const wall = await page.run(async (r) => {
    const world = window.world, plan = world.plan(r.floor), [x, z] = r.stand;
    let best = null;
    for (const [x1, z1, x2, z2] of plan.obstacles) {
      const ex = x2 - x1, ez = z2 - z1, t = Math.max(0, Math.min(1, ((x - x1) * ex + (z - z1) * ez) / (ex * ex + ez * ez || 1e-9)));
      const px = x1 + t * ex, pz = z1 + t * ez, d = Math.hypot(px - x, pz - z);
      if (d > 0.5 && (!best || d < best.d)) best = { d, at: [px, pz] };
    }
    world.select(null, { go: false });
    await window.standAt(world, r.floor, r.stand, best.at);
    window.cancel = (e) => e.preventDefault();
    world.addEventListener("pick", window.cancel);
    const y = world.package.get(r.floor).properties.elevation + 1.3;
    return { at: window.screenOf(world, best.at[0], y, best.at[1]), was: world.pointAt(...window.screenOf(world, best.at[0], y, best.at[1])) };
  }, r);
  truly(wall.was?.wall, `a wall there: ${JSON.stringify(wall.was)}`);
  await page.click(...wall.at, { altKey: true });
  const painted = await page.run(async () => {
    await window.frames(1);
    window.world.removeEventListener("pick", window.cancel);
    return { selected: window.world.selected, pick: window.picks.at(-1) };
  });
  truly(painted.pick.wall === true && painted.pick.room === r.room && painted.pick.altKey === true && painted.selected === null,
    `the wall: ${JSON.stringify(painted)}`);
});

test("walking, what is under the pointer is said as it changes (hover): an item, the floor and its room (a ring on it); nothing once the pointer is gone (a door: E, above)", async () => {
  const r = await beforeADesk();
  truly(r, "a desk to stand before");
  await page.run(() => {
    window.hovers = [];
    window.world.addEventListener("hover", (e) => window.hovers.push(e.detail));
  });
  const seen = async () => page.run(async () => {
    await window.frames(2);
    const ring = window.world.scene.getObjectByName("walk-ring");
    return { last: window.hovers.at(-1), n: window.hovers.length, hovered: window.world.hovered, ring: Boolean(ring?.visible),
      cursor: window.world.renderer.domElement.style.cursor };
  });
  await page.mouse("mouseMoved", ...r.at);
  const onItem = await seen();
  truly(onItem.last?.item === r.desk && onItem.hovered?.item === r.desk && !onItem.ring && onItem.cursor === "pointer", `on the desk: ${JSON.stringify(onItem)}`);
  await page.mouse("mouseMoved", ...r.mid);
  const onFloor = await seen();
  truly(onFloor.last?.space === r.room && !onFloor.last.item && !onFloor.last.wall && onFloor.ring && onFloor.cursor === "",
    `on the floor: ${JSON.stringify(onFloor)}`);
  // moved a little on the same floor: nothing new said
  await page.mouse("mouseMoved", r.mid[0] + 2, r.mid[1] + 1);
  const same = await seen();
  truly(same.n === onFloor.n, `the same room, said again: ${same.n} ${onFloor.n}`);
  await page.run(() => window.away(window.world));
  const gone = await seen();
  truly(gone.last === null && gone.hovered === null && !gone.ring, `the pointer gone: ${JSON.stringify(gone)}`);
});

test("walking, a double-click on the floor glides there, frame by frame; at a wall it stops before it; something in the way at once: refused", async () => {
  const r = await beforeADesk();
  truly(r, "a desk to stand before");
  // the floor a metre ahead, between the walker and the desk
  const target = await page.run(async (r) => {
    const world = window.world, [x, z] = r.stand, [dx, dz] = r.d, l = Math.hypot(dx - x, dz - z);
    const to = [x + ((dx - x) / l) * 0.9, z + ((dz - z) / l) * 0.9];
    window.glides = [];
    if (!window.glideHeard) world.addEventListener("glide", (e) => window.glides.push(e.detail));
    window.glideHeard = true;
    return { to, at: window.screenOf(world, to[0], world.package.get(r.floor).properties.elevation, to[1]) };
  }, r);
  await doubleClick(...target.at);
  const went = await page.run(async (to) => {
    const done = await window.glided(window.world);
    const p = window.world.player;
    return { done, off: Math.hypot(p.x - to[0], p.z - to[1]), glides: window.glides.map((g) => g.state) };
  }, target.to);
  truly(went.glides[0] === "going" && went.done.state === "there" && went.off < 0.05 && went.done.frames >= 3,
    `glided: ${JSON.stringify(went)}`);
  const chose = await page.run(async () => {
    await new Promise((res) => setTimeout(res, 600)); // (past when a single click would have chosen it)
    return window.world.selected;
  });
  truly(chose === null, `a double-click chose ${chose}: it only goes there`);
  // at a wall: stopped before it, the walker's reach from it
  const wall = await page.run(async (r) => {
    const world = window.world, plan = world.plan(r.floor), p = world.player;
    let best = null;
    for (const [x1, z1, x2, z2] of plan.obstacles) {
      const ex = x2 - x1, ez = z2 - z1, t = Math.max(0.2, Math.min(0.8, ((p.x - x1) * ex + (p.z - z1) * ez) / (ex * ex + ez * ez || 1e-9)));
      const px = x1 + t * ex, pz = z1 + t * ez, d = Math.hypot(px - p.x, pz - p.z);
      if (d > 1 && d < 4 && (!best || d < best.d)) best = { d, at: [px, pz] };
    }
    await window.standAt(world, r.floor, [p.x, p.z], best.at, -0.45);
    window.glides = [];
    const y = world.package.get(r.floor).properties.elevation + 0.6;
    return { at: window.screenOf(world, best.at[0], y, best.at[1]), d: best.d };
  }, r);
  await doubleClick(...wall.at);
  const stopped = await page.run(async (r) => {
    const done = await window.glided(window.world);
    const p = window.world.player, plan = window.world.plan(r.floor);
    const near = Math.min(...plan.obstacles.map(([x1, z1, x2, z2]) => {
      const ex = x2 - x1, ez = z2 - z1, t = Math.max(0, Math.min(1, ((p.x - x1) * ex + (p.z - z1) * ez) / (ex * ex + ez * ez || 1e-9)));
      return Math.hypot(x1 + t * ex - p.x, z1 + t * ez - p.z);
    }));
    return { done, near };
  }, r);
  truly(stopped.done.state === "there" && stopped.near >= 0.2 && stopped.near < 0.4, `at the wall: ${JSON.stringify(stopped)} (it was ${wall.d.toFixed(2)} m off)`);
  // the same wall again, there already: refused, said by the pointer for a moment
  // (the pointer's word read as the refusal is said: shown for a moment only, which on CI
  // may be over before two frames are)
  await page.run(() => {
    window.glides = [];
    window.refusedHint = undefined;
    window.world.addEventListener("glide", (e) => {
      if (e.detail.state !== "refused" || window.refusedHint !== undefined) return;
      const hint = document.querySelector("#w .sp3d-door-hint");
      window.refusedHint = hint.style.display !== "none" ? hint.textContent : null;
    });
  });
  await new Promise((res) => setTimeout(res, 500)); // (not a double-click with the last)
  await doubleClick(...wall.at);
  const refused = await page.run(async () => {
    await window.frames(2);
    return { glides: window.glides.map((g) => g.state), hint: window.refusedHint };
  });
  truly(refused.glides.join() === "refused" && refused.hint === "Something is in the way", `refused: ${JSON.stringify(refused)}`);
});

test("walking, a double-click on the floor seen through a shut door: its first click opens the door, its second glides through", async () => {
  const floor = await doorFloor();
  const a = await page.run(async (floor) => {
    const world = window.world;
    world.setDoors("manual"); // (not opened by walking into it: by the click)
    window.away(world);
    const door = window.doorWithRoom(world, floor);
    world.setDoorOpen(door.id, false, { instant: true });
    window.doorEvents.length = 0;
    const { m, n } = door;
    await window.standAt(world, floor, [m[0] - n[0] * 1.5, m[1] - n[1] * 1.5], m, -0.35);
    window.glides = [];
    if (!window.glideHeard) world.addEventListener("glide", (e) => window.glides.push(e.detail));
    window.glideHeard = true;
    const to = [m[0] + n[0] * 1.2, m[1] + n[1] * 1.2];
    const at = window.screenOf(world, to[0], world.package.get(floor).properties.elevation, to[1]);
    return { id: door.id, to, from: [m[0] - n[0] * 1.5, m[1] - n[1] * 1.5], n, at, aimed: world.pointAt(...at) };
  }, floor);
  await new Promise((res) => setTimeout(res, 500)); // (not a double-click with an earlier click)
  await doubleClick(...a.at);
  const through = await page.run(async (a) => {
    const done = await window.glided(window.world);
    const p = window.world.player;
    return { done, gone: (p.x - a.from[0]) * a.n[0] + (p.z - a.from[1]) * a.n[1], events: window.doorEvents.slice() };
  }, a);
  truly(through.events.length === 1 && through.events[0].id === a.id && through.events[0].open === true, `opened by the first click: ${JSON.stringify(through)}`);
  truly(through.done.state === "there" && through.gone > 2.6, `through the door: ${JSON.stringify(through)}`);
  await page.run(() => window.world.setDoors("auto"));
});

test("walking on a touch screen: a finger dragged looks round, a tap acts, a double tap glides, two fingers do neither", async () => {
  const r = await beforeADesk();
  truly(r, "a desk to stand before");
  const before = await page.run(() => ({ ...window.angles(window.world), k: (window.world.camera.fov * Math.PI) / 180 / 600 }));
  // the finger down and its first move (past the few pixels a tap may move) together: else,
  // on CI, a long press before it moved
  await together(() => page.touch("touchStart", [[300, 300]]), () => page.touch("touchMove", [[320, 300]]));
  for (let i = 3; i <= 9; i++) await page.touch("touchMove", [[300 + i * 10, 300]]);
  await page.touch("touchEnd", []);
  const turned = await page.run(async () => {
    await window.still(window.world);
    return { ...window.angles(window.world), selected: window.world.selected };
  });
  const dyaw = turned.yaw - before.yaw, want = 90 * before.k;
  truly(dyaw > want * 0.95 && dyaw < want + 1.2 && turned.selected === null, `a finger turned it ${dyaw.toFixed(4)}, want ${want.toFixed(4)}`);
  // a tap on the desk (where it is now): chosen
  const at = await page.run((r) => {
    const world = window.world, d = r.d, top = world.package.get(r.floor).properties.elevation + 0.45;
    return window.screenOf(world, d[0], top, d[1]);
  }, r);
  await together(() => page.touch("touchStart", [at]), () => page.touch("touchEnd", [])); // (a tap, not a long press, on CI too)
  const tapped = await page.run(async () => {
    await window.frames(1);
    return window.world.selected;
  });
  truly(tapped === r.desk, `a tap on the desk: ${tapped}`);
  // two fingers: neither a look nor a tap
  const two = await page.run(() => ({ ...window.angles(window.world), selected: window.world.selected }));
  await page.run(() => window.world.select(null, { go: false }));
  await page.touch("touchStart", [[300, 300], [500, 300]]);
  for (let i = 1; i <= 6; i++) await page.touch("touchMove", [[300 - i * 12, 300], [500 + i * 12, 300]]);
  await page.touch("touchEnd", []);
  const pinched = await page.run(async () => {
    await window.still(window.world);
    return { ...window.angles(window.world), selected: window.world.selected };
  });
  truly(Math.abs(pinched.yaw - two.yaw) < 1e-6 && pinched.selected === null, `two fingers: ${JSON.stringify(pinched)}`);
  // a double tap on the floor: glided there
  const floorAt = await page.run((r) => {
    const world = window.world, p = world.player, l = Math.hypot(p.dx, p.dz);
    const to = [p.x + (p.dx / l) * 1.0, p.z + (p.dz / l) * 1.0];
    window.glides = [];
    if (!window.glideHeard) world.addEventListener("glide", (e) => window.glides.push(e.detail)); // (this test alone too)
    window.glideHeard = true;
    return { to, at: window.screenOf(world, to[0], world.package.get(r.floor).properties.elevation, to[1]) };
  }, r);
  await new Promise((res) => setTimeout(res, 500));
  await together(() => page.touch("touchStart", [floorAt.at]), () => page.touch("touchEnd", []),
    () => page.touch("touchStart", [[floorAt.at[0] + 6, floorAt.at[1] + 4]]), () => page.touch("touchEnd", []));
  const glided = await page.run(async (to) => {
    const done = await window.glided(window.world);
    const p = window.world.player;
    return { done, off: Math.hypot(p.x - to[0], p.z - to[1]) };
  }, floorAt.to);
  truly(glided.done.state === "there" && glided.off < 0.15, `a double tap glided: ${JSON.stringify(glided)}`);
});

test("walking, a right-click (or a long press) says menu with what is there; a right-drag looks and says none; so does the dollhouse view's right-click", async () => {
  const r = await beforeADesk();
  truly(r, "a desk to stand before");
  await page.run(() => {
    window.menus = [];
    if (!window.menuHeard) window.world.addEventListener("menu", (e) => window.menus.push(e.detail));
    window.menuHeard = true;
  });
  const right = (type, x, y, buttons) => page.send("Input.dispatchMouseEvent", { type, x, y, button: "right", buttons, clickCount: 1 });
  await page.mouse("mouseMoved", ...r.at);
  await right("mousePressed", ...r.at, 2);
  await right("mouseReleased", ...r.at, 0);
  const said = await page.run(async () => {
    await window.frames(1);
    return { menus: window.menus.slice(), angles: window.angles(window.world), selected: window.world.selected };
  });
  truly(said.menus.length === 1 && said.menus[0].item === r.desk && Math.abs(said.menus[0].clientX - r.at[0]) < 1 && said.selected === null,
    `a right-click on the desk: ${JSON.stringify(said)}`);
  await right("mousePressed", 400, 300, 2);
  for (let i = 1; i <= 6; i++) await right("mouseMoved", 400 - i * 10, 300, 2);
  await right("mouseReleased", 340, 300, 0);
  const dragged = await page.run(async () => {
    await window.still(window.world);
    return { menus: window.menus.length, angles: window.angles(window.world) };
  });
  truly(dragged.menus === 1 && dragged.angles.yaw < said.angles.yaw - 0.05, `a right-drag looked: ${JSON.stringify(dragged)} ${JSON.stringify(said.angles)}`);
  // a long press of a finger
  await page.touch("touchStart", [r.mid]);
  await page.run(() => new Promise((res) => setTimeout(res, 800)));
  await page.touch("touchEnd", []);
  const held = await page.run(async () => {
    await window.frames(1);
    return { menus: window.menus.slice(1), selected: window.world.selected };
  });
  truly(held.menus.length === 1 && held.menus[0].space === r.room && held.menus[0].pointerType === "touch" && held.selected === null,
    `a long press: ${JSON.stringify(held)}`);
  // the dollhouse view: a right-click says menu; a right-drag (moving the view) does not
  const dollhouse = await page.run(async () => {
    window.world.setMode("dollhouse");
    window.menus = [];
    await window.frames(2);
    return true;
  });
  truly(dollhouse, "the dollhouse view");
  await right("mousePressed", 450, 300, 2);
  await right("mouseReleased", 450, 300, 0);
  await right("mousePressed", 450, 300, 2);
  for (let i = 1; i <= 4; i++) await right("mouseMoved", 450 + i * 12, 300, 2);
  await right("mouseReleased", 498, 300, 0);
  const orbit = await page.run(async () => {
    await window.frames(1);
    return window.menus.length;
  });
  truly(orbit === 1, `the dollhouse view's menus: ${orbit}`);
});

test("walking, the item chosen is carried by a drag (itemdrag…), the view held; a drag elsewhere, or on an item not chosen, looks", async () => {
  const r = await beforeADesk();
  truly(r, "a desk to stand before");
  await page.run((r) => {
    const world = window.world;
    window.dragged = [];
    if (!window.dragHeard) for (const type of ["itemdragstart", "itemdrag", "itemdragend"]) world.addEventListener(type, (e) => window.dragged.push({ type, ...e.detail }));
    window.dragHeard = true;
    world.setDraggable(true);
    world.select(r.desk, { go: false });
  }, r);
  const before = await page.run(() => window.angles(window.world));
  await page.drag(r.at, [r.at[0] + 60, r.at[1] + 30], 8);
  const carried = await page.run(async () => {
    await window.still(window.world);
    const e = window.dragged.map((d) => d.type);
    return { e, first: window.dragged[0], last: window.dragged.at(-1), angles: window.angles(window.world) };
  });
  truly(carried.e[0] === "itemdragstart" && carried.e.at(-1) === "itemdragend" && carried.e.filter((t) => t === "itemdrag").length >= 4
    && carried.first.id === r.desk && Math.abs(carried.angles.yaw - before.yaw) < 1e-6, `carried: ${JSON.stringify(carried)}`);
  // nothing chosen: the same drag looks
  await page.run(() => {
    window.dragged = [];
    window.world.select(null, { go: false });
  });
  await page.drag(r.at, [r.at[0] + 60, r.at[1]], 8);
  const looked = await page.run(async () => {
    await window.still(window.world);
    const n = window.dragged.length;
    window.world.setDraggable(false);
    return { n, angles: window.angles(window.world) };
  });
  truly(looked.n === 0 && looked.angles.yaw > before.yaw + 0.05, `not chosen, it looks: ${JSON.stringify(looked)}`);
});

test("walking, the wheel steps on (back, towards you); a pinch (Ctrl and the wheel) zooms nothing and moves nothing", async () => {
  const r = await beforeADesk();
  truly(r, "a desk to stand before");
  const from = await page.run(() => ({ ...window.world.player, fov: window.world.camera.fov }));
  await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 450, y: 300, deltaX: 0, deltaY: -100 });
  const on = await page.run(async (from) => {
    for (let i = 0; i < 60; i++) await window.frames(1);
    const p = window.world.player;
    return (p.x - from.x) * from.dx + (p.z - from.z) * from.dz;
  }, from);
  truly(on > 0.5 && on < 0.85, `a step on: ${on.toFixed(3)} m`);
  await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 450, y: 300, deltaX: 0, deltaY: -300, modifiers: 2 });
  const pinched = await page.run(async (from) => {
    const was = window.world.player;
    for (let i = 0; i < 20; i++) await window.frames(1);
    const p = window.world.player;
    return { moved: Math.hypot(p.x - was.x, p.z - was.z), fov: window.world.camera.fov, want: from.fov };
  }, from);
  truly(pinched.moved < 1e-6 && pinched.fov === pinched.want, `a pinch: ${JSON.stringify(pinched)}`);
});

test("walking, the walker's keys are not those typed in a field, nor in a dialog, nor those the page took first; let go of when the window is left", async () => {
  const r = await beforeADesk();
  truly(r, "a desk to stand before");
  const moved = await page.run(async () => {
    const world = window.world, from = world.player;
    const gone = () => Math.hypot(world.player.x - from.x, world.player.z - from.z);
    const field = document.body.appendChild(Object.assign(document.createElement("input"), { id: "typed" }));
    field.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", key: "w", bubbles: true }));
    await window.frames(6);
    const typed = gone();
    field.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW", key: "w", bubbles: true }));
    field.remove();
    const took = (e) => e.preventDefault();
    document.addEventListener("keydown", took);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowUp", key: "ArrowUp", bubbles: true, cancelable: true }));
    await window.frames(6);
    const taken = gone();
    document.removeEventListener("keydown", took);
    document.body.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowUp", key: "ArrowUp", bubbles: true }));
    // held, then the window left: let go of
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", key: "w" }));
    await window.frames(3);
    window.dispatchEvent(new Event("blur"));
    const at = gone();
    await window.frames(6);
    return { typed, taken, held: at, after: gone() };
  });
  truly(moved.typed < 1e-6 && moved.taken < 1e-6, `keys not the walker's moved it: ${JSON.stringify(moved)}`);
  truly(moved.held > 0 && Math.abs(moved.after - moved.held) < 1e-6, `the window left, it stopped: ${JSON.stringify(moved)}`);
});

test("mark: a room's floor, its walls' faces towards it, or an item, lightly; the ring under the pointer not with it; null: nothing", async () => {
  const r = await beforeADesk();
  truly(r, "a desk to stand before");
  await page.mouse("mouseMoved", ...r.mid);
  const got = await page.run(async (r) => {
    const world = window.world;
    const mark = () => {
      const m = world.scene.getObjectByName("mark");
      if (!m) return null;
      let tris = 0;
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      m.traverse((o) => {
        if (!o.isMesh) return;
        const pos = o.geometry.getAttribute("position");
        tris += (o.geometry.index ? o.geometry.index.count : pos.count) / 3;
        for (let i = 0; i < pos.count; i++) {
          [pos.getX(i), pos.getY(i), pos.getZ(i)].forEach((v, k) => { lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); });
        }
      });
      return { parent: m.parent.name, tris, box: [...lo, ...hi], parts: m.children.length };
    };
    const ring = () => Boolean(world.scene.getObjectByName("walk-ring")?.visible);
    await window.frames(2);
    const ringBefore = ring();
    world.mark({ floor: r.room });
    await window.frames(2);
    const floor = mark(), ringWith = ring();
    world.mark({ walls: r.room });
    const walls = mark();
    world.mark({ item: r.desk });
    const item = mark();
    // the item moved a metre (its floor's items given again): its mark with it
    const given = world.package.itemsOn(r.floor).map((i) => ({ id: i.id, type: i.properties.type, x: i.properties.local.x_m + (i.id === r.desk ? 1 : 0),
      y: i.properties.local.y_m, rotation: i.properties.local.rotation_deg }));
    world.setFloorItems(r.floor, given);
    const moved = mark();
    world.setFloorItems(r.floor, given.map((g) => (g.id === r.desk ? { ...g, x: g.x - 1 } : g)));
    world.mark(null);
    await window.frames(2);
    return { floor, walls, item, moved, gone: mark(), ringBefore, ringWith, ringAfter: ring(), elevation: world.package.get(r.floor).properties.elevation };
  }, r);
  truly(got.floor?.parent === r.floor && got.floor.tris >= 2 && got.floor.parts === 2 && Math.abs(got.floor.box[1] - got.elevation - 0.025) < 0.01,
    `the floor, its edge drawn: ${JSON.stringify(got.floor)}`);
  truly(got.walls?.tris >= 8 && got.walls.box[4] - got.walls.box[1] > 2, `the walls: ${JSON.stringify(got.walls)}`);
  truly(got.item?.tris >= 12 && got.gone === null, `the item, then none: ${JSON.stringify(got)}`);
  const shift = Math.hypot((got.moved.box[0] + got.moved.box[3]) / 2 - (got.item.box[0] + got.item.box[3]) / 2,
    (got.moved.box[2] + got.moved.box[5]) / 2 - (got.item.box[2] + got.item.box[5]) / 2);
  truly(Math.abs(shift - 1) < 0.05, `the item moved a metre, its mark ${shift.toFixed(3)} m`);
  truly(got.ringBefore && !got.ringWith && got.ringAfter, `the ring: ${JSON.stringify(got)}`);
  await page.run(() => window.away(window.world));
});

test("walking never asks for the mouse: no pointer lock; startWalking and stopWalking still there, the walk view and nothing", async () => {
  const r = await page.run(async () => {
    const world = window.world;
    world.setMode("dollhouse");
    const said = [];
    world.addEventListener("walklock", (e) => said.push(e.detail.locked));
    world.startWalking();
    const walking = [world.mode, world.walking];
    world.stopWalking();
    await window.frames(2);
    const still = [world.mode, world.walking];
    world.setMode("dollhouse");
    return { walking, still, said, locks: window.locks, element: document.pointerLockElement };
  });
  truly(r.walking.join() === "walk,true" && r.still.join() === "walk,true" && r.said.join() === "true,false", JSON.stringify(r));
  truly(r.locks === 0 && r.element === null, `the mouse asked for: ${r.locks} times`);
});

test("destroy gives the world's WebGL context back: twenty made and destroyed, a world still shown keeps drawing", async () => {
  const r = await page.run(async () => {
    const box = document.body.appendChild(document.createElement("div"));
    box.style.cssText = "width:300px;height:200px";
    try {
      const kept = window.world ??= new window.sp.StoreyPathWorld("#w");
      const gl = kept.renderer.getContext();
      let lost = null;
      for (let i = 0; i < 20 && lost === null; i++) {
        const w = new window.sp.StoreyPathWorld(box);
        await window.frames(1);
        w.destroy();
        if (gl.isContextLost()) lost = i + 1; // (a page has some 16: the browser took the oldest)
      }
      return { lost, left: box.children.length };
    } finally {
      box.remove();
    }
  });
  truly(r.lost === null && r.left === 0, `the world shown kept its context: ${JSON.stringify(r)}`);
});

test("destroy empties the container", async () => {
  const left = await page.run(() => {
    window.world.destroy();
    return document.querySelector("#w").children.length;
  });
  truly(left === 0, `${left} elements left`);
});

let failed = 0;
// ONLY=<words>: only the tests whose names have them (the others' state is not needed by any)
const only = process.env.ONLY?.toLowerCase();
for (const t of tests.filter((x) => !only || x.name.toLowerCase().includes(only))) {
  try {
    await page.run(() => window.idle?.(false));
    await t.fn();
    console.log(`ok    ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${t.name}\n      ${e.message}`);
  } finally {
    await page.run(() => window.idle?.(true)).catch(() => {});
  }
}
if (page.errors.length) {
  failed++;
  console.log(`FAIL  no errors in the page\n      ${page.errors.slice(0, 5).join("\n      ")}`);
}
page.close();
server.close();
console.log(failed ? `${failed} failed` : `all ${only ? tests.filter((x) => x.name.toLowerCase().includes(only)).length : tests.length} passed`);
process.exit(failed ? 1 : 0);
