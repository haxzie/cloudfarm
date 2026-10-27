import { LayoutGrid, LogOut } from "lucide-react";
import Image from "next/image";

import { Avatar } from "./avatar";

export type SessionUser = {
  name: string;
  email: string;
  image?: string | null;
};

type Props = {
  user: SessionUser;
  onOpenConnectors: () => void;
  onSignOut: () => void;
};

export function UserFooter({ user, onOpenConnectors, onSignOut }: Props) {
  return (
    <div className="mx-3 mb-2 flex items-center gap-1 px-2 py-2">
      <span title={`${user.name} · ${user.email}`.trim()}>
        {user.image ? (
          <Image
            src={user.image}
            alt={user.name || user.email}
            width={36}
            height={36}
            className="size-9 shrink-0 rounded-full"
          />
        ) : (
          <Avatar name={user.name || user.email} />
        )}
      </span>

      <span className="flex-1" />

      <button
        type="button"
        onClick={onOpenConnectors}
        title="Connectors"
        aria-label="Connectors"
        className="flex size-9 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-foreground dark:hover:bg-neutral-800"
      >
        <LayoutGrid className="size-[18px]" aria-hidden />
      </button>

      <button
        type="button"
        onClick={onSignOut}
        title="Sign out"
        aria-label="Sign out"
        className="flex size-9 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-foreground dark:hover:bg-neutral-800"
      >
        <LogOut className="size-4" aria-hidden />
      </button>
    </div>
  );
}
