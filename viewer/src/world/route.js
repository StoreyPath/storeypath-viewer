// A way through the building in 3D (world.js's showRoute): its line over each floor, a
// soft glowing ribbon with chevrons flowing along it the way it goes; a glowing column
// through the lift or stairs between floors, an arrow on it up or down; a pulsing ring
// at its start and a pin over its end, the destination's room lit; and the camera's
// tour along it (flyRoute). All drawn here, cheaply: a few meshes, their shaders
// animated by a uniform or two a frame.

import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

/** Sizes, in metres: the ribbon's width (its glow) and core's share of it, its height
 * over the floor, its chevrons' spacing and speed, the column's radius. */
export const ROUTE_SIZE = { width: 1.25, core: 0.44, lift: 0.14, chevron: 1.7, flow: 1.1, column: 0.24, corner: 0.8 };

// ---- the line ------------------------------------------------------------------------

/** Points [x, z] with each corner rounded (a curve of up to `radius` metres, never more
 * than a little under half of either side), as points close enough to look smooth. */
export function smoothed(points, radius = ROUTE_SIZE.corner) {
  const n = points.length;
  if (n < 3) return points.map((p) => [p[0], p[1]]);
  const out = [[points[0][0], points[0][1]]];
  for (let i = 1; i < n - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (ab < 1e-6 || bc < 1e-6) continue;
    const u = [(b[0] - a[0]) / ab, (b[1] - a[1]) / ab], v = [(c[0] - b[0]) / bc, (c[1] - b[1]) / bc];
    const r = Math.min(radius, ab * 0.45, bc * 0.45);
    if (Math.abs(u[0] * v[1] - u[1] * v[0]) < 0.02 || r < 0.05) {
      out.push([b[0], b[1]]);
      continue;
    }
    const p0 = [b[0] - u[0] * r, b[1] - u[1] * r], p2 = [b[0] + v[0] * r, b[1] + v[1] * r];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, s = 1 - t;
      out.push([s * s * p0[0] + 2 * s * t * b[0] + t * t * p2[0], s * s * p0[1] + 2 * s * t * b[1] + t * t * p2[1]]);
    }
  }
  out.push([points[n - 1][0], points[n - 1][1]]);
  return out;
}

/** How far along a line each of its points is. */
export function lengthsOf(points) {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return out;
}

/** The point `s` along a line (its lengths given), and its way there (a unit vector). */
export function along(points, lengths, s) {
  const n = points.length;
  if (n === 1) return { x: points[0][0], z: points[0][1], dx: 1, dz: 0 };
  const total = lengths[n - 1];
  const t = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < n - 1 && lengths[i] < t) i++;
  let k = i;
  while (k < n - 1 && lengths[k] - lengths[k - 1] < 1e-9) k++;
  const a = points[i - 1], b = points[i], span = lengths[i] - lengths[i - 1];
  const f = span > 1e-9 ? (t - lengths[i - 1]) / span : 0;
  const da = points[k - 1], db = points[k], len = Math.hypot(db[0] - da[0], db[1] - da[1]) || 1;
  return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, dx: (db[0] - da[0]) / len, dz: (db[1] - da[1]) / len };
}

/** A ribbon `width` wide along points [x, z] at height y, its corners mitred: each vertex
 * with how far along it is (aAlong, metres) and across it (aAcross, -1 to 1). */
