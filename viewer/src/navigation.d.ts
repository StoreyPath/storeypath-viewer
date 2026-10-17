// Declarations of navigation.js: a package's walking network (navigation.json, format
// 0.8) and the way on it, as spec/FORMAT.md ("Navigation (0.8)") describes them; a way
// across a location's site, its layout's network and its buildings' together ("Routes
// across a site", 0.13).

/** A point in a building's own frame (a layout's: the site's), metres: [x, y]. */
export type NavPoint = [number, number];

export interface NavFloor {
	id: string;
	/** Null for a layout (0.13): the land. */
	building_id: string | null;
	name: string;
	ordinal: number;
	elevation: number;
}

/** A space or zone a way goes through or to, and what a step calls it; on a layout
 * (0.13), an area, a gate (kind opening) or a building standing on it (kind footprint). */
export interface NavPlace {
	id: string;
	kind: 'space' | 'zone' | 'opening' | 'footprint';
	/** A zone's space. */
	space_id: string | null;
	floor_id: string;
	type: string;
	/** "OFFICE 112", "Room 114", "the corridor". */
	label: string;
}

export type NavNodeKind = 'door' | 'entrance' | 'approach' | 'room' | 'kiosk' | 'lift' | 'stairs' | 'escalator' | 'ramp' | 'gate';
export type NavEdgeKind = 'walk' | 'door' | 'lift' | 'stairs' | 'escalator' | 'ramp' | 'link';

export interface NavNode {
	/** Made from what it is: door:<opening>, approach:<opening>@<space>, room:<space or zone>,
	 * kiosk:<item>, lift:<object code>@<floor>, … */
	id: string;
	kind: NavNodeKind | string;
	floor_id: string;
	space_id: string | null;
	zone_id: string | null;
	/** Where it is in its building's own frame, metres. */
	local: { x_m: number; y_m: number };
	lonlat: [number, number];
	opening_id?: string | null;
	/** A door's: the spaces it joins (one, for an entrance). */
	spaces?: string[] | null;
	item_id?: string | null;
	/** A lift's, stairs', escalator's or ramp's stack. */
	stack?: string | null;
	/** (0.13) A layout's entrance's: the footprint its building stands on. */
	footprint_id?: string | null;
	/** (0.13) A layout's entrance's: the building it leads into. */
	building_id?: string | null;
	/** (0.13) A layout's entrance's: a step into the building there (true), none (false), or not known (null). */
	steps?: boolean | null;
	/** (0.13) A layout's entrance's: how far the building's floor stands above the ground there, metres. */
	rise_m?: number | null;
}

export interface NavEdge {
	from: string;
	to: string;
	kind: NavEdgeKind | string;
	length_m: number;
	seconds: number;
	/** What routing takes the fewest of: seconds, and more for a way into a room not for passing through. */
	cost: number;
	/** False for stairs and escalators, and for a link where a step is known. */
	accessible: boolean;
	space_id: string | null;
	zone_id: string | null;
	/** Its line from `from` to `to`, in the building's frame (a layout's: the site's); a link's is empty. */
	path: NavPoint[];
}

/** navigation.json. */
export interface Navigation {
	speed_m_s: number;
	/** (0.13) A layout's package's: the layout's ID, the floor of its land. */
	layout?: string | null;
	buildings: string[];
	/** Lowest first. */
	floors: NavFloor[];
	places: NavPlace[];
	nodes: NavNode[];
	edges: NavEdge[];
}

/** The walking on one floor between rides from floor to floor: the line to draw. */
export interface RouteLeg {
	floor_id: string;
	points: NavPoint[];
	metres: number;
}

/** A ride from floor to floor; or (0.13, by "entrance") a way into a building from the land, or out. */
export interface RouteChange {
	by: 'lift' | 'stairs' | 'escalator' | 'ramp' | 'entrance' | string;
	from_floor_id: string;
	to_floor_id: string;
	from_node: string;
	to_node: string;
	/** How many of the building's floors apart (0 through an entrance). */
	floors: number;
	direction: 'up' | 'down' | 'in' | 'out';
}

