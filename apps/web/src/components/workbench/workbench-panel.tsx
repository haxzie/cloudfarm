"use client";

import { FolderTree, Globe } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import {
  BrowserTab,
  type BrowserAction,
  type BrowserTarget,
  type Screenshot,
} from "./browser-tab";
import type { WorkspaceFile } from "./file-tree";
import { FilesTab } from "./files-tab";

const TABS = [
  { id: "files", label: "Files", icon: FolderTree },
  { id: "browser", label: "Browser", icon: Globe },
] as const;

type TabId = (typeof TABS)[number]["id"];

type Props = {
  listFiles: () => Promise<WorkspaceFile[]>;
  readFile: (path: string) => Promise<{ path: string; content: string } | { error: string }>;
  browserScreenshot: (targetId?: string) => Promise<Screenshot>;
  browserTargets: () => Promise<BrowserTarget[]>;
  browserLog: BrowserAction[];
};

const MIN_WIDTH = 360;
const MAX_WIDTH = 1000;
const DEFAULT_WIDTH = 512;
const WIDTH_KEY = "cloudfarm:workbench-width";

/** The bot's computer, beside its conversation. */
export function WorkbenchPanel({
  listFiles,
  readFile,
  browserScreenshot,
  browserTargets,
  browserLog,
}: Props) {
  const [tab, setTab] = useState<TabId>("files");
  // Read on first render rather than in an effect: localStorage is only there
  // on the client, and this component never renders on the server.
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    return stored >= MIN_WIDTH && stored <= MAX_WIDTH ? stored : DEFAULT_WIDTH;
  });
  const dragging = useRef(false);
  // The latest width, written synchronously during the drag: reading the state
  // in pointerup gets the value from before the move's re-render.
  const latestWidth = useRef(DEFAULT_WIDTH);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    // The panel is on the right, so its width grows as the pointer moves left.
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - event.clientX));
    latestWidth.current = next;
    setWidth(next);
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    localStorage.setItem(WIDTH_KEY, String(latestWidth.current));
  }, []);

  return (
    <aside
      style={{ width }}
      className="relative hidden shrink-0 flex-col border-l border-neutral-200 xl:flex dark:border-neutral-800"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the panel"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => {
          latestWidth.current = DEFAULT_WIDTH;
          setWidth(DEFAULT_WIDTH);
          localStorage.setItem(WIDTH_KEY, String(DEFAULT_WIDTH));
        }}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-neutral-300/60 dark:hover:bg-neutral-700/60"
      />
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-neutral-200 px-2 dark:border-neutral-800">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-colors ${
                isActive
                  ? "bg-neutral-100 font-medium dark:bg-neutral-800"
                  : "text-neutral-500 hover:bg-neutral-100/60 hover:text-foreground dark:hover:bg-neutral-800/60"
              }`}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          );
        })}
      </div>

      {/* Each tab keeps its own state, so they are mounted on demand and
          unmounted when hidden. */}
      {tab === "files" && <FilesTab list={listFiles} read={readFile} />}
      {tab === "browser" && (
        <BrowserTab
          capture={browserScreenshot}
          targets={browserTargets}
          log={browserLog}
        />
      )}
    </aside>
  );
}
