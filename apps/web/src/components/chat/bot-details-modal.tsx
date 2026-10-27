"use client";

import { BotAvatar } from "@cloudfarm/bot-avatar";
import { Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { Bot } from "@/lib/api";

type Props = {
  bot: Bot;
  onClose: () => void;
  onDelete: () => Promise<void>;
};

/**
 * What the bot is, and the way to get rid of it.
 *
 * Deleting asks for a second click rather than a confirm() — the dialog is
 * already modal, and a browser confirm inside it is both uglier and easy to
 * dismiss by reflex.
 */
export function BotDetailsModal({ bot, onClose, onDelete }: Props) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape backs out of the confirmation first, so it cannot close the
      // dialog out from under someone who is having second thoughts.
      if (isConfirming) setIsConfirming(false);
      else onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, isConfirming]);

  async function remove() {
    setIsDeleting(true);
    setError(null);
    try {
      await onDelete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete this bot");
      setIsDeleting(false);
      setIsConfirming(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${bot.name} details`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-background shadow-2xl dark:border-neutral-800">
        <header className="flex items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="font-medium">Bot details</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-foreground dark:hover:bg-neutral-800"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="flex flex-col items-center gap-4 overflow-y-auto px-5 py-7">
          <BotAvatar shape={bot.avatarShape} color={bot.avatarColor} size={104} />

          <div className="text-center">
            <p className="text-base font-medium">{bot.name}</p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">
              {bot.description || "No description yet."}
            </p>
          </div>

          <dl className="mt-2 w-full divide-y divide-neutral-200 text-xs dark:divide-neutral-800">
            <Row label="Model" value={bot.model} />
            <Row
              label="Last active"
              value={
                bot.lastMessageAt
                  ? new Date(bot.lastMessageAt).toLocaleString([], {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })
                  : "Never"
              }
            />
          </dl>
        </div>

        <footer className="border-t border-neutral-200 px-5 py-4 dark:border-neutral-800">
          {error && <p className="mb-3 text-center text-xs text-red-500">{error}</p>}

          {isConfirming ? (
            <div className="flex flex-col gap-2">
              <p className="text-center text-xs text-neutral-500">
                This deletes {bot.name} and its conversation. Its files stay in storage.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsConfirming(false)}
                  disabled={isDeleting}
                  className="flex-1 rounded-xl border border-neutral-200 px-4 py-3 text-sm font-medium transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={isDeleting}
                  className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                >
                  {isDeleting ? "Deleting…" : `Delete ${bot.name}`}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsConfirming(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
            >
              <Trash2 className="size-4" aria-hidden />
              Delete bot
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
