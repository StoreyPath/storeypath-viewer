# storeypath (Go)

Reads StoreyPath packages (`*.storeypath`) for systems written in Go: the
buildings, floors, spaces, zones and openings of a project with their stable IDs,
the furniture and equipment on its floors, (format 0.8) the way from one place
in a building to another, (0.11) each floor's drawing when the package carries
them, (0.12) a location's layout, its land: the plot its buildings stand on, and
(0.13) the way across it, from a gate into any building or from one to another.
Standard library only; Go 1.25.

```go
import storeypath "github.com/storeypath/storeypath-viewer/go"

pkg, err := storeypath.Open("campus.storeypath")
if err != nil { … }                       // not a package at all
for _, p := range pkg.Validate() { … }    // p.Code (stable), p.ID, p.Message

for _, b := range pkg.Buildings {
	frame, _ := pkg.Frame(b.ID)           // lon/lat ↔ Studio's drawing metres
	for _, f := range pkg.FloorsOf(b.ID) { // lowest first
		for _, u := range pkg.UnitsOn(f.ID) { // what people are placed in
			// u.ID: a zone, or a space with no zones; u.Kind says which
			rings, _ := frame.PolygonsToLocal(u.Geometry)
			_ = rings
		}
		for _, it := range pkg.ItemsOn(f.ID) { // desks, photocopiers, access points, …
			t := pkg.ItemType(it.Type)     // its type in the catalogue (nil if none)
			_, _ = it.Space, t             // where it stands; its ID is not its place
		}
	}
}
```

## What it gives

