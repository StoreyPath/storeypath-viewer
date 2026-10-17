package storeypath

import (
	"errors"
	"fmt"
	"sort"
)

// A way across a location's site (format 0.13, spec/FORMAT.md "Routes across a site"): a
// layout's package has its land's walking network, whose entrances are linked to the doors
// of the buildings standing on it, each in its own package. A Site puts the layout's
// network and its buildings' together, and finds a way on them as Route does in one
// building: from a gate, a kiosk or a point on the land into a building, to a room or an
// item, or from a room in one building to a room in another by the land.
//
//	site, err := storeypath.NewSite(layout, house, annex)
//	way, err := site.Route(gateID, officeID, storeypath.RouteOptions{})
//	way.Steps // "Start at the pedestrian gate", …, "Go into Main house", …
//
// Each way into or out of a building is a Change of its own, By "entrance" (Direction "in"
// or "out"), and a Step "enter" or "leave"; the Legs on the land are in the site's frame,
// those on a floor in its building's.

// ErrNotLayout: a site is put together from a layout's package (Package.IsLayout).
var ErrNotLayout = errors.New("not a layout's package")

// Site is a location's site's walking network: its layout's and its buildings' as one.
// It may be used from several goroutines at once.
type Site struct {
	nav   *Navigation
	items map[string][2]*string
}

// NewSite puts a layout's package and its buildings' packages together (of the same export
// run): every node, edge and place of each, the layout's floor first, then each building's
// floors in order of the building's ID. A link from an entrance on the land joins a
// building where its package is given (and has that door); a building not given is not
// reached. ErrNotLayout when layout is not a layout's package; ErrNoNavigation when a
// package has no walking network (the layout's of 0.12 has none).
func NewSite(layout *Package, buildings ...*Package) (*Site, error) {
	if layout == nil || !layout.IsLayout() {
		return nil, ErrNotLayout
	}
	if layout.navigation == nil {
		return nil, fmt.Errorf("%w: the layout's", ErrNoNavigation)
	}
	navs := make([]*Navigation, 0, len(buildings))
	for i, b := range buildings {
		if b == nil || b.navigation == nil {
			return nil, fmt.Errorf("%w: building package %d", ErrNoNavigation, i+1)
		}
		navs = append(navs, b.navigation)
	}
	first := func(n *Navigation) string {
		if len(n.Buildings) > 0 {
			return n.Buildings[0]
		}
		return ""
	}
	sort.SliceStable(navs, func(i, j int) bool { return first(navs[i]) < first(navs[j]) })
	land := layout.navigation
	merged := &Navigation{SpeedMS: land.SpeedMS, Layout: land.Layout, Buildings: []string{}}
	for _, n := range append([]*Navigation{land}, navs...) {
		merged.Buildings = append(merged.Buildings, n.Buildings...)
		merged.Floors = append(merged.Floors, n.Floors...)
		merged.Places = append(merged.Places, n.Places...)
		merged.Nodes = append(merged.Nodes, n.Nodes...)
		merged.Edges = append(merged.Edges, n.Edges...)
	}
	sort.Strings(merged.Buildings)
	items := map[string][2]*string{}
	for _, p := range append([]*Package{layout}, buildings...) {
		for _, it := range p.Items {
			if _, seen := items[it.ID]; !seen {
				items[it.ID] = [2]*string{it.Zone, it.Space}
			}
		}
	}
	return &Site{nav: merged, items: items}, nil
}

// Navigation is the site's networks as one (a way's nodes and places are in it).
func (s *Site) Navigation() *Navigation { return s.nav }

// Route is the way across the site from one place to another: each a node's ID, a
// space's or zone's (a building's room, or an area of the land), an opening's (a gate's,
// a door's), or an item's (a kiosk's own node; any other, where it stands), in any of the
// packages. As Navigation.Route, errors wrap ErrNoRoute when there is none (none without
// stairs or steps, with Accessible), ErrNotInNetwork for what none of them has.
func (s *Site) Route(from, to string, opts RouteOptions) (*Route, error) {
	return s.nav.route(from, to, opts.Accessible, s.items)
}

// RouteFrom is the way from a point on the land (x, y metres of the site's frame) to a
// place: from the land's node nearest it (Nearest), whose ID is the way's From.
func (s *Site) RouteFrom(x, y float64, to string, opts RouteOptions) (*Route, error) {
	from, err := s.Nearest(x, y)
	if err != nil {
		return nil, err
	}
	return s.Route(from, to, opts)
}

// Nearest is the land's node nearest a point of the site (metres of the site's frame): of
// its rooms, approaches, kiosks, gates and entrances, by straight distance; of those as
// near, the first by ID. ErrNotInNetwork when the site has no land.
func (s *Site) Nearest(x, y float64) (string, error) {
	return s.nav.nearest(x, y)
}

// nearest: Site.Nearest, on a network (a layout's, or a site's). Products are rounded on
// their own (float64(…)), never fused with what they are added to, as in every reader.
func (n *Navigation) nearest(x, y float64) (string, error) {
	g := n.prepared()
	best, bestD := "", 0.0
	if n.Layout != nil {
		for id, node := range g.nodes {
			if node.Floor != *n.Layout || !landNodes[node.Kind] {
				continue
			}
			dx, dy := node.Local.X-x, node.Local.Y-y
			d := float64(dx*dx) + float64(dy*dy)
			if best == "" || d < bestD || (d == bestD && id < best) {
				best, bestD = id, d
			}
		}
	}
	if best == "" {
		return "", fmt.Errorf("%w: no land in the network, so no point on it", ErrNotInNetwork)
	}
	return best, nil
}

// SiteRoute is the way across a location's site from one place to another, on its
// layout's package and its buildings' packages: NewSite, then Site.Route.
func SiteRoute(layout *Package, buildings []*Package, from, to string, opts RouteOptions) (*Route, error) {
	site, err := NewSite(layout, buildings...)
	if err != nil {
		return nil, err
	}
	return site.Route(from, to, opts)
}
