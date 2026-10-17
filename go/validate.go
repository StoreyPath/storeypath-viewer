package storeypath

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// A Problem found in a package: a stable Code a program can act on, the file and
// the ID it is about when there is one, and a Message for people.
type Problem struct {
	Code    string
	File    string
	ID      string
	Message string
}

func (p Problem) String() string { return p.Message }

// shownLength: the longest a string from a package is shown in a problem (longer
// than any ID), so a file of hostile strings cannot make problems as large.
const shownLength = 100

// clip is a string from a package as a problem shows it: cut short at shownLength.
func clip(s string) string {
	if len(s) <= shownLength {
		return s
	}
	i := shownLength
	for i > 0 && !utf8.RuneStart(s[i]) {
		i--
	}
	return s[:i] + "…"
}

// Problem codes. They never change meaning; new ones may be added.
const (
	ProblemMissingFile   = "MISSING_FILE"   // a file of the package is not in it
	ProblemBadFile       = "BAD_FILE"       // a file cannot be read as its kind
	ProblemFormat        = "FORMAT"         // not a StoreyPath package
	ProblemVersion       = "VERSION"        // a format major version this reader does not read
	ProblemCount         = "COUNT"          // the manifest's count of a file's features is wrong
	ProblemBadID         = "BAD_ID"         // an ID is not a StoreyPath ID
	ProblemDuplicateID   = "DUPLICATE_ID"   // two features share an ID
	ProblemWrongProject  = "WRONG_PROJECT"  // an ID is not of the package's project
	ProblemIDLevel       = "ID_LEVEL"       // an ID has the wrong number of segments for its kind
	ProblemParent        = "PARENT"         // a feature's parent is missing, or its ID does not start with it (0.12: a layout's location, an area's, gate's or footprint's layout)
	ProblemZone          = "ZONE"           // a zone and its space do not list each other, or a space lists another's zone (or one twice)
	ProblemOpening       = "OPENING"        // an opening joins a space that is not there, or on another floor (0.12: a gate, an area not on its layout)
	ProblemObjects       = "OBJECTS"        // objects.csv does not list exactly the features
	ProblemChanges       = "CHANGES"        // changes.json does not agree with the package
	ProblemGeometry      = "GEOMETRY"       // a feature's geometry is not the kind its file holds
	ProblemScope         = "SCOPE"          // a package holds a building its scope does not list, or lacks one it does; from 0.7, not exactly one
	ProblemItem          = "ITEM"           // an item is on a floor not in the package (or not of its building), or in a space or zone not on its floor, or serves a door not of its floor (0.10); from 0.7, without its position in its building, or with a map position or heading away from it; (0.12) on a layout, yet in a building
	ProblemItemType      = "ITEM_TYPE"      // an item's type is not in the package's catalogue
	ProblemPlacement     = "PLACEMENT"      // a building of the package, or one an item stands in, has no placement in the manifest
	ProblemValue         = "VALUE"          // a value the format does not allow: a type the manifest's types do not list, a negative capacity, a grade, mount, category or colour not of the format, a finish's code not of the form of a floor's or a wall's (format 0.9), a camera's view past all round or of no range (0.10)
	ProblemNavigation    = "NAVIGATION"     // (0.8) the walking network names a building, floor, space or zone not in the package, holds a node twice, or an edge joins a node it does not have (or two nodes another edge joins), or has no line
	ProblemItemElsewhere = "ITEM_ELSEWHERE" // (ValidateAcross) an item's ID is an item of another project, in another package
	ProblemMezzanine     = "MEZZANINE"      // (0.11) a mezzanine's host is not another floor of its building of type floor (not a mezzanine, nor a roof), of its ordinal; its above_host_m is not more than 0, or its elevation is not its host's and above_host_m; a level that is not a mezzanine names a host or an above_host_m
	ProblemFloorOrdinal  = "FLOOR_ORDINAL"  // (0.11) two levels of a building that are not mezzanines have one ordinal, or two floors of a building one code
	ProblemRoof          = "ROOF"           // (0.11) a floor of type floor stands above a roof of its building (a roof is its building's top: only roofs stand above it)
	ProblemDrawing       = "DRAWING"        // (0.11) a floor's drawing: a source names one not at drawings/<floor-id>.view, of a floor (0.12: or layout) not in the package, or not in it; it is not a drawing view this reader reads (gzip, SPDV, its head, format 1, its arrays and batches whole), or not in metres; the manifest lists drawings/ with none named, or names some without listing it; a file under drawings/ no source names
	ProblemLayout        = "LAYOUT"         // (0.12) a layout's package does not hold its layout alone: its scope names another (or the package is of a format before 0.12), it holds a building, a floor, a zone or a walking network, its manifest does not list its layout's files, or its placements are not the site's alone, by the layout's ID; a building's package lists a layout's files; a layout's ID is not of its location's land, or its code not its ID's; a building's code is LAND (the land's: no building has it)
	ProblemFootprint     = "FOOTPRINT"      // (0.12) a footprint's ID is not of its location's land; its building is not a building of its layout's location (not an ID, not a building's, the land, another location's); one of no building has a building's site
)

var kindLevel = map[string]string{
	"location": LevelLocation, "building": LevelBuilding, "floor": LevelFloor,
	"space": LevelObject, "zone": LevelObject, "opening": LevelObject,
	"layout": LevelFloor, "footprint": LevelObject, // (0.12: a layout is a level of its location)
}

// knownTypes: the types of spaces, zones and openings of this format, for a
// manifest that does not list them (manifest.json → types lists those a package
// may use, a later format's too).
var knownTypes = map[string][]string{
	"space": spaceTypes, "zone": spaceTypes, "opening": {"door", "opening", "window", "gate"}, // (gate: 0.12)
	"floor": {FloorTypeFloor, FloorTypeMezzanine, FloorTypeRoof}, // (0.11)
}

