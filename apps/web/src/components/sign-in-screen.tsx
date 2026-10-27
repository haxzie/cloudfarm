"use client";

import { BotAvatar } from "@cloudfarm/bot-avatar";

import { AuthPanel } from "@/components/auth-panel";
import { Brand } from "@/components/chat/brand";

/**
 * The cast shown above the headline. Hand-picked rather than random so the
 * shapes and colours stay distinct from each other at this size.
 */
const CAST = [
  { shape: "squircle", color: "coral", size: 44, lift: "translate-y-1" },
  { shape: "star", color: "amber", size: 52, lift: "" },
  { shape: "cloud", color: "fern", size: 60, lift: "-translate-y-1.5" },
  { shape: "droplet", color: "azure", size: 52, lift: "" },
  { shape: "hex", color: "violet", size: 44, lift: "translate-y-1" },
];

export function SignInScreen() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <Brand size="lg" />

        {/*
          Spaced, not overlapping: the avatars share a gooey SVG filter, so
          shapes that touch melt into one blob. Sized and lifted into an arc
          instead, which reads as a group while keeping each silhouette.
          They animate on their own, so the page has life without anything
          blinking for attention.
        */}
        <div className="mt-10 flex items-center gap-2.5">
          {CAST.map((bot) => (
            <div key={bot.shape} className={bot.lift}>
              <BotAvatar shape={bot.shape} color={bot.color} size={bot.size} />
            </div>
          ))}
        </div>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight text-balance">
          AI teammates with their own computer
        </h1>

        <p className="mt-3 text-sm leading-relaxed text-neutral-500 text-balance">
          Every bot gets a workspace, a shell and a browser — and keeps notes between
          conversations.
        </p>

        <div className="mt-9 w-full">
          <AuthPanel />
        </div>

        <p className="mt-6 text-xs text-neutral-500">
          Signing in creates your account if you do not have one.
        </p>
      </div>
    </main>
  );
}
