"use client";

import { BotAvatar } from "@cloudfarm/bot-avatar";
import { Monitor, MonitorOff } from "lucide-react";
import { useEffect, useRef } from "react";

import type { Bot } from "@/lib/api";
import { useBotChat } from "@/lib/use-bot-chat";

import { WorkbenchPanel } from "@/components/workbench/workbench-panel";

import { Composer } from "./composer";
import { HeaderFade } from "./header-fade";
import { MessageBubble } from "./message-bubble";

type Props = {
  bot: Bot;
  isInfoOpen: boolean;
  onToggleInfo: () => void;
  onOpenDetails: () => void;
};

export function ChatView({ bot, isInfoOpen, onToggleInfo, onOpenDetails }: Props) {
  const {
    messages,
    status,
    error,
    send,
    browserScreenshot,
    browserTargets,
    browserLog,
    listFiles,
    readFile,
  } = useBotChat(bot.id);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [bot.id, messages.length, status]);

  return (
    <section className="mt-2 mr-2 flex min-w-0 flex-1 overflow-hidden rounded-t-xl border border-b-0 border-neutral-200 bg-background dark:border-neutral-800">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <HeaderFade className="z-10 h-36" />

        {/* Floating iMessage-style header: avatar over name, centred. */}
        <header className="absolute inset-x-0 top-0 z-20 flex flex-col items-center gap-1.5 px-4 pt-3">
          <button
            type="button"
            onClick={onOpenDetails}
            title={`About ${bot.name}`}
            className="flex flex-col items-center gap-1.5 rounded-xl px-3 py-1.5 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <BotAvatar shape={bot.avatarShape} color={bot.avatarColor} size={40} />
            <span className="text-xs font-medium">{bot.name}</span>
          </button>

          <button
            type="button"
            onClick={onToggleInfo}
            aria-pressed={isInfoOpen}
            title={isInfoOpen ? "Hide the bot's computer" : "Show the bot's computer"}
            aria-label={isInfoOpen ? "Hide the bot's computer" : "Show the bot's computer"}
            className="absolute top-3 right-3 hidden size-9 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-foreground xl:flex dark:hover:bg-neutral-800"
          >
            {isInfoOpen ? (
              <MonitorOff className="size-[18px]" aria-hidden />
            ) : (
              <Monitor className="size-[18px]" aria-hidden />
            )}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* pt clears the floating header; justify-end keeps short
              conversations resting on the composer. */}
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end gap-4 px-6 pt-36 pb-8">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} colorId={bot.avatarColor} />
            ))}

            {status === "thinking" && (
              <p className="px-1 text-xs text-neutral-500">{bot.name} is thinking…</p>
            )}

            {error && (
              <p className="rounded-xl bg-red-500/10 px-4 py-3 text-xs text-red-500">{error}</p>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        <Composer onSend={send} disabled={status === "thinking"} />
      </div>

      {isInfoOpen && (
        <WorkbenchPanel
          listFiles={listFiles}
          readFile={readFile}
          browserScreenshot={browserScreenshot}
          browserTargets={browserTargets}
          browserLog={browserLog}
        />
      )}
    </section>
  );
}
