"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Lines of text shown before the textarea starts scrolling. */
const MAX_VISIBLE_LINES = 3;

type Props = {
  onSend: (body: string) => void;
  disabled?: boolean;
};

export function Composer({ onSend, disabled = false }: Props) {
  const [value, setValue] = useState("");
  const [isMultiline, setIsMultiline] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const styles = getComputedStyle(textarea);
    const lineHeight = parseFloat(styles.lineHeight) || 22;
    const paddingTop = parseFloat(styles.paddingTop);
    const paddingBottom = parseFloat(styles.paddingBottom);

    textarea.style.height = "auto";
    const lines = Math.max(
      1,
      Math.round((textarea.scrollHeight - paddingTop - paddingBottom) / lineHeight),
    );
    const overflows = lines > MAX_VISIBLE_LINES;

    // When it scrolls, the bottom padding is left out of the height so the
    // next line starts exactly on the edge instead of peeking through.
    textarea.style.height = overflows
      ? `${paddingTop + lineHeight * MAX_VISIBLE_LINES}px`
      : `${paddingTop + lineHeight * lines + paddingBottom}px`;
    textarea.style.overflowY = overflows ? "auto" : "hidden";
    // A pill reads well on one line; past that it needs real corners.
    setIsMultiline(lines > 1);
  }

  useEffect(resize, []);

  function send() {
    const body = value.trim();
    if (!body || disabled) return;
    onSend(body);
    setValue("");
    // The textarea keeps its grown height until it is measured again.
    requestAnimationFrame(resize);
  }

  return (
    <div className="px-6 pb-6">
      <div
        className={`mx-auto flex w-full max-w-3xl items-end gap-2 border border-neutral-200 bg-neutral-50 p-2.5 pl-5 shadow-sm transition-[border-radius] duration-150 focus-within:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:focus-within:border-neutral-600 ${
          isMultiline ? "rounded-3xl" : "rounded-full"
        }`}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          placeholder="Message cloudfarm…"
          aria-label="Message"
          disabled={disabled}
          onChange={(event) => {
            setValue(event.target.value);
            resize();
          }}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter adds a newline.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          className="flex-1 resize-none overflow-hidden bg-transparent py-2 text-sm leading-relaxed outline-none placeholder:text-neutral-500"
        />
        <button
          type="button"
          onClick={send}
          disabled={disabled || !value.trim()}
          aria-label="Send message"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white transition-opacity disabled:opacity-30 dark:bg-white dark:text-neutral-900"
        >
          <ArrowUp className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
