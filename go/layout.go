package storeypath

import (
	"math"
	"strings"
)

// A location's layout (format 0.12, spec/FORMAT.md "Location layouts") is its land: the
// plot its buildings stand on, as its site plan draws it, with its boundary walls and
// gates, the open ground between the buildings in areas (the yard, parking, a garden, the
// road beyond the boundary), the footprint of each building standing on it, and the items
// placed on it (cameras on poles, card readers at gates). It travels in a package of its
// own, beside its location's buildings' packages: IsLayout tells one, Layout gives its
// layout. Its areas are spaces on the layout's ID (SpacesOn), its gates openings of type
// gate (OpeningsOn), the items on it items of no building (ItemsOn, Item.OnLand), all of
// it in the site's frame (Frame, by the layout's ID). A building of the location stands
// on the site where its placement's Site says, in its own package.

// Layout is a location's layout (layout.geojson): its land, a level of the location, as a
// floor is of its building. Its geometry is its boundary, the plot (nil: none found).
type Layout struct {
	ID       string
	Geometry *Geometry
	// Code is its level's, LayoutCode (G00): its ID's last segment.
	Code     string `json:"code"`
	Name     string `json:"name"`
	Location string `json:"location_id"`
	// Area: the plot's (m²); nil when not known.
	Area  *float64 `json:"area_m2"`
	Label *LonLat  `json:"display_point"`
	// Walls: the boundary walls and fences, and walls standing on the land, as drawn,
	// with their gates' gaps (nil: none); WallHeight high and WallThickness thick (m).
	Walls         *Geometry `json:"walls"`
	WallThickness *float64  `json:"wall_thickness_m"`
	WallHeight    *float64  `json:"wall_height_m"`
	// North: which way north is on the site plan; nil when the package does not say.
	North *North `json:"north"`
}

// North is which way north is on a site plan (format 0.12).
type North struct {
	// Bearing: the compass bearing the site plan's up faces, degrees clockwise from
	// north (the site's placement's).
	Bearing float64 `json:"bearing"`
	// From: how it is known, NorthFromMap, NorthFromDrawing or NorthFromPerson; nil:
	// not known, up taken as north.
	From *string `json:"from"`
}

// How a site plan's north is known (North.From).
const (
	NorthFromMap     = "map"     // the site placed on the map
	NorthFromDrawing = "drawing" // the site plan's north arrow
	NorthFromPerson  = "person"  // set by a person
)

// northFroms: the values North.From may have.
var northFroms = []string{NorthFromMap, NorthFromDrawing, NorthFromPerson}

// Footprint is a building standing on a location's layout (footprints.geojson): its
// outline as the site plan draws it (often its roof, wider than its walls), a Polygon or
// MultiPolygon. A footprint is where a building stands, not the building: a system keys
// its buildings to Building, and finds their rooms in their own packages.
type Footprint struct {
	ID       string
	Geometry *Geometry
	Layout   string `json:"layout_id"`
	// Building: the building of the location standing on it, in a package of its own;
	// nil: none of the project's, or not said yet.
	Building *string `json:"building_id"`
	// Name: what the site plan names it, as read; DrawingLabel: its texts as written
	// (never corrected), a key to match on beside the ID.
	Name         *string `json:"name"`
	DrawingLabel *string `json:"drawing_label"`
	Area         float64 `json:"area_m2"`
	Label        LonLat  `json:"display_point"`
	// Site: its building's placement's Site, where the building's own frame lies on the
	// site; nil without one (always, for a footprint of no building).
	Site    *SiteFrame `json:"site"`
	Hidden  bool       `json:"hidden"`
	Ignored bool       `json:"ignored"`
}

// SiteFrame is where a building's own frame lies on its location's site (format 0.12):
// its origin at (X, Y) of the site's frame (metres from the site's centre, y the site
// plan's up), turned Rotation degrees clockwise.
type SiteFrame struct {
	X        float64 `json:"x_m"`
	Y        float64 `json:"y_m"`
	Rotation float64 `json:"rotation_deg"`
}

// ToSite is where a point (x, y) of the building's own frame is on its site: (X + x cos r
// + y sin r, Y − x sin r + y cos r), metres of the site's frame (where the layout's
// placement puts them on the map, as the building's own placement does).
func (s SiteFrame) ToSite(x, y float64) (float64, float64) {
	sin, cos := math.Sincos(s.Rotation * math.Pi / 180)
	return s.X + x*cos + y*sin, s.Y - x*sin + y*cos
}

// FromSite is a point of the site's frame in the building's own frame: ToSite undone.
func (s SiteFrame) FromSite(x, y float64) (float64, float64) {
	sin, cos := math.Sincos(s.Rotation * math.Pi / 180)
	dx, dy := x-s.X, y-s.Y
	return dx*cos - dy*sin, dx*sin + dy*cos
}

// LocalToSite is an item's position in its building (Item.Local) on the site: its middle
// there, and the way its front faces (degrees counter-clockwise, as Local's, 0 to 360).
func (s SiteFrame) LocalToSite(l ItemLocal) ItemLocal {
	x, y := s.ToSite(l.X, l.Y)
	return ItemLocal{X: x, Y: y, Rotation: math.Mod(math.Mod(l.Rotation-s.Rotation, 360)+360, 360)}
}

// IsLayout says whether the package holds a location's layout in place of a building
// (format 0.12: its scope's Layout). It holds no building: read none in it.
func (p *Package) IsLayout() bool { return p.Manifest.Scope != nil && p.Manifest.Scope.Layout != nil }

// Layout is the location's layout the package holds (format 0.12): the one its scope
// names, else the first of layout.geojson; nil for a building's package.
func (p *Package) Layout() *Layout {
	if p.IsLayout() {
		if l, ok := p.byID[*p.Manifest.Scope.Layout].(*Layout); ok {
			return l
		}
	}
	if len(p.Layouts) > 0 {
		return p.Layouts[0]
	}
	return nil
}

// Footprint finds a footprint by its ID (nil when there is none).
func (p *Package) Footprint(id string) *Footprint { f, _ := p.byID[id].(*Footprint); return f }

// FootprintOf is the footprint a building stands on (format 0.12): the first of the
// layout's that names the building; nil when none does.
func (p *Package) FootprintOf(buildingID string) *Footprint {
	for _, f := range p.Footprints {
		if f.Building != nil && *f.Building == buildingID {
			return f
		}
	}
	return nil
}

// locationOf is the location an ID is of (its first two segments), or the ID itself
// when it is not one a location can be read from.
func locationOf(id string) string {
	if pid, err := ParseID(id); err == nil {
		if loc, err := pid.Prefix(LevelLocation); err == nil {
			return loc
		}
	}
	return id
}

// codeOf is an ID's last segment, as written.
func codeOf(id string) string { return id[strings.LastIndex(id, "-")+1:] }
