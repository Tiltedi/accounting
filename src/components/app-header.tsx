"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

const TABS = [
  { href: "/", label: "Documents", short: "Docs" },
  { href: "/bank", label: "Bank", short: "Bank" },
  { href: "/card", label: "Card", short: "Card" },
] as const;

type Href = (typeof TABS)[number]["href"];

export function AppHeader({
  active,
  email,
  badges,
  onAccount,
  children,
}: {
  active: Href;
  email: string;
  badges?: Partial<Record<Href, number>>; // matches waiting for approval
  onAccount: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-paper/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-1.5 px-4 sm:gap-2 sm:px-6">
        <Logo className="size-8 shrink-0" />
        <nav className="flex gap-0.5 sm:ml-3 sm:gap-1" aria-label="Sections">
          {TABS.map((tab) => {
            const badge = badges?.[tab.href] ?? 0;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active === tab.href ? "page" : undefined}
                className={`relative rounded-full px-2.5 py-1.5 text-[0.95rem] font-semibold transition sm:px-3 ${
                  active === tab.href ? "bg-ink/[0.07] text-ink" : "text-muted hover:text-ink"
                }`}
              >
                <span className="sm:hidden">{tab.short}</span>
                <span className="hidden sm:inline">{tab.label}</span>
                {badge > 0 && (
                  <span
                    className="nums absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[0.65rem] leading-none font-semibold text-accent-ink"
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
        <button
          type="button"
          onClick={onAccount}
          aria-label="Account"
          className="ml-1 grid size-10 shrink-0 place-items-center rounded-full bg-ink/[0.06] text-sm font-semibold uppercase hover:bg-ink/10"
        >
          {email.slice(0, 1) || "?"}
        </button>
      </div>
    </header>
  );
}
