"use client";

import { useCallback, useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { createBot, deleteBot, listBots, type Bot } from "@/lib/api";

import { ChatSidebar } from "./chat-sidebar";
import { ChatView } from "./chat-view";
import { BotDetailsModal } from "./bot-details-modal";
import { ConnectorsModal } from "./connectors-modal";
import { CreateBotModal, type NewBot } from "./create-bot-modal";
import type { SessionUser } from "./user-footer";

type Props = {
  user: SessionUser & { id: string };
  onSignOut: () => void;
};

export function ChatApp({ user, onSignOut }: Props) {
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isConnectorsOpen, setIsConnectorsOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  // Lifted so the choice survives switching bots, which remounts ChatView.
  const [isInfoOpen, setIsInfoOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await listBots();
      setBots(next);
      setActiveBotId((current) => current ?? next[0]?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load bots");
      setBots([]);
    }
  }, []);

  useEffect(() => {
    // Mount-time fetch of an external resource. Next's rule wants this on the
    // server; it moves there when the two apps merge into one Worker and the
    // session can be read server-side.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function onCreate({ name, shape, color }: NewBot) {
    const created = await createBot({ name, avatarShape: shape, avatarColor: color });
    setBots((current) => [created, ...(current ?? [])]);
    setActiveBotId(created.id);
    setIsCreateOpen(false);
  }

  async function onDelete(id: string) {
    await deleteBot(id);

    // Drop it locally rather than refetching: the list is already here, and a
    // round trip would leave the deleted bot on screen until it came back.
    setBots((current) => {
      const next = (current ?? []).filter((candidate) => candidate.id !== id);
      setActiveBotId((active) => (active === id ? (next[0]?.id ?? null) : active));
      return next;
    });

    setIsDetailsOpen(false);
  }

  const activeBot = bots?.find((candidate) => candidate.id === activeBotId) ?? null;

  const sidebar = (
    <ChatSidebar
      bots={bots ?? []}
      activeBotId={activeBot?.id ?? ""}
      onSelect={setActiveBotId}
      user={user}
      onSignOut={async () => {
        await authClient.signOut();
        onSignOut();
      }}
      onCreateBot={() => setIsCreateOpen(true)}
      onOpenConnectors={() => setIsConnectorsOpen(true)}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 bg-neutral-100 dark:bg-neutral-900">
      {sidebar}

      {activeBot ? (
        <ChatView
          key={activeBot.id}
          bot={activeBot}
          isInfoOpen={isInfoOpen}
          onToggleInfo={() => setIsInfoOpen((open) => !open)}
          onOpenDetails={() => setIsDetailsOpen(true)}
        />
      ) : (
        <section className="mt-2 mr-2 flex min-w-0 flex-1 items-center justify-center rounded-t-xl border border-b-0 border-neutral-200 bg-background px-8 text-center dark:border-neutral-800">
          <div className="max-w-sm">
            <p className="text-sm font-medium">
              {bots === null ? "Loading…" : error ? "Something went wrong" : "No bots yet"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">
              {error ?? "Create your first bot with the + button to start a conversation."}
            </p>
          </div>
        </section>
      )}

      {isCreateOpen && (
        <CreateBotModal onClose={() => setIsCreateOpen(false)} onCreate={onCreate} />
      )}

      {isConnectorsOpen && (
        <ConnectorsModal userId={user.id} onClose={() => setIsConnectorsOpen(false)} />
      )}

      {isDetailsOpen && activeBot && (
        <BotDetailsModal
          bot={activeBot}
          onClose={() => setIsDetailsOpen(false)}
          onDelete={() => onDelete(activeBot.id)}
        />
      )}
    </div>
  );
}
