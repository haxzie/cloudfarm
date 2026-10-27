import type { BotAgent } from "./bot-agent";
import type { WorkspaceAgent } from "./workspace-agent";

/**
 * `cf workers types` types every Durable Object binding as the union of the
 * Worker's Durable Object classes, rather than the one its `exportName` names.
 * These narrow it back down at the point of use. Worth retrying once `cf` is
 * out of beta — if the union is gone, these become redundant.
 */
export function botAgents(env: Env) {
  return env.BotAgent as DurableObjectNamespace<BotAgent>;
}

export function workspaceAgents(env: Env) {
  return env.WorkspaceAgent as DurableObjectNamespace<WorkspaceAgent>;
}
