// A drawing view (spec/DRAWING-VIEW.md): a drawing as its own program shows it, every
// line, fill, point and text of it, packed small for a browser to draw. StoreyPath Studio
// makes one of a whole drawing for its drawing viewer, and a package may carry each
// floor's part of its drawing (spec/FORMAT.md, "Drawings", format 0.11). No
// dependencies: in a browser, or in Node 18 and later.

/** The make-up this reader reads (the head's `format`). */
export const DRAWING_VIEW_FORMAT = 1;

const MAGIC = "SPDV";
/** Metres in a unit, by the head's `units`. */
export const UNIT_METRES = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };
/** How many points each batch's kind takes: two a line, three a triangle, one a point. */
export const BATCH_POINTS = { lines: 2, fills: 3, points: 1 };

/**
 * A drawing view read: its head (JSON) and its arrays, each put back together from its
 * byte planes. ``source``: the file's bytes, gzip as a package and Studio hold it, or
 * already unzipped. A view of another format, or one that is not a view, is refused.
 * @param {ArrayBuffer | Uint8Array | Blob} source
 * @returns {Promise<DrawingViewData>}
 */
export async function readDrawingView(source) {
  let bytes = source instanceof Blob ? new Uint8Array(await source.arrayBuffer())
    : source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzip(bytes);
  return parseDrawingView(bytes);
}

/**
 * A drawing view fetched from ``url`` and read: ``onProgress(got, total)`` as it comes
 * (total 0 when not known), ``signal`` to stop it. A server answering with an error's
 * JSON ({"error": …}) has it said.
 */
export async function fetchDrawingView(url, { onProgress = null, signal = undefined } = {}) {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `${res.status} ${res.statusText}`);
  }
  const total = Number(res.headers.get("content-length")) || 0;
  const chunks = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(got, total);
  }
  return readDrawingView(new Blob(chunks));
}

/** A view's bytes, unzipped (DecompressionStream: no library). */
async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A view unzipped: its head and its arrays. Every array is checked to lie within the
 * file and to be whole, every batch within its array, and a text for each word and style.
 * @param {Uint8Array | ArrayBuffer} unzipped
 * @returns {DrawingViewData}
 */
export function parseDrawingView(unzipped) {
  const bytes = unzipped instanceof Uint8Array ? unzipped : new Uint8Array(unzipped);
  if (bytes.length < 8 || String.fromCharCode(...bytes.subarray(0, 4)) !== MAGIC) {
    throw new Error("this is not a drawing's view");
  }
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  if (8 + n > bytes.length) throw new Error("the drawing's view is cut short");
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + n)));
  if (head.format !== DRAWING_VIEW_FORMAT) {
    throw new Error(`the drawing's view is of format ${head.format}, this viewer reads ${DRAWING_VIEW_FORMAT}: update it`);
  }
  const start = 8 + n;
  const array = (name, Kind, width) => {
    const [at, size] = head.arrays?.[name] ?? [];
    if (!(Number.isInteger(at) && Number.isInteger(size) && at >= 0 && size >= 0 && start + at + size <= bytes.length)
      || size % (Kind.BYTES_PER_ELEMENT * width)) {
      throw new Error(`the drawing's view is damaged (its ${name})`);
    }
    return new Kind(together(bytes.subarray(start + at, start + at + size), Kind.BYTES_PER_ELEMENT).buffer);
  };
  const view = {
    head, lines: array("lines", Float32Array, 2), fills: array("fills", Float32Array, 2),
    points: array("points", Float32Array, 2), texts: array("texts", Float32Array, 8), styles: array("styles", Uint16Array, 2),
  };
  const texts = view.texts.length / 8;
  if (view.styles.length / 2 !== texts || head.words.length !== texts) throw new Error("the drawing's view is damaged (its texts)");
  for (const b of head.batches) {
    const of = view[b.kind];
    if (!of || b.first < 0 || b.count < 0 || 2 * (b.first + b.count) > of.length || b.count % BATCH_POINTS[b.kind]
      || !head.layers[b.layer] || head.colors[b.color] === undefined) {
      throw new Error("the drawing's view is damaged (its batches)");
    }
  }
  return view;
}

/** Bytes stored a byte at a time (every number's first byte, then every second…) as numbers
 * of ``size`` bytes again, little-endian. */
function together(planes, size) {
  const n = planes.length / size, out = new Uint8Array(planes.length);
  for (let b = 0; b < size; b++) {
    const plane = planes.subarray(b * n, (b + 1) * n);
    for (let i = 0, j = b; i < n; i++, j += size) out[j] = plane[i];
  }
  return out;
}

/** The lines of a view on a layer (by its name), as [x0, y0, x1, y1] in the view's own
 * coordinates (its origin added back): for a reader that wants the drawing's geometry, not
 * a picture of it. */
export function linesOn(view, layer) {
  const i = view.head.layers.findIndex((l) => l.name === layer);
  const [ox, oy] = view.head.origin, out = [];
  for (const b of view.head.batches) {
    if (b.kind !== "lines" || b.layer !== i) continue;
    for (let p = b.first; p < b.first + b.count; p += 2) {
      const at = 2 * p, l = view.lines;
      out.push([l[at] + ox, l[at + 1] + oy, l[at + 2] + ox, l[at + 3] + oy]);
    }
  }
  return out;
}

/** The texts of a view as their words, where each starts (its origin added back) and its
 * layer's name. */
export function textsOf(view) {
  const [ox, oy] = view.head.origin, t = view.texts;
  return view.head.words.map((words, i) => ({ words, at: [t[8 * i] + ox, t[8 * i + 1] + oy], height: t[8 * i + 6],
    layer: view.head.layers[view.styles[2 * i]]?.name ?? null }));
}
