// An item type's 3D model (format 0.9.2: models/<CODE>.glb, spec/FORMAT.md, "Models"): binary
// glTF of one mesh in the type's own frame — metres, +Y up, its front facing +Z, its middle at
// x = z = 0 and its bottom at y = 0 — with its colours in its vertices (COLOR_0, linear, as
// glTF has them) and how rough and metallic each part is (_FINISH). Read here into the arrays an
// item's template is made of (build.js): no three.js, nothing else read.

/** At most this many triangles a model: more is refused (Studio writes about 5,000). */
export const MODEL_TRIANGLES = 20000;

const GLB = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const SIZES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }; // a component's bytes, by its type
const PARTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const PLAIN = [153, 0]; // how rough and metallic a model is that does not say (build.js's FIN.plain)
let serial = 0;

/** A model file (an ArrayBuffer of binary glTF) read: {position (Float32Array, x y z each
 * vertex), color (Uint8Array, r g b each, 0–255 linear), finish (Uint8Array, roughness and
 * metalness each, 0–255), index (Uint32Array, three a triangle), vertices, triangles, min,
 * max ([x, y, z]: its box), id (this model's own, for a cache)}. Throws, saying why, when it
 * is not a model this reads: not binary glTF 2.0, needing an extension, its first mesh not
 * triangles with positions, data outside its buffer, more than MODEL_TRIANGLES. */
export function parseModel(data) {
  const bytes = data instanceof ArrayBuffer ? data : data?.buffer instanceof ArrayBuffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : null;
  if (!bytes || bytes.byteLength < 20) throw new Error("not binary glTF");
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== GLB) throw new Error("not binary glTF");
  if (view.getUint32(4, true) !== 2) throw new Error(`binary glTF version ${view.getUint32(4, true)}, not 2`);
  const length = Math.min(view.getUint32(8, true), bytes.byteLength);
  let json = null, bin = null;
  for (let at = 12; at + 8 <= length;) {
    const size = view.getUint32(at, true), kind = view.getUint32(at + 4, true), start = at + 8;
    if (start + size > length) throw new Error("a chunk runs past the end of the file");
    if (kind === JSON_CHUNK && !json) json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, start, size)));
    else if (kind === BIN_CHUNK && !bin) bin = new DataView(bytes, start, size);
    at = start + size + ((4 - (size % 4)) % 4);
  }
  if (!json) throw new Error("no JSON chunk");
  if (json.extensionsRequired?.length) throw new Error(`it needs ${json.extensionsRequired.join(", ")}, which this viewer does not read`);
  const mesh = json.meshes?.[0];
  if (!mesh?.primitives?.length) throw new Error("no mesh");

  const accessor = (k) => read(json, bin, k);
  const position = [], color = [], finish = [], index = [];
  let vertices = 0;
  for (const prim of mesh.primitives) {
    if ((prim.mode ?? 4) !== 4) throw new Error(`a part drawn as mode ${prim.mode}, not triangles`);
    const pos = prim.attributes?.POSITION === undefined ? null : accessor(prim.attributes.POSITION);
    if (!pos || pos.type !== "VEC3" || pos.componentType !== 5126) throw new Error("a part with no positions (POSITION, float x y z)");
    const n = pos.count;
    for (const v of pos.values) if (!Number.isFinite(v)) throw new Error("a position that is not a number");
    position.push(pos.values);
    color.push(colors(prim, n, accessor, json));
    finish.push(finishes(prim, n, accessor));
    if (vertices + n > 3 * MODEL_TRIANGLES) throw new Error(`more than ${3 * MODEL_TRIANGLES} vertices`);
    const ids = prim.indices === undefined ? null : accessor(prim.indices);
    if (ids && (ids.type !== "SCALAR" || ![5121, 5123, 5125].includes(ids.componentType))) throw new Error("indices that are not whole numbers");
    const idx = ids ? ids.values : Uint32Array.from({ length: n }, (_, i) => i);
    if (idx.length % 3) throw new Error("indices that are not whole triangles");
    for (const i of idx) if (!(i < n)) throw new Error("an index past its part's vertices");
    index.push(vertices ? idx.map((i) => i + vertices) : idx);
    vertices += n;
    if (index.reduce((s, a) => s + a.length, 0) / 3 > MODEL_TRIANGLES) throw new Error(`more than ${MODEL_TRIANGLES} triangles`);
  }
  const out = {
    position: join(Float32Array, position), color: join(Uint8Array, color), finish: join(Uint8Array, finish),
    index: join(Uint32Array, index), vertices, triangles: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity],
    id: ++serial,
  };
  out.triangles = out.index.length / 3;
  if (!out.triangles) throw new Error("no triangles");
  for (let j = 0; j < vertices * 3; j++) {
    const k = j % 3;
    out.min[k] = Math.min(out.min[k], out.position[j]);
    out.max[k] = Math.max(out.max[k], out.position[j]);
  }
  return out;
}

