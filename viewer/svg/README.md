# StoreyPath plan viewer (SVG)

One floor of a StoreyPath package as a plain SVG plan: spaces and zones, walls,
doors with their swings, windows and openings, furniture and equipment, labels.
No WebGL and no
dependencies, so it runs on any machine: VDI desktops and kiosks with no GPU,
old browsers' worth of hardware, a phone. Written in strict TypeScript; ships ES
modules and type declarations.

The engine draws a **floor model** (`FloorPlan`, in `src/types.ts`): plain data in
the floor's local metres. A system can make it from a package
(`floorFromPackage`), or serve it from its own records, which is how wayfinder
uses it. The engine leaves meaning to its host: the host says how each space looks,
what it is called, which spaces can be chosen, and what happens when one is.

```html
<link rel="stylesheet" href="@storeypath/viewer-svg/plan.css">
<div id="plan" style="height: 600px"></div>

<script type="module">
  import { FloorPlanEngine, floorFromPackage, readPackage } from "@storeypath/viewer-svg";

  const pkg = await readPackage(await (await fetch("/files/headquarters.storeypath")).arrayBuffer());
  const engine = new FloorPlanEngine("#plan", {
    label: (s) => [s.name ?? "", s.number ?? ""],          // lines, any language
    styleOf: (s) => (taken.has(s.id) ? { className: "taken" } : null),
    interactive: (s) => s.type === "office" || s.kind === "zone",
  });
  engine.setFloor(floorFromPackage(pkg, "K7Q2XM-RUH-HQ-F02"));
  engine.addEventListener("select", (e) => console.log(e.detail.id));
  engine.select("K7Q2XM-RUH-HQ-F02-0142", { focus: "pan" });
</script>
```

`example/index.html` opens any `.storeypath` file (build first, then serve the
folder: `npm run build && python3 -m http.server`, and open `/example/`).

## What is shown

- **Units**: the zones of a divided space and the spaces with no zones — what
  people are placed in (see FORMAT.md, "Which to use"). Each is a `<path>` with
  `data-sp-id`. A divided space's outline is drawn over its zones; zone edges
  are light dashed lines, not walls.
- **Walls** and **parapets** as filled shapes, with their door and window gaps.
- **Doors** with their swings as drawn; **windows**; **openings** (doorways).
- **Labels** in screen space: upright and the same size at any zoom, shown only
  where they fit inside their space, each line in its own direction
  (`unicode-bidi: plaintext`: Arabic and English mix). They sit on the space's
  label point, which is inside it whatever its shape.
- **Items** (format 0.6: furniture and equipment) over the spaces and under the
  walls and labels, as Studio draws them: the footprint in its type's colour, its
  front edge darker, and a mark of its kind: a desk's chair (and, by its type's
  grade, visitors' chairs, a return, a cabinet behind a high-backed chair), a
  sofa's seat, the way a TV faces, a photocopier's lid, a kiosk's screen and the
  way it faces; an access point a small circle with a wifi mark; anything on the
  ceiling dashed, as overhead. Each is a `<g>` with `data-sp-item`, a button in the
  tab order. `items: false` (or `setItems(false)`) hides them; `interactiveItems: false` leaves them out of clicks, which then
  choose the space under them. A floor model gives them as `items`, each its middle
  (`at`), the way its front faces (`front`, a direction in the plan's
  coordinates), `width`, `depth`, `type`, `mount` and `color`.
