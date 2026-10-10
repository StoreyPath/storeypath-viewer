// Declarations of @storeypath/viewer-world (dist/world.js): StoreyPath's 3D
// world and the package reader it opens packages with. Feature properties are
// as spec/FORMAT.md describes them.

export { webglSupport, type WebGLSupport } from './support.js';
// finding the way (format 0.8): the module both viewers share
export { route, shortest, Graph } from './navigation.js';
export { ITEM_ID_ALPHABET, itemCheckSymbol, isItemId, normalizeItemId } from './ids.js';
export type { Navigation, NavEdge, NavFloor, NavNode, NavPlace, Route, RouteChange, RouteLeg, RouteStep, RouteOptions,
	Routable } from './navigation.js';
import type { Navigation, Route, RouteStep } from './navigation.js';

/** One of StoreyPath's finishes (format 0.9, spec/finishes.json). */
export interface Finish {
	code: string;
	applies: 'floor' | 'wall';
	group: string;
	name: string;
	name_ar: string;
	/** Its colour on the whole, #rrggbb. */
	tone: string;
	roughness: number;
	/** The metres its painted image covers a side, and what the viewer paints it with. */
	size_m: number;
	paint: { kind: string } & Record<string, unknown>;
}

/** StoreyPath's finishes: the floors and walls a room may be given, with each type's defaults. */
export declare const FINISHES: {
	version: number;
	exterior: string;
	groups: { code: string; applies: 'floor' | 'wall'; name: string; name_ar: string }[];
	finishes: Finish[];
	defaults: { floor: Record<string, string>; wall: Record<string, string> };
};
/** A finish by its code, or null. */
export declare function finishOf(code: string | null | undefined): Finish | null;
/** The finish a type of room has when it is given none (an unknown type: as `unspecified`). */
export declare function defaultFinish(applies: 'floor' | 'wall', type: string | null | undefined): string;
/** The floor finish a space or zone shows (its own, else its space's, else its type's), from properties. */
export declare function floorFinish(props: Record<string, unknown> | null, space?: Record<string, unknown> | null): string;
/** The finish of a space's walls (its own, else its type's), from its properties. */
export declare function wallFinish(props: Record<string, unknown> | null): string;
/** The finish of walls' faces outside every room. */
export declare const EXTERIOR: string;

export declare const FORMAT: 'storeypath-package';
/** The format version this viewer reads, any patch of it. */
export declare const FORMAT_VERSION: string;
export declare const SUPPORTED_MAJOR_VERSION: number;
/** Default colour of each space type (CSS colours). */
export declare const TYPE_COLORS: Readonly<Record<string, string>>;

export type LonLat = [number, number];

export interface Geometry {
	type: string;
	coordinates: unknown;
}

/** A GeoJSON feature of a package: a location, building, floor, space, zone or opening. */
export interface Feature<P = Record<string, unknown>> {
	type: 'Feature';
	id: string;
	geometry: Geometry | null;
	properties: P;
}

/** A piece of furniture or equipment (items.geojson, format 0.6). Its ID is an asset's
 * tag (format 0.8: 7K2Q-XM9F-4DP, isItemId), not its place nor its project's. Where it stands is
 * `local` (format 0.7), in its building's own frame; its point and heading on the
 * map follow from that and the building's placement. */
export interface ItemProperties {
	kind: 'item';
	/** A code of the catalogue (DESK-MANAGER, COPIER, …). */
	type: string;
	category: 'furniture' | 'equipment' | 'appliance';
	/** Its type's English name. */
	name: string;
	floor_id: string;
	building_id: string;
	/** Where its middle stands: null when in none. */
	space_id: string | null;
	zone_id: string | null;
	/** Where it stands in its building (format 0.7; absent before): its middle in metres
	 * of the building's drawings, and the way its front faces, degrees counter-clockwise
	 * from their -y. What it is placed by: moving the building on the map leaves it as it is. */
	local?: { x_m: number; y_m: number; rotation_deg: number } | null;
	display_point: LonLat;
	/** The way its front faces (where a desk's user sits), degrees clockwise from north. */
	heading: number;
	width_m: number;
	depth_m: number;
	height_m: number;
	mount: 'floor' | 'wall' | 'ceiling';
	/** Its bottom above the floor; null for one on the ceiling (just under it). */
	elevation_m: number | null;
	/** Its details entered in StoreyPath, by the catalogue's field keys. */
	values: Record<string, string | number>;
}