- `Open` / `Read`: a package from a file or a reader, within `Limits` against
  broken or hostile ZIPs: files in the ZIP, bytes per file and in all, how many
  times its size in the ZIP a file may be (a package's files are 10 to 20), and
  entries in any one list (features, a ring's points, IDs). Fails only when a
  package cannot be read at all (`ErrTooLarge` when over its limits); everything
  else is reported by `Validate`. `DefaultLimits` (64 MiB a file, 256 MiB in all,
  100 times, 200,000 entries) are generous for the largest building, whose
  package is a few MB. **A server reading uploaded packages should pass its own
  limits, tied to the size of upload it accepts** (`OpenWithLimits`, `Read`): what
  reading costs is in proportion to them, not to the upload.
- Packages sealed with a password (`.storeypath.enc`, [SEALED.md](../spec/SEALED.md)):
  `Open`, `Read` and `ReadManifest` say so (`ErrNeedsPassword`); `OpenSealed(path,
  password)` and `ReadSealed(data, password, limits)` open one (a plain package as it
  is), its contents held to `limits.MaxTotalBytes`; `Unseal(r, w, password)` writes
  its contents a piece at a time. Another password is `ErrNeedsPassword` too; a
  changed or cut-short file is `ErrSealedDamaged`.
- `Validate`: the checks Studio's validator makes, each `Problem` with a stable
  `Code` (`MISSING_FILE`, `BAD_FILE`, `DUPLICATE_ID`, `PARENT`, `ZONE`, `CHANGES`,
  `PLACEMENT`, `ITEM`, `ITEM_TYPE`, `VALUE`, `DRAWING`, `LAYOUT`, `FOOTPRINT`, …), the
  file and the ID it is about.
  A file is read by its keys as written: one that differs from the format's only
  in case (`"Hidden"`) makes it a `BAD_FILE`, as Go's JSON decoder would
  otherwise read it where other readers do not. Types of spaces, zones and
  openings are those the manifest's `types` list.
- Lookups: `Get`, `Building`, `Floor`, `Space`, `Zone`, `Opening`, `FloorsOf`,
  `SpacesOn`, `ZonesOf`, `OpeningsOn`, and `UnitsOn`: the zones of a divided space
  and every space with none, which is what a system placing people should use.
  (Format 0.12: `Get` finds layouts and footprints too; `SpacesOn`, `OpeningsOn`,
  `ItemsOn` and `UnitsOn` take a layout's ID as a floor's: Location layouts, below.)
- Levels (format 0.11): a floor's `Type` is `FloorTypeFloor` (a storey, and every
  floor of an older package), `FloorTypeMezzanine` or `FloorTypeRoof` (`IsMezzanine`,
  `IsRoof`; a type a later version adds is read as a floor's). A mezzanine stands in
  its `Host` floor, `AboveHost` metres above it, with the host's `Ordinal`, so a
  building's floors may share an ordinal. A roof is the building's roof as a level,
  its own ordinal at the top: its open deck is spaces of type `roof` (outdoor), the
  rooms standing on it (stair and lift rooms, plant rooms) indoor. `FloorsOf` gives a
  building's floors in its order, by ordinal then elevation (`FloorBefore`): Ground,
  Mezzanine, First, Roof; `GroundFloor` is the floor of ordinal 0 that is a storey.
  `Validate` checks each floor's type (`VALUE`), a mezzanine's host, a floor of its
  building of type floor (`MEZZANINE`), one level per ordinal besides mezzanines,
  each code once (`FLOOR_ORDINAL`), and that no floor stands above a roof (`ROOF`).
- Items (format 0.6): `Items`, `Item`, `ItemsOn`, the `Catalogue` of their types
  and `ItemType`. An item's ID is an asset's tag (format 0.8: `7K2Q-XM9F-4DP`,
  `IsItemID`; the project's code and its number, `K7Q2XM-I000142`, before), not its
  place nor its project's: where it stands is its `Floor`,
  `Space` and `Zone`, and (0.7) its `Local` position in its building, which moving
  the building on the map never changes: keep that, not the map position, for the
  history of where an item has been (`ItemLocal` gives it for older packages too,
  worked out from the map). An item carried to another building is in the
  package's `Changes.MovedAway`, not retired. Its `Values` are the details entered
  in StoreyPath; the fields the managing system owns (`OwnerSystem`) are never in a
  package. Older packages have no items and no catalogue.
- Seating (format 0.7): each space's and zone's (and `Unit`'s) `Capacity` (set in
  StoreyPath's review, `CapacityFrom` "review", or its desks' workplaces, "items")
  and `Grade` (who it is laid out for: its highest desk), defaults a system placing
  people may keep its own instead of; the catalogue's `Workplaces` and `Grade`.
- Stacks (format 0.8): each lift, stairs and escalator space's `Stack`, the key
  its spaces share on every floor it serves (nil on other spaces): which of them
  are one.
- Navigation (format 0.8): the building's walking network (`Navigation()`, nil for
  a package without one) and the way on it (`Route`, below).
- Finishes (format 0.9): each space's `FloorFinish` and `WallFinish` and each zone's
  `FloorFinish`, codes of StoreyPath's fixed set (`Finishes()`: the 50 floor and wall
  finishes with their names in English and Arabic, tones and groups, and the defaults
  by type, embedded from `finishes.json`, a copy of spec/finishes.json); what a room
  shows: `Space.FloorFinishOf`, `Space.WallFinishOf`, `Zone.FloorFinishOf(space)` (its
  own, a zone's space's, else its type's; a code this module does not know, its
  type's), `FinishOf`, `DefaultFinish`. `Validate` refuses a code not of the form of a
  floor's or a wall's (`VALUE`).
- One building per package (format 0.7): `Manifest.Scope` names it; `Holds` says
  whether a package holds a building. Older packages may hold several, or a whole
  project; a StoreyPath project file (`.storeypath-project`) is refused by `Read`.
  From 0.12 a package may hold a location's layout in place of a building
  (`Scope.Layout`, `IsLayout`): Location layouts, below.
- `LocalFrame`: a building's longitude and latitude back to the local metres
  Studio drew it in, and back (azimuthal equidistant on WGS84, Vincenty), within a
  millimetre of Studio; positions read from a package are within about a
  centimetre (it keeps 7 decimals of a degree).
- Drawings (format 0.11): a package exported with *Include the drawings* carries
  each floor's drawing as drawn, every layer and text of its part of its drawing, in
  the building's own metres (where `LocalFrame` turns its spaces), for a system to show
  the real drawing under the plan ([FORMAT.md](../spec/FORMAT.md), "Drawings";
  [DRAWING-VIEW.md](../spec/DRAWING-VIEW.md)). `HasDrawing(floorID)` says whether it
  does; `Drawing(floorID)` gives its `Raw` bytes as the package holds them (gzip: hand
  them to StoreyPath Viewer's `DrawingView` to draw) and its `Header`: `Bounds`,
  `Body`, `Clip` (the floor's region of the drawing), `Units` (`m`), `Layers` (name,
  colour, count, off in the drawing), `Words`, `Counts`. `Arrays` and `LinesOn(layer)`
  read its lines, triangles, points and texts, for a system that wants the drawing's
  geometry; `ReadDrawingHeader` reads a view's head alone. Read checks each whole, within
  its `Limits`; `Validate` says which is not where its floor's source says, not a view
  of format 1, or not in metres (`DRAWING`).
- `ParseID`: a place's ID's project, parent, code and the prefix at any level (an
  item's ID is refused: it is not a place's).
- Items' IDs (format 0.8): `IsItemID` (as a package writes it, its check symbol
  right), `NormalizeItemID` (as a person typed it: either case, O for 0, I and L for 1,
  hyphens and spaces left out; for a kiosk's search box, never for an ID read from a
  package) and `ItemCheckSymbol`. `ValidateAcross` checks packages held together: the
  same item ID in packages of two projects is a clash (`ITEM_ELSEWHERE`), reported
  against the later one, which a system refuses.

Each file is found through the manifest's `files`, as the format asks (at its usual
name when a manifest does not list a file every package has; items and their
catalogue only when it lists them).

Properties a later format version adds are ignored, as the format asks, and so are
`objects.csv` rows of kinds this module does not know (with their IDs in
`changes.json`). So are files it does not read: a package's floors pre-built in
3D (format 0.5, `world/`) are for viewers. A package this module cannot process
is reported by `Validate` (`VERSION`), and `CheckVersion` says so from the
manifest's `format_version` alone: what is not a format version (`major.minor`,
a `.patch` if any, then a `-` or `+` suffix if any: ASCII digits and letters),
another major version, or before 1.0 a newer minor one (0.13 for this 0.12
reader), with a message to update the reader. `ReadManifest` reads the manifest
alone, so a server can refuse a package before reading the rest of it:

