"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { m } from "motion/react";
import { House } from "lucide-react";
import { Logo } from "@/components/logo";

const TABS = [
  { href: "/", label: "Home", short: null },
  { href: "/documents", label: "Documents", short: "Docs" },
  { href: "/bank", label: "Bank", short: "Bank" },
  { href: "/card", label: "Card", short: "Card" },
] as const;

type Href = (typeof TABS)[number]["href"];

// Moving between sections, the white pill glides from the old section to the
// new one (a shared layoutId, after 21st.dev's "Animated Tabs"). Without
// `onAccount` the header is a placeholder for loading screens.
export function AppHeader({
  active,
  email = "",
  badges,
  onAccount,
  children,
}: {
  active: Href;
  email?: string;
  badges?: Partial<Record<Href, number>>; // matches waiting for approval
  onAccount?: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-rule/80 bg-paper/90 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-1.5 px-4 sm:gap-2 sm:px-6">
        {/* Phones need the room for four sections: Home is a house there, and the logo goes. */}
        <Logo className="hidden size-8 shrink-0 sm:block" />
        <nav className="flex rounded-full bg-ink/[0.055] p-1 sm:ml-2" aria-label="Sections">
          {TABS.map((tab) => {
            const current = active === tab.href;
            const badge = badges?.[tab.href] ?? 0;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={`press relative rounded-full px-2.5 py-1.5 text-[0.92rem] font-semibold sm:px-3.5 ${
                  current ? "text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {current && (
                  <m.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-full bg-raised shadow-raised"
                    transition={{ type: "spring", duration: 0.45, bounce: 0.12 }}
                  />
                )}
                <span className="relative block">
                  {tab.short ? (
                    <span className="sm:hidden">{tab.short}</span>
                  ) : (
                    <House aria-hidden="true" className="my-0.5 size-[1.15rem] sm:hidden" />
                  )}
                  <span className={tab.short ? "hidden sm:inline" : "sr-only sm:not-sr-only"}>{tab.label}</span>
                </span>
                {badge > 0 && (
                  <span
                    key={badge}
                    className="nums absolute -top-1.5 -right-1.5 grid h-[1.125rem] min-w-[1.125rem] animate-pop place-items-center rounded-full bg-accent px-1 text-[0.65rem] leading-none font-semibold text-accent-ink ring-2 ring-paper"
                    title={`${badge} to approve`}
                  >
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="flex-1" />
        {children}
        {onAccount ? (
          <button
            type="button"
            onClick={onAccount}
            aria-label="Account"
            className="press ml-1 grid size-10 shrink-0 place-items-center rounded-full bg-ink/[0.06] text-sm font-semibold uppercase ring-1 ring-ink/[0.04] ring-inset hover:bg-ink/10"
          >
            {email.slice(0, 1) || "?"}
          </button>
        ) : (
          <span aria-hidden="true" className="skeleton ml-1 size-10 shrink-0 rounded-full" />
        )}
      </div>
    </header>
  );
}