/** A detail the items of a type carry, and who enters it: StoreyPath, or the system that manages the asset. */
export interface ItemField {
	key: string;
	name_en: string;
	name_ar: string;
	kind: 'text' | 'number' | 'choice' | 'color';
	choices: string[];
	owner: 'storeypath' | 'system';
}

/** A type of item (catalogue.json). */
export interface ItemType {
	code: string;
	name_en: string;
	name_ar: string;
	category: 'furniture' | 'equipment' | 'appliance';
	/** Metres: along its front, front to back, and tall. */
	width: number;
	depth: number;
	height: number;
	mount: 'floor' | 'wall' | 'ceiling';
	elevation: number | null;
	/** #rrggbb */
	color: string;
	fields: ItemField[];
	retired: boolean;
}

export interface Catalogue {
	format: 'storeypath-catalogue';
	format_version: number;
	types: ItemType[];
}

export interface Manifest {
	format: 'storeypath-package';
	format_version: string;
	project: { id: string; name: string };
	files: Record<string, string>;
	/** Only some of the project's buildings (format 0.4); from 0.7 always the one building
	 * the package holds; absent: all of them. */
	scope?: { buildings: string[] } | null;
	[key: string]: unknown;
}

/** A package as read: its features, and ways to find them. */
export declare class StoreyPathPackage {
	constructor(
		manifest: Manifest,
		collections: {
			location: Feature[];
			buildings: Feature[];
			floors: Feature[];
			spaces: Feature[];
			openings: Feature[];
			zones?: Feature[];
			items?: Feature<ItemProperties>[];
			catalogue?: Catalogue | null;
			navigation?: Navigation | null;
		},
		/** The archive (a JSZip), for the files read only when needed: the pre-built 3D. */
		zip?: unknown
	);
	readonly manifest: Manifest;
	readonly locations: Feature[];
	readonly buildings: Feature[];
	readonly floors: Feature[];
	/** What walls and doors enclose. */
	readonly spaces: Feature[];
	/** The parts of open spaces, with no wall between them. */
	readonly zones: Feature[];
	readonly openings: Feature[];
	/** What is used: the zones of divided spaces and the other spaces. */
	readonly units: Feature[];
	/** Furniture and equipment (format 0.6; none in older packages). */
	readonly items: Feature<ItemProperties>[];
	/** The types of items, or null when the package has none. */
	readonly catalogue: Catalogue | null;
	/** The building's walking network (navigation.json, format 0.8), or null: `route(pkg, from, to)` finds the way on it. */
	readonly navigation: Navigation | null;
	readonly project: { id: string; name: string };
	/** The feature with this ID, or null. */
	get(id: string): Feature | null;
	/** The buildings the package holds when it is part of a project (from 0.7, always one), or null for the whole project. */
	readonly scope: string[] | null;
	/** Whether the package holds a building: always for the whole project; for a part, when it is in the scope. */
	holds(buildingId: string): boolean;
	/** Floors of a building, lowest first. */
	floorsOf(buildingId: string): Feature[];
	spacesOn(floorId: string): Feature[];
	zonesOf(spaceId: string): Feature[];
	unitsOn(floorId: string): Feature[];
	/** The items on a floor: an item's ID says nothing of where it is, its properties do. */
	itemsOn(floorId: string): Feature<ItemProperties>[];
	/** An item type of the catalogue by its code (an item's `type`), or null. */
	itemType(code: string): ItemType | null;
	groundFloor(buildingId: string): Feature | null;
	hierarchy(id: string): {
		project: { id: string; name: string };
		location: Feature | null;
		building: Feature | null;
		floor: Feature | null;
		object: Feature | null;
	};
	doorsOf(spaceId: string): { door: Feature; space: Feature | null }[];
	search(query?: string, options?: { type?: string; buildingId?: string; floorId?: string; limit?: number }): Feature[];
	/** Whether a floor comes pre-built in 3D (format 0.5: world/<floor-id>.glb). */
	hasWorld(floorId: string): boolean;
	/** A floor's pre-built 3D as binary glTF, or null when the package has none. */
	world(floorId: string): Promise<ArrayBuffer | null>;
}

/** Read a package from a URL, Blob, File or ArrayBuffer. A package of a format version
 * this viewer does not read is refused (see checkVersion). */