```go
m, err := storeypath.ReadManifest(r, size, limits)
if err == nil {
	err = storeypath.CheckVersion(m.FormatVersion)
}
```

## Location layouts

A location's layout (format 0.12) is its land: the plot its buildings stand on, as its
site plan draws it, with its boundary walls and gates, the open ground between the
buildings in areas, the footprint of each building standing on it, and what is placed on
it (cameras on poles, card readers at gates). It comes in a package of its own, beside
its buildings' packages ([FORMAT.md](../spec/FORMAT.md), "Location layouts"): a system
that places outdoor cameras, or says where someone outside is ("at the gate", "in the
parking"), reads it.

```go
land, _ := storeypath.Open("site.storeypath")
if l := land.Layout(); l != nil {                 // a layout's package (land.IsLayout())
	site, _ := land.Frame(l.ID)                    // the site's frame: metres from its centre
	for _, a := range land.SpacesOn(l.ID) { … }    // its areas: yard, parking, road, …
	for _, g := range land.OpeningsOn(l.ID) { … }  // its gates
	for _, it := range land.ItemsOn(l.ID) { … }    // what is placed on it, of no building
	for _, f := range land.Footprints {            // the buildings standing on it
		if f.Building != nil { … }                 // its rooms are in its own package
	}
	_ = site
}

// in a building's package: where the building's own frame lies on its site
if s := pkg.Manifest.Placements[b.ID].Site; s != nil {
	sx, sy := s.ToSite(x, y) // a point of the building, in the site's metres
	_, _ = sx, sy            // site.ToLonLat(sx, sy): where pkg.Frame(b.ID) puts it too
}
```

- `IsLayout` tells a layout's package (its manifest's `Scope.Layout`; `Scope.Buildings`
  is empty): read no building in it. It holds no building, floor, zone or walking
  network (`Navigation()` is nil).
