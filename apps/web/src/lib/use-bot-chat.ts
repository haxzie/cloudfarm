"use client";

import { useAgent } from "agents/react";
import { useCallback } from "react";

import type {
  LiveViewTarget,
  BrowserAction,
  BrowserTarget,
  Screenshot,
} from "@/components/workbench/browser-tab";
import type { WorkspaceFile } from "@/components/workbench/file-tree";

import { API_HOST } from "./api";

export type Message = {
  id: string;
  author: "user" | "bot";
  body: string;
  sentAt: number;
};

type AgentState = {
  status: "idle" | "thinking";
  lastError: string | null;
  messages: Message[];
  browserLog: BrowserAction[];
};

/**
 * Talks to one bot's Durable Object. Replies arrive whole rather than streamed:
 * the agent appends to its state and the SDK syncs that to connected clients,
 * so there is nothing to poll or refetch here.
 */
export function useBotChat(botId: string) {
  const agent = useAgent<AgentState>({
    agent: "bot-agent",
    name: botId,
    host: API_HOST,
  });

  const send = useCallback(
    async (body: string) => {
      await agent.call("sendMessage", [body]);
    },
    [agent],
  );

  /**
   * Mints Live View URLs for the bot's browser. Short-lived bearer
   * credentials, so they are fetched on demand and never stored.
   */
  const browserScreenshot = useCallback(
    (targetId?: string) =>
      agent.call("browserScreenshot", targetId ? [targetId] : []) as Promise<Screenshot>,
    [agent],
  );

  /**
   * Live View URLs, one per tab. Short-lived bearer credentials (~5 min), so
   * they are fetched on demand and re-minted rather than stored.
   */
  const browserLiveView = useCallback(
    () => agent.call("browserLiveView") as Promise<LiveViewTarget[]>,
    [agent],
  );

  const browserTargets = useCallback(
    () => agent.call("browserTargets") as Promise<BrowserTarget[]>,
    [agent],
  );

  const listFiles = useCallback(
    () => agent.call("listWorkspace") as Promise<WorkspaceFile[]>,
    [agent],
  );

  const readFile = useCallback(
    (path: string) =>
      agent.call("readWorkspaceFile", [path]) as Promise<
        { path: string; content: string } | { error: string }
      >,
    [agent],
  );

  return {
    browserScreenshot,
    browserTargets,
    browserLiveView,
    listFiles,
    readFile,
    messages: agent.state?.messages ?? [],
    browserLog: agent.state?.browserLog ?? [],
    status: agent.state?.status ?? "idle",
    error: agent.state?.lastError ?? null,
    connected: agent.state !== undefined,
    send,
  };
}