export declare function loadPackage(source: string | URL | Blob | ArrayBuffer | Uint8Array): Promise<StoreyPathPackage>;
/** Throws when this viewer does not read packages of a format version: one that is not
 * a version, one of another major version, or (before 1.0) one of a newer minor version
 * than FORMAT_VERSION, saying to update the viewer. Older ones, and newer patches, are read. */
export declare function checkVersion(version: unknown): void;

export interface WorldOptions {
	/** Floor slab thickness, m (0.22). */
	slab?: number;
	/** Door head above the floor, m (2.1). */
	doorHead?: number;
	windowSill?: number;
	windowHead?: number;
	/** When the package does not say, m (0.2). */
	wallThickness?: number;
	/** Walls are cut to this in the cutaway view, m (1.25). */
	cutHeight?: number;
	/** Metres between floors in the dollhouse view (0). */
	explode?: number;
	/** Room labels (true). */
	labels?: boolean;
	/** Spaces hidden or ignored in review (false). */
	showHidden?: boolean;
	/** Furniture and equipment: shown, not drawn at all, or (null, the default) shown when one floor is. */
	items?: boolean | null;
	/** Fog colour (default: the look's). */
	fog?: number;
	/** The look ("real"). */
	style?: WorldStyle;
	/** The quality ("auto"). */
	quality?: WorldQuality;
	/** Walking: a shut door opens when walked into ("auto"), or stays shut until opened ("manual"). */
	doors?: DoorMode;
}

/** Doors when walking: "auto", a shut door opens when the walker walks into it; "manual", it stays
 * shut until opened (a click or E at it, or `setDoorOpen`). */
export type DoorMode = 'auto' | 'manual';

/** A door as a floor's plan has it (local metres, x east, z south). */
export interface WorldDoor {
	/** Its opening's ID. */
	id: string;
	/** As asked: it may be swinging still. Doors start open, as the plan draws them. */
	open: boolean;
	/** Swinging now. */
	moving: boolean;
	/** Jamb to jamb, along the middle of its wall: shut, the walker bumps into it there. */
	span: [[number, number], [number, number]];
	/** Each leaf where it is now: [hinge, free edge]. */
	leaves: [[number, number], [number, number]][];
}

export type WorldMode = 'dollhouse' | 'walk';
/** "real": real but clean (floors finished by room type, plaster walls, soft shadows); "model": an
 * architectural model (white clay, floors tinted by room type, lines along edges). */
export type WorldStyle = 'real' | 'model';
/** "high": ambient occlusion, multisampling, finer shadows and finishes; "low": none of them, for weak
 * graphics; "auto": Low on a software, virtual or integrated renderer, or when High draws slowly at first. */
export type WorldQuality = 'auto' | 'high' | 'low';

/** How a world is drawn. */
export interface WorldLook {
	style: WorldStyle;
	/** As asked. */
	quality: WorldQuality;
	/** As drawn. */
	drawn: 'high' | 'low';
	/** Why auto chose Low: its renderer is a software, virtual or integrated one, or High drew slowly. */
	why: 'software' | 'virtual' | 'integrated' | 'slow' | null;
}

export interface WorldEvents {
	load: { package: StoreyPathPackage };
	buildingchange: { id: string };
	floorchange: { id: string | null };
	modechange: { mode: WorldMode };
	/** A space, zone or item chosen (by a click or `select`), or none. An item's feature has `kind: 'item'` (ItemProperties). */
	select: { id: string | null; feature: Feature | null };
	/** The walker went into another space. */
	roomchange: { id: string | null; type: string | null; name: string | null; number: string | null; stairs: boolean };
	walklock: { locked: boolean };
	/** A click on the dollhouse view, or walking with the mouse taken (at the crosshair): what is
	 * there, and walking, the door within reach there (`door`). Cancelable: unless a listener calls
	 * preventDefault, what was clicked is selected (walking, at a door: the door opened or shut). */
	pick: WorldPoint & { door: string | null; button: number; altKey: boolean; shiftKey: boolean };
	/** A door asked to open or shut (by the walker, walking into it, or the page): it swings. */
	doorchange: { id: string; open: boolean; floor: string };
	/** Walking: the door within reach at the crosshair changed, or what it would do (`open`: as it
	 * is now); `id` null when none. */
	dooraim: { id: string | null; open: boolean | null };
	/** An item carried across its floor (setDraggable): where it is dragged, on its floor's level. */
	itemdragstart: ItemDrag;
	itemdrag: ItemDrag;
	itemdragend: ItemDrag & { cancelled: boolean };
	/** Floors built again by `reload`. */
	reload: { floors: string[] };
	/** The look or quality changed (setStyle, setQuality, or auto choosing Low). */
	lookchange: WorldLook;
	/** A step of the way shown (showStep), or the camera going along it got to one. */
	routestep: RouteStepDetail;
	/** Going along the way (playRoute, flyRoute): how far it has got, each frame. */
	routeprogress: RouteProgressDetail;
	/** Going along the way began, paused, went on, ended (got there) or stopped. */
	routeplay: { state: 'playing' | 'paused' | 'ended' | 'stopped' };
}

