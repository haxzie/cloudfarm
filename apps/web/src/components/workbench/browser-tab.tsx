"use client";

import { Globe, Loader2, Lock, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type BrowserAction = {
  id: string;
  at: number;
  tool: string;
  summary: string;
  ok: boolean;
  /** Why it failed. Only set when `ok` is false. */
  error?: string;
};

export type BrowserTarget = {
  targetId: string;
  pageUrl?: string;
  title?: string;
};

export type Screenshot =
  | { targetId: string; pageUrl?: string; title?: string; image: string }
  | { empty: true }
  | { error: string };

type Props = {
  capture: (targetId?: string) => Promise<Screenshot>;
  targets: () => Promise<BrowserTarget[]>;
  /** What the bot has done in the browser, newest last. */
  log: BrowserAction[];
};

/** How often to grab a fresh frame while the tab is visible. */
const REFRESH_MS = 1500;

/**
 * What the bot's browser is looking at, as a stream of screenshots over CDP.
 *
 * Live View is the other option, but it is an interactive handover surface and
 * under local dev it resolves to the raw DevTools frontend. A screenshot is
 * the same picture in development and production, so that is the default; the
 * Live View link stays available for taking control.
 */
export function BrowserTab({ capture, targets, log }: Props) {
  const [shot, setShot] = useState<Screenshot | null>(null);
  const [tabs, setTabs] = useState<BrowserTarget[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  /** Aspect ratio of the remote browser window, from the frame it returns. */
  const [ratio, setRatio] = useState<number | null>(null);
  const inFlight = useRef(false);

  /** Whatever tab we are showing, so polls stay on it rather than drifting. */
  const pinned = useRef<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await capture(selected ?? pinned.current);
      if ("targetId" in next) pinned.current = next.targetId;
      setShot(next);
    } finally {
      inFlight.current = false;
    }
  }, [capture, selected]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    void targets().then(setTabs);
  }, [targets, shot]);

  const image = shot && "image" in shot ? shot : null;
  // A freshly opened session parks on about:blank; its capture is a white
  // rectangle that tells nobody anything.
  const isBlank = !image?.pageUrl || image.pageUrl === "about:blank";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Chrome's shape: a tab strip sitting on the toolbar, URL bar below. */}
      <div className="shrink-0 border-b border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-end gap-1 overflow-x-auto px-2 pt-1.5">
          {tabs.length === 0 ? (
            <div className="rounded-t-lg bg-background px-3 py-1.5 text-[11px] text-neutral-500">
              New tab
            </div>
          ) : (
            tabs.map((tab, index) => {
              const isActive = tab.targetId === (selected ?? image?.targetId);
              return (
                <button
                  key={tab.targetId}
                  type="button"
                  onClick={() => {
                    pinned.current = tab.targetId;
                    setSelected(tab.targetId);
                  }}
                  title={tab.pageUrl ?? tab.title}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex min-w-0 max-w-44 shrink-0 items-center gap-1.5 rounded-t-lg px-3 py-1.5 text-[11px] transition-colors ${
                    isActive
                      ? "bg-background font-medium"
                      : "text-neutral-500 hover:bg-neutral-200/70 dark:hover:bg-neutral-800/70"
                  }`}
                >
                  <Globe className="size-3 shrink-0 opacity-60" aria-hidden />
                  <span className="truncate">{tab.title || hostOf(tab.pageUrl) || `Tab ${index + 1}`}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="bg-background px-2 py-1.5">
          <div className="flex min-w-0 items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 dark:bg-neutral-800">
            <Lock className="size-3 shrink-0 text-neutral-500" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-500">
              {isBlank ? "Search or type a URL" : image?.pageUrl}
            </span>
          </div>
        </div>
      </div>

      {/*
        The page keeps the remote window's proportions, so the frame is shown
        whole rather than cropped or letterboxed; the action log takes whatever
        height is left. Capped so a tall window cannot squeeze the log out.
      */}
      <div
        style={ratio ? { aspectRatio: String(ratio) } : undefined}
        className={`flex max-h-[70%] w-full items-center justify-center overflow-hidden bg-neutral-100 dark:bg-neutral-900 ${
          ratio ? "shrink-0" : "min-h-0 flex-1"
        }`}
      >
        {shot === null && <Loader2 className="size-4 animate-spin text-neutral-500" aria-hidden />}

        {/*
          No session, or a tab sitting on about:blank. Either way there is no
          page to show, and a blank rectangle reads as broken — so it gets the
          same new-tab page a real browser would be showing.
        */}
        {shot && ("empty" in shot || isBlank) && <NewTabPage />}

        {shot && "error" in shot && (
          <p className="px-4 text-center text-xs text-red-500">{shot.error}</p>
        )}

        {image && !isBlank && (
          // eslint-disable-next-line @next/next/no-img-element -- a base64 frame
          <img
            src={image.image}
            alt={image.title ?? "Page"}
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalHeight > 0) setRatio(naturalWidth / naturalHeight);
            }}
            className="size-full object-contain"
          />
        )}
      </div>

      {/* What the bot did, below it. */}
      <ActionLog log={log} />
    </div>
  );
}

function ActionLog({ log }: { log: BrowserAction[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [log.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-neutral-200 dark:border-neutral-800">
      <div className="shrink-0 border-b border-neutral-200 px-3 py-1.5 text-[11px] tracking-wide text-neutral-500 uppercase dark:border-neutral-800">
        Actions
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1.5">
        {log.length === 0 ? (
          <p className="py-4 text-center text-xs text-neutral-500">
            Nothing yet. Browser steps the bot takes show up here.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {log.map((action) => (
              <li key={action.id} className="flex flex-col gap-0.5 text-[11px]">
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 text-neutral-500 tabular-nums">
                    {new Date(action.at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                  <span
                    className={`shrink-0 font-medium ${action.ok ? "" : "text-red-500"}`}
                    title={action.ok ? undefined : "Failed"}
                  >
                    {action.tool.replace(/^browser_/, "")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-neutral-500" title={action.summary}>
                    {action.summary}
                  </span>
                </div>

                {/* The reason, under the step that failed — otherwise a red
                    tool name is all anyone ever sees. */}
                {action.error && (
                  <p className="pl-[4.5rem] text-red-500/80" title={action.error}>
                    {action.error}
                  </p>
                )}
              </li>
            ))}
            <div ref={bottomRef} />
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * A browser's new-tab page, drawn rather than captured.
 *
 * Purely decorative and deliberately inert: nothing here is wired up, because
 * it stands in for a page the bot has not opened yet. Keeping the shape of a
 * real start page makes the panel read as "a browser waiting" instead of "a
 * broken preview".
 */
function NewTabPage() {
  return (
    <div
      role="img"
      aria-label="New tab — the bot has not opened a page yet"
      className="flex size-full select-none flex-col items-center justify-center gap-5 bg-white px-6 dark:bg-neutral-950"
    >
      <div className="flex size-14 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-900">
        <Globe className="size-7 text-neutral-400" aria-hidden />
      </div>

      <div className="flex w-full max-w-xs items-center gap-2 rounded-full border border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
        <Search className="size-3.5 shrink-0 text-neutral-400" aria-hidden />
        <span className="text-xs text-neutral-400">Search the web</span>
      </div>

      <div className="flex items-start gap-5">
        {SHORTCUTS.map((label) => (
          <div key={label} className="flex w-14 flex-col items-center gap-1.5">
            <div className="flex size-9 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-medium text-neutral-400 dark:bg-neutral-900">
              {label.slice(0, 1)}
            </div>
            <span className="w-full truncate text-center text-[10px] text-neutral-400">
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Stand-ins for a real browser's most-visited tiles. */
const SHORTCUTS = ["Search", "Docs", "Mail", "News"];

/** The site name, for a tab that has not reported a title yet. */
function hostOf(url?: string) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
