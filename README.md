<h1 align="center">StoreyPath Viewer</h1>

<p align="center">
  <b>The StoreyPath package format, and everything that reads it.</b><br>
  A 3D world you can orbit and walk through, a 2D plan that needs no GPU, the way from a
  kiosk to an office, and a Go reader: for any web app or system that wants indoor maps
  with IDs that never change.
</p>

<p align="center">
  <img src="docs/images/world.webp" width="100%" alt="A three-floor office building in 3D, its floors lifted apart and cut away: rooms labelled, floors finished in carpet, marble, wood and tiles">
</p>

A `.storeypath` package is one building as plain JSON, GeoJSON and CSV in a ZIP: its
floors, rooms and zones, doors and windows, furniture and equipment with their asset tags,
floor and wall finishes, and the walking network between them. Every object has an ID
that never changes. Packages are made with
[StoreyPath Studio](https://github.com/StoreyPath/storeypath-studio), which pins a version
of this repository, so a package and the code that reads it always agree.

| Folder | What it is |
|---|---|
| [spec/](spec) | **The format**: [FORMAT.md](spec/FORMAT.md) (format 0.9), JSON Schemas, the list of finishes, and conformance packages with the ways every reader must find the same |
| [viewer/](viewer) | **The viewers**, to embed in a web app: the 3D world, a map view, the 2D plan ([viewer/svg](viewer/svg)) that needs no WebGL, and finding the way ([viewer/src/navigation.js](viewer/src/navigation.js)) |
| [go/](go) | **A Go module** that reads and validates packages and finds the way in a building, standard library only |

## The 3D world

![The same floor in 3D, cut away: the left half Real, finished as built; the right half Model, white with its edges drawn](docs/images/looks.webp)

`StoreyPathWorld` builds a building from its package alone: walls at the thickness they
were drawn, doors with architraves and handles, windows with glass, skirting, furniture
with its chairs (each desk with what its grade has), floors and walls in their finishes,
under a sun with soft shadows. Two looks, one call apart: **Real** or **Model**, an
architect's white model with its edges drawn; and a quality that suits the machine (Auto
takes Low on built-in, virtual or software graphics). Orbit it as a dollhouse, one floor
or all, cut away, lifted apart, or in x-ray:

![X-ray: see-through walls, every room a translucent volume in its type's colour, desks and sofas inside](docs/images/xray.webp)

```js
import { StoreyPathWorld } from "./storeypath-viewer/src/world/world.js";

const world = new StoreyPathWorld("#world", { style: "real" });
await world.open("/files/main-building.storeypath");
world.setFloor("CAMP05-CAMPUS-MAIN-F02");
world.setCutaway(true);
world.select("CAMP05-CAMPUS-MAIN-F02-0127");   // fly to the president's office
```

### Walk through it, doors and all

<p align="center">
  <img src="docs/images/walk.webp" width="80%" alt="Walking down a corridor to an office's door: the cross on it says Open door (E); it swings open; in, past the walnut panels to the desk">
</p>

`world.setMode("walk")` starts at the front door: mouse to look, W A S D to move, and
walls, windows and shut doors in the way. A door opens as you walk into it, or with E or a
click at the cross (`setDoors("manual")`: only those); a page opens and shuts doors itself
with `setDoorOpen(id, open)` and hears them with the `dooraim` and `doorchange` events. At
stairs and lifts, `changeFloor(+1)` takes you up.

## The 2D plan, for any machine

![A floor as an SVG plan: rooms coloured by type, doors with their swings, windows, desks in benches with their chairs, access points](docs/images/plan.webp)

`FloorPlanEngine` ([viewer/svg](viewer/svg)) draws one floor as a plain SVG plan: rooms by
type, doors with their swings, windows, items, a search, the way drawn on it. No WebGL and
no dependencies, for machines with no GPU (VDI desktops, kiosks). Strict TypeScript, with
its own build and tests.

## Finding the way

<p align="center">
  <img src="docs/images/route.webp" width="100%" alt="The plan's wayfinding look: the way draws itself in from You are here at the reception's kiosk to the stairs, a badge says Up to Floor 2; Play walks a dot along it, then Floor 2 fades in and the dot goes down the corridor to OFFICE 213, its pin and card">
</p>

Every package carries its building's walking network (`navigation.json`): its doors and
openings, a point in each room, the lifts and stairs on each floor, its entrances and
kiosks. `route(pkg, from, to, { accessible })` finds the quickest way between any two of
them, or the one without stairs, with its line on each floor and steps ready to show. Both
viewers draw it (`showRoute`) as the best indoor maps do. On the plan, in its calm
`wayfinding` look, light or dark: a line that draws itself in and flows the way it goes,
*You are here* at its start, a round badge where it changes floor (*Up to Floor 2*: a click
shows that floor), a pin and a card on the room it ends in; `playRoute()` walks a dot along
it, floor by floor. In 3D: a glowing ribbon over each floor, a column through the stairs or
the lift, the same marks; `flyRoute()` takes the camera along it. Both step through it
(`showStep`). The Go module finds the same way, and
[spec/conformance/routes.json](spec/conformance) holds ways every reader must agree on.

![The same way in the 3D world: a glowing ribbon from You are here through the reception to the stairs, up to Floor 2 and along the corridor to OFFICE 213, the floors it does not use faded back](docs/images/route-3d.webp)

```js
import { route } from "./storeypath-viewer/src/navigation.js";
const way = route(pkg, "6VY9-YE7X-YGR", "CAMP05-CAMPUS-MAIN-F02-0134"); // the reception's kiosk to OFFICE 213
plan.showRoute(way, { style: "wayfinding", fit: true, startLabel: "You are here",
  floorPlan: (id) => floorFromPackage(pkg, id) });   // the plan shows each floor of it itself
await plan.playRoute();                               // a dot walks it, floor by floor
world.showRoute(way, { fit: true, startLabel: "You are here" });
await world.flyRoute();                               // the camera along it, up the stairs
```

## The Go reader

```go
import storeypath "github.com/storeypath/storeypath-viewer/go"

pkg, err := storeypath.Open("main-building.storeypath")
for _, p := range pkg.Validate() { … }                  // problems, each with a stable code
for _, u := range pkg.UnitsOn(floorID) { … }            // the rooms and zones people are placed in
way, err := pkg.Route(kioskItemID, officeID, storeypath.RouteOptions{Accessible: true})
```

Buildings, floors, spaces, zones and openings with their IDs, items and their catalogue,
capacities and grades, finishes, lifts' and stairs' stacks, and the way: standard library
only. [go/README.md](go/README.md).

## Use it

The viewers are plain ES modules: serve them, or install `@storeypath/viewer-world` (the 3D
world as one module, three.js inside: [viewer/world](viewer/world)) and
`@storeypath/viewer-svg` (the 2D plan). Nothing is downloaded at run time: they work
offline. Every option, method and event: [viewer/README.md](viewer/README.md).

```sh
cd viewer/svg && npm ci && npm test      # the 2D plan
cd viewer/world && npm ci && npm test    # the 3D world (headless Chrome)
cd go && go test ./...                   # the Go reader
node spec/finishes.mjs --check           # the finishes' copies agree with spec/finishes.json
```

The pictures here are of StoreyPath Studio's demo campus (all of it made up), taken by
Studio's `docs/media/capture.mjs viewer`.

## Coming

A standalone viewer app (2D, 3D, walking and navigation in one view, read-only),
installable on phones and tablets and usable as a kiosk, built from these viewers.

## Licence

Apache 2.0 ([LICENSE](LICENSE)). The vendored libraries keep their own licences
([viewer/vendor](viewer/vendor)).