/** A step of a way: its index in `steps`, the step, the leg it is on and that leg's floor. */
export interface RouteStepDetail {
	index: number;
	step: RouteStep | null;
	leg: number;
	floor_id: string | null;
}

/** How far going along a way has got: metres walked of `total` (rides take none). */
export interface RouteProgressDetail {
	metres: number;
	total: number;
	fraction: number;
	leg: number;
	step: number | null;
	floor_id: string | null;
}

/** How a way is drawn in 3D (showRoute). */
export interface WorldRouteOptions {
	/** The camera goes along it (flyRoute) once it is drawn. */
	fly?: boolean;
	/** The camera frames the whole way. */
	fit?: boolean;
	/** It rises in from its start to its end (default: true; never when reduced motion is asked for). */
	animate?: boolean;
	/** Its start's tag ("You are here"); none by default. */
	startLabel?: string | null;
	/** Its end's card: by default its room's name and floor ("OFFICE 205 · Floor 2"); null: none (the room's own label shows). */
	endLabel?: string | null;
	/** A floor's name, for its tags (default: its name in the package). */
	floorName?: (floorId: string) => string;
	/** Its colours (CSS colours, as a page has them; by default the plan viewer's): its core, its rim (`casing`),
	 * its chevrons (`arrow`), its start's, its end's. */
	color?: string;
	casing?: string;
	arrow?: string;
	start?: string;
	end?: string;
}

/** A point of the world, as `pointAt` finds it. */
export interface WorldPoint {
	floor: string | null;
	/** Local metres: x east, z south. */
	x: number | null;
	z: number | null;
	/** The same point in the building's own frame: [x, y], metres of its drawings (null without a placement). */
	local: [number, number] | null;
	/** The space or zone it is in. */
	space: string | null;
	/** The space it is in (a zone's space): aimed at a wall, the room on that side of it. */
	room: string | null;
	/** The item in the way, if any. */
	item: string | null;
	/** Whether a wall (or the wall over or under an opening) was met first. */
	wall: boolean;
}

export interface ItemDrag {
	id: string;
	floor: string;
	x: number | null;
	z: number | null;
	local: [number, number] | null;
	altKey: boolean;
	shiftKey: boolean;
}

/** An item as `setFloorItems` and `ghost` take it: where it stands in the building's own frame
 * (metres of its drawings; rotation: degrees counter-clockwise, its front its own -y), and what
 * is not its type's in the package's catalogue. */
export interface GivenItem {
	id?: string;
	type: string;
	x: number;
	y: number;
	rotation?: number;
	width?: number;
	depth?: number;
	height?: number;
	mount?: 'floor' | 'wall' | 'ceiling';
	elevation?: number | null;
	/** #rrggbb */
	color?: string;
	grade?: string | null;
}

/** A floor's plan in local metres (x east, z south), for a minimap. */
export interface WorldPlan {
	walls: [number, number][][];
	spaces: { id: string; type: string; name: string | null; rings: [number, number][][] }[];
	/** The floor's furniture and equipment: each footprint's corners, and its type's colour. */
	items: { id: string; type: string; mount: 'floor' | 'wall' | 'ceiling'; color: string; ring: [number, number][] }[];
	/** What the walker bumps into besides the items and the shut doors: walls and windows, [x1, z1, x2, z2] each. */
	obstacles: [number, number, number, number][];
	/** The floor's doors with leaves, as they are now. */
	doors: WorldDoor[];
	bounds: unknown;
}

