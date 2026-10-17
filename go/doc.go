// Package storeypath reads StoreyPath packages (*.storeypath): the buildings,
// floors, spaces, zones and openings of a project, with their stable IDs, and the
// furniture and equipment on its floors (items, and the catalogue of their types),
// its walking network, and what its rooms' floors and walls are finished in
// (Finishes), as StoreyPath Studio exports them. See spec/FORMAT.md in the StoreyPath
// repository.
//
// A system that consumes packages keeps its own records and IDs and links each to
// a StoreyPath ID: Open reads a package, Validate checks it, and the lookups give
// the floors of a building, the spaces of a floor, the zones of a space and the
// units people are placed in (a space's zones where it has them, otherwise the
// space). LocalFrame turns the package's longitude and latitude back into the
// local drawing metres Studio works in, and ParseID takes an ID apart. Route
// finds the way from one place in a building to another (a kiosk to an office), the
// same way every StoreyPath reader finds it, with its line on each floor and its
// steps; with RouteOptions.Accessible, on lifts and ramps alone. Drawing gives a
// floor's drawing as drawn, when the package carries the drawings (format 0.11):
// its bytes for a viewer, and its head.
//
// A location's layout (format 0.12), its land, comes in a package of its own: IsLayout
// tells one and Layout gives it, with its areas, gates and items on the layout's ID
// (SpacesOn, OpeningsOn, ItemsOn), its Footprints (the buildings standing on it), and
// Frame by the layout's ID the site's frame they are in. A building's Placement.Site
// says where its own frame lies on that site (SiteFrame.ToSite). From format 0.13 the
// layout's package has its land's walking network, linked to its buildings' at their
// entrances: NewSite puts them together, and Site.Route (SiteRoute) finds the way across
// the site, from a gate into a building or from one building to another.
//
// The module uses only Go's standard library, so it can be pinned and vendored
// into an offline build.
package storeypath