export function ribbon(points, y, width = ROUTE_SIZE.width) {
  const half = width / 2, pos = [], alongs = [], across = [], index = [];
  const n = points.length;
  const unit = (dx, dz) => {
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };
  const lengths = lengthsOf(points);
  for (let i = 0; i < n; i++) {
    const [x, z] = points[i];
    const into = i > 0 ? unit(x - points[i - 1][0], z - points[i - 1][1]) : null;
    const out = i < n - 1 ? unit(points[i + 1][0] - x, points[i + 1][1] - z) : null;
    const [tx, tz] = unit((into?.[0] ?? 0) + (out?.[0] ?? 0), (into?.[1] ?? 0) + (out?.[1] ?? 0));
    const side = [-tz, tx];
    const way = into ?? out;
    const k = half / Math.max(0.5, Math.abs(side[0] * -way[1] + side[1] * way[0]));
    pos.push(x + side[0] * k, y, z + side[1] * k, x - side[0] * k, y, z - side[1] * k);
    alongs.push(lengths[i], lengths[i]);
    across.push(1, -1);
    if (i > 0) index.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aAlong", new THREE.Float32BufferAttribute(alongs, 1));
  g.setAttribute("aAcross", new THREE.Float32BufferAttribute(across, 1));
  g.setIndex(index);
  g.userData.length = lengths[n - 1] ?? 0;
  return g;
}

const linear = (c) => new THREE.Color(c); // (three converts CSS colours to its working space)

/** The ribbon's look: a bright core, a thin lighter rim, a soft glow fading out to its
 * edges, chevrons flowing along the core the way it goes; drawn in as `uReveal` (metres
 * along it) grows, each part rising from under the floor as it comes. */
export function lineMaterial({ color, edge, chevron }) {
  return new THREE.ShaderMaterial({
    name: "route-line",
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: {
      uColor: { value: linear(color) }, uEdge: { value: linear(edge) }, uChevron: { value: linear(chevron) },
      uTime: { value: 0 }, uReveal: { value: 1e6 }, uOpacity: { value: 0.96 }, uFlow: { value: 1 },
      uCore: { value: ROUTE_SIZE.core }, uEvery: { value: ROUTE_SIZE.chevron }, uSpeed: { value: ROUTE_SIZE.flow },
    },
    vertexShader: /* glsl */ `
      attribute float aAlong;
      attribute float aAcross;
      uniform float uReveal;
      varying float vAlong;
      varying float vAcross;
      varying float vRise;
      void main() {
        vAlong = aAlong;
        vAcross = aAcross;
        // rises out of the floor over the metres just drawn in
        vRise = smoothstep(0.0, 3.5, uReveal - aAlong);
        vec3 p = position;
        p.y -= 0.45 * (1.0 - vRise);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uEdge;
      uniform vec3 uChevron;
      uniform float uTime;
      uniform float uReveal;
      uniform float uOpacity;
      uniform float uFlow;
      uniform float uCore;
      uniform float uEvery;
      uniform float uSpeed;
      varying float vAlong;
      varying float vAcross;
      varying float vRise;
      void main() {
        if (vAlong > uReveal) discard;
        float a = abs(vAcross);
        float aa = fwidth(a) * 1.2;
        float core = 1.0 - smoothstep(uCore - aa, uCore + aa, a);
        float rim = smoothstep(uCore - 0.12, uCore - 0.02, a) * core;
        float glow = 1.0 - smoothstep(uCore, 1.0, a);
        glow = glow * glow * 0.5;
        // chevrons pointing the way it goes, flowing along it
        float p = (vAlong - a * uEvery * 0.42 - uTime * uSpeed * uFlow) / uEvery;
        float f = fract(p);
        float w = fwidth(p) * 1.5;
        float chev = smoothstep(0.0, w + 0.02, f) * (1.0 - smoothstep(0.2, 0.2 + w + 0.02, f)) * (1.0 - smoothstep(uCore * 0.62, uCore * 0.78, a));
        vec3 col = mix(uColor, uEdge, rim * 0.55);
        col = mix(col, uChevron, chev * 0.9);
        float alpha = max(core, glow) * uOpacity * (0.25 + 0.75 * vRise);
        // its far end, still being drawn: soft
        alpha *= smoothstep(0.0, 0.6, uReveal - vAlong + 0.6);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
  });
}

/** The column through a lift or stairs: a soft glowing tube, bands of light rising (or
 * falling) the way the way goes; `uReveal` (0 to 1) draws it in from below or above. */
export function columnMaterial({ color, chevron, up }) {
  return new THREE.ShaderMaterial({
    name: "route-column",
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: { uColor: { value: linear(color) }, uChevron: { value: linear(chevron) }, uTime: { value: 0 }, uUp: { value: up ? 1 : -1 },
      uReveal: { value: 1 }, uOpacity: { value: 0.9 }, uHeight: { value: 3 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uChevron;
      uniform float uTime;
      uniform float uUp;
      uniform float uReveal;
      uniform float uOpacity;
      uniform float uHeight;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vView;
      void main() {
        // (uv.y: 0 at the floor it leaves, 1 at the one it reaches)
        if (vUv.y > uReveal) discard;
        float facing = abs(dot(normalize(vNormalV), normalize(vView)));
        float body = 0.35 + 0.65 * facing;
        float metres = vUv.y * uHeight;
        float p = fract((metres - uTime * 1.3) / 1.1);
        float w = fwidth(metres / 1.1) * 1.5;
        float band = smoothstep(0.0, w + 0.03, p) * (1.0 - smoothstep(0.22, 0.22 + w + 0.03, p));
        vec3 col = mix(uColor, uChevron, band * 0.85);
        gl_FragColor = vec4(col, uOpacity * body);
        #include <colorspace_fragment>
      }`,
  });
}

/** A flat ring on the floor (inner and outer radius as shares of 1, scaled), lying flat. */
export function ringGeometry(inner, outer, segments = 48) {
  const g = new THREE.RingGeometry(inner, outer, segments, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A flat disc on the floor. */
export function discGeometry(radius, segments = 40) {
  const g = new THREE.CircleGeometry(radius, segments);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A plain colour, seen through what is in front of it (the way's marks). */
export function markMaterial(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color: linear(color), transparent: true, opacity, depthTest: false, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false });
}

/** A pin, its point at its origin: a head (a sphere) on a cone pointing down, a white
 * dot on the head's face, all in its own colour, softly lit. */
export function pinMesh(color) {
  const group = new THREE.Group();
  const look = new THREE.MeshStandardMaterial({ color: linear(color), emissive: linear(color), emissiveIntensity: 0.38, roughness: 0.45,
    metalness: 0.05, transparent: true, depthTest: false, toneMapped: false });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 20), look);
  head.position.y = 1.15;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.95, 32, 1, true), look);
  cone.rotation.x = Math.PI;
  cone.position.y = 0.6;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true,
    depthTest: false, toneMapped: false }));
  dot.position.y = 1.15;
  dot.scale.set(1, 1, 0.35);
  group.add(cone, head);
  group.userData.dot = dot;
  group.add(dot);
  return group;
}

