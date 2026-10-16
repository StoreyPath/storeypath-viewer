package storeypath

import (
	"archive/zip"
	"bytes"
	"io"
	"math"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// sitePlot is the corpus's location layout (format 0.12): a made-up plot, its boundary
// walls and two gates, four areas, four footprints (three of the project's buildings, a
// store of none) and two items on the land; sitePlotBuildings are its three buildings'
// packages, of the same export run, each placed on the site.
const sitePlot = "site-plot.storeypath"

var sitePlotBuildings = []string{"site-plot-house.storeypath", "site-plot-guest-a.storeypath", "site-plot-guest-b.storeypath"}

func TestALayoutsPackageHoldsTheLandAlone(t *testing.T) {
	p := open(t, sitePlot)
	if problems := p.Validate(); len(problems) != 0 {
		t.Fatalf("problems: %v", problems)
	}
	l := p.Layout()
	if !p.IsLayout() || l == nil || len(p.Layouts) != 1 || l.ID != *p.Manifest.Scope.Layout || len(p.Manifest.Scope.Buildings) != 0 {
		t.Fatalf("scope %+v, layout %+v", p.Manifest.Scope, l)
	}
	pid, err := ParseID(l.ID)
	if err != nil || !pid.IsLand() || pid.Level() != LevelFloor || l.Code != LayoutCode || l.ID != LayoutID(l.Location) ||
		len(p.Locations) != 1 || p.Locations[0].ID != l.Location {
		t.Errorf("the layout %s (%s) of %s: %v", l.ID, l.Code, l.Location, err)
	}
	if f, ok := p.Get(l.ID); !ok || f.(*Layout) != l {
		t.Error("Get does not find the layout")
	}
	// the plot, its walls 2.4 m high, north 30° from the plan's up, known from the map
	if l.Geometry == nil || l.Walls == nil || l.Area == nil || *l.Area != 1800 || l.WallHeight == nil || *l.WallHeight != 2.4 ||
		l.WallThickness == nil || *l.WallThickness != 0.25 || l.North == nil || l.North.Bearing != 30 || l.North.From == nil ||
		*l.North.From != NorthFromMap {
		t.Errorf("the layout: %+v", *l)
	}
	// no building, floor, zone or walking network; one placement, the site's
	if len(p.Buildings)+len(p.Floors)+len(p.Zones) != 0 || p.Navigation() != nil || p.Holds("7MJPBT-PLOT-HOUSE") {
		t.Errorf("%d buildings, %d floors, %d zones, a network %v", len(p.Buildings), len(p.Floors), len(p.Zones), p.Navigation() != nil)
	}
	site, err := p.Frame(l.ID)
	if err != nil || len(p.Manifest.Placements) != 1 || site.Placement.X != 0 || site.Placement.Y != 0 || site.Placement.Bearing != 30 ||
		site.Placement.Site != nil || !site.Placement.IsPlaced() {
		t.Fatalf("the site's placement %+v: %v", site.Placement, err)
	}
	// its areas, outdoors; a road beyond the boundary
	types := map[string]bool{}
	for _, s := range p.SpacesOn(l.ID) {
		types[s.Type] = true
		if !s.Outdoor || len(s.Zones) != 0 || s.Stack != nil {
			t.Errorf("area %s: %+v", s.ID, *s)
		}
	}
	if len(p.SpacesOn(l.ID)) != 4 || len(types) != 4 || !types["road"] || !types["yard"] || !types["garden"] || !types["parking"] {
		t.Errorf("areas: %v", types)
	}
	if units := p.UnitsOn(l.ID); len(units) != 4 {
		t.Errorf("%d units on the land", len(units))
	}
	// its gates, between the yard and the street
	gates := p.OpeningsOn(l.ID)
	if len(gates) != 2 {
		t.Fatalf("%d gates", len(gates))
	}
	for _, g := range gates {
		if g.Type != "gate" || !g.Exterior || len(g.Connects) != 2 || g.Width == nil || len(g.Span) != 2 {
			t.Errorf("gate %s: %+v", g.ID, *g)
		}
		for _, a := range g.Connects {
			if s := p.Space(a); s == nil || s.Floor != l.ID {
				t.Errorf("gate %s joins %s, not an area of the land", g.ID, a)
			}
		}
	}
	// four footprints: three of the project's buildings, each with its place on the site,
	// and a store of none
	linked := map[string]*Footprint{}
	for _, f := range p.Footprints {
		if f.Layout != l.ID || p.Footprint(f.ID) != f || !IsLand(f.ID) || f.Geometry == nil {
			t.Errorf("footprint %s: %+v", f.ID, *f)
		}
		if got, _ := p.Get(f.ID); got != f {
			t.Errorf("Get does not find footprint %s", f.ID)
		}
		if f.Building == nil {
			if f.Site != nil || f.Name == nil || *f.Name != "Store" {
				t.Errorf("a footprint of no building: %+v", *f)
			}
			continue
		}
		linked[*f.Building] = f
		if f.Site == nil || p.FootprintOf(*f.Building) != f {
			t.Errorf("%s: footprint %s, site %v", *f.Building, f.ID, f.Site)
		}
	}
	if len(p.Footprints) != 4 || len(linked) != 3 || p.FootprintOf("7MJPBT-PLOT-NONE") != nil {
		t.Errorf("%d footprints, %d of buildings", len(p.Footprints), len(linked))
	}
	// the house turned a right angle on the site from how its own drawing has it
	if h := linked["7MJPBT-PLOT-HOUSE"]; h == nil || h.Site.Rotation != 90 || h.DrawingLabel == nil || !strings.Contains(*h.DrawingLabel, "\n") {
		t.Errorf("the house: %+v", h)
	}
	// a camera on a pole and a card reader at the pedestrian gate, of no building
	items := p.ItemsOn(l.ID)
	if len(items) != 2 {
		t.Fatalf("%d items on the land", len(items))
	}
	var reader, camera *Item
	for _, it := range items {
		switch it.Type {
		case "CARD-READER":
			reader = it
		case "CCTV-POLE":
			camera = it
		}
		if !it.OnLand() || it.Building != "" || it.Space == nil || p.Space(*it.Space).Floor != l.ID || it.Local == nil {
			t.Errorf("item %s: %+v", it.ID, *it)
			continue
		}
		f, err := p.ItemFrame(it)
		if err != nil || f.Placement != site.Placement {
			t.Errorf("%s: frame %+v %v", it.ID, f.Placement, err)
		}
		// without Local, worked out from the map through the site's placement
		bare := *it
		bare.Local = nil
		if w, err := p.ItemLocal(&bare); err != nil || math.Hypot(w.X-it.Local.X, w.Y-it.Local.Y) > 0.02 ||
			math.Abs(math.Remainder(w.Rotation-it.Local.Rotation, 360)) > 0.05 {
			t.Errorf("%s: worked out %+v, Local %+v (%v)", it.ID, w, *it.Local, err)
		}
	}
	if reader == nil || reader.Door == nil || p.Opening(*reader.Door) == nil || p.Opening(*reader.Door).Type != "gate" {
		t.Errorf("the card reader: %+v", reader)
	}
	if camera == nil || camera.ViewDeg == nil || *camera.ViewDeg != 80 || camera.RangeM == nil || *camera.RangeM != 30 {
		t.Errorf("the camera: %+v", camera)
	}
	// objects.csv: the layout and its footprints, and nothing of the land in a building
	kinds := map[string]int{}
	for _, row := range p.Objects {
		kinds[row.Kind]++
		if (IsLand(row.ID) || row.Floor == l.ID) && row.Building != "" {
			t.Errorf("%s (%s): building %q", row.ID, row.Kind, row.Building)
		}
	}
	if kinds["layout"] != 1 || kinds["footprint"] != 4 || kinds["item"] != 2 || kinds["building"] != 0 {
		t.Errorf("objects.csv's kinds: %v", kinds)
	}
}

func TestABuildingStandsOnItsFootprintWhereItsSiteSays(t *testing.T) {
	land := open(t, sitePlot)
	site, err := land.Frame(land.Layout().ID)
	if err != nil {
		t.Fatal(err)
	}
	held := []*Package{land}
	for _, name := range sitePlotBuildings {
		b := open(t, name)
		held = append(held, b)
		if problems := b.Validate(); len(problems) != 0 {
			t.Errorf("%s: %v", name, problems)
		}
		if b.IsLayout() || b.Layout() != nil || len(b.Footprints) != 0 || b.Manifest.Files["layout"] != "" || len(b.Buildings) != 1 {
			t.Fatalf("%s: a building's package holds no layout", name)
		}
		id := b.Buildings[0].ID
		pl := b.Manifest.Placements[id]
		fp := land.FootprintOf(id)
		if fp == nil || fp.Site == nil || pl.Site == nil || *fp.Site != *pl.Site {
			t.Fatalf("%s: its footprint's site %v, its placement's %v", name, fp, pl.Site)
		}
		// its placement: the site's centre, the site's bearing and its turn on the site
		if pl.Lon != site.Placement.Lon || pl.Lat != site.Placement.Lat ||
			math.Abs(math.Remainder(pl.Bearing-site.Placement.Bearing-pl.Site.Rotation, 360)) > 1e-9 {
			t.Errorf("%s: placed at %+v, the site at %+v", name, pl, site.Placement)
		}
		// every corner of its floors, through its site and the layout's placement, where
		// its own placement puts it: within 2 cm
		own, _ := b.Frame(id)
		corners := 0
		for _, f := range b.Floors {
			polys, err := own.PolygonsToLocal(f.Geometry)
			if err != nil {
				t.Fatal(err)
			}
			for _, poly := range polys {
				for _, ring := range poly {
					for _, pt := range ring {
						corners++
						sx, sy := pl.Site.ToSite(pt[0], pt[1])
						a, c := site.ToLonLat(sx, sy), own.ToLonLat(pt[0], pt[1])
						if off, _ := vincentyInverse(a[1], a[0], c[1], c[0]); off > 0.02 {
							t.Errorf("%s: (%.3f, %.3f) %.3f m from where its own placement puts it", name, pt[0], pt[1], off)
						}
						if x, y := pl.Site.FromSite(sx, sy); math.Hypot(x-pt[0], y-pt[1]) > 1e-9 {
							t.Errorf("%s: (%.3f, %.3f) back from the site at (%.3f, %.3f)", name, pt[0], pt[1], x, y)
						}
					}
				}
			}
		}
		if corners < 4 {
			t.Errorf("%s: %d corners", name, corners)
		}
		// an item of it turned on the site faces the same way on the map either way
		for _, rot := range []float64{0, 45, 180, 300} {
			at := pl.Site.LocalToSite(ItemLocal{X: 1, Y: 2, Rotation: rot})
			byOwn := pl.Bearing + 180 - rot
			bySite := site.Placement.Bearing + 180 - at.Rotation
			if math.Abs(math.Remainder(byOwn-bySite, 360)) > 1e-9 || at.Rotation < 0 || at.Rotation >= 360 {
				t.Errorf("%s: turned %v: %v on the map by its own placement, %v by the site's", name, rot, byOwn, bySite)
			}
		}
	}
	// the land's package and its buildings', held together: one project's
	for i, problems := range ValidateAcross(held...) {
		if len(problems) != 0 {
			t.Errorf("package %d: %v", i+1, problems)
		}
	}
}

func TestTheLandsIDs(t *testing.T) {
	if got := LayoutID("K7Q2XM-SITE"); got != "K7Q2XM-SITE-LAND-G00" {
		t.Errorf("LayoutID: %s", got)
	}
	for id, want := range map[string]bool{"K7Q2XM-SITE-LAND-G00": true, "K7Q2XM-SITE-LAND-G00-0004": true, "K7Q2XM-SITE-LAND": true,
		"K7Q2XM-SITE-HQ-F00": false, "K7Q2XM-SITE": false, "K7Q2XM": false, "K7Q2XM-SITE-LANDS-G00": false, "K7Q2XM-LAND": false,
		"7K2Q-XM9F-4DP": false, "": false, strings.Repeat("A-B-LAND-", 20): false} {
		if IsLand(id) != want {
			t.Errorf("IsLand(%.30q): %v", id, !want)
		}
	}
	pid, err := ParseID("K7Q2XM-SITE-LAND-G00-0004")
	layout, _ := pid.Prefix(LevelFloor)
	location, _ := pid.Prefix(LevelLocation)
	if err != nil || !pid.IsLand() || pid.Level() != LevelObject || layout != "K7Q2XM-SITE-LAND-G00" || location != "K7Q2XM-SITE" {
		t.Errorf("%v: %v", pid, err)
	}
	if hq, _ := ParseID("K7Q2XM-SITE-HQ-F00-0004"); hq.IsLand() {
		t.Error("a building's room is of the land")
	}
	if !(&Item{Floor: "K7Q2XM-SITE-LAND-G00"}).OnLand() || (&Item{Floor: "K7Q2XM-SITE-HQ-F00", Building: "K7Q2XM-SITE-HQ"}).OnLand() {
		t.Error("OnLand")
	}
}

// landEdit edits the first feature of a file whose property key is value.
func landEdit(file, key string, value any, change func(p map[string]any)) func(string, []byte) []byte {
	return editJSON(file, func(doc map[string]any) {
		for _, f := range features(doc) {
			if props(f)[key] == value {
				change(props(f))
				return
			}
		}
	})
}

// sitePlotManifest edits a package's manifest.
func sitePlotManifest(change func(doc map[string]any)) func(string, []byte) []byte {
	return editJSON(FileManifest, change)
}

func TestALayoutsPackageIsChecked(t *testing.T) {
	const layout, house = "7MJPBT-PLOT-LAND-G00", "7MJPBT-PLOT-HOUSE"
	shed := `{"type":"Feature","id":"7MJPBT-PLOT-SHED","geometry":null,"properties":{"kind":"building","code":"SHED",` +
		`"name":"Shed","location_id":"7MJPBT-PLOT","display_point":null}}`
	shedFloor := `{"type":"Feature","id":"7MJPBT-PLOT-SHED-F00","geometry":null,"properties":{"kind":"floor","code":"F00",` +
		`"name":"Ground","building_id":"7MJPBT-PLOT-SHED","ordinal":0,"elevation":0,"height":3}}`
	adding := func(file, feature string) func(string, []byte) []byte {
		return func(name string, data []byte) []byte {
			if name != file {
				return data
			}
			return bytes.Replace(data, []byte(`"features": []`), []byte(`"features": [`+feature+`]`), 1)
		}
	}
	cases := []struct {
		name, pkg, want, says string
		edit                  func(string, []byte) []byte
	}{
		{"a building coded LAND", "site-plot-house.storeypath", ProblemLayout, "no building has it", func(n string, d []byte) []byte {
			if n == "FORMAT.md" || strings.HasPrefix(n, "schema/") {
				return d
			}
			return bytes.ReplaceAll(d, []byte(house), []byte("7MJPBT-PLOT-LAND"))
		}},
		{"a layout's package whose scope lists a building", sitePlot, ProblemLayout, "holds no building", sitePlotManifest(func(doc map[string]any) {
			doc["scope"].(map[string]any)["buildings"] = []any{house}
		})},
		{"a layout's package with a building", sitePlot, ProblemLayout, "holds no building", adding(FileBuildings, shed)},
		{"a layout's package with a floor", sitePlot, ProblemLayout, "no floors", adding(FileFloors, shedFloor)},
		{"a layout's package with a walking network", sitePlot, ProblemLayout, "walking network", sitePlotManifest(func(doc map[string]any) {
			doc["files"].(map[string]any)["navigation"] = FileNavigation
		})},
		{"a layout's package with two placements", sitePlot, ProblemLayout, "one placement", sitePlotManifest(func(doc map[string]any) {
			pl := doc["placements"].(map[string]any)
			pl[house] = pl[layout]
		})},
		{"a layout's package with no placement", sitePlot, ProblemLayout, "one placement", sitePlotManifest(func(doc map[string]any) {
			doc["placements"] = map[string]any{}
		})},
		{"a layout's package placing another layout", sitePlot, ProblemLayout, "one placement", sitePlotManifest(func(doc map[string]any) {
			pl := doc["placements"].(map[string]any)
			pl["7MJPBT-PLOT-LAND-G01"] = pl[layout]
			delete(pl, layout)
		})},
		{"a scope naming another layout", sitePlot, ProblemLayout, "scope names layout", sitePlotManifest(func(doc map[string]any) {
			doc["scope"].(map[string]any)["layout"] = "7MJPBT-PLOT-LAND-G01"
		})},
		{"a layout's package of format 0.11", sitePlot, ProblemLayout, "cannot hold", sitePlotManifest(func(doc map[string]any) {
			doc["format_version"] = "0.11.0"
		})},
		{"a layout's package not listing its footprints", sitePlot, ProblemLayout, "lists its footprints", sitePlotManifest(func(doc map[string]any) {
			delete(doc["files"].(map[string]any), "footprints")
		})},
		{"a layout whose code is not its ID's", sitePlot, ProblemLayout, "not its ID's", landEdit(FileLayout, "kind", "layout", func(p map[string]any) {
			p["code"] = "G01"
		})},
		{"a layout of a building's segment", sitePlot, ProblemLayout, "of its location's land", editJSON(FileLayout, func(doc map[string]any) {
			features(doc)[0].(map[string]any)["id"] = "7MJPBT-PLOT-YARD-G00"
		})},
		{"a layout of a location not in the package", sitePlot, ProblemParent, "7MJPBT-ELSE", landEdit(FileLayout, "kind", "layout", func(p map[string]any) {
			p["location_id"] = "7MJPBT-ELSE"
		})},
		{"a layout's north known some other way", sitePlot, ProblemValue, "north", landEdit(FileLayout, "kind", "layout", func(p map[string]any) {
			p["north"].(map[string]any)["from"] = "compass"
		})},
		{"footprints counted wrong", sitePlot, ProblemCount, FileFootprints, sitePlotManifest(func(doc map[string]any) {
			doc["counts"].(map[string]any)["footprints"] = 3
		})},
		{"a footprint of another location's building", sitePlot, ProblemFootprint, "not a building of its layout's location",
			landEdit(FileFootprints, "building_id", house, func(p map[string]any) { p["building_id"] = "7MJPBT-ELSE-HOUSE" })},
		{"a footprint of the land", sitePlot, ProblemFootprint, "not a building of its layout's location",
			landEdit(FileFootprints, "building_id", house, func(p map[string]any) { p["building_id"] = "7MJPBT-PLOT-LAND" })},
		{"a footprint of a floor", sitePlot, ProblemFootprint, "not a building of its layout's location",
			landEdit(FileFootprints, "building_id", house, func(p map[string]any) { p["building_id"] = house + "-F00" })},
		{"a footprint of an item", sitePlot, ProblemFootprint, "item's ID",
			landEdit(FileFootprints, "building_id", house, func(p map[string]any) { p["building_id"] = "7DHH-B9RZ-PG0" })},
		{"a footprint of no building, with a site", sitePlot, ProblemFootprint, "no building",
			landEdit(FileFootprints, "building_id", nil, func(p map[string]any) {
				p["site"] = map[string]any{"x_m": 1.0, "y_m": 2.0, "rotation_deg": 0.0}
			})},
		{"a footprint not of the land", sitePlot, ProblemFootprint, "of its location's land", editJSON(FileFootprints, func(doc map[string]any) {
			features(doc)[0].(map[string]any)["id"] = "7MJPBT-PLOT-YARD-G00-0005"
		})},
		{"a footprint of another layout", sitePlot, ProblemParent, "parent layout",
			landEdit(FileFootprints, "building_id", house, func(p map[string]any) { p["layout_id"] = "7MJPBT-PLOT-LAND-G01" })},
		{"a footprint's key written in another case", sitePlot, ProblemBadFile, `"Building_ID"`,
			landEdit(FileFootprints, "building_id", nil, func(p map[string]any) { p["Building_ID"] = house })},
		{"a footprint with no outline", sitePlot, ProblemGeometry, "no geometry", editJSON(FileFootprints, func(doc map[string]any) {
			features(doc)[0].(map[string]any)["geometry"] = nil
		})},
		{"an area on no layout", sitePlot, ProblemParent, "parent floor", landEdit(FileSpaces, "type", "garden", func(p map[string]any) {
			p["floor_id"] = "7MJPBT-PLOT-LAND-G01"
		})},
		{"an area of a type the format does not have", sitePlot, ProblemValue, "lake", landEdit(FileSpaces, "type", "garden", func(p map[string]any) {
			p["type"] = "lake"
		})},
		{"a gate to an area not there", sitePlot, ProblemOpening, "unknown space", landEdit(FileOpenings, "type", "gate", func(p map[string]any) {
			p["connects"] = []any{layout + "-0099"}
		})},
		{"an item on the land, in a building", sitePlot, ProblemItem, "in building", landEdit(FileItems, "type", "CCTV-POLE", func(p map[string]any) {
			p["building_id"] = house
		})},
		{"an item on the land, away from its place on the site", sitePlot, ProblemItem, "on its site",
			landEdit(FileItems, "type", "CCTV-POLE", func(p map[string]any) {
				p["local"].(map[string]any)["x_m"] = p["local"].(map[string]any)["x_m"].(float64) + 1
			})},
		{"an item on the land, turned on the map", sitePlot, ProblemItem, "heading", landEdit(FileItems, "type", "CCTV-POLE", func(p map[string]any) {
			p["heading"] = p["heading"].(float64) + 1
		})},
		{"a card reader at a gate not there", sitePlot, ProblemItem, "serves unknown door",
			landEdit(FileItems, "type", "CARD-READER", func(p map[string]any) { p["door_id"] = layout + "-0099" })},
		{"objects.csv without the layout", sitePlot, ProblemObjects, "missing", func(n string, d []byte) []byte {
			if n != FileObjects {
				return d
			}
			var kept []string
			for _, line := range strings.SplitAfter(string(d), "\n") {
				if !strings.HasPrefix(line, layout+",layout,") {
					kept = append(kept, line)
				}
			}
			return []byte(strings.Join(kept, ""))
		}},
		{"a layout's package of a format newer than the reader's", sitePlot, ProblemVersion, "update the reader",
			sitePlotManifest(func(doc map[string]any) { doc["format_version"] = "0.13.0" })},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			problems := rewriteFrom(t, c.pkg, c.edit).Validate()
			if !slices.ContainsFunc(problems, func(pr Problem) bool { return pr.Code == c.want && strings.Contains(pr.Message, c.says) }) {
				t.Errorf("want %s (%q): %v", c.want, c.says, problems)
			}
		})
	}
	// a building coded LAND: that alone
	coded := rewriteFrom(t, "site-plot-house.storeypath", cases[0].edit)
	if got := codes(coded.Validate()); !slices.Equal(got, []string{ProblemLayout}) {
		t.Errorf("a building coded LAND: %v", coded.Validate())
	}
}