- `Layout()` is its layout: its ID (`LayoutID(locationID)`: the location's, then `LAND`
  and `G00`), `Code`, `Name`, `Location`, `Area`, the plot as its `Geometry` (nil: none
  found), its boundary `Walls` as drawn with their gates' gaps (`WallHeight` high,
  `WallThickness` thick) and `North`: the `Bearing` the site plan's up faces and how it
  is known (`From`: `NorthFromMap`, `NorthFromDrawing`, `NorthFromPerson`, or nil).
- Its areas are spaces whose `Floor` is the layout's ID, outdoors, of the land's types
  (`yard`, `parking`, `driveway`, `garden`, `courtyard`, `path`, `gate_area`, `road`
  beyond the boundary, `pool`, `terrace`); its gates are openings of type `gate`,
  joining the areas on each side. Draw the areas' edges as light lines: the walls are
  the layout's `Walls`.
- The items on it are items of no building: their `Floor` is the layout's ID, their
  `Building` empty (`OnLand`), their `Local` in the site's frame, and a card reader's
  `Door` may be a gate. `ItemFrame(it)` is the frame an item's `Local` is in, its
  building's or its site's; `ItemLocal` works either way.
- `Frame(layoutID)` is the site's frame, from its one placement (by the layout's ID):
  metres from the site's centre, y the site plan's up.
- `Footprints` are the buildings standing on it (`Footprint(id)`,
  `FootprintOf(buildingID)`): each its outline as the site plan draws it, its `Building`
  (nil: none of the project's, or not said yet), `Name`, `DrawingLabel`, and `Site`. A
  footprint is where a building stands: its rooms are in its own package.
- A building placed on its site has its placement's `Site` (nil: placed on the map by
  itself): where its own frame lies on the site, its origin at (`X`, `Y`), turned
  `Rotation` degrees clockwise. `ToSite` turns a point of the building into the site's
  metres, `FromSite` back, `LocalToSite` an item's position and the way it faces; the
  layout's `Frame` puts a point of the site where the building's own placement puts it
  (its placement's `Lon`, `Lat` are the site's centre). A footprint's `Site` is its
  building's.
- IDs: the building segment `LandCode` (`LAND`) is the land's, no building's, and
  `LayoutCode` (`G00`) its level: `IsLand(id)` and `ID.IsLand` tell an ID of a location's
  land (its layout, an area, a gate, a footprint). An item carried onto the land is in
  `Changes.MovedAway` with the layout's ID as its `Building`.
- `Validate` checks that a layout's package holds its layout alone, by its scope, with
  one placement, the site's, and that no building is coded `LAND` (`LAYOUT`); that its
  footprints' buildings are buildings of its location, and one of no building has no
  `Site` (`FOOTPRINT`); that its areas and gates are on it (`PARENT`, `OPENING`) and the
  items on it in no building, where their `Local` puts them through the site's placement
  (`ITEM`).

## Navigation

A package of format 0.8 carries its building's walking network (`navigation.json`):
doors and the points in front of them, a point in each space and zone, lifts and
stairs on each floor, entrances and wayfinding kiosks, and the walks and rides
between them. `Route` finds the way on it, the same way Studio and the viewers do
(spec/FORMAT.md, "Navigation"; `../spec/conformance/routes.json` holds ways all of
them must agree on): from a kiosk to an office, say, as a kiosk in a lobby does when
someone types their employee number.

