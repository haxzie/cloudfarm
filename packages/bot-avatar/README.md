# @cloudfarm/bot-avatar

Generates bot profile pictures: a catalogue of organic shapes, a colour palette,
and a React component that animates the result with CSS 3D transforms.

```tsx
import { BotAvatar, BotAvatarStyles, BOT_SHAPES, BOT_COLORS } from "@cloudfarm/bot-avatar";

// once, near the root of the app
<BotAvatarStyles />

<BotAvatar shape="clover" color="amber" size={64} />
<BotAvatar shape="cloud" color="teal" size={40} playing={false} />
```

Shapes are generated rather than hand-drawn: each preset samples a wobbly circle
or polygon (`src/geometry.ts`) and smooths the points into a closed bézier path,
so the outlines look hand-made and new presets are a few numbers.

Playback stacks three loops on a `preserve-3d` stage — a sway on the stage, a
squish on the body, and a blink on the eyes, which sit on their own plane
(`translateZ`) so they parallax as the body turns. Timings are derived from the
shape and colour so a grid of avatars never moves in lockstep. `playing={false}`
freezes the pose, and `prefers-reduced-motion` disables the animation entirely.

`botAvatarFromSeed(id)` returns a stable shape + colour for an existing entity.