// spaceTypes: a building's rooms' (roomTypes), and a location's land's areas' (0.12:
// landTypes, outdoors; parking and terrace are a room's types too).
var (
	roomTypes = []string{"office", "room", "meeting_room", "corridor", "lobby", "elevator", "stairs", "escalator",
		"ramp", "restroom", "kitchen", "storage", "utility", "shaft", "open_area", "unspecified", "bedroom", "living_room",
		"dining_room", "bathroom", "dressing_room", "laundry", "prayer_room", "parking", "balcony", "terrace", "open_to_below",
		"roof"} // (roof: 0.11)
	landTypes  = []string{"driveway", "garden", "courtyard", "yard", "path", "gate_area", "road", "pool"}
	spaceTypes = append(slices.Clone(roomTypes), landTypes...)
)

// The values a property may have, as Studio's models allow them.
var (
	grades        = []string{"president", "c_level", "director", "manager", "section_head", "senior", "junior"}
	capacityFroms = []string{"review", "items"}
	mounts        = []string{"floor", "wall", "ceiling"}
	// Categories (format 0.10); "appliance", 0.9's, still read in an older package
	categories = append(slices.Clone(ItemCategories), "appliance")
	colourRE   = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
)

// maxWorkplaces: the most people who work at one item (a bench of desks).
const maxWorkplaces = 100

// maxRangeM: the furthest a camera sees, in metres (format 0.10: range_m).
const maxRangeM = 500.0

// knownKinds: the kinds of objects.csv rows this reader knows. Rows of others (a
// later format's), and their IDs in changes.json, are left alone.
var knownKinds = map[string]bool{"project": true, "location": true, "building": true, "floor": true,
	"space": true, "zone": true, "opening": true, "item": true, "layout": true, "footprint": true}

// elevationAgreesM: how far a mezzanine's elevation may be from its host's and its
// height above it (each kept to the millimetre).
const elevationAgreesM = 0.01

// localAgreesM: how far an item's map position may be from its position in its
// building (the package keeps 7 decimals of a degree, about a centimetre), and
// headingAgreesDeg how far its heading may be from the way it faces in its building
// (each kept to 2 decimals).
const (
	localAgreesM     = 0.05
	headingAgreesDeg = 0.5
)

// kindRoles: the role of the file each kind of feature is in.
var kindRoles = map[string]string{
	"location": "location", "building": "buildings", "floor": "floors",
	"space": "spaces", "zone": "zones", "opening": "openings", "item": "items",
	"layout": "layout", "footprint": "footprints",
}

