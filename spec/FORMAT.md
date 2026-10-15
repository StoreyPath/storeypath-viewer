# StoreyPath package format — version 0.11.0

A StoreyPath package (`*.storeypath`) describes one building of a project: the
building, its location, its floors, the spaces on each floor (offices, corridors,
elevators, …), the zones that divide open spaces, the doors between spaces, and the
furniture and equipment on them. A project of several buildings is several packages,
one each (One building per package). It is a ZIP archive of plain JSON, GeoJSON and
CSV files, so any system can read it without special software.

Sent where others could read it, a package may be sealed with a password
(`*.storeypath.enc`): what it holds is a package as below, and how it is opened is in
StoreyPath Viewer's spec/SEALED.md.

A copy of this document is included in every package.

## Files

| File | Contents |
|---|---|
| `manifest.json` | Format version, project, export number, file list, counts, the building's placement, and the building it holds (`scope`) |
| `location.geojson` | Locations (sites, campuses) |
| `buildings.geojson` | The building, with its footprint |
| `floors.geojson` | Floors, with their outline, order, elevation and height, and what level each is: a floor, a mezzanine (with the floor it stands in) or the roof (Levels, 0.11) |
| `spaces.geojson` | Rooms, offices, corridors, elevators, stairs, …: what walls and doors enclose |
| `zones.geojson` | The parts of an open space with no wall between them (a majlis and a dining area in one hall) |
| `openings.geojson` | Doors and other ways through, and which spaces each one connects |
| `objects.csv` | Every ID in one flat table, with its parent IDs — for building ID mappings |
| `changes.json` | IDs added, changed and retired since the previous export |
| `items.geojson` | Furniture and equipment on the floors: desks, photocopiers, access points, sofas, TVs, … (format 0.6) |
| `catalogue.json` | The types of items: their codes, names, sizes, how they are mounted, and the details each carries (format 0.6) |
| `navigation.json` | The walking network of the building: where a person can walk, and how long it takes, for finding the way (format 0.8) |
| `schema/*.schema.json` | JSON Schema for every JSON file |
| `world/<floor-id>.glb` | Optional: each floor already built in 3D, as binary glTF (Pre-built 3D) |
| `models/<CODE>.glb` | Optional: an item type's 3D model, as binary glTF (Models, 0.9.2) |
| `drawings/<floor-id>.view` | Optional: each floor's drawing as drawn, its part of its drawing in the building's own frame (Drawings, 0.11) |
| `FORMAT.md` | This document |

Readers locate each file through `manifest.json → files`, by its role (`location`,
`buildings`, `floors`, `spaces`, `zones`, `openings`, `objects`, `changes`, `items`,
`catalogue`, `navigation`); the names in the table are the defaults. A floor's drawing is
found through its source (`manifest.json → sources`, Drawings).

**JSON.** Keys are case-sensitive: a key that differs from the format's only in case is
not that key, and a reader may refuse the file. Every number is finite (NaN and
Infinity are not JSON), and numbers and booleans are never written as strings.

The files are JSON, GeoJSON and CSV in a ZIP archive, each compressed on its own
(a floor's plan is typically a tenth of its size in the archive), so a reader takes
only the files it needs, one at a time, and can parse a file as it reads it.

## IDs

Every object has a hierarchical ID; each segment is upper-case letters and digits,
separated by hyphens:

```
PROJECT-LOCATION-BUILDING-FLOOR-OBJECT        K7Q2XM-RUH-HQ-F02-0142
```

- Every prefix is itself an ID: `K7Q2XM-RUH` is the location, `K7Q2XM-RUH-HQ-F02` the floor.
  The project, location, building and floor of any object can be read from its ID alone.
- The project code is randomly generated when the project is created, so packages from
  different projects can be imported into the same system without collisions.
- **IDs are stable.** Re-converting a revised drawing keeps the ID of every object that is
  still there. An object that disappears is *retired*, and its ID is never issued again.
- The object's type is **not** part of its ID: correcting a type does not change the ID.
- Elevators, stairs and escalators keep the same object code on every floor they serve
  (`…-F01-0023`, `…-F02-0023`) when Studio finds them there itself. What links them
  across floors is their `stack` (0.8, Stacks): one drawn on a floor by hand has a code
  of its own, and the same stack.
- An ID is ASCII and at most 84 characters long (five segments of at most 16).
- Items (furniture and equipment) are not places: an item's ID is an asset ID, ten
  random symbols and a check symbol, `7K2Q-XM9F-4DP` (Asset IDs), of no project and no
  place. A place's ID never has that form (Studio's project codes are six symbols, and
  it refuses a building code that would give one): a reader taking an ID apart into
  its segments refuses an asset ID.

Importing systems should store our ID as the key of their own mapping, and use
`changes.json` on each new export to add, update and remove mappings.

## Coordinates

GeoJSON in WGS84 longitude/latitude (EPSG:4326, RFC 7946), rounded to 7 decimals
(about 1 cm). Lengths and heights are in meters. `manifest.json → placements` holds,
for each building, the anchor and bearing used to place the drawing, so local
drawing coordinates can be rebuilt if needed. It holds exactly one placement for each
building of the package, and so for every building an item stands in. Longitudes are
in (-180, 180]: a building across the antimeridian has longitudes on both sides of it.

Placing a building on the map is optional. A building whose placement has
`"placed": false` is not on the map yet: it is exported around 0°N 0°E with its
true shape and size (unplaced buildings of one location keep their positions
relative to each other as drawn), but its position on earth is not known. Its
coordinates change once it is placed.

**A building's own frame.** Every building has its own frame: the coordinates of
its drawings, in metres, shared by all its floors. The placement only says where
that frame is on the map, so moving a building (placing it, turning it, shifting it
on its site plan) changes the longitude and latitude of everything in it, and
nothing in the building itself: its rooms, doors and items stay where they are in
its frame, `changes.json` lists only the building as changed, and items carry their
position in the frame (`local`). The anchor point (`x`, `y`) of a placement is the
point of the frame put at (`lon`, `lat`): it may move between exports; the frame
does not.

## Features

Every feature has a top-level `id` and a `properties.kind`. Readers must ignore
properties they do not know: later versions may add some.

**location** — `code`, `name`, `address`, `project_id`, `display_point`. Geometry: the
convex hull of its buildings (or null).

**building** — `code`, `name`, `location_id`, `display_point`. Geometry: footprint (or
null if no floor has been converted).