func TestWhatALayoutsPackageMayBe(t *testing.T) {
	for _, c := range []struct {
		name, pkg string
		edit      func(string, []byte) []byte
	}{
		// the land's types known without the manifest's list
		{"a manifest that lists no types", sitePlot, sitePlotManifest(func(doc map[string]any) { delete(doc, "types") })},
		// an item carried from a building onto the land (moved_away: the layout's ID)
		{"an item moved onto the land", "site-plot-house.storeypath", editJSON(FileChanges, func(doc map[string]any) {
			doc["moved_away"] = []any{map[string]any{"id": "7DHH-B9RZ-PG0", "building_id": "7MJPBT-PLOT-LAND-G00"}}
		})},
		// a site not on the map yet, its north from its drawing
		{"a site not placed", sitePlot, alsoEdit(
			sitePlotManifest(func(doc map[string]any) {
				for _, pl := range doc["placements"].(map[string]any) {
					pl.(map[string]any)["placed"] = false
				}
			}),
			landEdit(FileLayout, "kind", "layout", func(p map[string]any) { p["north"].(map[string]any)["from"] = NorthFromDrawing }))},
		// a site whose north is not known, and a plot not found
		{"no north, no plot", sitePlot, editJSON(FileLayout, func(doc map[string]any) {
			f := features(doc)[0].(map[string]any)
			f["geometry"], props(f)["north"], props(f)["walls"] = nil, nil, nil
		})},
	} {
		t.Run(c.name, func(t *testing.T) {
			if problems := rewriteFrom(t, c.pkg, c.edit).Validate(); len(problems) != 0 {
				t.Errorf("problems: %v", problems)
			}
		})
	}
	// a building's package of 0.11, as before: no layouts, no site
	old := rewriteFrom(t, "campus-hq.storeypath", editJSON(FileManifest, func(doc map[string]any) { doc["format_version"] = "0.11.0" }))
	if problems := old.Validate(); len(problems) != 0 || old.IsLayout() || old.Layout() != nil {
		t.Errorf("0.11: %v", problems)
	}
}

