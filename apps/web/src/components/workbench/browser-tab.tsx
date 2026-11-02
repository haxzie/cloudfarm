"use client";

import { Globe, Loader2, Lock, MousePointerClick, Search } from "lucide-react";
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

export type LiveViewTarget = {
  targetId: string;
  /** Embeddable Live View URL. A ~5 minute bearer credential — never stored. */
  url: string;
  pageUrl?: string;
  title?: string;
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
  liveView: () => Promise<LiveViewTarget[]>;
  /** What the bot has done in the browser, newest last. */
  log: BrowserAction[];
};

/** How often to grab a fresh frame while the tab is visible. */
const REFRESH_MS = 1500;

/** Live View URLs expire in ~5 minutes; re-mint well inside that. */
const LIVE_VIEW_REFRESH_MS = 60_000;

/**
 * Live View renders its own toolbar that cannot be turned off. The iframe is
 * shifted up by its height so the page meets our URL bar cleanly.
 */
const LIVE_VIEW_TOOLBAR_PX = 49;

/**
 * What the bot's browser is looking at, as a stream of screenshots over CDP.
 *
 * Live View is the other option, but it is an interactive handover surface and
 * under local dev it resolves to the raw DevTools frontend. A screenshot is
 * the same picture in development and production, so that is the default; the
 * Live View link stays available for taking control.
 */
