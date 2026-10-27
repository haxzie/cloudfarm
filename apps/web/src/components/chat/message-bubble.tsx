import { getColor } from "@cloudfarm/bot-avatar";
import { Streamdown } from "streamdown";
import type { ComponentProps } from "react";

import type { Message } from "@/lib/use-bot-chat";

type Props = {
  message: Message;
  /** Palette id of the bot's avatar — your own bubbles borrow it. */
  colorId: string;
};

/**
 * Streamdown ships its own chrome for code blocks and tables — copy and
 * download buttons, borders, scroll containers, syntax themes. In a chat
 * bubble that is noise, so the components below replace them with plain
 * elements and `.prose-chat` in globals.css does the rest.
 */
const components = {
  pre: ({ children }: ComponentProps<"pre">) => <pre>{children}</pre>,
  // Streamdown styles every `code` as inline code, which is wrong inside a
  // fenced block. Plain element, styled by `.prose-chat` instead.
  code: ({ children }: ComponentProps<"code">) => <code>{children}</code>,
  table: ({ children }: ComponentProps<"table">) => <table>{children}</table>,
  img: ({ src, alt }: ComponentProps<"img">) =>
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary model output
    typeof src === "string" ? <img src={src} alt={alt ?? ""} /> : null,
};

export function MessageBubble({ message, colorId }: Props) {
  const isMine = message.author === "user";
  const color = getColor(colorId);

  return (
    <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[min(34rem,78%)] rounded-2xl px-4.5 py-3 text-sm leading-relaxed ${
          isMine ? "" : "bg-neutral-100 dark:bg-neutral-800"
        }`}
        style={isMine ? { background: color.value, color: color.ink } : undefined}
      >
        {isMine ? (
          // Your own text is taken literally — no markdown surprises.
          <p className="whitespace-pre-wrap">{message.body}</p>
        ) : (
          <Streamdown
            className="prose-chat"
            parseIncompleteMarkdown
            controls={false}
            components={components}
          >
            {message.body}
          </Streamdown>
        )}
      </div>
    </div>
  );
}