// Validate checks the package as Studio's validator does: its files, the
// manifest's counts, every ID and every reference between features, objects.csv
// and changes.json, every building's placement, and the items (format 0.6): their
// IDs, the floor, space and zone each stands in, its type in the catalogue, and
// (0.7) their position in their building, which their map position must agree
// with through the building's placement. From 0.7 a package holds one building.
// The walking network (0.8), when there is one: what its nodes are on and in, and
// what its edges join. The floors' drawings (0.11), when it carries them: each
// where its source says, a drawing view read whole, in metres. A location's layout
// (0.12): that a layout's package holds its layout alone, by its scope, with one
// placement, the site's; that no building is coded LAND; that its areas and gates are
// on it, its footprints' buildings of its location, and the items on it of no building.
// No problems means the package can be linked to as it is.
func (p *Package) Validate() []Problem {
	out := append([]Problem(nil), p.problems...)
	add := func(code, file, id, format string, args ...any) {
		for i, arg := range args {
			if s, ok := arg.(string); ok {
				args[i] = clip(s)
			}
		}
		out = append(out, Problem{Code: code, File: clip(file), ID: clip(id), Message: fmt.Sprintf(format, args...)})
	}
	m := p.Manifest
	// the files, where the manifest's files say
	buildingsFile, floorsFile, spacesFile, zonesFile := p.file("buildings"), p.file("floors"), p.file("spaces"), p.file("zones")
	openingsFile, itemsFile, objectsFile, changesFile := p.file("openings"), p.file("items"), p.file("objects"), p.file("changes")
	layoutFile, footprintsFile := p.file("layout"), p.file("footprints")
	fileOf := func(kind string) string { return p.file(kindRoles[kind]) }
	if m.Format != FormatName {
		add(ProblemFormat, FileManifest, "", "unknown format %q", m.Format)
	}
	if err := CheckVersion(m.FormatVersion); err != nil {
		add(ProblemVersion, FileManifest, "", "%v", err)
	}
	project := m.Project.ID
	// values: the types the manifest lists for each kind (else this format's), and
	// what a space's or zone's seating may be
	types := map[string]map[string]bool{}
	for kind, known := range knownTypes {
		names := m.Types[kind]
		if len(names) == 0 {
			names = known
		}
		types[kind] = map[string]bool{}
		for _, name := range names {
			types[kind][name] = true
		}
	}
	typed := func(kind, file, id, typ string) {
		if !types[kind][typ] {
			add(ProblemValue, file, id, "%s: type %q is not one of the %s types of the package", id, typ, kind)
		}
	}
	seated := func(file, id string, s Seating) {
		if s.Capacity != nil && *s.Capacity < 0 {
			add(ProblemValue, file, id, "%s: capacity %d is less than none", id, *s.Capacity)
		}
		if s.CapacityFrom != nil && !slices.Contains(capacityFroms, *s.CapacityFrom) {
			add(ProblemValue, file, id, "%s: capacity_from %q is not review or items", id, *s.CapacityFrom)
		} else if s.CapacityFrom != nil && s.Capacity == nil {
			add(ProblemValue, file, id, "%s: capacity_from %q with no capacity", id, *s.CapacityFrom)
		} else if s.CapacityFrom == nil && s.Capacity != nil {
			add(ProblemValue, file, id, "%s: capacity %d with no capacity_from", id, *s.Capacity)
		}
		if s.Grade != nil && !slices.Contains(grades, *s.Grade) {
			add(ProblemValue, file, id, "%s: grade %q is not one of %s", id, *s.Grade, strings.Join(grades, ", "))
		}
	}
	// a finish (0.9): a code of the form of a floor's or a wall's (one this module does
	// not know, a later version's, is read as the type's default)
	finished := func(file, id, applies string, code *string) {
		if code != nil && !wellFormedFinish(*code, applies) {
			add(ProblemValue, file, id, "%s: %s_finish %q is not a %s finish's code", id, applies, clip(*code), applies)
		}
	}
	oneBuilding := minor(m.FormatVersion) >= oneBuildingFrom
	// an item's ID: an asset's tag (0.8), else the project's code, -I and six digits
	assetIDs := minor(m.FormatVersion) >= assetIDsFrom
	itemForm := IsItemID
	if !assetIDs {
		itemForm = isLegacyItemID
	}

	counts := map[string]int{"location": len(p.Locations), "buildings": len(p.Buildings), "floors": len(p.Floors),
		"spaces": len(p.Spaces), "zones": len(p.Zones), "openings": len(p.Openings),
		"layout": len(p.Layouts), "footprints": len(p.Footprints)} // (a layout's files, 0.12: when read)
	roles := []string{"location", "buildings", "floors", "spaces", "zones", "openings", "layout", "footprints"}
	for _, role := range roles {
		file := p.file(role)
		if !p.read[role] { // missing or unreadable: already a problem of its own
			continue
		}
		if got, ok := m.Counts[role]; !ok || got != counts[role] {
			add(ProblemCount, file, "", "%s: manifest counts %d, file has %d", file, m.Counts[role], counts[role])
		}
	}
	if p.read["items"] {
		if got, ok := m.Counts["items"]; !ok || got != len(p.Items) {
			add(ProblemCount, itemsFile, "", "%s: manifest counts %d, file has %d", itemsFile, m.Counts["items"], len(p.Items))
		}
	}

	ids := make([]string, 0, len(p.kinds))
	for id := range p.kinds {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		kinds := p.kinds[id]
		if len(kinds) > 1 {
			add(ProblemDuplicateID, fileOf(kinds[0]), id, "duplicate ID %s", id)
		}
		if kinds[0] == "item" { // an asset's tag (before 0.8, the project's and its number): where it is, is data
			switch {
			case !itemForm(id) && assetIDs:
				add(ProblemBadID, itemsFile, id, "%s: not an item ID (four, four and three symbols of Crockford's "+
					"base32, the last its check: 7K2Q-XM9F-4DP)", id)
			case !itemForm(id):
				add(ProblemBadID, itemsFile, id, "%s: not an item ID (the project's code, -I and six digits)", id)
			case !assetIDs && !strings.HasPrefix(id, project+"-"):
				add(ProblemWrongProject, itemsFile, id, "%s: project segment is not the package's project %s", id, project)
			}
			continue
		}
		pid, err := ParseID(id)
		if err != nil {
			add(ProblemBadID, fileOf(kinds[0]), id, "%s: %v", fileOf(kinds[0]), err)
			continue
		}
		if pid.Project() != project {
			add(ProblemWrongProject, fileOf(kinds[0]), id, "%s: project segment is not the package's project %s", id, project)
		}
		if want := kindLevel[kinds[0]]; pid.Level() != want {
			add(ProblemIDLevel, fileOf(kinds[0]), id, "%s: a %s ID needs %d segments", id, kinds[0], levelDepth(want))
		}
		// a location's land (0.12): LAND is its segment, no building's; a layout and
		// its footprints are of it
		switch land := pid.IsLand(); {
		case kinds[0] == "building" && land:
			add(ProblemLayout, fileOf(kinds[0]), id, "%s: %s is a location's land (its layout): no building has it", id, LandCode)
		case kinds[0] == "layout" && !land:
			add(ProblemLayout, fileOf(kinds[0]), id, "%s: a layout's ID is of its location's land (…-%s-%s)", id, LandCode, LayoutCode)
		case kinds[0] == "footprint" && !land:
			add(ProblemFootprint, fileOf(kinds[0]), id, "%s: a footprint's ID is of its location's land (…-%s-…)", id, LandCode)
		}
	}
	kindOf := func(id string) string {
		if k := p.kinds[id]; len(k) > 0 {
			return k[0]
		}
		return ""
	}
	parent := func(child, parentID, kind, file string) {
		if parentID == "" || kindOf(parentID) != kind {
			add(ProblemParent, file, child, "%s: parent %s %s is not in the package", child, kind, parentID)
		} else if !strings.HasPrefix(child, parentID+"-") {
			add(ProblemParent, file, child, "%s: ID does not start with its parent %s", child, parentID)
		}
	}
	for _, b := range p.Buildings {
		parent(b.ID, b.Location, "location", buildingsFile)
	}
	var layoutScope *string // (0.12) the layout a layout's package holds, in place of a building
	if m.Scope != nil {
		layoutScope = m.Scope.Layout
	}
	if layoutScope != nil && minor(m.FormatVersion) < layoutsFrom {
		add(ProblemLayout, FileManifest, *layoutScope, "scope names a layout, which a package of format %s cannot hold (0.12)", m.FormatVersion)
	}
	if layoutScope != nil { // its layout alone: no building, floor, zone or walking network; one placement, the site's
		for _, role := range []string{"layout", "footprints"} {
			if m.Files[role] == "" {
				add(ProblemLayout, FileManifest, "", "a layout's package lists its %s in its manifest's files", role)
			}
		}
		if p.read["layout"] { // (missing or unreadable: a problem of its own)
			var held []string
			for _, l := range p.Layouts {
				held = append(held, l.ID)
			}
			if len(held) != 1 || held[0] != *layoutScope {
				if len(held) == 0 {
					held = []string{"none"}
				}
				add(ProblemLayout, layoutFile, *layoutScope, "scope names layout %s; the package holds %s", *layoutScope, strings.Join(held, ", "))
			}
		}
		if len(m.Scope.Buildings) > 0 || len(p.Buildings) > 0 {
			add(ProblemLayout, buildingsFile, "", "a layout's package holds no building")
		}
		if len(p.Floors) > 0 || len(p.Zones) > 0 {
			add(ProblemLayout, floorsFile, "", "a layout's package holds no floors and no zones")
		}
		if m.Files["navigation"] != "" && minor(m.FormatVersion) < siteRoutesFrom {
			add(ProblemLayout, FileManifest, "", "a layout's package of %s has no walking network (0.13)", m.FormatVersion)
		}
		if _, ok := m.Placements[*layoutScope]; !ok || len(m.Placements) != 1 {
			add(ProblemLayout, FileManifest, *layoutScope, "a layout's package has one placement, its site's, by the layout's ID %s", *layoutScope)
		}
	} else if m.Files["layout"] != "" || m.Files["footprints"] != "" { // (0.12) a building's package holds no layout
		add(ProblemLayout, FileManifest, "", "a building's package holds no layout: its manifest lists layout or footprints")
	}
	if layoutScope == nil && oneBuilding { // from 0.7, a package holds one building and names it
		if m.Scope == nil || len(m.Scope.Buildings) != 1 {
			add(ProblemScope, FileManifest, "", "a package of format %s holds one building: its manifest's scope names it", m.FormatVersion)
		}
		if len(p.Buildings) != 1 {
			add(ProblemScope, buildingsFile, "", "%s: a package of format %s holds one building, this one %d",
				buildingsFile, m.FormatVersion, len(p.Buildings))
		}
	}
	if m.Scope != nil {
		listed := map[string]bool{}
		for _, id := range m.Scope.Buildings {
			listed[id] = true
			if p.Building(id) == nil {
				add(ProblemScope, FileManifest, id, "scope lists building %s, which is not in the package", id)
			}
		}
		for _, b := range p.Buildings {
			if !listed[b.ID] {
				add(ProblemScope, buildingsFile, b.ID, "building %s is in the package but not in its scope", b.ID)
			}
		}
	}
	// the placements hold one for each building: where its frame is on the map,
	// which the items standing in it are checked against
	unplaced := map[string]bool{}
	placed := func(building string) {
		if _, ok := m.Placements[building]; !ok && !unplaced[building] {
			unplaced[building] = true
			add(ProblemPlacement, FileManifest, building, "building %s has no placement", building)
		}
	}
	// (an item on a location's land, 0.12, is placed by the site's: a layout's package
	// has that one alone, checked above)
	onLand := func(it *Item) bool { return kindOf(it.Floor) == "layout" }
	if layoutScope == nil {
		for _, b := range p.Buildings {
			placed(b.ID)
		}
		for _, it := range p.Items {
			if !onLand(it) && it.Building != "" {
				placed(it.Building)
			}
		}
		for _, b := range sortedKeys(m.Placements) { // and no other building
			if p.Building(b) == nil {
				add(ProblemPlacement, FileManifest, b, "the manifest places building %s, which is not in the package", b)
			}
		}
	}
	for _, f := range p.Floors {
		parent(f.ID, f.Building, "building", floorsFile)
		typed("floor", floorsFile, f.ID, f.Type) // (0.11; before, every floor a storey)
	}
	// levels (0.11): one of each ordinal in a building that is not a mezzanine, and any
	// mezzanines on it; each code once in a building
	ordinals, floorCodes := map[string]string{}, map[string]string{}
	for _, f := range p.Floors {
		if !f.IsMezzanine() {
			key := fmt.Sprintf("%s %d", f.Building, f.Ordinal)
			if other, ok := ordinals[key]; ok {
				add(ProblemFloorOrdinal, floorsFile, f.ID, "%s: floor %d of building %s, as %s is (only a mezzanine shares a floor's ordinal)",
					f.ID, f.Ordinal, f.Building, other)
			} else {
				ordinals[key] = f.ID
			}
		}
		key := f.Building + " " + f.Code
		if other, ok := floorCodes[key]; ok {
			add(ProblemFloorOrdinal, floorsFile, f.ID, "%s: code %s, as floor %s of its building has", f.ID, f.Code, other)
		} else {
			floorCodes[key] = f.ID
		}
	}
	// a roof (0.11) is its building's top: no floor of type floor above it (a second
	// roof, over the rooms standing on the first, may be)
	lowestRoof := map[string]*Floor{}
	for _, f := range p.Floors {
		if r := lowestRoof[f.Building]; f.IsRoof() && (r == nil || f.Ordinal < r.Ordinal) {
			lowestRoof[f.Building] = f
		}
	}
	for _, f := range p.Floors {
		if r := lowestRoof[f.Building]; r != nil && !f.IsMezzanine() && !f.IsRoof() && f.Ordinal > r.Ordinal {
			add(ProblemRoof, floorsFile, f.ID, "%s: floor %d, above the roof %s (floor %d): a roof is its building's top",
				f.ID, f.Ordinal, r.ID, r.Ordinal)
		}
	}
	// a mezzanine (0.11) stands in a floor of its building of type floor (its host),
	// of the same ordinal, above_host_m above it
	for _, f := range p.Floors {
		if !f.IsMezzanine() {
			if f.Host != nil || f.AboveHost != nil {
				add(ProblemMezzanine, floorsFile, f.ID, "%s: not a mezzanine, yet it names a host floor or a height above one", f.ID)
			}
			continue
		}
		var host *Floor
		if f.Host != nil {
			host = p.Floor(*f.Host)
		}
		switch {
		case f.Host == nil:
			add(ProblemMezzanine, floorsFile, f.ID, "%s: a mezzanine with no host floor", f.ID)
		case host == nil || *f.Host == f.ID || host.Building != f.Building:
			add(ProblemMezzanine, floorsFile, f.ID, "%s: its host %s is not another floor of its building in the package", f.ID, *f.Host)
		case host.IsMezzanine():
			add(ProblemMezzanine, floorsFile, f.ID, "%s: its host %s is a mezzanine", f.ID, host.ID)
		case host.IsRoof():
			add(ProblemMezzanine, floorsFile, f.ID, "%s: its host %s is a roof (a mezzanine stands in a floor)", f.ID, host.ID)
		case host.Ordinal != f.Ordinal:
			add(ProblemMezzanine, floorsFile, f.ID, "%s: ordinal %d, its host %s's is %d", f.ID, f.Ordinal, host.ID, host.Ordinal)
		}
		switch {
		case f.AboveHost == nil || !(*f.AboveHost > 0):
			add(ProblemMezzanine, floorsFile, f.ID, "%s: a mezzanine's above_host_m is more than 0", f.ID)
		case host != nil && math.Abs(host.Elevation+*f.AboveHost-f.Elevation) > elevationAgreesM:
			add(ProblemMezzanine, floorsFile, f.ID, "%s: elevation %.3f m is not its host's (%.3f m) and above_host_m (%.3f m)",
				f.ID, f.Elevation, host.Elevation, *f.AboveHost)
		}
	}
	// a location's layout (0.12): of its location, its code its ID's, its boundary and
	// walls polygons, its north known so or not known
	for _, l := range p.Layouts {
		parent(l.ID, l.Location, "location", layoutFile)
		if codeOf(l.ID) != l.Code {
			add(ProblemLayout, layoutFile, l.ID, "%s: its code is %s, not its ID's", l.ID, l.Code)
		}
		for _, g := range []*Geometry{l.Geometry, l.Walls} { // (either may be none)
			if g != nil {
				geometryOf(l.ID, g, layoutFile, false, add)
			}
		}
		if n := l.North; n != nil && n.From != nil && !slices.Contains(northFroms, *n.From) {
			add(ProblemValue, layoutFile, l.ID, "%s: north from %q is not map, drawing or person", l.ID, *n.From)
		}
	}
	// a space's or an opening's level: a floor, or (0.12) a layout, its area or gate
	levelOf := func(floorID string) string {
		if kindOf(floorID) == "layout" {
			return "layout"
		}
		return "floor"
	}
	zonesOf := map[string]map[string]bool{}
	for _, s := range p.Spaces {
		parent(s.ID, s.Floor, levelOf(s.Floor), spacesFile)
		zonesOf[s.ID] = map[string]bool{}
		for _, z := range s.Zones {
			if zonesOf[s.ID][z] {
				add(ProblemZone, spacesFile, s.ID, "%s: lists zone %s twice", s.ID, z)
			}
			zonesOf[s.ID][z] = true
			if kindOf(z) != "zone" {
				add(ProblemZone, spacesFile, s.ID, "%s: lists unknown zone %s", s.ID, z)
			} else if of := p.Zone(z).Space; of != s.ID { // a zone is part of one space
				add(ProblemZone, spacesFile, s.ID, "%s: lists zone %s, which is part of space %s", s.ID, z, of)
			}
		}
		typed("space", spacesFile, s.ID, s.Type)
		seated(spacesFile, s.ID, s.Seating)
		finished(spacesFile, s.ID, "floor", s.FloorFinish)
		finished(spacesFile, s.ID, "wall", s.WallFinish)
		geometryOf(s.ID, s.Geometry, spacesFile, false, add)
	}
	for _, z := range p.Zones {
		parent(z.ID, z.Floor, "floor", zonesFile)
		if kindOf(z.Space) != "space" {
			add(ProblemZone, zonesFile, z.ID, "%s: zone of unknown space %s", z.ID, z.Space)
		} else if !zonesOf[z.Space][z.ID] {
			add(ProblemZone, zonesFile, z.ID, "%s: not listed in the zones of its space %s", z.ID, z.Space)
		}
		typed("zone", zonesFile, z.ID, z.Type)
		seated(zonesFile, z.ID, z.Seating)
		finished(zonesFile, z.ID, "floor", z.FloorFinish)
		geometryOf(z.ID, z.Geometry, zonesFile, false, add)
	}
	for _, o := range p.Openings {
		parent(o.ID, o.Floor, levelOf(o.Floor), openingsFile)
		for _, s := range o.Connects {
			if kindOf(s) != "space" {
				add(ProblemOpening, openingsFile, o.ID, "%s: connects to unknown space %s", o.ID, s)
			} else if !strings.HasPrefix(s, o.Floor+"-") {
				add(ProblemOpening, openingsFile, o.ID, "%s: connects to %s on another floor", o.ID, s)
			}
		}
		typed("opening", openingsFile, o.ID, o.Type)
		geometryOf(o.ID, o.Geometry, openingsFile, true, add)
	}
	// footprints (0.12): the buildings standing on a layout, each of the layout's
	// location (its own package holds it), or of none, then with no place on the site
	for _, f := range p.Footprints {
		parent(f.ID, f.Layout, "layout", footprintsFile)
		if f.Building != nil {
			b, err := ParseID(*f.Building)
			switch {
			case err != nil:
				add(ProblemFootprint, footprintsFile, f.ID, "%s: building %v", f.ID, err)
			case b.Level() != LevelBuilding || b.IsLand() || !strings.HasPrefix(*f.Building, locationOf(f.Layout)+"-"):
				add(ProblemFootprint, footprintsFile, f.ID, "%s: building %s is not a building of its layout's location", f.ID, *f.Building)
			}
		} else if f.Site != nil {
			add(ProblemFootprint, footprintsFile, f.ID, "%s: a footprint of no building, with a building's place on the site", f.ID)
		}
		geometryOf(f.ID, f.Geometry, footprintsFile, false, add)
	}
	// a camera's view (0.10): more than nothing, all round and maxRangeM at most
	viewed := func(file, id, what string, deg, reach *float64) {
		if deg != nil && !(*deg > 0 && *deg <= 360) {
			add(ProblemValue, file, id, "%s: view_deg %g is not more than 0 and at most 360", what, *deg)
		}
		if reach != nil && !(*reach > 0 && *reach <= maxRangeM) {
			add(ProblemValue, file, id, "%s: range_m %g is not more than 0 and at most %g", what, *reach, maxRangeM)
		}
	}
	ways := make(map[string]string, len(p.Openings)) // what an item's door may be: an opening's type, by its ID
	for _, o := range p.Openings {
		ways[o.ID] = o.Type
	}
	for _, it := range p.Items {
		land := onLand(it) // (0.12) on a location's land: of no building, placed in the site's frame
		switch {
		case land && it.Building != "":
			add(ProblemItem, itemsFile, it.ID, "%s: on layout %s, in building %s (what is on a location's land is in no building)",
				it.ID, it.Floor, it.Building)
		case land:
		case kindOf(it.Building) != "building":
			add(ProblemItem, itemsFile, it.ID, "%s: in building %s, which is not a building of the package", it.ID, it.Building)
		case kindOf(it.Floor) != "floor" || !strings.HasPrefix(it.Floor, it.Building+"-"):
			add(ProblemItem, itemsFile, it.ID, "%s: on unknown floor %s (or not of building %s)", it.ID, it.Floor, it.Building)
		}
		for _, in := range []struct {
			id   *string
			kind string
		}{{it.Space, "space"}, {it.Zone, "zone"}} {
			if in.id != nil && (kindOf(*in.id) != in.kind || !strings.HasPrefix(*in.id, it.Floor+"-")) {
				add(ProblemItem, itemsFile, it.ID, "%s: in unknown %s %s (or not on its floor)", it.ID, in.kind, *in.id)
			}
		}
		if p.Catalogue != nil && p.Catalogue.Type(it.Type) == nil {
			add(ProblemItemType, itemsFile, it.ID, "%s: type %s is not in the catalogue", it.ID, it.Type)
		}
		if it.Door != nil && (ways[*it.Door] == "" || ways[*it.Door] == "window" || !strings.HasPrefix(*it.Door, it.Floor+"-")) {
			add(ProblemItem, itemsFile, it.ID, "%s: serves unknown door %s (or not a door or opening of its floor)", it.ID, *it.Door)
		}
		viewed(itemsFile, it.ID, it.ID, it.ViewDeg, it.RangeM)
		frame, in := it.Building, "in its building" // its Local's frame: its building's, or on the land its site's
		if land {
			frame, in = it.Floor, "on its site"
		}
		if it.Local == nil && oneBuilding {
			add(ProblemItem, itemsFile, it.ID, "%s: no position %s (local)", it.ID, in)
		} else if f, err := p.Frame(frame); it.Local != nil && err == nil {
			at := f.ToLonLat(it.Local.X, it.Local.Y)
			dlon := math.Remainder(at[0]-it.Label[0], 360) // the short way, across the antimeridian too
			off := math.Hypot(dlon*111320*math.Cos(at[1]*math.Pi/180), (at[1]-it.Label[1])*110574)
			if off > localAgreesM {
				add(ProblemItem, itemsFile, it.ID, "%s: its map position is %.2f m from its position %s", it.ID, off, in)
			}
			// its front faces rotation_deg counter-clockwise from the drawings' -y,
			// which the building's bearing (the site's) turns to: on the map, clockwise
			// from north
			faces := f.Placement.Bearing + 180 - it.Local.Rotation
			if math.Abs(math.Remainder(it.Heading-faces, 360)) > headingAgreesDeg {
				add(ProblemItem, itemsFile, it.ID, "%s: its heading %.2f° is not the way it faces %s (%.2f°)",
					it.ID, it.Heading, in, math.Mod(math.Mod(faces, 360)+360, 360))
			}
		}
		if !slices.Contains(mounts, it.Mount) {
			add(ProblemValue, itemsFile, it.ID, "%s: mount %q is not floor, wall or ceiling", it.ID, it.Mount)
		}
		if !slices.Contains(categories, it.Category) {
			add(ProblemValue, itemsFile, it.ID, "%s: category %q is not one of the format's (%s)", it.ID, it.Category, strings.Join(ItemCategories, ", "))
		}
		geometryOf(it.ID, it.Geometry, itemsFile, false, add)
		if it.Geometry != nil && it.Geometry.Type != "Polygon" {
			add(ProblemGeometry, itemsFile, it.ID, "%s: an item's footprint is a Polygon, not a %s", it.ID, it.Geometry.Type)
		}
	}

	if c := p.Catalogue; c != nil { // a colour, category or mount left out is Studio's default
		file := p.file("catalogue")
		for _, ty := range c.Types {
			if ty.Color != "" && !colourRE.MatchString(ty.Color) {
				add(ProblemValue, file, ty.Code, "%s: type %s: colour %q is not #rrggbb", file, ty.Code, ty.Color)
			}
			if ty.Category != "" && !slices.Contains(categories, ty.Category) {
				add(ProblemValue, file, ty.Code, "%s: type %s: category %q is not one of the format's (%s)", file, ty.Code, ty.Category, strings.Join(ItemCategories, ", "))
			}
			if ty.Mount != "" && !slices.Contains(mounts, ty.Mount) {
				add(ProblemValue, file, ty.Code, "%s: type %s: mount %q is not floor, wall or ceiling", file, ty.Code, ty.Mount)
			}
			if ty.Workplaces < 0 || ty.Workplaces > maxWorkplaces {
				add(ProblemValue, file, ty.Code, "%s: type %s: workplaces %d is not 0 to %d", file, ty.Code, ty.Workplaces, maxWorkplaces)
			}
			if ty.Grade != nil && !slices.Contains(grades, *ty.Grade) {
				add(ProblemValue, file, ty.Code, "%s: type %s: grade %q is not one of %s", file, ty.Code, *ty.Grade, strings.Join(grades, ", "))
			}
			viewed(file, ty.Code, file+": type "+ty.Code, ty.ViewDeg, ty.RangeM)
		}
	}

	if n := p.navigation; n != nil {
		file := p.file("navigation")
		// (0.13) a layout's: on the layout, its links to its buildings' doors in their own packages
		level, layout := "floor", ""
		if p.IsLayout() {
			level, layout = "layout", *m.Scope.Layout
		}
		if (n.Layout == nil) != (layout == "") || (n.Layout != nil && *n.Layout != layout) {
			said := "none"
			if n.Layout != nil {
				said = *n.Layout
			}
			add(ProblemNavigation, file, said, "%s: its layout is %s, not the package's %s", file, said, layout)
		}
		for _, b := range n.Buildings {
			if kindOf(b) != "building" {
				add(ProblemNavigation, file, b, "%s: building %s is not in the package", file, b)
			}
		}
		prints := map[string]*string{}
		for _, f := range p.Footprints {
			prints[f.ID] = f.Building
		}
		nodes := map[string]*NavNode{}
		for i := range n.Nodes {
			node := &n.Nodes[i]
			if nodes[node.ID] != nil {
				add(ProblemNavigation, file, node.ID, "%s: node %s is there twice", file, node.ID)
			}
			nodes[node.ID] = node
			if kindOf(node.Floor) != level {
				add(ProblemNavigation, file, node.ID, "%s: node %s is on unknown %s %s", file, node.ID, level, node.Floor)
			}
			if node.Footprint != nil {
				if b, ok := prints[*node.Footprint]; !ok || !samePlace(b, node.Building) {
					add(ProblemNavigation, file, node.ID, "%s: entrance %s is into a building that does not stand on footprint %s",
						file, node.ID, *node.Footprint)
				}
			}
			for _, in := range []struct {
				id   *string
				kind string
			}{{node.Space, "space"}, {node.Zone, "zone"}} {
				if in.id != nil && kindOf(*in.id) != in.kind {
					add(ProblemNavigation, file, node.ID, "%s: node %s is in unknown %s %s", file, node.ID, in.kind, *in.id)
				}
			}
		}
		pairs := map[[2]string]bool{}
		for _, e := range n.Edges {
			if e.Kind == linkKind { // one end on the land, the other its building's door, in its own package
				land, far := nodes[e.To], e.From
				if land == nil {
					land, far = nodes[e.From], e.To
				}
				if layout == "" || land == nil || land.Footprint == nil || land.Opening == nil || land.Building == nil ||
					far != "door:"+*land.Opening || nodes[far] != nil || !strings.HasPrefix(*land.Opening, *land.Building+"-") {
					add(ProblemNavigation, file, e.From, "%s: the link from %s to %s does not join an entrance on the land to its building's door",
						file, e.From, e.To)
				}
			} else {
				for _, end := range []string{e.From, e.To} {
					if nodes[end] == nil {
						add(ProblemNavigation, file, end, "%s: an edge joins unknown node %s", file, end)
					}
				}
				if len(e.Path) < 2 {
					add(ProblemNavigation, file, e.From, "%s: the edge from %s to %s has no line", file, e.From, e.To)
				}
			}
			pair := [2]string{e.From, e.To}
			if pair[1] < pair[0] {
				pair = [2]string{e.To, e.From}
			}
			if pairs[pair] {
				add(ProblemNavigation, file, pair[0], "%s: two edges join %s and %s", file, pair[0], pair[1])
			}
			pairs[pair] = true
		}
	}

	// the floors' drawings (0.11): named by their floor's source, in the folder the
	// manifest lists, each a drawing view of a format this reader reads, in metres (the
	// building's own frame)
	folder, listed := m.Files["drawings"]
	named := map[string]bool{}
	for _, s := range m.Sources {
		if s.View != nil {
			named[*s.View] = true
		}
	}
	if len(named) > 0 && folder != DrawingsDir {
		add(ProblemDrawing, FileManifest, "", "the manifest's sources name drawings, but its files list %q for them, not %q", folder, DrawingsDir)
	} else if listed && len(named) == 0 {
		add(ProblemDrawing, FileManifest, "", "the manifest lists %s but no floor's source names a drawing in it", folder)
	}
	for _, floor := range sortedKeys(p.drawings) {
		d := p.drawings[floor]
		if want := DrawingsDir + floor + ".view"; d.file != want {
			add(ProblemDrawing, d.file, floor, "%s: floor %s's drawing is %s", d.file, floor, want)
		}
		if k := kindOf(floor); k != "floor" && k != "layout" { // (a layout's site plan, 0.12)
			add(ProblemDrawing, d.file, floor, "%s: the drawing of floor %s, which is not in the package", d.file, floor)
		}
		if d.err != nil {
			add(ProblemDrawing, d.file, floor, "%s: %v", d.file, d.err)
			continue
		}
		if h := d.header; h.Units == nil || *h.Units != "m" {
			units := "none"
			if h.Units != nil {
				units = *h.Units
			}
			add(ProblemDrawing, d.file, floor, "%s: in %q, not metres of the building's own frame", d.file, units)
		}
	}
	for _, name := range sortedKeys(p.files) {
		if strings.HasPrefix(name, DrawingsDir) && name != DrawingsDir && !named[name] {
			add(ProblemDrawing, name, "", "%s: no floor's source names it", name)
		}
	}

	unknown := map[string]bool{} // rows of a later format's kinds
	if p.files[objectsFile] {
		listed := map[string]bool{}
		for _, row := range p.Objects {
			if !knownKinds[row.Kind] {
				unknown[row.ID] = true
			} else if row.Kind != "project" {
				listed[row.ID] = true
			}
		}
		extra, missing := 0, 0
		for id := range listed {
			if _, ok := p.kinds[id]; !ok {
				extra++
			}
		}
		for id := range p.kinds {
			if !listed[id] {
				missing++
			}
		}
		if extra+missing > 0 {
			add(ProblemObjects, objectsFile, "", "%s: rows do not match the features (%d extra, %d missing)", objectsFile, extra, missing)
		}
	}

	if c := p.Changes; c != nil {
		for _, id := range append(append([]string(nil), c.Added...), c.Changed...) {
			if _, ok := p.kinds[id]; !ok && !unknown[id] {
				add(ProblemChanges, changesFile, id, "%s: %s is listed as added/changed but not in the package", changesFile, id)
			}
		}
		retired := map[string]bool{}
		for _, id := range append(append([]string(nil), c.Retired...), c.AllRetired...) {
			if _, ok := p.kinds[id]; ok && !retired[id] {
				add(ProblemChanges, changesFile, id, "%s: retired ID %s is still in the package", changesFile, id)
			}
			retired[id] = true
		}
		for _, mv := range c.MovedAway {
			if _, here := p.kinds[mv.ID]; here || !itemForm(mv.ID) {
				add(ProblemChanges, changesFile, mv.ID, "%s: %s is listed as moved away but is not an item gone from here", changesFile, mv.ID)
			}
			if _, here := p.kinds[mv.Building]; here || !strings.HasPrefix(mv.Building, project+"-") {
				add(ProblemChanges, changesFile, mv.ID, "%s: %s moved to %s, not another building (or a layout, 0.12) of the project",
					changesFile, mv.ID, mv.Building)
			}
			if retired[mv.ID] {
				add(ProblemChanges, changesFile, mv.ID, "%s: %s is listed both as moved away and as retired", changesFile, mv.ID)
			}
		}
		if prev := c.PreviousSequence; prev != nil && *prev >= c.Sequence {
			add(ProblemChanges, changesFile, "", "%s: previous_sequence %d is not before sequence %d", changesFile, *prev, c.Sequence)
		}
		if a, b := c.PreviousSequence, m.Export.PreviousSequence; (a == nil) != (b == nil) || (a != nil && *a != *b) {
			add(ProblemChanges, changesFile, "", "%s: previous_sequence does not match the manifest's", changesFile)
		}
		if c.Sequence != m.Export.Sequence {
			add(ProblemChanges, changesFile, "", "%s: sequence does not match the manifest", changesFile)
		}
	}
	return out
}