- A **pin** (`setPin`) on a space's label point, for "you are here".
- A **way** through the building (`showRoute`, format 0.8), drawn as the best indoor
  maps draw one: its walking on the floor shown as a line (a bright core on a darker
  casing on a halo of the plan's paper, its corners rounded, as wide at any zoom) that
  draws itself in over a second, then lets dots flow along it the way it goes (CSS alone:
  no frame is asked for once it is still); a "you are here" dot at its start, a soft halo
  pulsing round it; a pin dropping in at its end, a card over it naming the room and its
  floor ("OFFICE 205 · Floor 2"), the room tinted and outlined, pulsing once; and where it
  changes floor a round badge with the stairs' or lift's picture and a tag ("Up to Floor 2",
  "From Ground floor"), a button that shows that floor. Over the walls and doors, under
  the labels; the tags are set beside the labels and off the line, and labels the line
  runs over are moved off it (or, but the way's own, not shown). Kept when another floor
  is shown: that floor's part is drawn then. Without motion (the `motion` option, or
  reduced motion asked for) it is drawn at once, still, with arrows along it.
- Two **looks** and two **themes**: `style: "wayfinding"` is the calm look for finding
  the way (light rooms with their type a faint tint, quiet walls and doors, furniture one
  quiet tone, labels muted but the way's own: its start, the corridors it goes along);
  `theme` holds the colours `"light"` or `"dark"` (default: as the system has them).

Hidden spaces (set in review) are left out unless `showHidden`; ignored ones always.

## Using it

| | |
|---|---|
| `new FloorPlanEngine(element, options)` | `label`, `ariaLabel`, `styleOf`, `interactive`, `colors`, `motion`, `padding`, `maxScale`, `labels`, `labelSize`, `items`, `interactiveItems`, `title` |
| `setFloor(plan, { fit, fade })` | draw a floor; fitted unless `fit: false`; with `fade`, the floor before fades out over it |
| `setOptions(options)` / `restyle()` | new options; apply `styleOf` again when the host's data changes |
| `setItems(on)` / `itemsShown` | show the items, or hide them (shown unless `items: false`) |
| `select(id, { focus })` / `selected` | choose a space or an item (`focus: "pan"` brings it to the middle at the same zoom, `"zoom"` zooms to it) |
| `highlight(ids, { dim })` | bring some spaces out, dim the rest; `null` for none |
| `setPin(id)` / `markerOf(id)` | a pin in a space; a space's label point |
| `showRoute(route, options)` / `clearRoute()` / `route` | draw a way (`route()` below, or any `PlanRoute`: `legs` of `{ floor_id, points }`, `changes` of `{ by, from_floor_id, to_floor_id, direction }`, and `steps` to step through it) over the floor shown, each floor's part when it is shown. Options: `floorName(id)` names floors in its tags and card; `fit` brings it into view; `style` the plan's look while it is shown; `animate` (draw it in, then flow; default true), `flow` (the dots; default true); `startLabel` ("You are here"; none by default), `endLabel` (default: its room and floor; null: none), `changeLabel(change, side)`; `landmarks` (the spaces whose labels stay clear); `floorPlan(id)` (another floor's plan, or a promise of one: the engine then shows other floors itself, cross-faded) |
| `fitRoute()` | the way on the floor shown in view, with room for its marks |
| `showStep(i, { animate })` / `showLeg(i)` / `routeStep` | a step of the way framed (the start and its first metres, a walk whole, the stairs or lift, the destination and its room), its floor shown first (cross-faded, through `floorPlan`, else the page's `routefloor`); `routestep` says so |
| `playRoute({ speed, restart, follow })` / `pauseRoute()` / `stopRoute()` / `routePlay` | play the way: a dot walks it at a steady pace (default: the whole way in some ten seconds), the part walked paler, a pause at each floor change and the next floor cross-faded to, the view following it (unless taken in hand); without motion, its steps one at a time; a promise, resolved when it ends or is stopped |
| `fit()`, `fitTo(ids)`, `focus(id, { zoom })`, `zoomBy(f, at)` | move the view |
| `camera()` / `setCamera(c)` | the view: screen = (x·k + tx, ∓y·k + ty) |
| `toScreen(p)` / `toPlan(s)` | between plan metres and the element's CSS pixels |
| events | `select` (`detail: { id, space, item }`: the space or the item chosen, from a click, a tap or the keyboard), `camerachange`, `floorchange` (`{ id }`), and a way's: `routestep` (`{ index, step, leg, floor_id }`), `routeprogress` (`{ metres, total, fraction, leg, step, floor_id, at }`, each frame while it plays), `routeplay` (`{ state }`: playing, paused, ended, stopped), `routefloor` (`{ floor_id, reason }`: the engine would show another floor; cancelable, or show it yourself with `setFloor`) |
| `ROUTE_GLYPHS`, `glyphOf(by)` | the pictures of the badges (stairs, lift, escalator, ramp, up, down: 24 × 24 path data, to be stroked), for a page's list of steps |

A drawing's y grows upwards; set `yDown: true` on a floor model whose y grows
downwards (as a page's does).

People move the plan with a drag, the wheel, two fingers, or the keyboard (arrows,
`+`, `-`, `0` to fit). Spaces that can be chosen are buttons in the tab order:
Tab to one and press Enter. Moves are animated unless the system asks for reduced
motion. Resizing keeps the middle of the view where it was.

Theme with CSS variables in a rule for `.sp-plan` (the plan's `<svg>` and the layers
over it, its way's line, its marks and its labels, each its own `<svg>` in a
`.sp-plan-box`, all carry the class): `#map .sp-plan { --sp-route: #0b6bcb }`
(`--sp-wall`, `--sp-door`, `--sp-window`,
`--sp-select`, `--sp-highlight`, `--sp-dim-opacity`, `--sp-label`, `--sp-pin`, …: see
`src/plan.css`; a way's: `--sp-route`, `--sp-route-width`, `--sp-route-casing`,
`--sp-route-casing-width`, `--sp-route-halo`, `--sp-route-halo-width`, `--sp-route-flow`,
`--sp-route-done`, `--sp-route-arrow`, `--sp-route-start`, `--sp-route-end`,
`--sp-route-room`, `--sp-route-marker-ring`, `--sp-route-change`, `--sp-route-badge`,
`--sp-route-chip`, `--sp-route-chip-text`, `--sp-route-chip-sub`, with dark values
under `prefers-color-scheme: dark` or `theme: "dark"`), or style the classes (`.sp-unit`, `.sp-zone`, `.sp-selected`,
`.sp-highlight`, `.sp-dim`, `.sp-type-office`, `.sp-style-wayfinding`, `.sp-theme-dark`, …). Space colours follow their type
unless `styleOf` or `colors` says otherwise.

For tests: the `<svg>` carries `data-cam="k,tx,ty"`, each unit `data-sp-id` and each
item `data-sp-item` (and `data-selected` when chosen), the pin `data-sp-pin` with
`data-plan-x`/`data-plan-y`; a way's lines `.sp-route[data-sp-route]` (how many legs
on this floor) and its markers `data-sp-route-start`, `data-sp-route-end`,
`data-sp-route-change` (`to` or `from`, with `data-floor`) and, playing,
`data-sp-route-walker`, each with `data-plan-x`/`data-plan-y`; how far it is drawn in
`data-sp-route-drawn` (0 to 1), its destination's room `data-sp-route-room`, the step
shown `data-sp-route-step` and playing's state `data-sp-route-play` on the `<svg>`.

## Finding the way

A package of format 0.8 carries its building's walking network: `readPackage` reads
it (`navigation`, null in older packages), and spaces of lifts and stairs their
`stack`. `route(pkg, from, to, { accessible })` — the module both viewers share
(`../src/navigation.js`, copied into `dist/` by the build, with its declarations) —
finds the way on it as Studio and the Go module do, and `showRoute` draws it:

```js
import { FloorPlanEngine, floorFromPackage, readPackage, route } from "@storeypath/viewer-svg";

const way = route(pkg, kioskItemId, officeId, { accessible: true });   // null: no way
const names = Object.fromEntries(pkg.floors.map((f) => [f.id, f.properties.name]));
engine.setFloor(floorFromPackage(pkg, way.legs[0].floor_id));
engine.showRoute(way, { floorName: (id) => names[id], fit: true, style: "wayfinding", startLabel: "You are here",
  floorPlan: (id) => floorFromPackage(pkg, id) });
list.replaceChildren(...way.steps.map((s, i) => Object.assign(document.createElement("li"), { textContent: s.text,
  onclick: () => engine.showStep(i) })));   // its floor cross-faded to, the step framed
engine.addEventListener("routestep", (e) => mark(e.detail.index));
await engine.playRoute();                   // a dot walks it, floor by floor
```

## Coordinates

`floorFromPackage` turns the package's longitude and latitude back into the
building's local metres: the drawing as the architect drew it, whatever its
bearing on the map. It agrees with Studio to a millimetre on
`spec/conformance/localframe.json`; `LocalFrame` is exported for the same use.
Items of format 0.7 carry where they stand in those metres (`local`), and are put
there as they are: moving the building on the map moves nothing in its plan.
Older packages' items are placed by their point and heading on the map.

## Tests

`npm test` builds, then checks the frame, the package reader and the way every reader
finds (`routes.json`) against `spec/conformance/`, and the engine in headless Chrome with real input: clicks,
drags, the wheel, two-finger pinches, the keyboard, resizing, reduced motion, both
y directions. Positions must hold to a pixel. Set `CHROME` to a Chrome or Chromium
if it is not in the usual place.