**floor** — a level of the building: `code`, `name`, `building_id`, `type` (`floor`,
`mezzanine` or `roof`: Levels), `ordinal` (0 = ground, negative = below ground; a
mezzanine's is the floor's it stands in), `elevation` (m above the ground floor), `height`
(floor-to-floor, m; a mezzanine's its own; a roof's, the rooms' standing on it),
`host_floor_id` and `above_host_m` (a mezzanine's: Levels), `walls` (the walls as drawn, with their
door and window gaps: a Polygon or MultiPolygon, for drawing or modelling the floor; they
rise to the ceiling), `wall_thickness_m`, `parapets` (the low walls around terraces,
balconies and roofs, `parapet_height_m` high: a Polygon or MultiPolygon, or null) and
`parapet_height_m`. Geometry: floor outline (or null): a mezzanine's covers its own
rooms, not the floor under it.

**space** — `type`, `name`, `number`, `drawing_label`, `floor_id`, `area_m2`,
`display_point` (a good spot for its label), `zones`, `outdoor` (open to the sky: a terrace, balcony or roof with no
windows of its own; a glazed veranda is not), `capacity`, `capacity_from`, `grade`
(Capacity), `stack` (Stacks), `floor_finish`, `wall_finish` and `wall_finishes` (Finishes), `hidden`, `ignored`.
Geometry: Polygon or MultiPolygon. A space is what walls, doors and windows enclose:
walls stand on its edges.

**zone** — `type`, `name`, `number`, `drawing_label`, `space_id`, `floor_id`, `area_m2`,
`display_point`, `capacity`, `capacity_from`, `grade`, `floor_finish` (Finishes), `hidden`, `ignored`. Geometry:
Polygon or MultiPolygon. A zone is a
part of a space used for one thing, with no wall between it and the rest of the
space: a majlis and a dining area in one hall, a passage running into a living room,
team areas in an open office. The zones of a space divide it exactly (together they
cover it, without overlapping) and are listed in its `zones`, each once (a space lists
only its own zones: each one's `space_id` is that space); a space used for one thing
has none. Zone edges are not walls: draw them as light lines, and walk across
them freely.

**Names.** `name` and `number` are what StoreyPath read in the space's label and a
person may have corrected in review. `drawing_label` is the text written in the space
on the drawing, exactly as written (its lines joined by a line break; null when there
is none), never changed in review: the drawing's own name for the space, a key other
systems can match their records on, beside the ID. Systems keep their own display
names besides both.

**Which to use.** A space with zones is used through its zones; a space without
zones is used as a whole. Systems that place people or things in rooms should use
the zones of a space that has them, and the space itself otherwise.

**Capacity** (0.7). `capacity` is how many people a space or zone is meant to seat:
the number a person set in review (`capacity_from: "review"`), else the workplaces of
the items standing in it (`"items"`: a desk seats one; a space divided into zones
counts its zones' too), else null. 0 is a room meant to seat nobody (a meeting room
set so); `capacity` and `capacity_from` are both given or both null. `grade` is who it is laid out for: the highest grade among the desks standing
in it (`president`, `c_level`, `director`, `manager`, `section_head`, `senior`,
`junior`), or null. Both are the building's as drawn and furnished: a system placing
people takes them as defaults, and may keep its own (a capacity it sets, a
designation of the office) by the space's ID, which no later package changes. A
change of capacity or grade is a change of the space in `changes.json`.

**opening** — `type`, `floor_id`, `connects` (IDs of the one or two spaces it joins),
`exterior` (true when it leads outside), `width_m` and `span` (jamb to jamb, when
known), `swings` (a door's leaves as the plan draws them, each `[hinge, free edge
when open]`, when known: which side it hinges on and which way it opens; two for a
double door), `sill_m` and `height_m` (how high above the floor it starts, and how
tall it is, from the drawing's schedule of openings, when known), `hidden`, `ignored`.
Geometry: Point in the wall (never null).

`hidden` and `ignored` are set by a person in review. A hidden object is real but
not shown unless asked for (a shaft, a plant room); an ignored one was judged not
worth anything (a sliver, a pocket) and is best left out. Both keep their IDs, so
they are exported like any other object, and are listed in `objects.csv`.

## Types

Space types: `office`, `room`, `meeting_room`, `corridor`, `lobby`, `elevator`,
`stairs`, `escalator`, `ramp`, `restroom`, `kitchen`, `storage`, `utility`, `shaft`,
`open_area`, `unspecified`, `bedroom`, `living_room`, `dining_room`, `bathroom`
(private; public toilets are `restroom`), `dressing_room`, `laundry`, `prayer_room`,
`parking`, `balcony`, `terrace`, `open_to_below` (a void over the floor below), `roof`
(0.11: the open roof of a building, its deck behind the parapets, on a roof level).

Opening types: `door`, `window` (glazing in a wall: not a way through), `opening` (a
way through a wall with no door: a doorway). Openings join spaces; the zones of a
space need none.

Zones use the space types.

Type names are never renamed or removed; new types may be added in later versions,
and `manifest.json → types` lists the ones this package may use. `unspecified`
means the converter could not decide and nobody has corrected it yet.

## objects.csv

One row per ID, including the project itself:

`id, kind, type, name, number, project_id, location_id, building_id, floor_id,
floor_ordinal, area_m2, lon, lat, hidden, ignored, space_id, drawing_label`

`kind` is `project`, `location`, `building`, `floor`, `space`, `zone`, `opening` or
`item` (0.6). A reader skips rows of a kind it does not know: a later format may add some.
Parent columns are empty where they do not apply; `space_id` is a zone's space.
`lon`/`lat` is the label point (spaces, zones, buildings, locations) or the door
position (openings).

## changes.json

```json
{
  "sequence": 3,              // this export; 1 for the project's first
  "previous_sequence": 1,     // the last export that held this building (null: its first)
  "added":   ["…"],           // IDs new since then
  "changed": ["…"],           // IDs whose geometry or properties changed
  "retired": ["…"],           // IDs removed since then
  "all_retired": ["…"],       // every ID this building has ever retired
  "moved_away": [             // items carried since to another building (0.7)
    { "id": "7K2Q-XM9F-4DP", "building_id": "K7Q2XM-RUH-ANNEX" } ]
}
```

Every list is about the package's building since it was last exported (0.7; before,
since the project's previous export). Export numbers run across the project, so
`previous_sequence` may be several lower than `sequence`: a reader that applied a
later package of this building than `previous_sequence`, or an earlier one, missed or
holds another of its exports. `previous_sequence` is before `sequence` and the same as
the manifest's `export.previous_sequence`.

- `added`: new since then. An item a package of the project held before, carried into
  this building, is `changed`, not added.
- `changed`: anything whose geometry or properties changed in the building's own frame
  (Coordinates): moving the building on the map lists the building as changed, and
  nothing in it. A location is changed when its name or address changes (its outline
  follows its buildings).
- `retired`: removed since then, including an item that package held and that was
  taken away since, wherever it was then. Nothing listed is in the package.
- `all_retired`: every ID this building has ever retired: its own objects', and the
  items its packages held that were taken away since. An ID in use again is not
  listed. A system that skipped an export uses it to clean up its mappings.
- `moved_away`: items the building's last package held that stand in another building
  now (not retired: that building's package holds them). An item is never both moved
  away and retired.

## Items

Items are the furniture and the building's equipment people place on floors, each piece
an item of its own: desks (by grade: a manager's, a junior staff member's), chairs,
meeting tables, cupboards, sofas; cameras, card readers, smoke detectors, fire
extinguishers, wireless access points, photocopiers, air-conditioning units.
`items.geojson` holds them; `catalogue.json` says what each type is.

**An item's ID does not say where it is, nor whose it is.** It is an asset ID, the
tag on the asset: ten random symbols and a check symbol, `7K2Q-XM9F-4DP` (Asset IDs,
below). A desk carried to another office, another floor or another building keeps its
ID; where it stands is in its properties, and the project it is of is the package's.
Like every ID, an item's is never issued again once it is retired.

```json
{ "type": "Feature", "id": "7K2Q-XM9F-4DP",
  "geometry": { "type": "Polygon", "coordinates": [ … ] },     // its footprint, on the map
  "properties": {
    "kind": "item", "type": "DESK-MANAGER", "category": "workstations", "name": "Manager's desk",
    "floor_id": "K7Q2XM-RUH-HQ-F02", "building_id": "K7Q2XM-RUH-HQ",
    "space_id": "K7Q2XM-RUH-HQ-F02-0142", "zone_id": null,       // where its middle stands
    "local": { "x_m": 31.25, "y_m": 12.4, "rotation_deg": 90 },  // where it stands in its building
    "display_point": [46.67, 24.71], "heading": 270.0,          // its front faces west
    "width_m": 1.8, "depth_m": 0.9, "height_m": 0.75,
    "mount": "floor", "elevation_m": 0.0,                        // wall: its bottom; ceiling: null
    "values": { }, "group": "G4K7QX2MD",                        // placed with its chair and pedestal
    "door_id": null, "view_deg": null, "range_m": null } }       // a card reader's door; a camera's view
```

- `type` is a code of `catalogue.json`; `name` is that type's English name, for a reader
  that does not read the catalogue. The geometry is its footprint, a Polygon.
- `space_id`, and `zone_id` when the space is divided, are where its middle stands at
  export: null when it is in none.
- `local` (0.7) is where it stands in its building: its middle in the building's own
  frame (`x_m`, `y_m`: metres from the origin of the building's drawings), and the way
  its front faces there (`rotation_deg`, counter-clockwise: 0 is the drawings' −y, 90
  their +x). This is what the item is placed by: moving the building on the map never
  changes it, so a system keeping the history of where items have been keeps `local`
  and the floor, not the longitude and latitude.
- The footprint, `display_point` and `heading` follow from `local` and the building's
  placement, for maps: `heading` is the way its front faces, in degrees clockwise
  from north (a desk's front is where its user sits): (the placement's `bearing` + 180
  − `rotation_deg`) mod 360, which readers check to half a degree.
- `values` are its details entered in StoreyPath, by the catalogue's field keys.
- `group` (0.10) says which items were placed or grouped together: a workstation's desk,
  its chair and its pedestal; a meeting table and its chairs. It is a key the items of one
  group share and no other item of the package has; null, or absent, in none. A group is a
  link, not an asset: it has no tag, each of its items keeps its own ID, and taken out of
  the group an item keeps that ID. Studio moves and turns a group's items together.
- `door_id` (0.10) is the door an item serves, for a type that `serves_door`: a card
  reader, a door controller, an exit button, an intercom. It is the ID of an opening of the
  item's floor, a `door` or an `opening` (never a `window`); null, or absent, none. Studio
  links one placed within 2 m of a door to the nearest, and a person may link it to another.
  A door deleted since leaves it null in the package (the link comes back with the door).
- `view_deg` and `range_m` (0.10) are a camera's view, an item of a type of shape `camera`:
  how wide it sees, degrees across, centred on the way its front faces (360: all round),
  and how far, metres. Each is the item's own (its fields of those keys, entered where a
  lens is zoomed or a camera looks down a corridor), else its type's; null, or absent, not
  a camera or not known. A reader draws what a camera covers out to `range_m`, as a wedge
  or, all round, a circle; walls are not taken off it.

`catalogue.json` (`schema/catalogue.schema.json`) lists the types: a `code` that is
kept for good and never given to another type (a type no longer used is `retired`),
English and Arabic names, a `category` (Categories, below), a size, how
it is mounted (`floor`, `wall`, `ceiling`), a colour (`#rrggbb`), `workplaces` (how many people work
at one: a desk, 1; 0 for most else), `grade` (who a desk is for, 0.7), `shape` (how it is
drawn, 0.9.1: Shapes, below), `model` (its 3D model, 0.9.2: Models, below), and its `fields`. Each field
says who enters it: `owner: "storeypath"` (what is physical: a colour, a size, a
model) or `"system"` (the system that manages the asset: an access point's network).
A reader keeps the `system` fields itself, by the item's ID; the package never
carries them. The catalogue is the organization's: the same for every project. A
package's `catalogue.json` holds every type its items use, each once (a retired one too,
while an item has it), or, exported so, the whole catalogue (0.9.1; before, always the
whole). A camera type's `view_deg` and `range_m` (0.10) are its items' view where
they are given none of their own; a type's `serves_door` (0.10), whether its items serve a
door (`door_id`). A type a package does not hold is not removed: a reader keeping types adds new
ones and updates those it has, and takes none away.

**Categories (0.10).** A type's `category`, and its items', says what it is: furniture
by what it is for, `workstations` (desks), `seating` (chairs), `tables`, `storage`
(drawers, cupboards, lockers), `soft_seating` (sofas, armchairs), `beds`; the building's
equipment by the system it is part of, `security` (cameras, card readers, door
controllers), `fire_safety` (detectors, call points, extinguishers, emergency lights,
first aid), `it_av` (access points, network racks, printers, screens, kiosks),
`building_services` (air conditioning, electrical panels, water heaters), `appliances`
(fridges, coffee machines); and `furniture` or `equipment`, anything else of either. A
package of 0.9 has `furniture`, `equipment` or `appliance` (read as `appliances`).

**Shapes (0.9.1; 0.10).** A type's `shape` says how its items are drawn, whatever its code:
`desk` (a desk alone: on panel ends with a drawer pedestal when its `grade` is director,
c_level or president, else on a steel frame), `table` (a table alone), `chair` (an office
chair on castors, high-backed when it is 0.66 m wide or more), `side_chair` (a visitor's
chair), `armchair`, `sofa`, `storage` (a drawer pedestal when it is low and narrow, else
a cupboard, its doors at its front), `screen` (a TV or a display on a wall), `copier`,
`bed`, `kiosk`, `access_point` (a disc under the ceiling), `camera` (looking the way its
front faces: a dome under the ceiling, else a body on a bracket), or `box` (a box of its
size). Since 0.10 every piece is an item of its own: a desk's chair, a return, a credenza
and visitors' chairs, a meeting table's chairs, each have a type and an ID, and a desk or a
table is drawn without them; a chair's front is where its sitter looks. A package of 0.9
may say `meeting_table`, drawn as a `table`. Absent or null, a type is drawn by its code's
first part, as before 0.9.1: `DESK`, `MEETING` (a table), `SOFA`, `TV` or `SCREEN`, `COPIER`
or `PRINTER`, `ACCESS`, `BED`, `KIOSK`; any other code as a box (on the ceiling, a disc
when it is about as wide as it is deep). A shape a reader does not know (a later
version's) is drawn as if the type had none. Its size, colour and grade are the type's
whatever its shape. The shape says only how a type looks: what it is stays with its code
(a wayfinding kiosk is a `KIOSK` type, below, whatever its shape).

**Models (0.9.2).** A type may come with a 3D model of what it is: a supplier's model of
that sofa, that copier. Its `model` is the model's path in the package, always `models/`,
its code and `.glb` (`models/SOFA-3.glb`); absent or null, it has none. The package holds
each model once, for the types its `catalogue.json` holds that have one, and
`manifest.json → files.models` is `models/` when it holds any. A model is binary glTF 2.0
of one mesh (the first node of the first scene, with no transform) of one part drawn as
triangles, in the type's own frame: metres, +Y up, its front facing +Z (glTF's own
convention: where a person sits on a sofa, where a screen shows), +X across it, its middle
at x = 0, z = 0 and its bottom at y = 0. Its colours are in its vertices (`COLOR_0`,
unsigned bytes, normalised, linear as glTF has them), and how rough and how metallic each
part is in `_FINISH` (two unsigned bytes, normalised: roughness, metalness); it has no
textures, and its one material leaves the vertex colours as they are, so any glTF viewer
shows it as StoreyPath does. It has at most 20,000 triangles (Studio makes about 5,000 of
a supplier's model). An item of the type is drawn as the model made the item's size: its
box stretched or shrunk each way to the item's `width_m` (x), `height_m` (y) and `depth_m`
(z), turned and placed as the item is. Studio gives a type its model's own size when the
model is added, so it is drawn as it was made. The model says only how a type looks in 3D:
the plan still draws its shape. A reader that cannot read a model (missing, malformed, too
large) draws the type by its shape, as one of 0.9.1 does.

**Kiosks.** An item whose type is `KIOSK`, or `KIOSK-` and more (`KIOSK-WALL`), is
where a wayfinding kiosk stands: a screen where people type their employee number
and are shown their office. Its front is the side its screen faces, where people
stand to use it. A system running kiosks links each of its own to such an item by
the item's ID: the item's floor is the kiosk's floor, and its `local` position (its
`display_point` on the map) is the "you are here" of the kiosk's maps, and where a
way to an office will start. A kiosk moved keeps its ID, so the link holds; one
retired leaves its kiosk without a place until it is linked again.

Items are for asset management: where things are, and where they have been. They
are not inventory: nothing in a package says who holds what. An inventory system
keys its own records to the items' IDs, as every system keys its own to StoreyPath's.

Items go through `changes.json` as everything else: one moved, turned or given other
details in its building is `changed`, so a system can keep the history of where each
item has been. An item is in the package of the building it stands in. One carried
to another building since this building was last exported is listed in `moved_away`
with the building it went to: it is not retired, and that building's package holds it
(as `changed`, with its new floor and position) when that building is next exported.

### Asset IDs (0.8)

An asset ID is ten random symbols and a check symbol of Crockford's base32, whose
alphabet is `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no I, L, O or U), written in upper
case in groups of four, four and three joined by hyphens: `7K2Q-XM9F-4DP`. Packages
hold it only so (`^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{3}$`,
with its check symbol right), and systems should keep it so.

**Random.** The ten symbols are 50 random bits, from a cryptographically secure source.
A system issuing them checks a new one against every one it has issued (Studio: its
database's items, by their key) and draws again when it is taken. Between systems that
do not share their IDs, a clash is unlikely: two that issue 100,000 assets each give
one the same ID with a chance of about 1 in 110,000. An asset is one project's: a
reader that meets the same asset ID in packages of two projects (the manifests'
`project.id`) refuses the later one, as a clash, not the same asset. In packages of one
project it is the same asset, carried from building to building (`moved_away`).

**The check symbol** is Luhn mod 32 over the ten symbols' values (their places in the
alphabet: `0` is 0, `A` 10, `Z` 31). From the left, the 2nd, 4th, 6th, 8th and 10th
values are doubled: a doubled value *v* is 2*v* when that is below 32, else 2*v* − 31
(its two base-32 digits added). The ten are added; the check symbol's value is
(32 − sum mod 32) mod 32. Checked so, the eleven (the check symbol not doubled) add up to
a multiple of 32. For `7K2QXM9F4D`, the values 7 19 2 23 29 20 9 15 4 13 become
7 7 2 15 29 9 9 30 4 26, whose sum 138 is 10 mod 32: the check value is 22, `P`, and
the ID `7K2Q-XM9F-4DP`. The check catches every symbol mistyped, and every two
neighbouring symbols swapped but a `0` and a `Z` (`…0Z…` for `…Z0…`, as Luhn's 09
and 90): then it is right still.

**What people type.** Where a person gives an asset ID (a search box, a command line,
a call made for a person), a reader reads it so: letters in either case; `O` as `0`,
`I` and `L` as `1`; hyphens, spaces, tabs and line breaks left out wherever they are;
then eleven symbols whose check symbol is right are the asset ID, written as above.
Anything else, or more than 64 characters as typed, is not an asset ID. An ID read
from a package is never read so: it is written as above, or it is not an ID.

`spec/conformance/asset-ids.json` holds check symbols, IDs right and wrong, and what
people type with what it reads as, for every reader to agree on.

## Levels (0.11)

Every floor is a level of its building, and its `type` says which kind:

- `floor`: a storey (the ground floor, a floor above it, a basement). A floor of a package
  before 0.11 has no `type`, and is a floor.
- `mezzanine`: a floor standing in another floor of its building, over part of it (a block
  of rooms up a stair in a double-height hall, a gallery). Mezzanines, below.
- `roof`: the building's roof as a level, open to the sky, with what stands on it (stair
  and lift rooms, plant rooms). Roofs, below.

A level of any type is a floor like any other, with its own code, rooms, doors, items and
walking network. Types may be added in later versions (`manifest.json → types` lists
those of the package under `floor`): a reader takes a type it does not know for `floor`.

**Ordinals and order.** A building has one level of each ordinal that is not a mezzanine,
and any number of mezzanines on them. A building's floors are in order of `ordinal`, then
`elevation` (Ground floor, Mezzanine, First floor, Roof; two at one elevation as the
package lists them): `floors.geojson` lists them so, and so does `navigation.json`. The
ground floor is the level of ordinal 0 of type `floor`.

**Codes.** A floor's code is its building's own, and unique in it. Studio gives F00 to the
ground floor, F01, F02… above it, B01, B02… below it, to a mezzanine M00 over F00, M01
over F01, MB01 over B01 (a second on one floor M00B, then M00C…), and to the roof RF (a
second roof RF2), unless a person chose another: a mezzanine's rooms have IDs such as
`K7Q2XM-RUH-WH-M00-0042`, the roof's `K7Q2XM-RUH-WH-RF-0003`. No other floor's code or
ID changes when a mezzanine or a roof is added. A code is no more than a code: a reader
tells a level by its `type`, never by its code.

**What a reader does.** Sort a building's floors by `ordinal`, then `elevation`, never by
`ordinal` alone, and never take an ordinal to name one floor (a floor list, a floor
picker, stacking floors in 3D, a floor up or down); key floors by their IDs. Name a level
by its `name`. A reader of 0.10 knows none of this: it refuses a 0.11 package
(Versioning).

### Mezzanines

```json
"properties": { "kind": "floor", "type": "mezzanine", "code": "M00", "name": "Mezzanine",
                "building_id": "K7Q2XM-RUH-WH", "ordinal": 0, "elevation": 4.0, "height": 3.0,
                "host_floor_id": "K7Q2XM-RUH-WH-F00", "above_host_m": 4.0, … }
```

- `host_floor_id`: the floor it stands in, its host: a level of the same building of type
  `floor`, with the same `ordinal`. Null for a level that is not a mezzanine.
- `above_host_m`: how far its floor is above its host's, in metres (more than 0): its
  `elevation` is the host's and this. Null for a level that is not a mezzanine.

A mezzanine keeps its host's `ordinal` (0 for one over the ground floor), so floors may
share an ordinal; it comes after its host and before the floor above.

**Ways between floors.** A lift, stairs or escalator that serves a mezzanine has a space on
it in its stack (Stacks), as on any floor: stairs that serve the ground floor, the
mezzanine and the first floor join the ground floor to the mezzanine and the mezzanine to
the first floor; stairs or a lift that pass it without a door join the ground floor to the
first, as before. In `navigation.json` a mezzanine is one of the building's floors in its
order: a way passing it counts it among the floors it rides (`floors`, and the time a
floor).

Show a mezzanine where it stands, at its `elevation`, with its own outline (a slab under
its rooms, not the host's).

### Roofs

```json
"properties": { "kind": "floor", "type": "roof", "code": "RF", "name": "Roof",
                "building_id": "K7Q2XM-RUH-WH", "ordinal": 2, "elevation": 10.5, "height": 3.0,
                "parapets": { … }, "parapet_height_m": 1.2, … }
```

A roof has its own ordinal, at the top: a building's roofs are its top levels, and no
level of type `floor` stands above a roof (a second roof, over the rooms standing on the
first, may). Its outline is the roof, and its slab is the roof itself; nothing of the
building is built above it.

- Its open ground is its deck: spaces of type `roof`, `outdoor` (open to the sky), walked
  through as a terrace is. The rooms standing on it (stair and lift rooms, plant rooms, a
  water tank's room, a penthouse's rooms) are spaces of their own types, under a ceiling:
  their walls rise its `height`.
- Its parapets are its edge: `parapets`, `parapet_height_m` high, as any floor's.
- Stairs that reach it have a space on it in their stack, and link to it as to any floor.
  A lift's machine room on it is no stop: it is a room of its own (Studio reads a lift's
  space on a roof as its machine room, of type `utility`, unless a person sets it to be a
  lift that stops there), and the lift's stack does not serve the roof.

## Stacks (0.8)

A lift, a staircase or an escalator is one thing through the floors it serves; on
each floor it is a space of type `elevator`, `stairs` or `escalator`. Their `stack`
says which are the same one: a key the spaces of one lift share on every floor it
serves, and no other space of the building has. A ramp between floors (one ramp's
spaces on two or more floors) has one too; any other space has `stack: null`.

```json
"properties": { "kind": "space", "type": "elevator", "floor_id": "K7Q2XM-RUH-HQ-F02",
                "stack": "K7Q2XM-RUH-HQ-F00-0023", … }
```

Studio links them so: spaces of these types on different floors of a building are one
stack when they have the same object code, or when they are of the same type and their
outlines, in the building's own frame, overlap by at least 30% of the smaller one; and
through any number of floors (what is linked to what is linked is one stack). A
person may set it in review, and wins: a space linked by hand to another floor's is
linked to it alone (others may still be linked to it); one set as not linked stands
alone. The key is the ID of the stack's space on the lowest floor it serves (the
lowest ID there): it stays while that space does, and may change when the stack does. A system keys its own
lifts and stairs to the spaces' IDs; `stack` tells it which of them are one.

A stack may have more than one space on a floor (a staircase drawn as two spaces), and
none on a floor it passes without a door.

## Navigation (0.8)

`navigation.json` is the walking network of the building: the points a person is at or
passes (nodes), and the ways between them (edges), with how far each is and how long it
takes. Studio makes it from the package's spaces, zones, openings, stacks and kiosks,
so that every reader finds the same way between two places without working out any
geometry: Studio, the Go module and the viewers route on it the same way (Routing). A
package of format 0.8 may lack it (a reader then has no network to route on); one of
an earlier format has none.

```json
{
  "speed_m_s": 1.3,
  "buildings": ["K7Q2XM-RUH-HQ"],
  "floors": [ { "id": "K7Q2XM-RUH-HQ-F00", "building_id": "K7Q2XM-RUH-HQ", "name": "Ground floor",
                "ordinal": 0, "elevation": 0.0 } ],                       // lowest first (Levels)
  "places": [ { "id": "K7Q2XM-RUH-HQ-F01-0069", "kind": "space", "space_id": null,
                "floor_id": "K7Q2XM-RUH-HQ-F01", "type": "office", "label": "OFFICE 112" } ],
  "nodes": [ { "id": "door:K7Q2XM-RUH-HQ-F00-0048", "kind": "door", "floor_id": "K7Q2XM-RUH-HQ-F00",
               "space_id": null, "zone_id": null, "local": { "x_m": 167.0, "y_m": 59.5 },
               "lonlat": [46.6772311, 24.7131542], "opening_id": "K7Q2XM-RUH-HQ-F00-0048",
               "spaces": ["K7Q2XM-RUH-HQ-F00-0001", "K7Q2XM-RUH-HQ-F00-0002"] } ],
  "edges": [ { "from": "approach:K7Q2XM-RUH-HQ-F00-0048@K7Q2XM-RUH-HQ-F00-0001",
               "to": "door:K7Q2XM-RUH-HQ-F00-0048", "kind": "door", "length_m": 1.5, "seconds": 1.2,
               "cost": 1.2, "accessible": true, "space_id": "K7Q2XM-RUH-HQ-F00-0001", "zone_id": null,
               "path": [[167.0, 58.0], [167.0, 59.5]] } ]
}
```

Positions are in the building's own frame (Coordinates), in metres, as items' `local`;
a node's `lonlat` is the same point on the map. Lengths are in metres, times in
seconds.

**Nodes.** Each has an `id` made from what it is, so it is the same from one export to
the next while that is:

| `kind` | `id` | Where |
|---|---|---|
| `door` | `door:<opening ID>` | each door and opening (`type` `door` or `opening`, never a window) between two spaces a person walks in, at the middle of its span; `spaces` lists them. A lift or stairs with no way in drawn (one drawn in review) joins a space it shares an edge with: `door:<space ID>+<space ID>` (the two in order), `opening_id` null |
| `entrance` | `door:<opening ID>` | a door or opening to the outside (`exterior`), on any floor: where a campus's ways would join the building's |
| `approach` | `approach:<opening ID>@<space ID>` | in front of a door in each space it opens into: half the space's depth there, at most 2 m (so the approaches along a corridor are on its middle line) |
| `room` | `room:<space or zone ID>` | where a person arrives in each space (in each zone of a space divided into zones): its label point, clear of the walls |
| `lift`, `stairs`, `escalator`, `ramp` | `lift:<object code>@<floor ID>`, … | each lift, stairs, escalator and ramp space, on its floor, in place of a `room` node; `stack` is its stack |
| `kiosk` | `kiosk:<item ID>` | each wayfinding kiosk (Items, Kiosks): where people stand before its screen, 0.6 m in front of it, in the space it stands in; `item_id` is the item |

`space_id` and `zone_id` are the space, and the zone of a divided space, a node is in
(a door's are null: `spaces` says what it joins). Readers ignore kinds of nodes and
edges they do not know: a later version may add some.

**What is walked.** A person walks in the spaces and zones of these types, unless
hidden or ignored in review: `corridor`, `lobby`, `open_area`, `elevator`, `stairs`,
`escalator`, `ramp`, `parking`, `terrace`, `balcony`, `roof`, `living_room`, `dining_room`
(spaces to pass through), and `office`, `room`, `meeting_room`, `restroom`,
`kitchen`, `storage`, `bedroom`, `bathroom`, `dressing_room`, `laundry`,
`prayer_room`, `unspecified` (spaces a person goes to). Not `utility` (plant and
electrical rooms), `shaft` or `open_to_below`. A door into what is not walked is not
a node. The zones of a divided space are one room to walk across, as no wall parts
them (a zone not walked, a void, is left out of it).

**Edges.** Every edge joins two nodes, both ways; at most one joins any two. `path` is
its line from `from` to `to`, at least two points; a reader going from `to` to `from`
follows it backwards.

| `kind` | Joins | `seconds` |
|---|---|---|
| `door` | a door to each of its approaches: through the door | `length_m` / `speed_m_s` |
| `walk` | two nodes of one room (its approaches, room nodes, kiosks, lift or stairs), along the shortest way across it that keeps 0.35 m from its walls where it is wide enough (round its corners), and up to them in a passage narrower than that. A walk is left out where the room's other walks already join its ends within 2% and 5 cm: a corridor's approaches are joined each to the next | `length_m` / `speed_m_s` |
| `lift` | each floor a lift's stack serves to each other one | 30 (waiting) + 4 a floor |
| `stairs`, `escalator`, `ramp` | each floor its stack serves to the next one up it serves | 12 a floor |

`length_m` is the length of `path` (for a lift, stairs, escalator or ramp: the height
between the floors); "a floor" is each of the building's floors passed, by their
order (`floors`: by ordinal, then elevation, a mezzanine or a roof among them). `space_id` is the space a `walk` or `door` edge is in (for a `door`, the space
of its approach), and `zone_id`, in a divided space, the zone most of its line is in.
`accessible` is false for `stairs` and `escalator`. `cost` is what routing takes the
fewest of: `seconds`, and 30 more for a `door` edge into a space a person goes to (an
office, a meeting room): a way through someone's office costs a minute more than it
takes, so the way round by the corridor is taken unless it is that much longer. A
way to or from such a room pays half of that, whichever way it takes. `seconds` and
`cost` have one decimal.

**Places.** `places` lists the spaces and zones the network goes through, with their
`type` and `label`: what a step calls them. The label is the name and the number
("OFFICE 112"; the name alone when it holds the number), the name, the type and the
number ("Room 114"), or "the" and the type ("the corridor"); a type in words, with
spaces for underscores, `elevator` as "lift" and `unspecified` as "room".

### Routing

A way is asked for from a place to a place, each one of: a node's ID; a space's ID
(its `lift`, `stairs`, `escalator`, `ramp` or `room` node; for a space divided into
zones, its zones' `room` nodes); a zone's ID (its `room` node); an item's ID (a
kiosk's node, else the zone or space it stands in). A place of several nodes is any of
them. With `accessible`, no edge whose `accessible` is false is taken.

Every reader takes the same way: each edge costs round(`cost` × 10), a whole number;
the nodes are taken in order of their distance from the start and, at one distance,
of their IDs (compared as strings of bytes), all the start's nodes at 0; a node keeps
the way it was first reached by at its least distance; the way ends at the first of
the destination's nodes taken. (Dijkstra's algorithm, its queue ordered by distance,
then ID.)

A way is given as:

- `nodes`: its nodes' IDs, in order; `metres` and `seconds`: the sums of its edges'
  `length_m` and `seconds`, added in that order, then rounded to two decimals as
  floor(x × 100 + 0.5) / 100.
- `legs`: the walking on one floor between rides from floor to floor (one more than
  the rides; one may have no edges): `floor_id`, `points` (the line to draw: its first
  node's point, then each edge's `path` in the way's direction, without a point the
  same as the one before it) and `metres` (rounded so).
- `changes`: each ride between floors (one `lift` edge, or `stairs`, `escalator` or
  `ramp` edges one after another): `by` (its kind), `from_floor_id`, `to_floor_id`,
  `from_node`, `to_node`, `floors` (how many of the building's floors apart) and
  `direction` (`up` or `down`).
- `steps`: what to tell a person, each a `kind`, values and `text` in English; a
  system words them in its own language from the kind and values.

| `kind` | Values | `text` |
|---|---|---|
| `start` | `node`, `node_kind`, `place`, `floor_id` | "Start at the kiosk in RECEPTION 017", "Start at the entrance into the corridor", "Start in OFFICE 001", "Start at the lift", "Start at the door of …" |
| `walk` | `floor_id`, `metres`, `along`, `to`, `place` | "Walk 24 m along CORRIDOR to the lift": for each leg at least half a metre long, in whole metres (floor(x + 0.5)); `along` is the place most of it is in (of those as long, the first by ID): "along" a corridor or ramp, "through" anything else; `to` is the next ride's kind ("the stairs"), or `destination` (then `place` is it, by its label). Walking mostly in the destination itself: "Walk 6 m to OPEN OFFICE 117" |
| `take` | `by`, `from_floor_id`, `to_floor_id`, `floors`, `direction` | "Take the lift up to Floor 1" (the floor by its name) |
| `arrive` | `place`, `floor_id`, `side` | "OFFICE 112 is on your left": `side` is `left` or `right` when the way's last door is the destination's own (from another place into it), else `ahead`; `here` when the start is the destination ("You are at …"). The label begins with a capital ("The meeting room is ahead") |

The side is where the destination's door is as a person walks to it: *w* is the way
they walk, from the point 2 m back along the way's line (or its start) to the approach
in front of the door; *r* the way into the room, from the door to the approach inside.
With *d* = *w*·*r* and *c* = *w*ₓ*r*ᵧ − *w*ᵧ*r*ₓ: `ahead` when *d* > 0 and
|*c*| ≤ 0.5 *d*, else `left` when *c* > 0, `right` when *c* < 0 (a building's frame has
*y* to the left of *x*, as drawings do).

A way that cannot be found (none, or none without stairs) is said to be none; an ID
the network does not have is an error.

## Finishes (0.9)

What a room's floor and walls are finished in: carpet tiles, porcelain, marble, oak
planks, paint, wallpaper, wall tiles… A space may name its floor's finish
(`floor_finish`) and its walls' (`wall_finish`), a zone its floor's (`floor_finish`: a
zone has no walls of its own), each a code of StoreyPath's finishes below: a fixed set
every reader has, the same in every package. They are what a person chose in review;
null is the room's type's default (Defaults).

```json
"properties": { "kind": "space", "type": "lobby", "floor_finish": "FLOOR-MARBLE-WHITE",
                "wall_finish": "WALL-STONE", … }
```

- **The floor** of a space shows its `floor_finish`, else its type's default. A zone
  shows its own, else its space's, else its type's default (a hall divided into zones
  finished as one, and one of them otherwise).
- **The walls.** A wall stands between two rooms (or a room and the outside): each side of
  it, each face, is finished as the room it faces is: the `wall_finish` of the space on
  that side (a zone's walls are its space's), else that space's type's default; a face
  towards no room (the building's outside, the jambs of openings), as `exterior` in the
  list. The wall over a door or a window, and under a window, is the wall.
- **One wall otherwise (0.9.3).** A space may finish some of its walls otherwise than
  the rest, one by one (an accent wall): `wall_finishes`, a list of `{"line": [[x, y],
  [x, y]], "finish": "WALL-…"}`, each line from one end of the wall to the other along
  its face towards the space, in metres of the building's own frame (as an item's
  `local`). A face of a wall towards the space lying along a line, within the wall's
  thickness of it and between its ends, is that line's finish; the space's other faces
  are its `wall_finish`. Null (or absent): none. A reader that does not know it shows
  every wall of the space as its `wall_finish`.
- **A code a reader does not know** (one a later version adds) is shown as the type's
  default; a reader refuses only a code not of the form of a floor's (`FLOOR-` and
  capital letters, digits and hyphens: `^FLOOR(-[A-Z0-9]+)+$`, at most 40 characters)
  or a wall's (`^WALL(-[A-Z0-9]+)+$`). Codes are kept for good: a finish is never
  renamed to another code, nor its code given to another.

`spec/finishes.json` is the list as data, for every reader: each finish's `code`, what it
`applies` to (`floor` or `wall`), its `group`, its English and Arabic names (`name`,
`name_ar`), its colour on the whole (`tone`, `#rrggbb`: what to fill a room with on a plan
coloured by finish, or show before a texture), how rough it is (`roughness`, 0–1) and what
StoreyPath's viewer paints it with (`size_m`, the metres its image covers, and `paint`: a
kind of painter and its values; nothing is downloaded); and the defaults by type, and the
exterior's finish. The viewer has it as `viewer/src/finishes.js`, the Go module as
`go/finishes.json` (Finishes(), FloorFinishOf, WallFinishOf), Studio as it is.

