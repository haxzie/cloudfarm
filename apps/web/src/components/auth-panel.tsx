"use client";

import { useState } from "react";

import { authClient } from "@/lib/auth-client";

export function AuthPanel() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * One flow for both cases: Better Auth creates the account on the first
   * GitHub callback and signs the user in on every one after that.
   */
  async function signInWithGitHub() {
    setBusy(true);
    setError(null);

    const { error: socialError } = await authClient.signIn.social({
      provider: "github",
      callbackURL: window.location.origin,
      errorCallbackURL: window.location.origin,
    });

    // On success the browser leaves for GitHub, so this only runs on failure.
    if (socialError) {
      setBusy(false);
      setError(socialError.message ?? "Could not start GitHub sign-in");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={signInWithGitHub}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-foreground px-4 py-3.5 text-sm font-medium text-background shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {/* lucide dropped brand marks, so the GitHub logo stays as a path. */}
        <svg viewBox="0 0 16 16" aria-hidden className="size-4 fill-current">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
        {busy ? "Opening GitHub…" : "Continue with GitHub"}
      </button>

      {error && <p className="text-center text-xs text-red-500">{error}</p>}
    </div>
  );
}