```go
// the kiosk is an item of the package (IsKiosk, KiosksOn); the office a space
// (or a zone) the system keeps people in, by its ID
way, err := pkg.Route(kioskItemID, officeSpaceID, storeypath.RouteOptions{})
switch {
case errors.Is(err, storeypath.ErrNoRoute): // no way (or none without stairs)
case err != nil:                            // an ID the network does not know
}
for _, s := range way.Steps {
	fmt.Println(s.Text) // "Walk 24 m along CORRIDOR to the lift", "Take the lift up to Floor 1", …
}
for _, leg := range way.Legs {
	_ = leg.Points // the line to draw on leg.Floor, in the building's own metres
}
```

- From and to: a node's ID (`kiosk:<item>`, `door:<opening>`, `room:<space>`, …),
  a space's or zone's ID (where it is arrived at: a divided space's nearest zone),
  an opening's (its node, format 0.13), or an item's (a kiosk's node; any other, the
  zone or space it stands in).
- `RouteOptions{Accessible: true}`: lifts and ramps alone, no stairs or escalators.
- A `Route` has its `Nodes`, `Legs` (the walking on each floor between rides: the
  line to draw, as `LocalFrame` turns it onto the map), `Changes` (each ride: by
  lift or stairs, from which floor to which, up or down), `Metres` and `Seconds`,
  and `Steps`: each a `Kind` (start, walk, take, arrive), its values (places and
  floors by ID, whole metres, the side the destination's door is on) and `Text` in
  English. A system words steps in its own language from the kind and values.
- `Navigation()` gives the network itself (`Nodes`, `Edges`, `Places` with what a
  step calls them, `Floors`; `Node`, `Place`); `Navigation().Route` routes on it by
  node, space and zone IDs alone. Both may be used from several goroutines.

`ErrNoNavigation` is returned for a package without a network (older than 0.8).

### Across a site (format 0.13)

A location's layout's package carries its land's walking network: its areas walked, a
node in each gate, kiosks on the land, and an entrance at each building's door to the
outside, linked (an edge of kind `link`) to the same door's node in the building's own
package (spec/FORMAT.md, "Routes across a site"). `NewSite` puts the layout's package and
its buildings' together; `Site.Route` finds the way across them as Studio and the viewers
do (`routes.json → site_routes`):

```go
site, err := storeypath.NewSite(layout, house, annex) // a layout's package (ErrNotLayout), its buildings'
way, err := site.Route(gateID, officeSpaceID, storeypath.RouteOptions{})
// "Start at the pedestrian gate", "Walk 28 m through the yard to the entrance", "Go into Main house", …
way, err = site.RouteFrom(12.5, -8, officeSpaceID, storeypath.RouteOptions{}) // from a point on the land
way, err = storeypath.SiteRoute(layout, []*storeypath.Package{house, annex}, gateID, officeSpaceID, opts)
```

- From and to: a gate's, a kiosk's, an area's, a room's or an item's ID in any of the
  packages; a point on the land (x, y in the site's frame) is its nearest node (`Nearest`),
  whose ID is the way's `From`.
- Each way into or out of a building is a `Change` of its own (`By` "entrance", `Direction`
  "in" or "out", `Floors` 0) and a `Step` "enter" or "leave" (`Building`, `Place` its
  footprint): "Go into Main house". A leg on the layout (its `Floor` the layout's ID) is in
  the site's frame (`Frame` by the layout's ID), one on a floor in its building's.
- With `Accessible`, no entrance with a step known is taken (`NavNode.Steps`, `Rise`: its
  floor above the ground, as the site plan writes them).
- A building whose package is not given is not reached (its rooms: `ErrNotInNetwork`).
  `Validate` checks a layout's network as a building's (its nodes on the layout), and each
  link: from an entrance on the land to `door:` its door, an opening of its building.

## Tests

`go test ./...` reads the packages in `../spec/conformance/` (made by Studio, see
`make.py` there) and checks the same things Studio's own tests check.