/** An accessor's values (``values``: a typed array, ``count`` elements of its type's parts),
 * from the binary chunk; refused when it is sparse or runs outside its buffer view. */
function read(json, bin, k) {
  const a = json.accessors?.[k];
  if (!a) throw new Error(`no accessor ${k}`);
  if (a.sparse) throw new Error("a sparse accessor");
  const parts = PARTS[a.type], size = SIZES[a.componentType];
  if (!parts || !size) throw new Error(`an accessor of ${a.type} ${a.componentType}`);
  const bv = json.bufferViews?.[a.bufferView];
  if (!bv || !bin || (bv.buffer ?? 0) !== 0 || json.buffers?.[0]?.uri !== undefined) throw new Error("data outside the file");
  const element = parts * size, stride = bv.byteStride || element, count = a.count | 0;
  const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0), viewEnd = (bv.byteOffset ?? 0) + bv.byteLength;
  if (count < 0 || viewEnd > bin.byteLength || (count && start + stride * (count - 1) + element > viewEnd)) {
    throw new Error("an accessor runs outside its buffer");
  }
  const get = {
    5120: (o) => bin.getInt8(o), 5121: (o) => bin.getUint8(o), 5122: (o) => bin.getInt16(o, true),
    5123: (o) => bin.getUint16(o, true), 5125: (o) => bin.getUint32(o, true), 5126: (o) => bin.getFloat32(o, true),
  }[a.componentType];
  const values = new (a.componentType === 5126 ? Float32Array : Uint32Array)(count * parts);
  for (let i = 0; i < count; i++) for (let p = 0; p < parts; p++) values[i * parts + p] = get(start + i * stride + p * size);
  return { values, count, type: a.type, componentType: a.componentType, normalized: Boolean(a.normalized), parts };
}

/** A part's vertex colours, 0–255 linear: COLOR_0 (float, or normalised bytes or shorts; an
 * alpha left out), else its material's base colour, else a grey. */
function colors(prim, n, accessor, json) {
  const out = new Uint8Array(n * 3);
  if (prim.attributes.COLOR_0 !== undefined) {
    const c = accessor(prim.attributes.COLOR_0);
    if (c.count !== n || (c.parts !== 3 && c.parts !== 4)) throw new Error("vertex colours (COLOR_0) that are not one each");
    const to255 = c.componentType === 5126 ? (v) => Math.round(Math.min(1, Math.max(0, v)) * 255)
      : c.componentType === 5121 ? (v) => v : c.componentType === 5123 ? (v) => Math.round(v / 257) : null;
    if (!to255) throw new Error("vertex colours (COLOR_0) of another kind");
    for (let i = 0; i < n; i++) for (let p = 0; p < 3; p++) out[i * 3 + p] = to255(c.values[i * c.parts + p]);
    return out;
  }
  const base = json.materials?.[prim.material]?.pbrMetallicRoughness?.baseColorFactor ?? [0.4, 0.4, 0.4, 1];
  const rgb = base.slice(0, 3).map((v) => Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 255));
  for (let i = 0; i < n; i++) out.set(rgb, i * 3);
  return out;
}

/** A part's finishes, roughness and metalness 0–255 each: _FINISH (normalised bytes), else plain. */
function finishes(prim, n, accessor) {
  const out = new Uint8Array(n * 2);
  if (prim.attributes._FINISH !== undefined) {
    const f = accessor(prim.attributes._FINISH);
    if (f.count === n && f.parts === 2 && f.componentType === 5121) {
      out.set(f.values);
      return out;
    }
  }
  for (let i = 0; i < n; i++) out.set(PLAIN, i * 2);
  return out;
}

function join(Type, arrays) {
  const out = new Type(arrays.reduce((s, a) => s + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}
