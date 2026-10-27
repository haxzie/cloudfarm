export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

/** Host:port form the agents client needs for its WebSocket. */
export const API_HOST = API_URL.replace(/^https?:\/\//, "");

export type Bot = {
  id: string;
  name: string;
  description: string;
  charter: string;
  avatarShape: string;
  avatarColor: string;
  model: string;
  lastMessagePreview: string | null;
  lastMessageAuthor: "user" | "bot" | null;
  lastMessageAt: number | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `${init?.method ?? "GET"} ${path} failed (${response.status})`);
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export function listBots() {
  return request<{ bots: Bot[] }>("/api/bots").then((data) => data.bots);
}

export function createBot(input: {
  name: string;
  description?: string;
  avatarShape: string;
  avatarColor: string;
}) {
  return request<{ bot: Bot }>("/api/bots", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((data) => data.bot);
}

export function deleteBot(id: string) {
  return request<void>(`/api/bots/${id}`, { method: "DELETE" });
}
