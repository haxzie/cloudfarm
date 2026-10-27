"use client";

import { ChatApp } from "@/components/chat/chat-app";
import { SignInScreen } from "@/components/sign-in-screen";
import { useSession } from "@/lib/auth-client";

export function HomeScreen() {
  const { data: session, isPending, refetch } = useSession();

  if (isPending) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-neutral-500">Loading…</p>
      </div>
    );
  }

  if (!session) return <SignInScreen />;

  return <ChatApp user={session.user} onSignOut={() => refetch()} />;
}