/** An arrow head (a cone) pointing up or down, its tip at its origin. */
export function arrowMesh(color, up) {
  const g = new THREE.ConeGeometry(0.34, 0.55, 28);
  g.translate(0, -0.275, 0);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: linear(color), transparent: true, depthTest: false, depthWrite: false,
    toneMapped: false }));
  if (!up) m.rotation.x = Math.PI;
  return m;
}

// ---- tags, in the world's label layer ---------------------------------------------------

const TAG_STYLE = {
  display: "flex", alignItems: "center", gap: "6px", padding: "4px 10px", borderRadius: "999px", whiteSpace: "nowrap",
  font: '600 12px/1.3 system-ui, -apple-system, "Segoe UI", "Noto Sans Arabic", sans-serif', pointerEvents: "none",
  boxShadow: "0 2px 8px rgba(15, 23, 42, 0.22), 0 0 0 1px rgba(15, 23, 42, 0.06)", unicodeBidi: "plaintext",
};

/** A tag over a point: its text, a quieter part after it ("· Floor 2"), in the way's
 * colours: "start" (white, a dot of the way's colour), "end" (white, the pin's colour
 * dotted before its words), "change" (the way's colour, `icon` before its words: an
 * arrow). Pages may restyle .sp3d-route-tag and its kinds (.sp3d-route-start, …). */