export function BrowserTab({ capture, targets, liveView, log }: Props) {
  const [shot, setShot] = useState<Screenshot | null>(null);
  const [tabs, setTabs] = useState<BrowserTarget[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  /** Aspect ratio of the remote browser window, from the frame it returns. */
  const [ratio, setRatio] = useState<number | null>(null);
  const inFlight = useRef(false);

  /** Whatever tab we are showing, so polls stay on it rather than drifting. */
  const pinned = useRef<string | undefined>(undefined);

  /**
   * The last frame seen for each tab. Switching shows the cached one straight
   * away and replaces it when the fresh capture lands, so a click feels
   * instant instead of waiting on a CDP round trip.
   */
  const frames = useRef(new Map<string, Screenshot>());

  const remember = useCallback((next: Screenshot) => {
    if ("targetId" in next) frames.current.set(next.targetId, next);
  }, []);

  /**
   * Live View URLs keyed by target. Cloudflare streams the page straight to
   * the iframe, so the Worker is not in the data path and there is no frame
   * to poll — the screenshot path below is only the fallback.
   */
  const [views, setViews] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const mint = () =>
      void liveView()
        .then((next) =>
          // Keep the URL already in an iframe: swapping src tears the stream
          // down and reconnects for no reason. Only new tabs get fresh URLs.
          setViews((prev) => {
            const merged = new Map<string, string>();
            for (const target of next) {
              merged.set(target.targetId, prev.get(target.targetId) ?? target.url);
            }
            return merged;
          }),
        )
        .catch(() => {});

    mint();
    // Comfortably inside the ~5 minute expiry.
    const timer = setInterval(mint, LIVE_VIEW_REFRESH_MS);
    return () => clearInterval(timer);
  }, [liveView]);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await capture(selected ?? pinned.current);
      if ("targetId" in next) pinned.current = next.targetId;
      remember(next);
      setShot(next);
    } finally {
      inFlight.current = false;
    }
  }, [capture, selected, remember]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    void targets().then((next) =>
      // Keep the order tabs were first seen in. The CDP target listing is not
      // ordered, so assigning it straight to state reshuffles the strip on
      // every poll and the active tab visibly jumps.
      setTabs((prev) => {
        const seen = new Map(next.map((tab) => [tab.targetId, tab]));
        const kept = prev
          .filter((tab) => seen.has(tab.targetId))
          .map((tab) => seen.get(tab.targetId)!);
        const added = next.filter(
          (tab) => !prev.some((old) => old.targetId === tab.targetId),
        );
        return [...kept, ...added];
      }),
    );
  }, [targets, shot]);

  /**
   * Warm each new tab once, so the first switch to it is instant too. Only
   * once per tab rather than on a loop — every capture is a CDP attach, and a
   * blank tab is skipped because capturing one makes the server raise it,
   * which would steal the foreground from the bot.
   */
  useEffect(() => {
    const cold = tabs.find(
      (tab) =>
        !frames.current.has(tab.targetId) &&
        tab.pageUrl &&
        tab.pageUrl !== "about:blank",
    );
    if (!cold || inFlight.current) return;

    let cancelled = false;
    void (async () => {
      inFlight.current = true;
      try {
        const next = await capture(cold.targetId);
        if (!cancelled) remember(next);
      } finally {
        inFlight.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tabs, capture, remember]);

  const [interactive, setInteractive] = useState(false);
  const image = shot && "image" in shot ? shot : null;

  /** The Live View stream for whichever tab is selected, when there is one. */
  const activeId = selected ?? image?.targetId ?? tabs[0]?.targetId;
  const liveUrl = activeId ? views.get(activeId) : undefined;
  const live = liveUrl
    ? { targetId: activeId!, url: liveUrl, ...tabs.find((t) => t.targetId === activeId) }
    : null;
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
                    // Paint the cached frame now; the poll replaces it with a
                    // fresh one a moment later.
                    const cached = frames.current.get(tab.targetId);
                    if (cached) setShot(cached);
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

        <div className="flex items-center gap-2 bg-background px-2 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 dark:bg-neutral-800">
            <Lock className="size-3 shrink-0 text-neutral-500" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-500">
              {live?.pageUrl ?? (isBlank ? "Search or type a URL" : image?.pageUrl)}
            </span>
          </div>

          {/*
            Only offered while a stream is up — there is nothing to click on a
            screenshot. Taking control types into the same browser the bot is
            using, so it is off until asked for.
          */}
          {live && (
            <button
              type="button"
              onClick={() => setInteractive((on) => !on)}
              aria-pressed={interactive}
              title={
                interactive
                  ? "Give the browser back to the bot"
                  : "Click and type in the bot's browser"
              }
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                interactive
                  ? "bg-foreground text-background"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-foreground dark:hover:bg-neutral-800"
              }`}
            >
              <MousePointerClick className="size-3.5" aria-hidden />
              {interactive ? "You have control" : "Take control"}
            </button>
          )}
        </div>
      </div>

      {/*
        The page keeps the remote window's proportions, so the frame is shown
        whole rather than cropped or letterboxed; the action log takes whatever
        height is left. Capped so a tall window cannot squeeze the log out.
      */}
      <div
        style={ratio ? { aspectRatio: String(ratio) } : undefined}
        className={`relative flex max-h-[70%] w-full items-center justify-center overflow-hidden bg-neutral-100 dark:bg-neutral-900 ${
          ratio ? "shrink-0" : "min-h-0 flex-1"
        }`}
      >
        {live ? (
          /*
            Cloudflare streams the page into this iframe directly, so it is
            real-time and costs the Worker nothing. Shifted up by the height of
            Live View's own toolbar, which cannot be hidden — the tab strip and
            URL bar above stand in for it.

            Not interactive by default: the bot is driving, and a stray click
            would fight it. "Take control" hands the page over deliberately.
          */
          <iframe
            key={live.targetId}
            src={live.url}
            title={live.title || live.pageUrl || "The bot's browser"}
            allow="clipboard-read; clipboard-write"
            tabIndex={interactive ? 0 : -1}
            style={{
              top: -LIVE_VIEW_TOOLBAR_PX,
              height: `calc(100% + ${LIVE_VIEW_TOOLBAR_PX}px)`,
            }}
            className={`absolute inset-x-0 w-full border-0 bg-white ${
              interactive ? "" : "pointer-events-none"
            }`}
          />
        ) : null}

        {!live && shot === null && (
          <Loader2 className="size-4 animate-spin text-neutral-500" aria-hidden />
        )}

        {/*
          No session, or a tab sitting on about:blank. Either way there is no
          page to show, and a blank rectangle reads as broken — so it gets the
          same new-tab page a real browser would be showing.
        */}
        {!live && shot && ("empty" in shot || isBlank) && <NewTabPage />}

        {!live && shot && "error" in shot && (
          <p className="px-4 text-center text-xs text-red-500">{shot.error}</p>
        )}

        {!live && image && !isBlank && (
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