Floors:

| Code | Name | الاسم | Group |
|---|---|---|---|
| `FLOOR-CARPET-CHARCOAL` | Carpet tiles, charcoal | بلاط سجاد، فحمي | Carpet |
| `FLOOR-CARPET-GREY` | Carpet tiles, mid grey | بلاط سجاد، رمادي متوسط | Carpet |
| `FLOOR-CARPET-BLUEGREY` | Carpet tiles, blue-grey | بلاط سجاد، رمادي مزرق | Carpet |
| `FLOOR-CARPET-WARMGREY` | Carpet tiles, warm grey | بلاط سجاد، رمادي دافئ | Carpet |
| `FLOOR-CARPET-NAVY` | Carpet tiles, navy | بلاط سجاد، كحلي | Carpet |
| `FLOOR-CARPET-BEIGE` | Carpet tiles, beige | بلاط سجاد، بيج | Carpet |
| `FLOOR-CARPET-GREEN` | Carpet tiles, green | بلاط سجاد، أخضر | Carpet |
| `FLOOR-CARPET-BURGUNDY` | Carpet tiles, burgundy | بلاط سجاد، عنابي | Carpet |
| `FLOOR-CARPET-PATTERN` | Patterned carpet, grey and blue | سجاد منقوش، رمادي وأزرق | Carpet |
| `FLOOR-CARPET-PRAYER` | Prayer carpet, rows | سجاد صلاة بصفوف | Carpet |
| `FLOOR-VINYL-GREY` | Vinyl sheet, grey | فينيل لفائف، رمادي | Vinyl |
| `FLOOR-VINYL-BLUE` | Vinyl sheet, clinic blue | فينيل لفائف، أزرق طبي | Vinyl |
| `FLOOR-LVT-OAK` | Vinyl planks, light oak look | ألواح فينيل بمظهر البلوط الفاتح | Vinyl |
| `FLOOR-LVT-WALNUT` | Vinyl planks, walnut look | ألواح فينيل بمظهر الجوز | Vinyl |
| `FLOOR-PORCELAIN-WHITE` | Porcelain tiles 60×60, white | بلاط بورسلان 60×60، أبيض | Porcelain tiles |
| `FLOOR-PORCELAIN-GREY` | Porcelain tiles 60×60, light grey | بلاط بورسلان 60×60، رمادي فاتح | Porcelain tiles |
| `FLOOR-PORCELAIN-BEIGE` | Porcelain tiles 60×60, beige | بلاط بورسلان 60×60، بيج | Porcelain tiles |
| `FLOOR-PORCELAIN-DARK` | Porcelain tiles 60×120, dark grey | بلاط بورسلان 60×120، رمادي داكن | Porcelain tiles |
| `FLOOR-MARBLE-WHITE` | Marble, white | رخام أبيض | Marble and terrazzo |
| `FLOOR-MARBLE-BEIGE` | Marble, beige | رخام بيج | Marble and terrazzo |
| `FLOOR-MARBLE-BLACK` | Marble, black | رخام أسود | Marble and terrazzo |
| `FLOOR-TERRAZZO-LIGHT` | Terrazzo, light | تيرازو فاتح | Marble and terrazzo |
| `FLOOR-TERRAZZO-DARK` | Terrazzo, dark | تيرازو داكن | Marble and terrazzo |
| `FLOOR-WOOD-OAK` | Oak planks, light | ألواح بلوط فاتح | Wood |
| `FLOOR-WOOD-WALNUT` | Walnut planks | ألواح جوز | Wood |
| `FLOOR-WOOD-HERRINGBONE` | Oak herringbone | باركيه بلوط بنقش عظم السمكة | Wood |
| `FLOOR-CONCRETE-POLISHED` | Polished concrete | خرسانة مصقولة | Concrete and resin |
| `FLOOR-CONCRETE` | Concrete | خرسانة | Concrete and resin |
| `FLOOR-EPOXY-GREY` | Epoxy, grey | إيبوكسي رمادي | Concrete and resin |
| `FLOOR-RUBBER` | Rubber, anti-slip studs | مطاط مانع للانزلاق | Technical |
| `FLOOR-RAISED-ACCESS` | Raised access floor | أرضية مرفوعة | Technical |