export function tag(text, sub, kind, colours, icon = "") {
  const outer = document.createElement("div"); // (the renderer shows and hides this one)
  const el = document.createElement("div");
  el.className = `sp3d-route-tag sp3d-route-${kind}`;
  const change = kind === "change";
  Object.assign(el.style, TAG_STYLE, { background: change ? colours.color : "#ffffff", color: change ? "#ffffff" : "#16181d",
    transform: "translateY(-50%)" });
  if (change) {
    const i = document.createElement("span");
    i.textContent = icon;
    Object.assign(i.style, { fontSize: "13px", fontWeight: "700", lineHeight: "1" });
    el.append(i);
  } else {
    const dot = document.createElement("span");
    Object.assign(dot.style, { width: "8px", height: "8px", borderRadius: "50%", flex: "none",
      background: kind === "end" ? colours.end : colours.start ?? colours.color, boxShadow: "0 0 0 2px rgba(255,255,255,0.9)" });
    el.append(dot);
  }
  const main = document.createElement("span");
  main.textContent = text;
  if (kind === "end") main.style.fontWeight = "700";
  el.append(main);
  if (sub) {
    const s = document.createElement("span");
    s.textContent = `· ${sub}`;
    Object.assign(s.style, { fontWeight: "500", color: change ? "rgba(255, 255, 255, 0.82)" : "#5f6570" });
    el.append(s);
  }
  outer.append(el);
  const o = new CSS2DObject(outer);
  o.userData.routeTag = kind;
  return o;
}

// ---- the camera's tour along it ---------------------------------------------------------------

/** The camera's tour along a way, made once: its parts in order, each a time; walking a
 * leg slower at its turns, a pause at each lift or stairs and the ride through it, and
 * the destination framed at its end. `legs`: each { points: [[x, z]], y } (y: where its
 * floor is now); `walk`: metres a second. */
export function tourOf(legs, walk) {
  const parts = [];
  legs.forEach((leg, i) => {
    const points = smoothed(leg.points, 1.6);
    const lengths = lengthsOf(points);
    const total = lengths[lengths.length - 1];
    // time along it: slower where it turns (looked at a few metres ahead and behind)
    const step = 0.5, times = [0], at = [0];
    let t = 0;
    for (let s = step; s < total + step; s += step) {
      const here = Math.min(s, total);
      const a = along(points, lengths, here - 2.5), b = along(points, lengths, here + 2.5);
      const turn = 1 - Math.max(-1, Math.min(1, a.dx * b.dx + a.dz * b.dz)); // 0 straight on, 2 back
      const near = Math.min(1, Math.min(here, total - here) / 4); // slower off and onto each floor
      const speed = walk * (1 - 0.45 * Math.min(1, turn)) * (0.55 + 0.45 * near);
      t += (here - at[at.length - 1]) / Math.max(0.3, speed);
      at.push(here);
      times.push(t);
      if (here >= total) break;
    }
    parts.push({ kind: "walk", leg: i, points, lengths, y: leg.y, at, times, seconds: t });
    if (i < legs.length - 1) {
      parts.push({ kind: "hold", leg: i, seconds: 0.7 });
      parts.push({ kind: "ride", leg: i, seconds: 1.9 });
      parts.push({ kind: "hold", leg: i + 1, seconds: 0.35 });
    }
  });
  parts.push({ kind: "end", leg: legs.length - 1, seconds: 1.6 });
  let start = 0;
  for (const p of parts) {
    p.start = start;
    start += p.seconds;
  }
  return { parts, seconds: start };
}

/** Where a part of a tour is at `t` seconds into it: the metres walked along a leg. */
export function walkedAt(part, t) {
  const { at, times } = part;
  if (t <= 0) return 0;
  if (t >= part.seconds) return at[at.length - 1];
  let i = 1;
  while (i < times.length - 1 && times[i] < t) i++;
  const f = (t - times[i - 1]) / (times[i] - times[i - 1] || 1);
  return at[i - 1] + (at[i] - at[i - 1]) * f;
}

/** Eased out, a little past its end and back. */
export const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

/** Eased in and out. */
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
