/** Eased stops — a plain two-stop gradient leaves a visible edge where it ends. */
const STOPS: [number, number][] = [
  [0, 1],
  [38, 1],
  [55, 0.86],
  [70, 0.6],
  [82, 0.32],
  [92, 0.12],
  [100, 0],
];

/**
 * Fades messages into the panel colour as they scroll up behind the floating
 * header, so there is a clean cutout at the top instead of a hard edge.
 */
export function HeaderFade({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 top-0 ${className}`}
      style={{
        background: `linear-gradient(to bottom, ${STOPS.map(
          ([at, alpha]) =>
            `color-mix(in srgb, var(--background) ${alpha * 100}%, transparent) ${at}%`,
        ).join(", ")})`,
      }}
    />
  );
}