// geometryOf checks a feature's geometry is a polygon (or, for openings, a point).
func geometryOf(id string, g *Geometry, file string, point bool, add func(code, file, id, format string, args ...any)) {
	if point {
		if g == nil {
			add(ProblemGeometry, file, id, "%s: no geometry (an opening's is a Point)", id)
		} else if g.Type != "Point" {
			add(ProblemGeometry, file, id, "%s: an opening's geometry is a Point, not a %s", id, g.Type)
		}
		return
	}
	if g == nil {
		add(ProblemGeometry, file, id, "%s: no geometry", id)
	} else if _, err := g.Polygons(); err != nil {
		add(ProblemGeometry, file, id, "%s: %v", id, err)
	}
}

// versionRE: a format version as the format writes it: major.minor, a patch
// number if any, then a pre-release or build after - or + (ASCII only).
var versionRE = regexp.MustCompile(`^([0-9]+)\.([0-9]+)(\.[0-9]+)?([-+][0-9A-Za-z.-]+)?$`)

// parseVersion is a format version's major and minor numbers, ok false for what
// is not a format version. A number too large to hold is taken as the largest.
func parseVersion(version string) (major, minor int, ok bool) {
	m := versionRE.FindStringSubmatch(version)
	if m == nil {
		return 0, 0, false
	}
	number := func(s string) int {
		n, err := strconv.Atoi(s)
		if err != nil { // only too large, after the pattern
			return math.MaxInt
		}
		return n
	}
	return number(m[1]), number(m[2]), true
}

