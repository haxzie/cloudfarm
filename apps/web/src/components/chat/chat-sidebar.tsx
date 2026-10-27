import { BotAvatar } from "@cloudfarm/bot-avatar";
import { Plus } from "lucide-react";

import type { Bot } from "@/lib/api";

import { Brand } from "./brand";
import { UserFooter, type SessionUser } from "./user-footer";

type Props = {
  bots: Bot[];
  activeBotId: string;
  onSelect: (botId: string) => void;
  user: SessionUser;
  onSignOut: () => void;
  onCreateBot: () => void;
  onOpenConnectors: () => void;
};

export function ChatSidebar({
  bots,
  activeBotId,
  onSelect,
  user,
  onSignOut,
  onCreateBot,
  onOpenConnectors,
}: Props) {
  return (
    <aside className="flex w-80 shrink-0 flex-col">
      <div className="flex h-14 items-center justify-between px-5">
        <h1>
          <Brand />
        </h1>
        <button
          type="button"
          onClick={onCreateBot}
          title="Create bot"
          aria-label="Create bot"
          className="flex size-9 items-center justify-center rounded-full bg-neutral-200 text-foreground transition-colors hover:bg-neutral-300 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        >
          <Plus className="size-5" aria-hidden />
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {bots.map((bot) => {
          const isActive = bot.id === activeBotId;

          return (
            <button
              key={bot.id}
              type="button"
              onClick={() => onSelect(bot.id)}
              aria-current={isActive ? "true" : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                isActive
                  ? "bg-neutral-200 dark:bg-neutral-800"
                  : "hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60"
              }`}
            >
              <BotAvatar shape={bot.avatarShape} color={bot.avatarColor} size={44} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{bot.name}</span>
                  <span className="shrink-0 text-[11px] text-neutral-500">
                    {formatWhen(bot.lastMessageAt)}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-neutral-500">
                  {bot.lastMessageAuthor === "user" && "You: "}
                  {bot.lastMessagePreview ?? "Say hello to get started"}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      <UserFooter user={user} onSignOut={onSignOut} onOpenConnectors={onOpenConnectors} />
    </aside>
  );
}

function formatWhen(at: number | null) {
  if (!at) return "New";

  const date = new Date(at);
  const dayMs = 24 * 60 * 60 * 1000;
  const elapsed = Date.now() - date.getTime();

  if (elapsed < dayMs && date.getDate() === new Date().getDate()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (elapsed < 7 * dayMs) {
    return date.toLocaleDateString([], { weekday: "short" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
