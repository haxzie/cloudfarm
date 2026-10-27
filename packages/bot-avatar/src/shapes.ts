import { polygonPoints, radialPoints, smoothClosedPath, type Point } from "./geometry";

export type EyeLayout = {
  /** Distance between the eyes, in viewBox units. */
  spread: number;
  /** Vertical centre of the eyes, in viewBox units. */
  y: number;
  width: number;
  height: number;
  /** Degrees, tilts both eyes outward like the reference art. */
  tilt: number;
};

export type BotShape = {
  id: string;
  label: string;
  path: string;
  eyes: EyeLayout;
};

const DEFAULT_EYES: EyeLayout = { spread: 17, y: 50, width: 8, height: 17, tilt: 0 };

type ShapeInput = {
  id: string;
  label: string;
  points: Point[];
  tension?: number;
  eyes?: Partial<EyeLayout>;
};

function shape({ id, label, points, tension = 1, eyes }: ShapeInput): BotShape {
  return {
    id,
    label,
    path: smoothClosedPath(points, tension),
    eyes: { ...DEFAULT_EYES, ...eyes },
  };
}

/** The shape catalogue offered by the picker. */
export const BOT_SHAPES: BotShape[] = [
  shape({
    id: "pebble",
    label: "Pebble",
    points: radialPoints({ lobes: 3, amplitude: 0.05, jitter: 0.05, seed: 7 }),
  }),
  shape({
    id: "blob",
    label: "Blob",
    points: radialPoints({ lobes: 2, amplitude: 0.09, jitter: 0.04, rotation: 0.6, seed: 3 }),
  }),
  shape({
    id: "squircle",
    label: "Squircle",
    points: polygonPoints({ sides: 4, radius: 46, rotation: -Math.PI / 4 }),
    tension: 1.1,
  }),
  shape({
    id: "clover",
    label: "Clover",
    points: radialPoints({ lobes: 4, amplitude: 0.19, rotation: Math.PI / 4, seed: 5 }),
  }),
  shape({
    id: "flower",
    label: "Flower",
    points: radialPoints({ lobes: 6, amplitude: 0.15, seed: 9 }),
  }),
  shape({
    id: "bloom",
    label: "Bloom",
    points: radialPoints({ lobes: 8, amplitude: 0.12, seed: 11 }),
  }),
  shape({
    id: "star",
    label: "Star",
    points: radialPoints({ lobes: 5, amplitude: 0.23, rotation: -Math.PI / 2, seed: 13 }),
  }),
  shape({
    id: "spark",
    label: "Spark",
    points: radialPoints({ lobes: 7, amplitude: 0.2, seed: 17 }),
  }),
  shape({
    id: "droplet",
    label: "Droplet",
    points: radialPoints({
      lobes: 1,
      amplitude: 0.2,
      rotation: Math.PI / 2,
      radius: 40,
      scale: [0.95, 1.08],
      seed: 19,
    }),
    eyes: { y: 56 },
  }),
  shape({
    id: "bean",
    label: "Bean",
    points: radialPoints({
      lobes: 2,
      amplitude: 0.12,
      rotation: Math.PI / 6,
      scale: [1.04, 0.86],
      seed: 23,
    }),
    eyes: { height: 15 },
  }),
  shape({
    id: "hex",
    label: "Hex",
    points: polygonPoints({ sides: 6, radius: 45 }),
  }),
  shape({
    id: "shield",
    label: "Shield",
    // A 3-lobe radial reads as a rounded triangle; a real polygon keeps corners
    // too sharp at thumbnail size.
    points: radialPoints({ lobes: 3, amplitude: 0.24, rotation: -Math.PI / 2, radius: 40, seed: 31 }),
    eyes: { y: 56, height: 15 },
  }),
  shape({
    id: "penta",
    label: "Penta",
    points: polygonPoints({ sides: 5, radius: 46 }),
    eyes: { y: 52 },
  }),
  shape({
    id: "cloud",
    label: "Cloud",
    points: radialPoints({ lobes: 5, amplitude: 0.06, jitter: 0.12, seed: 29 }),
  }),
];

export const DEFAULT_SHAPE_ID = BOT_SHAPES[0]!.id;

export function getShape(id: string): BotShape {
  return BOT_SHAPES.find((candidate) => candidate.id === id) ?? BOT_SHAPES[0]!;
}
