/** Shared id of the gooey SVG filter rendered by `<BotAvatarStyles />`. */
export const BOT_AVATAR_FILTER_ID = "cf-bot-goo";

/**
 * Keyframes for the avatar's 3D playback. Injected once per document — render
 * `<BotAvatarStyles />` near the root of the app.
 */
export const BOT_AVATAR_CSS = `
.cf-bot {
  position: relative;
  display: inline-block;
  width: var(--cf-bot-size);
  height: var(--cf-bot-size);
  perspective: calc(var(--cf-bot-size) * 2.4);
  flex-shrink: 0;
}

.cf-bot__stage {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  animation: cf-bot-sway var(--cf-bot-sway) ease-in-out infinite alternate;
  animation-delay: var(--cf-bot-delay);
}

.cf-bot__body {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  transform-style: preserve-3d;
  animation: cf-bot-squish var(--cf-bot-squish) ease-in-out infinite;
  animation-delay: var(--cf-bot-delay);
}

.cf-bot__eyes {
  position: absolute;
  inset: 0;
  /* Lifting the eyes off the body is what sells the rotation as 3D. */
  transform: translateZ(calc(var(--cf-bot-size) * 0.16));
  transform-style: preserve-3d;
}

.cf-bot__eye {
  position: absolute;
  transform: translate(-50%, -50%) rotate(var(--cf-bot-tilt));
}

.cf-bot__pupil {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 999px;
  background: var(--cf-bot-ink);
  animation: cf-bot-blink var(--cf-bot-blink) ease-in-out infinite;
  animation-delay: var(--cf-bot-delay);
}

.cf-bot--paused .cf-bot__stage,
.cf-bot--paused .cf-bot__body,
.cf-bot--paused .cf-bot__pupil {
  animation-play-state: paused;
}

@keyframes cf-bot-sway {
  from {
    transform: rotateY(-15deg) rotateX(7deg);
  }
  to {
    transform: rotateY(15deg) rotateX(-5deg);
  }
}

@keyframes cf-bot-squish {
  0%,
  100% {
    transform: scale3d(1, 1, 1);
  }
  35% {
    transform: scale3d(1.05, 0.95, 1);
  }
  65% {
    transform: scale3d(0.96, 1.04, 1);
  }
}

@keyframes cf-bot-blink {
  0%,
  88%,
  100% {
    transform: scaleY(1);
  }
  92% {
    transform: scaleY(0.08);
  }
  96% {
    transform: scaleY(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .cf-bot__stage,
  .cf-bot__body,
  .cf-bot__pupil {
    animation: none;
  }
}
`;
