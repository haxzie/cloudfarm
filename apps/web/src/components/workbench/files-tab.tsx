"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { FileTree, type WorkspaceFile } from "./file-tree";

type Props = {
  list: () => Promise<WorkspaceFile[]>;
  read: (path: string) => Promise<{ path: string; content: string } | { error: string }>;
};

export function FilesTab({ list, read }: Props) {
  const [files, setFiles] = useState<WorkspaceFile[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setFiles(await list());
  }, [list]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external fetch on mount
    void refresh();
  }, [refresh]);

  async function open(path: string) {
    setSelected(path);
    setPreview(null);
    setPreviewError(null);

    const result = await read(path);
    if ("error" in result) setPreviewError(result.error);
    else setPreview(result.content);
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Tree on the left, preview on the right. */}
      <div className="flex w-48 shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-neutral-200 px-3 dark:border-neutral-800">
          <span className="text-[11px] tracking-wide text-neutral-500 uppercase">Files</span>
          <button
            type="button"
            onClick={() => void refresh()}
            aria-label="Refresh files"
            title="Refresh"
            className="flex size-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-foreground dark:hover:bg-neutral-800"
          >
            <RefreshCw className="size-3.5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {files === null ? (
            <div className="flex h-20 items-center justify-center">
              <Loader2 className="size-4 animate-spin text-neutral-500" aria-hidden />
            </div>
          ) : files.length === 0 ? (
            <p className="px-3 py-6 text-xs text-neutral-500">
              No files yet. The bot writes here with its file tools and its shell.
            </p>
          ) : (
            <FileTree files={files} selected={selected} onSelect={(path) => void open(path)} />
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center border-b border-neutral-200 px-3 dark:border-neutral-800">
          <span className="truncate text-[11px] text-neutral-500">
            {selected ?? "No file selected"}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {selected === null ? (
            <p className="px-3 py-6 text-center text-xs text-neutral-500">
              Select a file to preview it.
            </p>
          ) : previewError ? (
            <p className="px-3 py-4 text-xs text-red-500">{previewError}</p>
          ) : preview === null ? (
            <div className="flex h-20 items-center justify-center">
              <Loader2 className="size-4 animate-spin text-neutral-500" aria-hidden />
            </div>
          ) : (
            <pre className="px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre">
              {preview}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