Walls:

| Code | Name | الاسم | Group |
|---|---|---|---|
| `WALL-PAINT-WHITE` | Paint, white | دهان أبيض | Paint |
| `WALL-PAINT-OFFWHITE` | Paint, warm off-white | دهان أبيض دافئ | Paint |
| `WALL-PAINT-GREY` | Paint, light grey | دهان رمادي فاتح | Paint |
| `WALL-PAINT-SAND` | Paint, sand | دهان رملي | Paint |
| `WALL-PAINT-BLUE` | Paint, pale blue | دهان أزرق فاتح | Paint |
| `WALL-PAINT-GREEN` | Paint, pale green | دهان أخضر فاتح | Paint |
| `WALL-PAINT-CHARCOAL` | Paint, accent dark grey | دهان رمادي داكن | Paint |
| `WALL-PAINT-NAVY` | Paint, accent navy | دهان كحلي | Paint |
| `WALL-PAINT-TERRACOTTA` | Paint, accent terracotta | دهان تيراكوتا | Paint |
| `WALL-PAPER-LINEN` | Wallpaper, linen beige | ورق جدران، كتان بيج | Wallpaper |
| `WALL-PAPER-STRIPES` | Wallpaper, grey stripes | ورق جدران، خطوط رمادية | Wallpaper |
| `WALL-PAPER-GEOMETRIC` | Wallpaper, geometric | ورق جدران، نقش هندسي | Wallpaper |
| `WALL-PAPER-DAMASK` | Wallpaper, damask | ورق جدران، دمشقي | Wallpaper |
| `WALL-TILE-WHITE` | Wall tiles 30×60, white | بلاط جدران 30×60، أبيض | Tiles |
| `WALL-TILE-GREY` | Wall tiles 30×60, grey | بلاط جدران 30×60، رمادي | Tiles |
| `WALL-TILE-MOSAIC` | Mosaic tiles, blue | فسيفساء زرقاء | Tiles |
| `WALL-WOOD-SLATS` | Oak slats | شرائح بلوط | Wood and stone |
| `WALL-WOOD-WALNUT` | Walnut panels | ألواح جوز للجدران | Wood and stone |
| `WALL-STONE` | Stone cladding | تكسية حجرية | Wood and stone |