export interface StartStep {
	kind: 'start';
	node: string;
	node_kind: string;
	place: string | null;
	floor_id: string;
	text: string;
}
export interface WalkStep {
	kind: 'walk';
	floor_id: string;
	/** Whole metres. */
	metres: number;
	/** The place most of it is in. */
	along: string | null;
	/** The next ride's kind, or "destination". */
	to: string;
	/** The destination, when `to` is "destination". */
	place: string | null;
	text: string;
}
export interface TakeStep {
	kind: 'take';
	by: string;
	from_floor_id: string;
	to_floor_id: string;
	floors: number;
	direction: 'up' | 'down';
	text: string;
}
/** (0.13) Into a building from the land ("enter"), or out of it ("leave"). */
export interface EnterStep {
	kind: 'enter' | 'leave';
	building_id: string | null;
	/** The building's footprint on the land (a place of the layout's network). */
	place: string | null;
	from_floor_id: string;
	to_floor_id: string;
	text: string;
}
export interface ArriveStep {
	kind: 'arrive';
	place: string | null;
	floor_id: string;
	side: 'left' | 'right' | 'ahead' | 'here';
	text: string;
}
/** What to tell a person: a kind, its values, and its text in English. */
export type RouteStep = StartStep | WalkStep | TakeStep | EnterStep | ArriveStep;

/** A way, as every reader of the format finds it. */
export interface Route {
	from: string;
	to: string;
	accessible: boolean;
	/** Its nodes' IDs, in order. */
	nodes: string[];
	metres: number;
	seconds: number;
	/** One more than the changes: the walking on each floor (on a layout, in the site's frame). */
	legs: RouteLeg[];
	changes: RouteChange[];
	steps: RouteStep[];
}

/** A package's walking network, ready to route on. */
export declare class Graph {
	constructor(nav: Navigation);
	readonly nav: Navigation;
	/** (0.13) A layout's ID: the floor of the land; null without one. */
	readonly layout: string | null;
	readonly nodes: Map<string, NavNode>;
	readonly places: Map<string, NavPlace>;
	readonly floors: Map<string, NavFloor>;
	/** Each floor's place in the building, lowest first. */
	readonly order: Map<string, number>;
	readonly adjacent: Map<string, [string, NavEdge][]>;
	/** The nodes a place is (a node's, space's, zone's or item's ID); throws for one it does not know. */
	ends(ref: string, items?: Map<string, { properties?: { space_id?: string | null; zone_id?: string | null } }> | null): string[];
	/** The zone, else the space, a node is in (a door's first space; a gate itself). */
	placeOf(id: string): string | null;
	/** (0.13) The land's node nearest a point of the site (metres of its frame); throws without land. */
	nearest(x: number, y: number): string;
	/** What a step calls a place. */
	label(place: string | null): string;
}

/** What route() takes: a package (its `navigation`, and its `items` for a way to an
 * item), navigation.json itself, or a Graph. */
export type Routable = Graph | Navigation | { navigation?: Navigation | null; items?: { id: string }[] | null };

export interface RouteOptions {
	/** On lifts and ramps alone: no stairs or escalators. */
	accessible?: boolean;
	/** The items to find an item's place in (default: the package's). */
	items?: Iterable<{ id: string }> | Map<string, unknown> | null;
}

/** The way from `from` to `to` (a node's, space's, zone's or item's ID), or null when
 * there is none. Throws for an ID the network does not know, or a package without a
 * network. */
export declare function route(pkg: Routable, from: string, to: string, options?: RouteOptions): Route | null;

/** The cheapest way's nodes from any of `sources` to any of `targets`, or null. */
export declare function shortest(graph: Graph, sources: string[], targets: string[], accessible?: boolean): string[] | null;

/** A point on a location's land, in the site's frame (metres): [x, y] or { x_m, y_m }. */
export type LandPoint = [number, number] | { x_m: number; y_m: number };

/** A layout's or a building's package (its `navigation`, its `items`), or navigation.json itself. */
export type SitePart = Navigation | { navigation?: Navigation | null; items?: { id: string }[] | null };

/** (0.13) A site's walking network: its layout's and its buildings' as one. */
export declare function siteGraph(layout: SitePart, buildings?: Iterable<SitePart>): Graph;

/** (0.13) The way across a location's site: from a gate, a kiosk, an area or a point on its
 * land, or a room or item in one of its buildings, to any of those; null when there is none.
 * Throws for what the networks do not know. */
export declare function siteRoute(layout: SitePart | Graph, buildings: Iterable<SitePart> | null,
	from: string | LandPoint, to: string | LandPoint, options?: RouteOptions): Route | null;
