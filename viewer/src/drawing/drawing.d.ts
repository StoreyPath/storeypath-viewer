// Declarations of drawing.js: the drawing view, in an element of the page.

import type { Box, DrawingLayer, DrawingViewData, DrawingViewHead } from "./view.js";

export * from "./view.js";

export type DrawingLook = "cad" | "print";
export declare const LOOKS: readonly DrawingLook[];

/** Something to outline on the drawing: a plan found on a sheet, a part read as a floor. */
export interface DrawingMark {
  /** Short, on the drawing. */
  label: string;
  /** When the pointer is on it. */
  title?: string;
  /** Where it is, in the view's coordinates; null: not outlined. */
  region: Box | null;
  [key: string]: unknown;
}

export interface DrawingViewOptions {
  look?: DrawingLook;
  /** The drawing's units (mm, cm, m, in, ft), for metres, when the view's own are not to be trusted. */
  units?: string | null;
  marks?: DrawingMark[];
  /** A mark clicked: it is a button then. */
  onPick?: ((mark: DrawingMark) => void) | null;
  /** What a click on a mark does ("Choose"). */
  pickLabel?: string;
  /** False: it only follows setCamera (a plan's backdrop); the pointer goes through it. Default true. */
  interactive?: boolean;
  /** A CSS colour, or "transparent"; default: the look's (the drawing's own ground in CAD, white in Print). */
  background?: string | null;
  /** False: its texts are not written. */
  texts?: boolean;
  /** What a screen reader says it is. */
  label?: string;
}

/** The view: the point of the drawing at the middle of the element (the view's
 * coordinates), and CSS px a unit. */
export interface DrawingCamera {
  x: number;
  y: number;
  k: number;
}

export interface DrawingCursor {
  x: number;
  y: number;
  /** Where it is in metres, when the units are known. */
  metres: [number, number] | null;
}

export interface DrawingViewEvents {
  load: CustomEvent<{ head: DrawingViewHead }>;
  camerachange: CustomEvent<DrawingCamera>;
  cursor: CustomEvent<DrawingCursor | null>;
  markhover: CustomEvent<{ mark: DrawingMark | null }>;
  pick: CustomEvent<{ mark: DrawingMark }>;
  contextlost: CustomEvent<null>;
}

export declare class DrawingView extends EventTarget {
  constructor(container: HTMLElement | string, options?: DrawingViewOptions);
  readonly container: HTMLElement;
  /** The element it draws in (.sp-drawing), filling the container. */
  readonly root: HTMLElement;
  readonly look: DrawingLook;
  /** The view open, or null. */
  readonly view: DrawingViewData | null;
  readonly head: DrawingViewHead | null;
  readonly metresPerUnit: number | null;
  readonly layers: (DrawingLayer & { shown: boolean })[];
  /** Open a view: its URL, its bytes (gzip, as a package holds it), or a view read already. */
  open(source: string | URL | Blob | ArrayBuffer | Uint8Array | DrawingViewData, options?: {
    onProgress?: ((got: number, total: number) => void) | null;
    signal?: AbortSignal;
  }): Promise<this>;
  setLook(look: DrawingLook): void;
  setLayer(layer: number | string, shown: boolean): void;
  setLayers(shown: boolean): void;
  setMarks(marks: DrawingMark[]): void;
  /** A box (the view's coordinates) fitted to the element; without one, the main body. */
  fit(box?: Box | null): void;
  fitMark(mark: DrawingMark): void;
  getCamera(): DrawingCamera;
  /** Look where another view looks: drawn at once. */
  setCamera(camera: DrawingCamera): void;
  toDrawing(point: [number, number]): [number, number];
  toScreen(point: [number, number]): [number, number];
  zoomBy(factor: number, at?: [number, number]): void;
  panBy(dx: number, dy: number): void;
  /** A round length in metres about ``px`` long, for a scale bar; null when the units are not known. */
  scale(px?: number): { px: number; metres: number; label: string } | null;
  /** A key for the drawing (+, -, 0, F, the arrows): whether it was one. */
  key(event: KeyboardEvent): boolean;
  /** Its size changed (a ResizeObserver calls it). */
  resize(): void;
  destroy(): void;
  addEventListener<K extends keyof DrawingViewEvents>(type: K, listener: (event: DrawingViewEvents[K]) => void,
    options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
}