**Defaults** (a room given none; a type a reader does not know, as `unspecified`; the
building's outside: `WALL-PAINT-WHITE`):

| Types | Floor | Walls |
|---|---|---|
| `bedroom`, `living_room`, `dining_room`, `dressing_room` | `FLOOR-WOOD-OAK` | `WALL-PAINT-WHITE` |
| `corridor` | `FLOOR-PORCELAIN-GREY` | `WALL-PAINT-WHITE` |
| `elevator`, `stairs`, `escalator`, `ramp` | `FLOOR-TERRAZZO-LIGHT` | `WALL-PAINT-WHITE` |
| `kitchen`, `balcony`, `terrace` | `FLOOR-PORCELAIN-BEIGE` | `WALL-PAINT-WHITE` |
| `lobby` | `FLOOR-MARBLE-BEIGE` | `WALL-PAINT-WHITE` |
| `meeting_room` | `FLOOR-CARPET-WARMGREY` | `WALL-PAINT-WHITE` |
| `office`, `room`, `open_area` | `FLOOR-CARPET-BLUEGREY` | `WALL-PAINT-WHITE` |
| `parking` | `FLOOR-EPOXY-GREY` | `WALL-PAINT-WHITE` |
| `prayer_room` | `FLOOR-CARPET-GREEN` | `WALL-PAINT-WHITE` |
| `restroom`, `bathroom`, `laundry` | `FLOOR-PORCELAIN-WHITE` | `WALL-TILE-WHITE` |
| `storage`, `utility`, `shaft`, `unspecified`, `open_to_below`, `roof` | `FLOOR-CONCRETE` | `WALL-PAINT-WHITE` |

## One building per package

From 0.7 a package holds exactly one building: `manifest.json → scope` names it.

```json
"scope": { "buildings": ["7KQ2MX-SITE-ENG"] }
```

It holds that building, its floors and everything on them, and the location it
stands in; `sources`, `placements` and `counts` cover it alone. A project of several
buildings is exported as several packages, one each.

What is not in the package says nothing about the project's other buildings: a
reader that keeps a project's buildings leaves the others as they are, and compares
a building only with the last package that held it. `changes.json` lists what
changed in that building alone since it was last exported. Export numbers run on
across the project's packages, so a later package always has a higher `sequence`.

Packages of 0.4 to 0.6 may hold several buildings, or a whole project (without
`scope`); readers still read them. StoreyPath Studio no longer writes them. A
StoreyPath *project file* (`*.storeypath-project`, sent from one Studio to another,
with the drawings) is not a package: readers refuse it.

## Pre-built 3D

A package may carry its floors already built in 3D, as StoreyPath's viewer builds
them from the features, so that a viewer on a slow machine shows a building
without building it: `world/<floor-id>.glb`, one binary glTF 2.0 file a floor,
listed in the manifest as `"world": "world/"`. Studio builds them when it exports,
when it can; a floor without a file is built from its features, as before. Readers
that do not draw in 3D ignore the folder.

**Frame.** One unit is a metre. x is east, y up and z south, from the building's
local origin (`origin` in the extras below): the middle of the box round its floors'
outlines in longitude and latitude (its footprint's, with no floors; 0, 0 with
neither), where a point (lon, lat) is at x = (lon − origin.lon) · kx and
z = −(lat − origin.lat) · ky, with kx = 111320 · cos(origin.lat) and ky = 110540
metres a degree. y is the height above the building's ground floor: a floor stands
at its `elevation`. Every floor of a building has the same origin, so the files
stack as they are, and every node's transform is the identity.

**Meshes.** One mesh a piece of the floor, each one primitive with one material.
The node names it; its `extras` say what it is: `material`, `view`, and `type` and
`hidden` where they apply.

| Name | `material` | `view` | What |
|---|---|---|---|
| `slab` | `slab` | | the floor slab, under the floor's outline |
| `floor:<type>` | `floor` | | the floor finish of the spaces and zones of that `type` |
| `volume:<type>` | `volume` | `xray` | each space of that `type` as a volume, up to its ceiling (to its parapets, when open to the sky) |
| `ceiling` | `ceiling` | `walk` | the ceiling, over every space but those open to the sky |
| `lights` | `lightPanel` | `walk` | ceiling panels, 60 cm square, about every 2.4 m in each space or zone (none in shafts and lifts): their faces down |
| `wall`, `wallTop` | `wall`, `wallTop` | `full` | the walls' faces (with those of the wall over and under openings), and their tops and undersides, full height |
| `parapet`, `parapetTop` | `wall`, `wallTop` | `full` | the parapets, likewise |
| `skirting` | `skirting` | | a skirting board along every face of the walls and parapets, and under windows |
| `heads`, `headTop` | `wallPlain`, `wallTop` | `full` | the wall over doors, doorways and windows: under it and its ends (its faces are `wall`'s), and its top |
| `sills` | `wallPlain` | | the wall under windows: its ends (its faces are `wall`'s) |
| `sillBoard` | `sillBoard` | | a board on each window's sill |
| `stairs` | `stairs` | `full` | the steps of each space or zone of type `stairs` or `escalator`, rising a floor's `height` (each riser about 17.5 cm, the last up onto the floor above; none above the walls): along its outline's longer side, as two flights side by side with a landing at the far end where it is 2 m wide or more, else as one; drawings do not say which way stairs go up, so this shows where they are, not their direction |
| `stairsLow` | `stairs` | `cut` | the steps of `stairs` wholly under `options.cutHeight`, for the cutaway view, as a plan shows stairs |
| `glass`, `frame` | `glass`, `frame` | `full` | windows: the glass, and its frame and mullions |
| `door`, `doorFrame` | `door`, `doorFrame` | `full` | door leaves, open as the plan draws them (each a run of vertices of its own: `doors` below), and their frames |
| `trim`, `handle` | `trim`, `handle` | `full` | architraves round doors, on both faces of their wall; lever handles each side of each leaf (each leaf's a run of vertices of their own) |
| `items:light`, `items:light:high` | `item` | `full` for `high` | the floor's items, a box each (`"form": "light"`), for a view of many floors: those wholly below `options.cutHeight`, and the others (on a wall, under the ceiling) |
| `obstacles` | | | lines (mode `LINES`) at the floor, not drawn: what someone walking bumps into (walls and windows; an open door's leaf is not in the way, a door shut is, across its `span`: `doors` below) |

`view` says when a piece shows: `full` unless the walls are cut low, as on a plan;
`cut` only then; `walk` when walking on that floor; `xray` in the see-through view;
with none, always. The pieces of spaces and zones hidden or ignored in review are
meshes of their own (`floor:shaft:hidden`, `"hidden": true`), shown only when asked
for. A plain glTF viewer shows every mesh at once. The items' pieces are kept apart
from the rest, so that a viewer leaves them out until they are asked for; a floor
with no items has none. Drawn in detail (a desk with its chairs, and what goes with
its grade; a meeting table with as many chairs round it as its size seats), items are not in the file: a viewer builds them from the items, as
quickly as it would read them (files of builder 2 have them, as `items` and
`items:high`).

The walls and parapets cut low are not in the file: they are `wall`, `wallTop`,
`parapet` and `parapetTop` with every vertex higher than `elevation` +
`options.cutHeight` brought down to that height (and on the faces, its v to
1 − `cutHeight`), shown with `view` `cut`, the tops with the material `wallCut`.
Texture coordinates (`TEXCOORD_0`) are only on what has a texture: the floor
finishes (metres east and north) and the walls' and parapets' faces (v = 1 − the
height above the floor, in metres). What is built of boxes (`heads`, `headTop`, `sills`,
`glass`, `frame`, `door`, `doorFrame`, `trim`, `handle`, `skirting`, `sillBoard`,
`lights`, `stairs`, `stairsLow`) shares its corners between its faces and has no normals: flat-shaded, as
glTF draws a mesh without them. Its vertices are in the order they were built: box by
box, so a door's leaf (and its handles) is a run of them.

The floor finishes and volumes have a vertex attribute `_ROOM` (unsigned integer),
an index into `rooms` below: the space or zone each vertex belongs to, so that a
click on a floor tells which room it is. The walls' and parapets' faces (builder 4) have
it too: the space each face faces (Finishes), or a value past the end of `rooms` (65535,
or 4294967295 for a floor of more than 65534 rooms and zones) for a face towards none. A
viewer draws each triangle in the finish of its room (a floor's, a wall's), from the
package's properties: the file holds no finish, so it stays right when they change. The items' pieces have `_ITEM`, an index
into `items` below, likewise; their colours are the vertices' (`COLOR_0`: their
type's colour, and shades of it), how rough and how metallic each is `_FINISH`
(unsigned bytes, normalised: roughness, metalness), and they have no normals
(flat-shaded). The materials in the file are plain colours; StoreyPath's viewer
draws each piece with its own, by `material` and `type`, in the look it is asked for.

**Extras.** The scene's `extras.storeypath`:

| Key | |
|---|---|
| `project_id`, `building_id`, `floor_id` | what it is |
| `export_sequence` | the export it was built for: a file whose sequence is not the manifest's is stale; build that floor instead |
| `builder` | the version of StoreyPath's builder that made it: 8 since a floor open where it is open to below (its slab with a hole under each `open_to_below` space or zone); 7 since every piece of furniture an item of its own (0.10: a desk or table built without chairs); 6 since the steps of stairs (`stairs`); 5 since doors that swing (`doors`; an open leaf no longer in `obstacles`); 4 since the room each wall's face faces (`_ROOM` on `wall` and `parapet`, and the faces of the wall over and under openings in `wall`); 3 since skirting, architraves, handles, window boards, ceiling panels and the finer furniture; 2 since items (format 0.6); a viewer builds a floor itself from a file of another version (a file without it is of 1, and has no items) |
| `origin` | `lon`, `lat`, `kx`, `ky`: the frame above |
| `options` | the sizes it was built with, in metres: `slab` (thickness), `doorHead`, `windowSill`, `windowHead`, `wallThickness` (where the floor gives none), `cutHeight` |
| `elevation`, `wall_height` | the floor's elevation, and how high its walls rise above it |
| `rooms` | the IDs `_ROOM` indexes |
| `items` | the IDs `_ITEM` indexes (format 0.6) |
| `doors` | (builder 5) the doors with leaves, to swing them shut and open: each `id` (its opening's), `span` (`[x1, z1, x2, z2]`: jamb to jamb, along the middle of its wall; shut, the door is in the way there), `top` (how high it is, metres above the floor) and `leaves`; each leaf its `hinge` (`[x, z]`), the angles it lies at `open` (as the `door` mesh has it) and `shut` (radians counter-clockwise from east seen from above: the way (cos a, −sin a) in x and z), its `length` (metres from its hinge to its free edge), and its runs of vertices, `[first, count]`, of the `door` mesh (`door`) and of the `handle` mesh (`handle`). A leaf turned is its runs' vertices turned about the upright line through its hinge, the shorter way from `open` to `shut`. A door starts open, as drawn |

## Drawings (0.11)

A package carries only what StoreyPath read from the drawings: the spaces, zones,
openings, walls, items and the rest above. It may also carry the drawings themselves, one
floor at a time, so that a reader shows the real drawing under the plan (a wayfinding
screen, a system that calibrates cameras on it): when it was asked for at export (Studio's
*Include the drawings*, `storeypath export --drawings`), never otherwise. A drawing holds
everything drawn on it, every layer and text: whoever receives such a package sees it all.
The drawing Studio keeps had its title blocks, names, contact and registration numbers
and hidden data taken out when it was added (unless a person kept them); the texts a
package carries are as Studio's privacy rules leave them once more: a text with a phone
number, an email, a web address or a permit, plot or licence number is left out, and a
name with a title (Mr, Dr, Eng, Sheikh, السيد …) is taken out of its text, the rest of the
text kept.

Each floor's drawing is `drawings/<floor-id>.view`, a drawing view (StoreyPath Viewer's
spec/DRAWING-VIEW.md): gzip, its head JSON, its lines, triangles, points and texts in
arrays of numbers, layer by layer in the drawing's colours. The floor's source in the
manifest names it, and `files.drawings` is `drawings/` when the package holds any:

```json
"files": { …, "drawings": "drawings/" },
"sources": [{ "floor_id": "7KQ2MX-SITE-ENG-F01", "file": "drawing-1.dxf", "sha256": "…",
              "view": "drawings/7KQ2MX-SITE-ENG-F01.view" }]
```

A source without `view` (or with null) has no drawing in the package. The files are stored
in the ZIP as they are (they are gzip already).

**What it holds.** The floor's part of its drawing: what lies in the floor's region of it
(the plan a sheet of several holds for this floor; the whole drawing for a drawing of one
floor), what crosses the region's edge cut there and a text kept by where it starts. Every
layer is there, a layer turned off in the drawing said so (`off`).

**Frame.** Metres of the building's own frame (Coordinates), where the floor's spaces, walls
and openings are once their longitude and latitude are turned back into it, and where
items' `local` are: the view's `units` are `m` and its `clip` is the region in those metres.
A floor drawn elsewhere on its sheet, or moved to stand on the floor below, is moved with
it: drawn under the plan, the drawing lies on it.

Readers that do not show drawings ignore the folder.

## Changes from 0.2

- `zones.geojson` and the `zone` kind: open areas are one space divided into zones,
  where 0.2 cut them into separate spaces joined by an `opening` with no wall.
- `space.zones`; `objects.csv` gains `space_id` (and documents `hidden`, `ignored`).
- An object's kind may change between exports when it is the same place in use:
  a 0.2 space that becomes a zone keeps its ID.

0.3.1 adds the openings' `swings`, `sill_m` and `height_m`, and the spaces' `outdoor`.
0.3.2 adds the spaces' and zones' `drawing_label` (and its column in `objects.csv`).

## Changes from 0.3

- `manifest.json → scope`: a package of some of a project's buildings (Part of a
  project). A reader of 0.3 that imports packages would take the buildings left
  out as removed: it must read `scope` before it applies a 0.4 package.

## Changes from 0.4

- `world/` and `manifest.json → files.world`: the floors pre-built in 3D (Pre-built
  3D), when the exporter could build them. Nothing else changes: a reader of 0.4
  read a 0.5 package as it is, ignoring the folder (readers of 0.7 and later refuse a
  newer minor version instead: Versioning).

## Changes from 0.10

- Levels (Levels): a floor's `type`, what level of its building it is: `floor` (a storey,
  as every floor before), `mezzanine` or `roof`; `manifest.json → types` lists them under
  `floor`. A mezzanine's `host_floor_id` and `above_host_m`: it has the `ordinal` of the
  floor it stands in, so floors of a building may now share an ordinal. A roof is the
  building's roof as a level, its own ordinal at the top, its open deck spaces of the new
  type `roof` (`outdoor`, walked through), the rooms standing on it of their own types. A
  reader must:
  - sort a building's floors by `ordinal`, then `elevation` (`floors.geojson` and
    `navigation.json → floors` list them so), and never take an ordinal to name one floor;
  - take the ground floor as the level of ordinal 0 of type `floor`;
  - read a floor's `type` (none: `floor`; one it does not know: `floor`), a mezzanine's
    host (`host_floor_id`, a floor of its building of type `floor`, of its ordinal) and its
    level above the host's (`above_host_m`);
  - count a mezzanine or a roof among the floors a way between floors passes (Navigation),
    as the list's order has it;
  - know the space type `roof` (Types), open to the sky as a terrace.
  A validator checks each floor's `type`; that a building has at most one level of each
  ordinal that is not a mezzanine, and that floor codes are unique in it; that a
  mezzanine's host is a floor of its building of type `floor`, of its ordinal, its
  elevation the host's and `above_host_m`, and that no other level names a host; and that
  no level of type `floor` stands above a roof of its building.
- `drawings/` and `manifest.json → files.drawings`, and a source's `view` (Drawings): each
  floor's drawing as drawn, its part of its drawing in the building's own frame, when the
  export was asked to carry them; its texts as the privacy rules leave them. (Written first
  as 0.10.1, which was never released: 0.11 is the version that has it.)
- A minor version: a reader of 0.10 refuses a 0.11 package (Versioning), as floors may
  share an ordinal; a reader of 0.11 reads 0.10 and earlier ones as before (every floor of
  type `floor`).

## Changes from 0.9.3

- Categories (Items): a type's and an item's `category` is one of `workstations`,
  `seating`, `tables`, `storage`, `soft_seating`, `beds`, `furniture`, `security`,
  `fire_safety`, `it_av`, `building_services`, `appliances`, `equipment`; 0.9's
  `appliance` is read as `appliances`.
- Every piece of furniture an item of its own: a desk (`desk`) and a table (`table`, in
  place of `meeting_table`) are drawn alone, their chairs types and items of their own.
- Items' `group`: the items placed or grouped together (a workstation, a meeting table and
  its chairs), a key they share.
- Items' `door_id`: the door a card reader, a door controller, an exit button serves; types'
  `serves_door`.
- Items' and camera types' `view_deg` and `range_m`: what a camera covers.
  New shapes: `table`, `chair`, `side_chair`, `armchair`, `storage`, `camera`.
- A minor version: a reader of 0.9 refuses a 0.10 package (Versioning), as what a desk
  and a meeting table are drawn with changed.

## Changes from 0.9.2

- Spaces' `wall_finishes` (Finishes): walls finished otherwise than the rest, one by
  one, each a line along the wall in the building's own frame and its finish.
- A patch: a reader of 0.9 reads a 0.9.3 package (Versioning), showing every wall of a
  space as its `wall_finish`.

## Changes from 0.9.1

- `catalogue.json`: a type's `model` (Models): the path of its 3D model in the package,
  `models/<CODE>.glb`, binary glTF in the type's own frame; absent or null, none.
- `models/`: each model once (`manifest.json → files.models`).
- A patch: a reader of 0.9 reads a 0.9.2 package (Versioning), drawing each type by its
  shape as before.

## Changes from 0.9.0

- `catalogue.json`: a type's `shape` (Shapes): how its items are drawn, whatever its
  code; absent or null, by its code's first part as before.
- `catalogue.json` holds every type the package's items use, or the whole catalogue;
  before, always the whole. A reader keeping types removes none a package does not hold.
- A patch: a reader of 0.9 reads a 0.9.1 package (Versioning), drawing each type by its
  code as before.

## Changes from 0.8

- Spaces' `floor_finish` and `wall_finish`, zones' `floor_finish` (Finishes): what a
  room's floor and walls are finished in, codes of StoreyPath's fixed set
  (`spec/finishes.json`); null, the type's default; a code a reader does not know, the
  type's default too.
- Pre-built 3D of builder 4: the walls' faces say which room each faces (`_ROOM`), and
  the faces of the wall over and under openings are in `wall`.
- A reader of 0.8 refuses a 0.9 package (Versioning); a reader of 0.9 reads 0.8 and
  earlier ones as before (every room as its type).

## Changes from 0.7

- `navigation.json` and `manifest.json → files.navigation`: the building's walking
  network (Navigation), and the rule by which every reader finds the same way on it.
- Spaces' `stack` (Stacks): which lifts, stairs and escalators on different floors are
  one, worked out from their codes and outlines, or set by a person.
- Items' IDs are asset IDs (Items, Asset IDs): `7K2Q-XM9F-4DP`, random with a check
  symbol, of no project, where they were the project's code and the item's number
  (`K7Q2XM-I000142`). `manifest.json → export.next_item` is gone: a reader ignores it
  in a package that has it. A package of 0.6 or 0.7 holds items by their IDs then.
- A reader of 0.7 refuses a 0.8 package (Versioning); a reader of 0.8 reads 0.7 and
  earlier ones as before (no stacks, no network, items by the project's numbers).

## Changes from 0.6

- One building per package (One building per package): `scope` always names the one
  building. A reader of 0.4 to 0.6, which read a newer minor version under the earlier
  rule, takes a 0.7 package as a part of a project.
- What `changes.json` compares is each building in its own frame: moving a building
  on the map lists the building as changed, not what is in it (Coordinates).
- Items' `local`: where an item stands in its building, the position it is placed by
  (Items). `changes.json → moved_away`: items carried to another building.
- The project file sent between Studios is a file of its own (`*.storeypath-project`),
  not a package carrying `studio/`.
- Spaces' and zones' `capacity`, `capacity_from` and `grade` (Capacity); the
  catalogue's `workplaces` and `grade`.
- `changes.json` is about the building: `previous_sequence` is the last export that held
  it, `all_retired` its own; `manifest.json → export.next_item` (until 0.8).
- Readers refuse a package of a newer minor version (Versioning), and check more: one
  placement for each building, items' headings, zones listed by their own space,
  finite numbers, case-sensitive keys.

## Changes from 0.5

- `items.geojson` and `catalogue.json`: furniture and equipment, with IDs of their own
  that do not change when they move (Items): until 0.8, the project's code, `-I` and
  six digits (`K7Q2XM-I000142`). Readers of 0.5 ignore them.
- Pre-built 3D: each floor's items in pieces of their own, and the extras' `builder`
  and `items`. A viewer builds a floor itself from a file of an earlier builder.

## Readers

`spec/conformance/` holds packages and coordinate pairs that every reader must read
the same way: Studio's own validator, the Go module in `go/` (for systems written in
Go), the viewer. A reader turning longitude and latitude back into a building's
local metres must agree with `localframe.json` to a millimetre; positions read from
a package are within about a centimetre of Studio's (7 decimals of a degree).
`campus-hq`, `campus-annex`, `campus-hq-2` and `campus-annex-2` are one project of
this format, exported a building at a time: its first two exports, then the
Headquarters' after it was moved on the map, a desk carried to the Annex and a TV
taken away (the building changed, and the office the desk left, which seats one fewer;
nothing else; the desk moved away; the TV retired; every item's `local` as it was),
then the Annex's, the desk in it. They have items: desks of several grades (one in a
zone, one in a building turned on the map), a photocopier, two access points, a sofa,
a TV, a bed and a wayfinding kiosk; lifts and stairs through the Headquarters' three
floors (their stacks), a corridor divided into two zones, and finishes (0.9) on some of
the Headquarters' rooms: the reception in white marble with stone walls, the meeting room
in oak herringbone with oak slats, an office in navy carpet with linen wallpaper, a
restroom in dark porcelain with mosaic, the divided hall's walls pale green and its two
zones' floors grey vinyl and light terrazzo; every other room as its type. `routes.json` holds ways
on the first two that every reader must find the same (Navigation, Routing): the same
nodes, changes of floor, legs and steps, and the same lengths and times to a
centimetre and a tenth of a second. `asset-ids.json` holds asset IDs (Asset IDs) every
reader must check and read the same: check symbols, IDs right, wrong by a symbol or
two swapped, and what people type. The others are packages of earlier formats, which
readers still read: `campus` (0.6, the whole campus, with items), `campus-world` and `simple-office-world` (pre-built in 3D: a reader reads
them as it reads `campus` and `simple-office`, and the viewer shows them as it shows
those), `campus-whole-1`, `campus-part`, `campus-whole-3` (0.4), `simple-office`,
`simple-office-2` and `unplaced`. `drawn-office` (0.11) carries its drawings (Drawings):
a made-up sheet of two floors side by side, the second floor's region of it moved onto the
first; each floor's drawing view lies on its walls, in the building's own frame, and
nothing of the other floor, nor of the notes beside them, is in it. `mezzanine-warehouse`
(0.11) is a made-up warehouse with a mezzanine and a roof (Levels): a ground floor, a
mezzanine over part of it (M00, its own outline), a first floor, and a roof (RF) over the
first floor, listed in that order, the mezzanine sharing the ground floor's ordinal; stairs
through all four (Ground to Mezzanine to First to Roof, where a stair room stands on the
roof), lifts that pass the mezzanine (Ground to First) and do not stop on the roof (the
lift's machine room there is a room of its own), a plant room on the roof, and the roof's
open deck behind its parapets (spaces of type `roof`). `routes.json` holds ways through it
too: up the stairs by the mezzanine, to a room on it, by lift past it, and up the stairs
to the roof.

A reader that takes packages from uploads bounds what it reads. A building's package
is a few megabytes; the Go module reads by default at most 64 MiB a file and 256 MiB in
all, a file at most 100 times its size in the archive (files above 1 MiB), and at most
200,000 entries in any list, and refuses longer IDs before taking them apart.

## Versioning

`manifest.json → format_version` follows semantic versioning, and says which readers
can process a package. A reader reads packages of its own major version that are not
newer than it, and ignores unknown files, properties, and `objects.csv` rows of kinds it
does not know (as 0.6 added items), with the IDs of those rows where `changes.json` lists
them. Before 1.0 a minor version may change what a package means (0.4's `scope`, 0.7's
one building per package), so a reader refuses a package of a newer minor version
(0.12 for a reader of 0.11), saying it must be updated; a newer patch version (0.11.1)
only adds properties and is read. From 1.0, a reader reads any package of its major
version. A format version is ASCII `major.minor`, an optional `.patch`, and an optional
`-` or `+` suffix (`^[0-9]+\.[0-9]+(\.[0-9]+)?([-+][0-9A-Za-z.-]+)?$`); a reader refuses
anything else as not a format version.