func TestALayoutsSitePlanMayCarryItsDrawing(t *testing.T) {
	// the drawing view of drawn-office's ground floor, carried as site-plot's site plan
	src, err := zip.OpenReader(filepath.Join(corpus, "packages", drawnOffice))
	if err != nil {
		t.Fatal(err)
	}
	defer src.Close()
	var view []byte
	for _, f := range src.File {
		if strings.HasPrefix(f.Name, DrawingsDir) && view == nil {
			rc, _ := f.Open()
			view, _ = io.ReadAll(rc)
			rc.Close()
		}
	}
	const layout = "7MJPBT-PLOT-LAND-G00"
	name := DrawingsDir + layout + ".view"
	data := zipFrom(t, sitePlot, sitePlotManifest(func(doc map[string]any) {
		doc["files"].(map[string]any)["drawings"] = DrawingsDir
		doc["sources"].([]any)[0].(map[string]any)["view"] = name
	}), zip.Deflate)
	p, err := readZip(withFile(t, data, name, view), DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	if problems := p.Validate(); len(problems) != 0 {
		t.Errorf("problems: %v", problems)
	}
	if d, err := p.Drawing(layout); !p.HasDrawing(layout) || err != nil || d == nil || d.Floor != layout {
		t.Errorf("the site plan's drawing: %v %v", d, err)
	}
}

// withFile is a package's ZIP with a file added.
func withFile(t *testing.T, data []byte, name string, content []byte) []byte {
	t.Helper()
	src, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for _, f := range src.File {
		if err := w.Copy(f); err != nil {
			t.Fatal(err)
		}
	}
	out, _ := w.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store})
	out.Write(content)
	w.Close()
	return buf.Bytes()
}
