// Declarations of view.js: reading a drawing view (spec/DRAWING-VIEW.md).

/** The make-up this reader reads (the head's `format`). */
export declare const DRAWING_VIEW_FORMAT: 1;
/** Metres in a unit, by the head's `units`: mm, cm, m, in, ft. */
export declare const UNIT_METRES: Readonly<Record<string, number>>;
/** How many points each batch's kind takes: two a line, three a triangle, one a point. */
export declare const BATCH_POINTS: Readonly<{ lines: 2; fills: 3; points: 1 }>;

/** A box: [x0, y0, x1, y1], in the view's coordinates. */
export type Box = [number, number, number, number];

export interface DrawingLayer {
  name: string;
  /** Its colour in the drawing (#rrggbb), or null. */
  color: string | null;
  /** How many things are drawn on it. */
  count: number;
  /** Off or frozen in the drawing: drawn, and hidden until shown. */
  off: boolean;
}

/** Lines, fills or points of one layer in one colour: points [first, first + count) of the
 * kind's array. */
export interface DrawingBatch {
  kind: "lines" | "fills" | "points";
  layer: number;
  color: number;
  first: number;
  count: number;
}

/** A view's head (spec/DRAWING-VIEW.md): what it holds and where. A reader ignores keys it
 * does not know. */
export interface DrawingViewHead {
  format: 1;
  /** What the arrays' coordinates are from: add it back for the view's coordinates. */
  origin: [number, number];
  /** The grid the points are kept to, in the view's units. */
  grid: number;
  /** Where anything at all is drawn, every stray included. */
  bounds: Box;
  /** Where most of it is: what is fitted to a window. */
  body: Box;
  /** The box a floor's part was cut to (a package's: metres of the building's own frame), or null. */
  clip?: Box | null;
  /** Its ground in a CAD program (#rrggbb): its own colours are for it. */
  background: string;
  /** The view's units: mm, cm, m, in or ft (a package's: m), or null when not known. */
  units: string | null;
  layers: DrawingLayer[];
  /** Layers of the drawing with nothing on them. */
  empty_layers: number;
  /** The colours, #rrggbb or #rrggbbaa (a tint). */
  colors: string[];
  batches: DrawingBatch[];
  /** Each text's words, in the order of the texts' arrays. */
  words: string[];
  counts: { lines: number; triangles: number; points: number; texts: number; entities: number };
  /** Where each array is after the head: [offset, length] in bytes. */
  arrays: Record<"lines" | "fills" | "points" | "texts" | "styles", [number, number]>;
  [key: string]: unknown;
}

/** A drawing view read: its head and its arrays, coordinates from the head's origin. */
export interface DrawingViewData {
  head: DrawingViewHead;
  /** x, y; two points a line. */
  lines: Float32Array;
  /** x, y; three points a triangle. */
  fills: Float32Array;
  /** x, y. */
  points: Float32Array;
  /** Eight a text: x, y where its first line's baseline starts; a, b, c, d its turn and
   * stretch (a point u along it and v up from it, of letters one unit tall, is at
   * x + a·u + c·v, y + b·u + d·v); its cap height; its width as the drawing sets it (0: not known). */
  texts: Float32Array;
  /** Two a text: its layer and its colour (indices into the head's lists). */
  styles: Uint16Array;
}

/** A drawing view read from its bytes: gzip (as a package and Studio hold it), or unzipped. */
export declare function readDrawingView(source: ArrayBuffer | Uint8Array | Blob): Promise<DrawingViewData>;
/** A drawing view fetched and read. */
export declare function fetchDrawingView(url: string | URL, options?: {
  onProgress?: ((got: number, total: number) => void) | null;
  signal?: AbortSignal;
}): Promise<DrawingViewData>;
/** A view unzipped, read and checked. */
export declare function parseDrawingView(unzipped: Uint8Array | ArrayBuffer): DrawingViewData;
/** The lines on a layer, [x0, y0, x1, y1] each, in the view's coordinates. */
export declare function linesOn(view: DrawingViewData, layer: string): [number, number, number, number][];
/** The texts: their words, where each starts (the view's coordinates), its cap height and layer. */
export declare function textsOf(view: DrawingViewData): { words: string; at: [number, number]; height: number; layer: string | null }[];