// CheckVersion says whether this module reads packages of a format version: what
// is not a format version (major.minor.patch) is refused, as is one of another
// major version, or (before 1.0, where a minor version may change what a package
// means, as 0.4's scope and 0.7's one building per package did) of a newer minor
// version, with a message to update the reader. Older versions, and newer patch
// versions (properties added), are read.
func CheckVersion(version string) error {
	major, minor, ok := parseVersion(version)
	if !ok {
		return fmt.Errorf("%q is not a format version (major.minor.patch)", clip(version))
	}
	ownMajor, ownMinor, _ := parseVersion(FormatVersion)
	if major != ownMajor {
		return fmt.Errorf("unsupported format version %s (this reader reads %d.x)", clip(version), ownMajor)
	}
	if ownMajor == 0 && minor > ownMinor {
		return fmt.Errorf("format version %s is newer than this reader's %s: update the reader to read it", clip(version), FormatVersion)
	}
	return nil
}

// ValidateAcross checks packages a system holds together (each is checked by
// Validate): an asset is one project's, so the same item ID in packages of two
// projects is a clash, not one item. Each is a problem (ITEM_ELSEWHERE) of the later
// package, in the order given: out[i] are pkgs[i]'s, and a package with any is to be
// refused. In packages of one project the same ID is the same item, carried from
// building to building.
func ValidateAcross(pkgs ...*Package) [][]Problem {
	type first struct{ project, at string }
	seen := map[string]first{}
	out := make([][]Problem, len(pkgs))
	for i, p := range pkgs {
		project := p.Manifest.Project.ID
		for _, it := range p.Items {
			f, ok := seen[it.ID]
			if !ok {
				seen[it.ID] = first{project, fmt.Sprintf("package %d", i+1)}
			} else if f.project != project {
				out[i] = append(out[i], Problem{Code: ProblemItemElsewhere, File: p.file("items"), ID: it.ID,
					Message: fmt.Sprintf("%s: an item of project %s too (%s): an item's ID is one project's",
						clip(it.ID), clip(f.project), f.at)})
			}
		}
	}
	return out
}

// minor is a format version's minor number ("0.7.0" → 7). What is not a format
// version is taken as the newest, so that every rule applies to it (and Validate
// reports it).
func minor(version string) int {
	_, n, ok := parseVersion(version)
	if !ok {
		return math.MaxInt
	}
	return n
}

func levelDepth(level string) int {
	for i, l := range levels {
		if l == level {
			return i + 1
		}
	}
	return 0
}

// sortedKeys is a map's keys in order, so problems come out the same every time.
func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
