import { Cloud } from "lucide-react";

type Props = {
  /** `lg` is the sign-in screen; `sm` is the sidebar. */
  size?: "sm" | "lg";
};

/** cloudfarm wordmark: cloud glyph + Madimi One. */
export function Brand({ size = "sm" }: Props) {
  const isLarge = size === "lg";

  return (
    <span
      className={`flex items-center leading-none tracking-tight ${
        isLarge ? "gap-2.5 text-3xl" : "gap-1.5 text-base"
      }`}
      // Set directly: the font only ever applies here, so it needs no theme token.
      style={{ fontFamily: "var(--font-madimi)" }}
    >
      <Cloud
        className={isLarge ? "size-9" : "size-5"}
        fill="currentColor"
        strokeWidth={1.5}
        aria-hidden
      />
      cloudfarm
    </span>
  );
}
