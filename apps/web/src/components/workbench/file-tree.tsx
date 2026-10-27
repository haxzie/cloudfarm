"use client";

import { ChevronDown, ChevronRight, File as FileIcon } from "lucide-react";
import { useMemo, useState } from "react";

export type WorkspaceFile = {
  path: string;
  bytes: number;
  uploadedAt: string;
};

type Node = {
  name: string;
  path: string;
  children?: Node[];
  file?: WorkspaceFile;
};

/** Flat R2 keys -> a folder tree, folders first and alphabetical. */
function buildTree(files: WorkspaceFile[]): Node[] {
  const root: Node = { name: "", path: "", children: [] };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let node = root;

    parts.forEach((part, index) => {
      const isLeaf = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join("/");

      node.children ??= [];
      let next = node.children.find((child) => child.name === part);

      if (!next) {
        next = isLeaf ? { name: part, path, file } : { name: part, path, children: [] };
        node.children.push(next);
      }
      node = next;
    });
  }

  const sort = (nodes: Node[]): Node[] =>
    nodes
      .map((node) => (node.children ? { ...node, children: sort(node.children) } : node))
      .sort((a, b) => {
        const aFolder = Boolean(a.children);
        const bFolder = Boolean(b.children);
        if (aFolder !== bFolder) return aFolder ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

  return sort(root.children ?? []);
}

export function FileTree({
  files,
  selected,
  onSelect,
}: {
  files: WorkspaceFile[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);

  return (
    <ul className="py-1">
      {tree.map((node) => (
        <TreeNode key={node.path} node={node} depth={0} selected={selected} onSelect={onSelect} />
      ))}
    </ul>
  );
}

function TreeNode({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: Node;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(depth === 0);
  const isFolder = Boolean(node.children);
  const isSelected = node.path === selected;

  return (
    <li>
      <button
        type="button"
        onClick={() => (isFolder ? setIsOpen((open) => !open) : onSelect(node.path))}
        aria-expanded={isFolder ? isOpen : undefined}
        className={`flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs transition-colors ${
          isSelected
            ? "bg-neutral-200 dark:bg-neutral-800"
            : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {isFolder ? (
          isOpen ? (
            <ChevronDown className="size-3.5 shrink-0 text-neutral-500" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-neutral-500" aria-hidden />
          )
        ) : (
          <FileIcon className="size-3.5 shrink-0 text-neutral-500" aria-hidden />
        )}
        <span className="truncate">{node.name}</span>
      </button>

      {isFolder && isOpen && (
        <ul>
          {node.children?.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
