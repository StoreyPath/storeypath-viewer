// The way's small pictures, drawn by line (24 × 24, to be stroked 2 wide with round
// ends, as Lucide's icons are): how a way changes floor, and which way. The plan draws
// them in its floor-change badges; a page may draw the same in its list of steps.

export const ROUTE_GLYPHS: Readonly<Record<string, string>> = {
  /** Steps going up to the right. */
  stairs: "M3 20h5v-5h5v-5h5V5h3",
  /** A car with its two arrows. */
  lift: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9.5 10 12 7.5 14.5 10M9.5 14 12 16.5 14.5 14",
  /** A moving stair: flat, up, flat. */
  escalator: "M3 19h4l9-11h5M8.5 14.5h3M12 10.5h3",
  /** A slope. */
  ramp: "M3 19h18V9L3 19z",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
};

/** The picture for a way of changing floor ("lift", "stairs", …): the stairs' for one
 * not known. */
export const glyphOf = (by: string): string => ROUTE_GLYPHS[by] ?? ROUTE_GLYPHS.stairs!;
