// Small geometry for drawing a way: lengths along a line, a point so far along it, and
// a line through screen points with its corners rounded (as a path, with its length).

import type { XY } from "./types.js";
import { round } from "./geometry.js";

/** How far along a line each of its points is (the first 0). */
export function along(points: XY[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    out.push(out[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return out;
}

/** The point `s` along a line (its lengths from `along`), the way it goes there (a unit
 * vector), and the segment it is on. */
export function pointAt(points: XY[], lengths: number[], s: number): { at: XY; dir: XY; i: number } {
  const n = points.length;
  if (n === 0) return { at: [0, 0], dir: [1, 0], i: 0 };
  if (n === 1) return { at: [points[0]![0], points[0]![1]], dir: [1, 0], i: 0 };
  const total = lengths[n - 1]!;
  const t = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < n - 1 && lengths[i]! < t) i++;
  // a segment of no length: the way of the next one that has some
  let k = i;
  while (k < n - 1 && lengths[k]! - lengths[k - 1]! < 1e-9) k++;
  const a = points[i - 1]!, b = points[i]!;
  const span = lengths[i]! - lengths[i - 1]!;
  const f = span > 1e-9 ? (t - lengths[i - 1]!) / span : 0;
  const da = points[k - 1]!, db = points[k]!;
  const len = Math.hypot(db[0] - da[0], db[1] - da[1]) || 1;
  return { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], dir: [(db[0] - da[0]) / len, (db[1] - da[1]) / len], i };
}

/** Points without those closer than `min` to the last one kept (the last always kept). */
export function thinned(points: XY[], min = 0.75): XY[] {
  if (points.length < 3) return points.slice();
  const out: XY[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!, q = out[out.length - 1]!;
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= min) out.push(p);
  }
  const last = points[points.length - 1]!, q = out[out.length - 1]!;
  if (out.length > 1 && Math.hypot(last[0] - q[0], last[1] - q[1]) < min) out[out.length - 1] = last;
  else out.push(last);
  return out;
}

/** A line through points (screen pixels) as SVG path data, each corner rounded with a
 * curve of up to `radius` (never more than a little under half of either side, so that
 * two corners close together do not overlap), and its length. Points straight on are
 * left as they are. */
export function rounded(points: XY[], radius: number): { d: string; length: number } {
  const n = points.length;
  if (n === 0) return { d: "", length: 0 };
  const p = (q: XY): string => `${round(q[0])},${round(q[1])}`;
  if (n === 1) return { d: `M${p(points[0]!)}`, length: 0 };
  let d = `M${p(points[0]!)}`;
  let length = 0;
  let from = points[0]!;
  for (let i = 1; i < n - 1; i++) {
    const a = points[i - 1]!, b = points[i]!, c = points[i + 1]!;
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (ab < 1e-6 || bc < 1e-6) continue;
    const u: XY = [(b[0] - a[0]) / ab, (b[1] - a[1]) / ab], v: XY = [(c[0] - b[0]) / bc, (c[1] - b[1]) / bc];
    const turn = Math.abs(u[0] * v[1] - u[1] * v[0]);
    const r = Math.min(radius, ab * 0.45, bc * 0.45);
    if (turn < 0.02 || r < 0.5) continue; // straight on, or too short a corner to round
    const enter: XY = [b[0] - u[0] * r, b[1] - u[1] * r], leave: XY = [b[0] + v[0] * r, b[1] + v[1] * r];
    length += Math.hypot(enter[0] - from[0], enter[1] - from[1]) + curveLength(enter, b, leave);
    d += `L${p(enter)}Q${p(b)} ${p(leave)}`;
    from = leave;
  }
  const last = points[n - 1]!;
  length += Math.hypot(last[0] - from[0], last[1] - from[1]);
  d += `L${p(last)}`;
  return { d, length };
}

/** A quadratic curve's length, near enough (eight chords). */
function curveLength(a: XY, c: XY, b: XY): number {
  let sum = 0, prev = a;
  for (let k = 1; k <= 8; k++) {
    const t = k / 8, s = 1 - t;
    const q: XY = [s * s * a[0] + 2 * s * t * c[0] + t * t * b[0], s * s * a[1] + 2 * s * t * c[1] + t * t * b[1]];
    sum += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
    prev = q;
  }
  return sum;
}

/** Eased: slow out of the start and into the end. */
export const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Eased: quick off, slowing to the end. */
export const easeOut = (t: number): number => 1 - (1 - t) ** 3;
