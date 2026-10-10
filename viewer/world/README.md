# StoreyPath 3D world, as one package

`@storeypath/viewer-world` is the viewer's `StoreyPathWorld` (a building from a
StoreyPath package as a 3D world: the dollhouse view, or a walk through it; see
[../README.md](../README.md)) made into one ES module, with three.js, JSZip and
N8AO (its ambient occlusion) inside it, and declarations for TypeScript. An application installs it and needs
nothing else: no import map, no CDN, nothing downloaded at run time. That is how
wayfinder shows its floors in 3D.

```ts
import { webglSupport } from "@storeypath/viewer-world/support";   // small: no three.js

if (webglSupport().ok) {
  const { StoreyPathWorld } = await import("@storeypath/viewer-world"); // ~1 MB, loaded only now
  const world = new StoreyPathWorld(element); // the real look, quality auto: Low on weak graphics
  await world.open(await (await fetch("/files/headquarters.storeypath")).arrayBuffer());
  world.select("K7Q2XM-RUH-HQ-F02-0142");
} else {
  // show the floor with the SVG plan viewer (../svg), made for machines with no GPU
}
```

`webglSupport()` answers `{ok, reason, renderer}`: `ok` only with WebGL 2 on a
graphics card. A browser that would give WebGL only with a major performance
caveat, or draws it in software (SwiftShader, llvmpipe, Microsoft Basic Render:
VDI desktops, kiosks with no GPU), is refused: the world does run there, at a
frame a second or so.

The module exports `StoreyPathWorld`, `loadPackage`, `StoreyPathPackage`,
`TYPE_COLORS`, `webglSupport` and, to find the way through a building (format 0.8),
`route`, `Graph` and `shortest` (the module both viewers share); `dist/world.d.ts`
declares them.

```ts
import { route, type Route } from "@storeypath/viewer-world";

const pkg = await world.open(data);
const way: Route | null = route(pkg, kioskItemId, officeId, { accessible: true });
if (way) {
  await world.showRoute(way, { fit: true, startLabel: "You are here" }); // it rises in, from its start
  world.addEventListener("routestep", (e) => mark(e.detail.index));
  await world.flyRoute();          // the camera along it, floor by floor
}
```

`showRoute(route, { fit, fly, animate, startLabel, endLabel, floorName, color, casing,
arrow, start, end })` draws the way: a softly glowing ribbon a little over each floor it
walks on, chevrons flowing along it the way it goes; a glowing column through each lift
or stairs, an arrow up or down on it, tagged "Stairs up to Floor 2"; a pulsing ring at
its start ("You are here") and a pin over its end, its room tinted and outlined, its card
naming it and its floor; seen through what is in front of it, its marks as big on the
screen far off as near, its tags never on one another. It rises in from its start
(`animate`; at once when reduced motion is asked for). While it is shown, rooms' labels
but its own (the corridors it goes along) are not; over the whole building the floors
it does not walk on fade back to a light shell, those above it are left out, and on a
way of several floors those but the one it is at fade too, so it shows through them.
`showStep(i)` and `showLeg(i)` frame a step or a leg, its floor clear and the way's other
legs faded (`routestep`). `flyRoute({ seconds })` (and `playRoute`, `pauseRoute`,
`stopRoute`, `routePlay`) takes the camera along it: a smooth line just behind and
above, looking ahead, slower at turns, pausing at each lift or stairs and riding with
the column to the next floor, ending on the destination (`routeprogress`, `routeplay`);
`clearRoute()` takes it away; `route` is the way shown. Its colours are CSS colours (by
default the plan viewer's).

Walking, the mouse is never taken (see ../README.md, "Walking"): a drag (either button,
or a finger) looks round, <kbd>W A S D</kbd> or the arrows move, a click acts where the
pointer is (`pick`), a double-click or a double tap on the floor glides there (`glide`), a
right-click or a long press says `menu`, and what is under the pointer is said as it
changes (`hover`, `hovered`); `mark` lightly marks what a click would act on.

```ts
world.setMode("walk");
world.addEventListener("hover", (e) => world.mark(e.detail?.space ? { floor: e.detail.space } : null));
world.addEventListener("pick", (e) => console.log(e.detail.item ?? e.detail.space, e.detail.door)); // at the pointer
world.addEventListener("menu", (e) => showMenu(e.detail.clientX, e.detail.clientY, e.detail));
```

Walking, doors open and shut: a click on a door within 2 m, or <kbd>E</kbd> (the door
under the pointer, else the nearest ahead: `useDoor()`), swings it, a shut door stops the walker until walked into (with
`doors: "manual"`, until opened), and a page does the same by the door's ID (the
opening's), the world saying so with `doorchange` (see ../README.md, "Doors"). Doors
start open, as the plan draws them; whether one is open is the view's, never the package's.

```ts
import type { DoorMode, WorldDoor } from "@storeypath/viewer-world";

const world = new StoreyPathWorld(element, { doors: "auto" satisfies DoorMode });
world.addEventListener("doorchange", (e) => console.log(e.detail.id, e.detail.open)); // { id, open, floor }
const doors: WorldDoor[] = world.plan(floorId)?.doors ?? []; // each { id, open, moving, span, leaves }
world.setDoorOpen(doors[0].id, false);  // shut, swinging about its hinges; { instant: true } at once
world.toggleDoor(doors[0].id);          // open again: true
```

## Pre-built 3D

```sh
node bake.mjs campus.storeypath out/     # out/<floor-id>.glb, one a floor
```

`bake.mjs` builds every floor of a package with the world's own builder
(`../src/world/build.js`) and writes it as binary glTF: what a package's `world/`
folder holds (format 0.5, "Pre-built 3D" in `spec/FORMAT.md`). Studio runs it when
it exports, when it finds Node.js (20.6 or newer); it needs nothing installed, as
it takes three.js and JSZip from `../vendor`. The world shows a floor pre-built
when the package has it, reading it with three.js's glTF loader (in the module),
instead of building it: when it was built by this builder (`BUILDER`, 5: its doors'
leaves listed to swing in its own geometry), else it builds the floor itself.

## Build and test

```sh
npm install
npm test        # build, type-check test/usage.ts, then test/run.mjs in headless Chrome
npm pack        # storeypath-viewer-world-<version>.tgz
```

`build.mjs` bundles `../src/world`, `../src/package.js` and `../src/theme.js`
with the copies in `../vendor` (three.js r186, JSZip 3.10.1); their licences
are in `dist/THIRD-PARTY-LICENSES.txt`. The tests open the conformance packages
with WebGL drawn in software (Chrome's SwiftShader), so they run on any machine.

Apache-2.0, like the rest of StoreyPath; three.js is MIT, JSZip is used under MIT.
