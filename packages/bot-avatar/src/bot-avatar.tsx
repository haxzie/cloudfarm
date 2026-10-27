import type { CSSProperties } from "react";

import { BOT_AVATAR_CSS, BOT_AVATAR_FILTER_ID } from "./styles";
import { DEFAULT_COLOR_ID, getColor, BOT_COLORS } from "./palette";
import { BOT_SHAPES, DEFAULT_SHAPE_ID, getShape } from "./shapes";
import { mulberry32 } from "./geometry";

export type BotAvatarProps = {
  shape?: string;
  color?: string;
  /** Rendered size in pixels. */
  size?: number;
  /** Animated by default; pass false to freeze the pose. */
  playing?: boolean;
  className?: string;
  title?: string;
};

function hash(value: string) {
  let out = 0;
  for (const char of value) out = (out * 31 + char.charCodeAt(0)) >>> 0;
  return out;
}

/** Stable shape + colour for an existing entity, e.g. a chat id. */
export function botAvatarFromSeed(seed: string): { shape: string; color: string } {
  const random = mulberry32(hash(seed) || 1);
  return {
    shape: BOT_SHAPES[Math.floor(random() * BOT_SHAPES.length)]!.id,
    color: BOT_COLORS[Math.floor(random() * BOT_COLORS.length)]!.id,
  };
}

/**
 * Inject once per document, near the root: the keyframes plus the gooey filter
 * every avatar references. Blur then crush the alpha — sharp tips melt into
 * soft, liquid bulges.
 */
export function BotAvatarStyles() {
  return (
    <>
      <style
        href="cf-bot-avatar"
        precedence="default"
        dangerouslySetInnerHTML={{ __html: BOT_AVATAR_CSS }}
      />
      <svg aria-hidden width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <filter id={BOT_AVATAR_FILTER_ID} x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4.8" result="blurred" />
            <feColorMatrix
              in="blurred"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 21 -9"
            />
          </filter>
        </defs>
      </svg>
    </>
  );
}

export function BotAvatar({
  shape = DEFAULT_SHAPE_ID,
  color = DEFAULT_COLOR_ID,
  size = 40,
  playing = true,
  className = "",
  title,
}: BotAvatarProps) {
  const resolvedShape = getShape(shape);
  const resolvedColor = getColor(color);
  const { eyes } = resolvedShape;

  // Offsetting the timings keeps a grid of avatars from moving in lockstep.
  const seed = hash(`${resolvedShape.id}:${resolvedColor.id}`);
  const swaySeconds = 4.6 + (seed % 17) / 10;
  const squishSeconds = 3.1 + (seed % 11) / 10;
  const blinkSeconds = 5.4 + (seed % 23) / 10;

  return (
    <span
      className={`cf-bot ${playing ? "" : "cf-bot--paused"} ${className}`.trim()}
      style={
        {
          "--cf-bot-size": `${size}px`,
          "--cf-bot-ink": resolvedColor.ink,
          "--cf-bot-sway": `${swaySeconds}s`,
          "--cf-bot-squish": `${squishSeconds}s`,
          "--cf-bot-blink": `${blinkSeconds}s`,
          "--cf-bot-delay": `-${(seed % 30) / 10}s`,
        } as CSSProperties
      }
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <span className="cf-bot__stage">
        <svg className="cf-bot__body" viewBox="0 0 100 100" aria-hidden>
          <g filter={`url(#${BOT_AVATAR_FILTER_ID})`}>
            <path d={resolvedShape.path} fill={resolvedColor.value} />
          </g>
        </svg>

        <span className="cf-bot__eyes">
          {[-1, 1].map((side) => (
            <span
              key={side}
              className="cf-bot__eye"
              style={
                {
                  left: `${50 + (side * eyes.spread) / 2}%`,
                  top: `${eyes.y}%`,
                  width: `${eyes.width}%`,
                  height: `${eyes.height}%`,
                  "--cf-bot-tilt": `${side * eyes.tilt}deg`,
                } as CSSProperties
              }
            >
              <span className="cf-bot__pupil" />
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}
