# StoreyPath Viewer

Read-only web viewer engines for StoreyPath packages, to embed in any web app. It
does no editing of its own; packages are made with [StoreyPath Studio](https://github.com/StoreyPath/storeypath-studio),
whose Review edits on top of the 3D world through its [editing API](#the-3d-world).

- **`StoreyPathWorld`**, the 3D world: walls, doorways, windows, skirting,
  architraves, furniture and floor finishes built from the package, with sunlight
  and soft shadows, in one of two looks (real, or an architectural model) at the
  quality the machine can draw. Orbit it as a dollhouse (one
  floor or all, cut away, x-ray) or walk through it in the first person. Built on
  [three.js](https://threejs.org).
- **`StoreyPathViewer`**, the map view: floors on a map, search, and spaces
  highlighted by their StoreyPath ID — for example where employees sit. Built on
  [MapLibre GL JS](https://maplibre.org/).
- **`FloorPlanEngine`** in [`svg/`](svg/), one floor as a plain SVG plan: no WebGL
  and no dependencies, for machines with no GPU (VDI desktops, kiosks). Strict
  TypeScript, with its own build and tests.
- **`@storeypath/viewer-world`** in [`world/`](world/): the 3D world as one ES
  module with three.js and JSZip inside, type declarations, and `webglSupport()`
  to ask first whether the machine can show it well; for applications that
  install it as a package rather than serve these files.

Plain ES modules, no build step. Neither downloads anything but the package.

## The 3D world

```html
<script type="importmap">
  { "imports": {
      "three": "./vendor/three/three.module.js",
      "three/addons/": "./vendor/three/addons/",
      "jszip": "./vendor/jszip.mjs" } }
</script>

<div id="world" style="height: 600px; position: relative"></div>

<script type="module">
  import { StoreyPathWorld } from "./storeypath-viewer/src/world/world.js";

  const world = new StoreyPathWorld("#world");
  await world.open("/files/headquarters.storeypath");

  world.setFloor("K7Q2XM-RUH-HQ-F02");
  world.setCutaway(true);
  world.select("K7Q2XM-RUH-HQ-F02-0142");             // fly to an office
  // later: world.setMode("walk");  (drag to look, W A S D to move, double-click to go)
</script>
```

With a bundler, `import { StoreyPathWorld } from "@storeypath/viewer/world"` and
install `three` and `jszip` alongside it.

`new StoreyPathWorld(container, options)`

| Option | Default | |
|---|---|---|
| `labels` | `true` | room names in the dollhouse view |
| `showHidden` | `false` | spaces marked hidden or ignored in Studio |
| `items` | `null` | furniture and equipment: `true`, `false`, or `null`: shown when one floor is |
| `style` | `"real"` | the look: `"real"` or `"model"` ([below](#looks-and-quality)) |
| `quality` | `"auto"` | `"auto"`, `"high"` or `"low"` ([below](#looks-and-quality)) |
| `explode` | `0` | m between floors in the dollhouse view |
| `doors` | `"auto"` | walking, a shut door opens when walked into (`"auto"`), or stays shut until opened (`"manual"`) ([doors](#doors)) |
| `doorKey` | `"KeyE"` | walking, the key (a `KeyboardEvent.code`) that opens or shuts the door under the pointer, else the nearest ahead; `null` leaves every key to the page |
| `slab`, `doorHead`, `windowSill`, `windowHead`, `cutHeight` | `0.22`, `2.1`, `0.9`, `2.2`, `1.25` | m |

| Method | |
|---|---|
| `open(source)` | load a package (URL, `Blob`, `File`, `ArrayBuffer`); builds its first building |
| `setBuilding(id)` | build and show a building; a promise, resolved once it is shown |
| `setFloor(id)` | one floor, or `null` for all; when walking, go to that floor |
| `setMode("dollhouse" \| "walk", { at, floor, heading, back })` | orbit, or stand at the front door to walk in; walking from `at` (`{ x, z }`, local metres: the middle of the nearest room when in none), on `floor`, facing `heading`; back to orbiting, round the whole building, or with `back`, where the view was before walking |
| `startWalking()`, `stopWalking()` | kept for pages written before the mouse was never taken: the first is `setMode("walk")`, the second does nothing ([walking](#walking)) |
| `changeFloor(+1 \| -1)` | when walking: up or down a floor |
| `select(id, { go })` | highlight a space, zone or item and fly (or, walking, go) to it |
| `setXray(on)`, `setCutaway(on)`, `setLabels(on)`, `setShowHidden(on)`, `setExplode(m)` | |
| `setItems(on)` | furniture and equipment: `true`, `false`, or `null` (shown when one floor is) |
| `plan(floorId)` | a floor's walls, rooms, items, obstacles and doors (each `{ id, open, moving, span, leaves }`: where its leaves are now) in local meters, for drawing a minimap |
| `showRoute(route, { fit, fly, animate, startLabel, endLabel, floorName, color, casing, arrow, start, end })` | draw a way (`route()`, below; [finding the way](#finding-the-way)): a softly glowing ribbon over each floor it walks on, chevrons flowing along it, a glowing column with an arrow through each lift or stairs, a pulsing ring at its start and a pin over its end (its room lit), rising in from its start (`animate`); the floors it does not use fade back; with `fit` the camera frames it, with `fly` it goes along it |
| `showStep(i)`, `showLeg(i)`, `routeStep` | frame a step of the way (or a leg), its floor clear and its other legs faded; `routestep` says so |
| `flyRoute({ seconds })`, `playRoute({ seconds, restart })`, `pauseRoute()`, `stopRoute()`, `routePlay` | take the camera along the way shown (a promise): a smooth line just behind and above, slower at turns, riding each lift or stairs to the next floor, ending on the destination; at once with reduced motion; `routeprogress` and `routeplay` say how far; `clearRoute()` takes the way away; `route` is the way shown |
| `reload(source, { floors })` | read the package again and build only `floors` again (default: all of the building shown), where they stand: the view, mode, floor shown, selection, walker and a way shown are kept |
| `pause()`, `resume()` | stop drawing while the page hides the world (kept as it is), and draw again at once |
| `setStyle("real" \| "model")`, `setQuality("auto" \| "high" \| "low")` | the look and the quality ([below](#looks-and-quality)): nothing is built again |
| `ready()` | a promise, resolved once the look is drawn as it will stay: its finishes painted, its passes loaded |
| `setDoorOpen(id, open, { instant })`, `doorOpen(id)`, `toggleDoor(id)`, `setDoors("auto" \| "manual")` | open or shut a door by its opening's ID ([doors](#doors)) |
| `useDoor()` | walking: open or shut the door under the pointer (within reach), else the nearest ahead, as <kbd>E</kbd> does: its new `{ id, open }`, or null |
| `destroy()` | |

**Editing on top of it** (what Studio's Review does in 3D and walking; the world
changes nothing by itself — the page decides, saves, and tells it):

| Method | |
|---|---|
| `pointAt(clientX, clientY)` | what is under a point of the screen (given none, the middle of the view; walking, on the walker's floor): `{ floor, x, z, local, space, room, item, wall }` (`x`, `z`: local metres; `local`: `[x, y]` in the building's own frame, the metres of its drawings, as Studio and an item's `local` have them; the space or zone it is in, and `room`, the space (a zone's space); the item in the way; `wall`: whether a wall was met first). The first thing in the way counts: aimed at a wall, the point is on the floor just before it, so `room` is the room on the side aimed at. From the plan's walls and the items' boxes, not triangles: well under a millisecond on a floor of a thousand rooms, so it can follow the pointer every frame |
| `worldPoint([x, y])`, `buildingPoint({ x, z })` | the building's own frame into the world and back (through its placement, format 0.7; null without one) |
| `setFloorItems(floorId, items)` | replace one floor's furniture and equipment without building anything else again (a thousand desks in milliseconds): each `{ id, type, x, y, rotation }` in the building's own frame (rotation: degrees counter-clockwise, its front its own −y), with `width`, `depth`, `height`, `mount`, `elevation`, `color`, `grade` where they are not its type's in the package's catalogue |
| `ghost(item \| null)` | where an item would go: see-through over its floor, green, or red with `ok: false`, its footprint outlined, with the magnet's `guides` (`[[x, y], [x, y]]` each); `null` takes it away |
| `mark(target \| null)` | lightly mark what a click would act on, apart from what is chosen: `{ floor: id }` a space's or zone's floor, `{ walls: id }` the faces of a space's walls towards it (a zone's: its space's), `{ item: id }` an item; `null`: nothing (Studio marks what painting or choosing would do as the pointer moves: `hover`) |
| `setDraggable(on)` | items carried across their floor by a drag — in the dollhouse view any item, walking the item chosen (a drag elsewhere looks round): `itemdragstart`, `itemdrag`, `itemdragend` say where (`{ id, floor, x, z, local, altKey, shiftKey }`; a press that does not move stays a click) |
| `updateSpace(id, { name, number, type, hidden, ignored, floor_finish, wall_finish })` | a room corrected: its label at once; its finishes in place, before the next frame (its floor's triangles and its walls' faces drawn in the finishes' materials: nothing built again, however many rooms change at once); its floor built again when its type or whether it shows changed |
| `finishOf(id)` | what a space's or zone's floor and walls are in, as shown: `{ floor, wall }`, codes of `FINISHES` (its own, a zone's space's, else its type's) |

Properties: `target` (where the dollhouse view looks, `{ x, z }`), `paused`, `draggable`,
`hovered` (walking, what is under the pointer, as `hover` said it last), `lookSensitivity`
(walking, how far a drag turns the view: 1, the default, keeps what was pressed under the
pointer; 0.25 to 4).

Properties: `package`, `building`, `floor`, `mode`, `selected`, `room` (the space
the walker is in), `walkFloor`, `atStairs`, `walking` (the walk view is on), `player`
(`{ x, z, dx, dz, floor }`, for a minimap), `prebuilt` (the floors shown from the
package's pre-built 3D), `items` (whether items are drawn now), `look` (`{ style,
quality, drawn, why }`: below), `doors` (`"auto"` or `"manual"`), `aimedDoor` (walking,
the door <kbd>E</kbd> works: `{ id, open, under }`, under the pointer within reach, else the
nearest ahead; or null).

Items (format 0.6: desks, photocopiers, access points, sofas, TVs, …) are drawn
in their type's colour as shapes of their kind (a desk with its chair on five
spokes, and what goes with its grade: visitors' chairs, a return, a credenza), on
their floor, where they
stand in their building (format 0.7: `local`, put on the map by the building's
placement, as its walls are; older packages: their point and heading on the map).
They cost nothing until shown: their geometry is made the first time a floor
shows them (a copy of one template a kind and size: a thousand desks in
milliseconds), detailed when one floor is shown, a box each when more are (taken
from the pre-built file when there is one), in two meshes a floor (below the cut, and above
it: on a wall, under the ceiling). A click on one chooses it, as on a room
(`select` with the item's feature); the walker bumps into those on the floor.

A floor is built from the package's features by
[src/world/build.js](src/world/build.js), merged into a few dozen meshes (one for
the walls, one for each type of space's floors, …) whatever its number of rooms. Each
floor's and wall's triangle carries the room it is of (a wall's face, the room it
faces), so the world draws each mesh a finish at a time (format 0.9: a draw call a
finish, the triangles sorted, not built again when a room's finish changes). A
package exported by Studio with Node.js at hand carries each floor already built
(format 0.5, `world/<floor-id>.glb`, made by the same build.js:
[world/bake.mjs](world/bake.mjs)); the world shows those as they are, unless they
are of another export or another version of the builder (`BUILDER`: 5 since doors
swing), or the world was given other sizes, and builds the rest. Either way it looks
the same, and its doors open and shut the same.

Events: `load`, `buildingchange`, `floorchange`, `modechange`, `routestep`
(`{ index, step, leg, floor_id }`), `routeprogress` (`{ metres, total, fraction, leg,
step, floor_id }`), `routeplay` (`{ state }`: playing, paused, ended, stopped), `select`
(`{ id, feature }`), `roomchange` (`{ id, type, name, number, stairs }`),
`pick` (a click — a press that does not move a few pixels, or a tap — in either view:
what `pointAt` says is there, with `button`, `altKey`, `shiftKey`, `clientX`, `clientY`,
`pointerType`, and `door`, walking, the door within reach under the pointer; cancelable —
unless a listener calls `preventDefault()`, what was clicked is selected, or walking on a
door, the door opened or shut), `menu` (a right-click that does not move — a right-drag
looks, or moves the dollhouse view — or walking a long press: what is there, as `pick`
says, for the page's own menu), `hover` (walking: what is under the pointer changed —
its floor, space, room, item, wall, or the door there (`door: { id, open }`); null once
nothing is), `glide` (`{ state, x, z }`, walking: a double-click's glide `"going"`,
`"there"`, `"stopped"` or `"refused"`), `itemdragstart`, `itemdrag`, `itemdragend` (with
`cancelled`), `reload` (`{ floors }`), `lookchange` (`look`, when the look or
quality changed, or auto chose Low), `doorchange` (`{ id, open, floor }`: a door asked
to open or shut, by the walker or the page) and `dooraim` (`{ id, open, under }`,
walking: the door <kbd>E</kbd> works changed, or what it would do; `id` null for none).
`walklock` (`{ locked }`) is said as the walk view starts and ends, for pages written
when walking took the mouse.

### Looks and quality

The world is drawn in a **look** and at a **quality**; switching either swaps its
materials, lights and passes on what is built, and builds nothing again.

| Look (`style`) | |
|---|---|
| `"real"` (default) | real but clean: each room's floor and walls in its finishes ([Finishes](#finishes)) — by default carpet tiles in offices and meeting rooms, marble in lobbies, porcelain in corridors, restrooms and kitchens (white wall tiles in restrooms), terrazzo on stairs and at lifts, concrete in plant rooms and stores, oak in homes, white paint on walls — painted here (High: with normal and roughness maps, and a far larger tint so nothing visibly repeats) off the page's thread, only those shown; painted joinery, metal handles; furniture rough or metallic part by part |
| `"model"` | an architectural model: white clay, floors (and, faintly, walls) tinted by their finishes' tones, dark lines along the edges of walls, frames, doors and furniture |

| Quality (`quality`) | |
|---|---|
| `"high"` | ambient occlusion where surfaces meet ([N8AO](https://github.com/N8python/n8ao), at half resolution), multisampled edges, a 4096 px shadow map, finer finishes; the screen's pixels up to 1.5 a CSS pixel (3.6 million at most) |
| `"low"` | none of these: a 2048 px shadow map, plain finishes, a pixel a CSS pixel; for integrated graphics, virtual desktops and software renderers |
| `"auto"` (default) | Low on a software, virtual or integrated renderer (as the browser names it), or when High's frames take over 40 ms once the building has been shown; else High. `look.drawn` says which, `look.why` why Low (`"software"`, `"virtual"`, `"integrated"`, `"slow"`) |

### Finishes

What a room's floor and walls are finished in (format 0.9, spec/FORMAT.md
"Finishes"): a fixed set of 50 — carpet tiles in eight colours, patterned and prayer
carpet, sheet vinyl and vinyl planks, porcelain tiles, marble, terrazzo, oak and walnut
planks, herringbone, polished concrete, epoxy, studded rubber, raised access floor; nine
paints, linen, striped, geometric and damask wallpaper, wall tiles, mosaic, oak slats,
walnut panels, stone cladding. [src/finishes.js](src/finishes.js) has them
(`FINISHES`: each finish's code, names in English and Arabic, tone, and what it is
painted with; the defaults by type; made from `spec/finishes.json`), with `finishOf`,
`floorFinish(props, space)`, `wallFinish(props)` and `defaultFinish`: what a room
shows, from its properties (`floor_finish`, `wall_finish`; none, or a code a later
version adds, its type's). Each is painted here by its kind
([src/world/finishes.js](src/world/finishes.js): a square image that tiles, in a
worker), nothing downloaded; a surface shows its finish's tone until its image comes.
Each face of a wall is the finish of the room it faces (the outside, white paint),
the wall over and under openings too.

Either way: soft shadows from the sun, fitted round what is shown (on a big floor,
round what is looked at, and walking round the walker) and drawn again only when
what casts them or their frame changes; walking, the ceiling keeps the sun out but
at the windows, and the ceiling panels nearest the walker light its room. Skirting,
architraves, handles, window boards, ceiling panels and the furniture are geometry
(build.js), the same in every look and quality.

```js
const world = new StoreyPathWorld("#world"); // real, auto: sensible with no controls at all
world.addEventListener("lookchange", (e) => console.log(e.detail)); // { style, quality, drawn, why }
world.setStyle("model");
world.setQuality("low");
```

On a Mac (M-series, headless Chrome, 1600 × 1000): a floor of a thousand offices
and desks draws in about 3.5 ms a frame at High and 2 ms at Low (campus HQ: 2–3 ms
and under 2 ms), and is first built as quickly as before the looks.

Rooms' labels show where there is room for them on the screen (a room at least
56 px across), and are placed again only when the view moves: a floor of a thousand
rooms orbits as smoothly as a floor of ten.

### Walking

The mouse is never taken: walking is used as Street View is, and the page around the
world stays usable.

| | |
|---|---|
| look round | drag with the left or right button, or one finger: the scene stays under the pointer, eased a little, and turns on a moment when let go of while moving (not with reduced motion); up and down stop short of straight up |
| move | <kbd>W A S D</kbd> or the arrow keys, <kbd>Shift</kbd> to run; the wheel a step on or back (a pinch zooms nothing) |
| go there | double-click (or double-tap) the floor: the walker glides there along a straight line, stopping before a wall or anything in the way (a key stops it); refused with a word by the pointer when something is in the way at once |
| act | a click (a press that moves less than 4 px; a finger's, 10) at the pointer: `pick` says what is there, and unless the page takes it, a door within reach opens or shuts, else what is there is chosen (a floor's room a moment later, when the click is not the first of a double-click: that only goes there); a right-click or a long press says `menu` |
| see | what is under the pointer is said as it changes (`hover`); a ring on the floor shows where a double-click would go, the pointer is a hand over what a click acts on, and the door hint is by the pointer |

Walls and windows stop you, and shut doors; doorways and open doors don't. Floor
changes are up to the page (the example uses <kbd>E</kbd>/<kbd>Q</kbd> where `atStairs`
is true, when <kbd>E</kbd> was not a door's). The walker's keys are never those typed in
a field, in an open dialog or menu, or taken first by the page (`preventDefault()`).
Walls come from the floors' `walls`, door and window openings from the openings'
`span` (format 0.1); a package without them shows rooms but no walls.

### Doors

A door's leaves start as the plan draws them, open (from the openings' `swings`, format
0.3.1: which side each hinges on and which way it opens; two for a double door; a door
drawn without them gets one leaf opening into the room it serves, or two when wider
than 1.3 m). An open leaf is never in the walker's way, even drawn across a passage.

Walking, click a door within 2 m — its leaf, or a shut one's doorway (an open doorway
is looked through: a click there is on what is beyond it) — or press <kbd>E</kbd>, which
works the door under the pointer, else the nearest within 2 m ahead (no more than 60° off
the way you look): it swings shut about its hinges in half a second, eased, or open again.
With the pointer on it, a hint by the pointer says so (`.sp3d-door-hint`, styled here; a
page may restyle or hide it) and the world's element has the class `sp3d-door-aim`;
`dooraim` says which door <kbd>E</kbd> works, under the pointer or ahead. A shut door is in the walker's way; walking into it (within half a metre,
going and looking towards it) opens it by itself, unless the world was made with
`doors: "manual"` (or `setDoors("manual")`), when it stays shut until opened. In the
dollhouse view nothing changes: a click chooses as before.

<kbd>E</kbd> is taken only at a door (the world listens first, on the window: the
event's `defaultPrevented` tells a page's own <kbd>E</kbd> it was a door's), never
while typing in a field; `doorKey` names another key, or `null` none (the page calls
`useDoor()`).

```js
world.addEventListener("doorchange", (e) => console.log(e.detail)); // { id, open, floor }
world.setDoorOpen("K7Q2XM-RUH-HQ-F02-0311", false);                 // shut, swinging
world.setDoorOpen("K7Q2XM-RUH-HQ-F02-0311", true, { instant: true }); // open at once
world.doorOpen("K7Q2XM-RUH-HQ-F02-0311");   // true; null for no such door
world.toggleDoor("K7Q2XM-RUH-HQ-F02-0311"); // its new state
```

Whether a door is open is the view's, never written into a package: kept when a floor
is built again (`reload`, a room retyped), as drawn again when another package opens.
A leaf swings by its own few vertices of its floor's merged doors, turned in place
(src/world/doors.js): nothing is built again or drawn apart, a pre-built floor's doors
swing in its own geometry (builder 5: their runs listed in its extras, spec/FORMAT.md
"Pre-built 3D"), nothing is done a frame while no door moves, and the shadows are drawn
again only while one swings.

[examples/world](examples/world) is a complete page: floor picker, dollhouse
controls, room details, the walking HUD and minimap.

## Finding the way

A package of format 0.8 carries its building's walking network (`navigation.json`,
`pkg.navigation`; null in older packages). [src/navigation.js](src/navigation.js),
one module both viewers share (no dependencies), finds the way on it exactly as
StoreyPath Studio and the Go module do (spec/FORMAT.md, "Navigation (0.8)";
spec/conformance/routes.json):

```js
import { route } from "@storeypath/viewer/navigation"; // or from @storeypath/viewer, -world, -svg

const pkg = await loadPackage("/files/headquarters.storeypath");
// from a kiosk (its item's ID) to an office (a space's, a zone's, an item's or a node's ID)
const way = route(pkg, "7K2Q-XM9F-4DP", "K7Q2XM-RUH-HQ-F01-0069", { accessible: true }); // from a kiosk
way.steps.map((s) => s.text);
// ["Start at the kiosk in RECEPTION 017", "Walk 48 m along CORRIDOR to the lift",
//  "Take the lift up to Floor 1", "Walk 24 m along CORRIDOR to OFFICE 112", "OFFICE 112 is on your left"]
world.showRoute(way, { fly: true });
```

Both viewers draw it the same way, as the best indoor maps do, light or dark as the page
is: in 2D a line that draws itself in over a second and then lets dots flow along it the
way it goes, a "you are here" dot with a soft pulsing halo at its start, a pin dropping in
at its end with a card naming the room and its floor (the room lit and pulsing once), and
a round badge with the stairs' or lift's picture where it changes floor ("Up to Floor 2":
a click shows that floor); in 3D the same marks, its line a glowing ribbon with chevrons
and a glowing column through each lift or stairs. Both step through it (`showStep`) and
play it (`playRoute`: a dot walks it floor by floor in 2D, the camera flies along it in
3D), saying where they are (`routestep`, `routeprogress`, `routeplay`). Nothing moves
when reduced motion is asked for. A kiosk's page:

```js
const names = Object.fromEntries(pkg.floors.map((f) => [f.id, f.properties.name]));
plan.setFloor(floorFromPackage(pkg, way.legs[0].floor_id));
plan.showRoute(way, { style: "wayfinding", fit: true, startLabel: "You are here", floorName: (id) => names[id],
  floorPlan: (id) => floorFromPackage(pkg, id) });            // the engine shows other floors itself
plan.addEventListener("routestep", (e) => highlight(e.detail.index));
stepsList.onclick = (i) => plan.showStep(i);                 // its floor cross-faded to, the step framed
playButton.onclick = () => plan.playRoute();                 // again after pauseRoute: on from there
```

`route(pkg, from, to, { accessible })` answers the way: `nodes`, `legs` (the walking
on each floor: `floor_id`, `points` in the building's own metres, `metres`),
`changes` (each ride between floors: `by`, `from_floor_id`, `to_floor_id`,
`floors`, `direction`), `metres`, `seconds` and `steps` (each a `kind` — `start`,
`walk`, `take`, `arrive` — its values, and its `text` in English, for a system to
word in its own language); `null` when there is none (none without stairs, with
`accessible`); it throws for an ID the network does not have. `Graph` and
`shortest` are there for more. Spaces of lifts and stairs carry their `stack`: the
same on every floor one serves.

## Items' IDs

An item's ID (format 0.8) is an asset's tag, `7K2Q-XM9F-4DP`: ten random symbols of
Crockford's base32 and a check symbol (spec/FORMAT.md, "Asset IDs"). [src/ids.js](src/ids.js),
shared by both viewers too, reads it as a person types it, for a search box (a kiosk's,
an asset's page):

```js
import { isItemId, normalizeItemId } from "@storeypath/viewer/ids"; // or from @storeypath/viewer, -world, -svg

normalizeItemId("7k2q xm9f 4dp"); // "7K2Q-XM9F-4DP": either case, O for 0, I and L for 1, hyphens and spaces left out
normalizeItemId("7K2Q-XM9F-4DK"); // null: its check symbol is wrong (a symbol mistyped, or two swapped)
isItemId("7K2Q-XM9F-4DP");        // true: as a package writes it
```

## The map view

```html
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css">
<link rel="stylesheet" href="storeypath-viewer/src/viewer.css">
<script type="importmap">
  { "imports": {
      "maplibre-gl": "https://esm.sh/maplibre-gl@4.7.1",
      "jszip": "https://esm.sh/jszip@3.10.1" } }
</script>

<div id="map" style="height: 600px"></div>

<script type="module">
  import { StoreyPathViewer } from "./storeypath-viewer/src/index.js";

  const viewer = new StoreyPathViewer("#map");
  const pkg = await viewer.open("/files/headquarters.storeypath");

  viewer.select("K7Q2XM-RUH-HQ-F02-0142");          // fly to an office
  viewer.highlight(["K7Q2XM-RUH-HQ-F02-0143"]);      // e.g. a colleague's desk
  viewer.addEventListener("select", (e) => console.log(e.detail.id));
</script>
```

With a bundler, `import { StoreyPathViewer } from "@storeypath/viewer"` and
install `maplibre-gl` and `jszip` alongside it.

### API

`new StoreyPathViewer(container, options)`

| Option | Default | |
|---|---|---|
| `basemap` | `true` | map under the buildings: `true` for OpenStreetMap (online), a tile URL template for your own tile server, or `false` (offline) |
| `labels` | `true` | room names and numbers on the current floor |
| `showHidden` | `false` | show spaces and doors marked hidden or ignored in Studio |
| `labelMinZoom` | `18.6` | hide labels when zoomed out further |
| `roomHeight` | `2.4` | meters; how tall rooms are drawn on a single floor |
| `colors` | | `{ type: color }` overrides per space type |
| `selectColor` | `#ff8a00` | |
| `background` | `#ecebe6` | map background |
| `mapOptions` | `{}` | passed to `maplibregl.Map` |

| Method | |
|---|---|
| `open(source)` | load a package from a URL, `Blob`, `File` or `ArrayBuffer`; resolves to the package |
| `setBuilding(id, { floor })` | show a building (its ground floor unless `floor` is given) |
| `setFloor(id)` | show a floor |
| `setMode("floor" \| "stack")` | one floor with labels and doors, or every floor at its real height |
| `select(id, { fly })` | select a space, switching building and floor as needed |
| `clearSelection()` | |
| `highlight(ids, { color })` | color a set of spaces; replaces the previous highlight |
| `clearHighlight()` | |
| `fitTo(features)` | frame features (default: the current building) |
| `set3D(on)`, `setBasemap(visible)`, `setShowHidden(on)` | |
| `destroy()` | |

Properties: `package`, `building`, `floor`, `mode`, `selected`, `map` (the
MapLibre map, for anything else).

Events (`addEventListener`, data in `event.detail`): `load`, `buildingchange`,
`floorchange`, `modechange`, `select` (`{ id, feature }`, `id` is `null` when
cleared).

The package object (`viewer.package`, or `loadPackage(source)` on its own):
`get(id)`, `hierarchy(id)` → `{ project, location, building, floor, object }`,
`floorsOf(buildingId)`, `spacesOn(floorId)`, `doorsOf(spaceId)`,
`search(query, { type, buildingId, floorId, limit })`, and the raw `manifest`,
`buildings`, `floors`, `spaces`, `openings` collections.

## Examples

- [examples/world](examples/world): the 3D world — dollhouse and walk-through —
  open with `?pkg=<url>` (also `&building=<id>`, `&floor=<id>`, `&mode=walk`, `&xray=1`,
  `&cutaway=1`, `&hidden=1`).
- [examples/basic](examples/basic): the map view with building and floor picker,
  search, legend and details — open with `?pkg=<url>`.
- [examples/minimal](examples/minimal): the smallest embed.

Serve the `viewer/` folder over HTTP (ES modules don't load from `file://`), or
run `storeypath view <package>` from Studio.
