export type Point = readonly [number, number];

/** Deterministic PRNG so a given shape always draws identically. */
export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Closed Catmull-Rom spline rendered as cubic béziers. Sampling a shape as
 * points and smoothing them here is what makes every preset look hand-drawn
 * rather than geometric.
 */
export function smoothClosedPath(points: readonly Point[], tension = 1): string {
  const count = points.length;
  if (count < 3) return "";

  const at = (index: number) => points[((index % count) + count) % count] as Point;
  const first = at(0);
  let path = `M ${first[0].toFixed(2)} ${first[1].toFixed(2)}`;

  for (let i = 0; i < count; i += 1) {
    const [x0, y0] = at(i - 1);
    const [x1, y1] = at(i);
    const [x2, y2] = at(i + 1);
    const [x3, y3] = at(i + 2);

    const c1x = x1 + ((x2 - x0) / 6) * tension;
    const c1y = y1 + ((y2 - y0) / 6) * tension;
    const c2x = x2 - ((x3 - x1) / 6) * tension;
    const c2y = y2 - ((y3 - y1) / 6) * tension;

    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }

  return `${path} Z`;
}

export type RadialOptions = {
  /** Number of bumps around the outline. 0 keeps it round. */
  lobes: number;
  /** Bump depth as a fraction of the radius. */
  amplitude: number;
  /** Smooth radius wobble, for pebble- and cloud-like outlines. */
  jitter?: number;
  /** Radians, rotates the lobe pattern. */
  rotation?: number;
  radius?: number;
  samples?: number;
  seed?: number;
  /** Squash on each axis, e.g. [1, 0.86] for a wide shape. */
  scale?: Point;
};

/** Samples a wobbly circle: the base for blobs, flowers and stars. */
export function radialPoints({
  lobes,
  amplitude,
  jitter = 0,
  rotation = 0,
  radius = 42,
  samples = 48,
  seed = 1,
  scale = [1, 1],
}: RadialOptions): Point[] {
  const random = mulberry32(seed);
  // Low-frequency harmonics rather than per-sample noise: integer frequencies
  // keep the outline closed, and summing a few of them keeps it smooth where
  // white noise would leave a crinkled edge.
  const harmonics = [3, 5, 8].map((frequency, index) => ({
    frequency,
    phase: random() * Math.PI * 2,
    weight: 1 / (index + 1.5),
  }));

  const wobbleAt = (angle: number) =>
    harmonics.reduce(
      (sum, { frequency, phase, weight }) => sum + Math.sin(frequency * angle + phase) * weight,
      0,
    ) / 2;

  return Array.from({ length: samples }, (_, index) => {
    const angle = (index / samples) * Math.PI * 2;
    const lobe = lobes > 0 ? Math.cos(lobes * angle + rotation) : 0;
    const noise = jitter * wobbleAt(angle);
    const r = radius * (1 + amplitude * lobe + noise);

    return [50 + Math.cos(angle) * r * scale[0], 50 + Math.sin(angle) * r * scale[1]] as Point;
  });
}

export type PolygonOptions = {
  sides: number;
  radius?: number;
  rotation?: number;
  /** Points sampled along each edge — more means crisper corners. */
  edgeSamples?: number;
  scale?: Point;
};

/** Samples a polygon; smoothing it afterwards gives soft, rounded corners. */
export function polygonPoints({
  sides,
  radius = 44,
  rotation = -Math.PI / 2,
  edgeSamples = 3,
  scale = [1, 1],
}: PolygonOptions): Point[] {
  const corners = Array.from({ length: sides }, (_, index) => {
    const angle = (index / sides) * Math.PI * 2 + rotation;
    return [
      50 + Math.cos(angle) * radius * scale[0],
      50 + Math.sin(angle) * radius * scale[1],
    ] as Point;
  });

  return corners.flatMap((corner, index) => {
    const next = corners[(index + 1) % sides] as Point;
    return Array.from({ length: edgeSamples }, (_, step) => {
      const t = step / edgeSamples;
      return [
        corner[0] + (next[0] - corner[0]) * t,
        corner[1] + (next[1] - corner[1]) * t,
      ] as Point;
    });
  });
}