/** A building of a package as a 3D world: the dollhouse view, or a walk through it. */
export declare class StoreyPathWorld extends EventTarget {
	/** `container`: an element or a selector. Needs WebGL 2 (see `webglSupport`). */
	constructor(container: string | HTMLElement, options?: WorldOptions);
	readonly package: StoreyPathPackage | null;
	readonly building: string | null;
	/** The floor shown on its own, or null for all. */
	readonly floor: string | null;
	readonly mode: WorldMode;
	readonly selected: string | null;
	readonly room: unknown;
	readonly walking: boolean;
	readonly atStairs: boolean;
	readonly walkFloor: string | null;
	readonly player: { x: number; z: number; dx: number; dz: number; floor: string | null };
	/** The floors shown from the package's pre-built 3D (world/), not built here. */
	readonly prebuilt: string[];
	/** three.js objects, for anything else (`renderer.info.render.calls`: the draw calls of the last frame). */
	readonly camera: unknown;
	readonly renderer: unknown;
	readonly scene: unknown;
	/** Open a package (URL, Blob, File or ArrayBuffer) and show its first building:
	 * its floors pre-built in the package (world/) where they match, the others built here. */
	open(source: string | URL | Blob | ArrayBuffer | Uint8Array): Promise<StoreyPathPackage>;
	/** Show a building; resolves once it is shown: at once, unless its pre-built floors are still to be read. */
	setBuilding(id: string): Promise<void>;
	/** Show one floor, or all with null. */
	setFloor(id: string | null): void;
	/** Walking starts at the front door, or `at` (local metres; the nearest room's middle when in
	 * none), on `floor`, facing `heading`; back to the dollhouse, round the whole building, or with
	 * `back`, where the view was before walking. */
	setMode(mode: WorldMode, options?: { at?: { x: number; z: number }; floor?: string; heading?: number; back?: boolean }): void;
	/** In the walk view, take the mouse to look around (call from a click). */
	startWalking(): void;
	/** Give the mouse back, still walking. */
	stopWalking(): void;
	/** Where the dollhouse view looks (the point it turns around), local metres. */
	readonly target: { x: number; z: number };
	/** Stop drawing for a while (the world kept); `resume` draws again at once. */
	pause(): void;
	resume(): void;
	readonly paused: boolean;
	/** The look: materials, lights and passes change; nothing is built again. */
	setStyle(style: WorldStyle): void;
	/** The quality: "auto" (the default), "high" or "low". */
	setQuality(quality: WorldQuality): void;
	/** How it is drawn now. */
	readonly look: WorldLook;
	/** Resolves once the look is drawn as it will stay: its finishes painted, its passes loaded. */
	ready(): Promise<void>;
	/** Read the package again and build only these floors again (default: all of the building
	 * shown), keeping the view, mode, floor shown, selection and walker. */
	reload(source: string | URL | Blob | ArrayBuffer | Uint8Array, options?: { floors?: string[] }): Promise<StoreyPathPackage>;
	/** A point of the building's own frame ([x, y], metres of its drawings) in the world, and back
	 * (null when the package does not place the building: before format 0.7). */
	worldPoint(point: [number, number]): { x: number; z: number } | null;
	buildingPoint(point: { x: number; z: number }): [number, number] | null;
	/** What is under a point of the screen (client pixels), or the crosshair when walking with the
	 * mouse taken (or given none): quick enough to follow the pointer. */
	pointAt(clientX?: number, clientY?: number): WorldPoint | null;
	/** Replace one floor's furniture and equipment without building anything else again. */
	setFloorItems(floorId: string, items: GivenItem[]): boolean;
	/** Where an item would go, see-through (red when `ok` is false), with the magnet's guides
	 * ([[x, y], [x, y]] each, building frame); null takes it away. */
	ghost(spec: (GivenItem & { floor?: string; ok?: boolean; guides?: [[number, number], [number, number]][] }) | null): void;
	/** Items carried across their floor by a drag in the dollhouse view (itemdrag… events). */
	setDraggable(on: boolean): void;
	readonly draggable: boolean;
	/** A space or zone corrected: its label at once, its finishes in place (format 0.9: its
	 * floor's triangles, its walls' faces, in their finishes before the next frame; nothing
	 * built again), its floor built again when its type or whether it is shown changed. */
	updateSpace(id: string, props: { name?: string | null; number?: string | null; type?: string; hidden?: boolean; ignored?: boolean;
		floor_finish?: string | null; wall_finish?: string | null }): boolean;
	/** What a space's or zone's floor and walls are in, as shown (codes of FINISHES), or null. */
	finishOf(id: string): { floor: string; wall: string } | null;
	setXray(on: boolean): void;
	setCutaway(on: boolean): void;
	setLabels(on: boolean): void;
	setShowHidden(on: boolean): void;
	setExplode(meters: number): void;
	/** Furniture and equipment: shown (true), not drawn at all (false), or (null, the default) shown when one
	 * floor is shown: detailed on one floor, a box each on more. */
	setItems(on: boolean | null): void;
	/** Whether furniture and equipment are drawn now. */
	readonly items: boolean;
	/** Shut a door (`open` false) or open it, by its ID: it swings about its hinge, unless `instant`.
	 * Shut, it is in the walker's way. Whether the world has that door (one with a leaf, in the
	 * building shown). A view's state: never in the package. */
	setDoorOpen(id: string, open: boolean, options?: { instant?: boolean }): boolean;
	/** Whether a door is open (as asked), or null for no such door. */
	doorOpen(id: string): boolean | null;
	/** Open a door if shut, shut it if open: its new state, or null for no such door. */
	toggleDoor(id: string): boolean | null;
	/** Doors when walking: "auto" (the default) or "manual". */
	setDoors(mode: DoorMode): void;
	readonly doors: DoorMode;
	/** Walking: the door within reach at the crosshair (a click or E opens or shuts it), or null. */
	readonly aimedDoor: { id: string; open: boolean } | null;
	/** Highlight a space, zone or item (null: none); `go` (default true) takes the view to it. */
	select(id: string | null, options?: { go?: boolean }): void;
	/** Up (+1) or down (−1) a floor from where the walker stands. */
	changeFloor(step: number): boolean;
	toLocal(lonlat: LonLat): { x: number; z: number };
	plan(floorId: string): WorldPlan | null;
	/** The way shown (showRoute), or null. */
	readonly route: Route | null;
	/** Draw a way (as `route()` finds it, format 0.8): a softly glowing ribbon a little over each floor it walks
	 * on, chevrons flowing along it the way it goes; a glowing column through each lift or stairs, an arrow up or
	 * down on it; a ring pulsing at its start, a pin over its end, its room lit, and their tags; seen through what
	 * is in front of it. It rises in from its start (`animate`). Over the whole building the floors it does not
	 * walk on fade back, those above it are left out, and on a way of several floors those but the one it is at
	 * fade too; rooms' labels other than its own are not shown meanwhile. Null: none. With `fit`, the camera frames
	 * it; with `fly`, it goes along it, resolving when it is there. */
	showRoute(route: Route | null, options?: WorldRouteOptions): Promise<void>;
	/** Take the way away (and stop going along it). */
	clearRoute(): void;
	/** Show a step of the way (`steps`): its leg's floor clear, the way's others faded, the camera framing it (the
	 * start, a walk, the lift or stairs between both floors, the destination); "routestep". */
	showStep(index: number, options?: { animate?: boolean }): void;
	/** Show a leg of the way whole, its floor clear. */
	showLeg(index: number, options?: { animate?: boolean }): void;
	/** The step shown, or the one the camera going along the way is at; null for none. */
	readonly routeStep: number | null;
	/** Take the camera along the way shown, in the dollhouse view of the whole building: just behind and above,
	 * looking ahead, slower at turns; at each lift or stairs it stops and rides up or down with the column to the
	 * next floor; it ends framing the destination. About `seconds` long (default: as long as the way is, 8 to
	 * 20 s); at once when reduced motion is asked for. Resolves when it is there, or stopped. */
	flyRoute(options?: { seconds?: number }): Promise<void>;
	/** As flyRoute, or on from where pauseRoute left it (unless `restart`). */
	playRoute(options?: { seconds?: number; restart?: boolean }): Promise<void>;
	/** Pause going along the way (the view the page's meanwhile). */
	pauseRoute(): void;
	/** Stop going along the way. */
	stopRoute(): void;
	/** "playing" or "paused" while going along the way, else null. */
	readonly routePlay: 'playing' | 'paused' | null;
	/** Stop drawing and free the GPU; the container is emptied. */
	destroy(): void;
	addEventListener<K extends keyof WorldEvents>(
		type: K,
		listener: (event: CustomEvent<WorldEvents[K]>) => void,
		options?: boolean | AddEventListenerOptions
	): void;
	addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
	removeEventListener<K extends keyof WorldEvents>(
		type: K,
		listener: (event: CustomEvent<WorldEvents[K]>) => void,
		options?: boolean | EventListenerOptions
	): void;
	removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
}
