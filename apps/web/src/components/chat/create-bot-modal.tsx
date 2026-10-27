"use client";

import {
  BOT_COLORS,
  BOT_SHAPES,
  BotAvatar,
  DEFAULT_COLOR_ID,
  DEFAULT_SHAPE_ID,
  getColor,
} from "@cloudfarm/bot-avatar";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

export type NewBot = {
  name: string;
  shape: string;
  color: string;
};

type Props = {
  onClose: () => void;
  onCreate: (bot: NewBot) => void;
};

/** Mounted only while open, so each run starts from the defaults. */
export function CreateBotModal({ onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const [shape, setShape] = useState(DEFAULT_SHAPE_ID);
  const [color, setColor] = useState(DEFAULT_COLOR_ID);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const canCreate = name.trim().length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create new bot"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-background shadow-2xl dark:border-neutral-800">
        <header className="flex items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="font-medium">Create New Bot</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-foreground dark:hover:bg-neutral-800"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="flex flex-col items-center gap-5 overflow-y-auto px-5 py-6">
          <BotAvatar shape={shape} color={color} size={104} />

          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name your Bot"
            aria-label="Bot name"
            autoFocus
            className="w-full rounded-xl border border-neutral-200 bg-transparent px-4 py-2.5 text-center text-sm outline-none placeholder:text-neutral-500 focus:border-neutral-300 dark:border-neutral-700 dark:focus:border-neutral-600"
          />

          <div className="grid w-full grid-cols-5 justify-items-center gap-2" role="radiogroup" aria-label="Shape">
            {BOT_SHAPES.map((option) => {
              const isActive = option.id === shape;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  aria-label={option.label}
                  title={option.label}
                  onClick={() => setShape(option.id)}
                  className={`flex size-14 items-center justify-center rounded-xl border transition-colors ${
                    isActive
                      ? "border-neutral-400 dark:border-neutral-500"
                      : "border-transparent hover:border-neutral-200 dark:hover:border-neutral-700"
                  }`}
                >
                  <BotAvatar shape={option.id} color={color} size={38} />
                </button>
              );
            })}
          </div>

          <div className="flex w-full flex-wrap justify-center gap-2.5" role="radiogroup" aria-label="Colour">
            {BOT_COLORS.map((option) => {
              const isActive = option.id === color;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  aria-label={option.label}
                  title={option.label}
                  onClick={() => setColor(option.id)}
                  className={`size-8 rounded-full ring-offset-2 ring-offset-background transition-shadow ${
                    isActive ? "ring-2 ring-neutral-400 dark:ring-neutral-400" : ""
                  }`}
                  style={{ background: getColor(option.id).value }}
                />
              );
            })}
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => onCreate({ name: name.trim(), shape, color })}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            Create
          </button>
        </footer>
      </div>
    </div>
  );
}
