import type { ComponentType, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

type Icon = ComponentType<{ className?: string }>;

// A fanned stack of icon tiles over a short message (after 21st.dev's "Empty").
export function EmptyState({
  icon: Icon,
  behind,
  busy = false,
  title,
  children,
}: {
  icon: Icon;
  behind: [Icon, Icon];
  busy?: boolean;
  title: ReactNode;
  children?: ReactNode;
}) {
  const [Left, Right] = behind;
  const side =
    "absolute top-2.5 grid size-12 place-items-center rounded-xl border border-rule bg-card text-muted/70 shadow-card transition duration-300 ease-out";
  return (
    <div className="group ruled mt-6 flex animate-rise flex-col items-center rounded-3xl border border-dashed border-rule-strong px-6 py-16 text-center">
      <div aria-hidden="true" className="relative mb-6 flex h-16 w-40 justify-center">
        <span className={`${side} left-3 -rotate-12 group-hover:-translate-x-1.5 group-hover:-rotate-[18deg]`}>
          <Left className="size-5" />
        </span>
        <span className={`${side} right-3 rotate-12 group-hover:translate-x-1.5 group-hover:rotate-[18deg]`}>
          <Right className="size-5" />
        </span>
        <span className="relative grid size-16 place-items-center rounded-2xl border border-rule bg-card text-accent shadow-raised transition duration-300 ease-out group-hover:-translate-y-1">
          {busy ? <LoaderCircle className="size-7 animate-spin" /> : <Icon className="size-7" />}
        </span>
      </div>
      <p className="text-lg font-semibold tracking-tight">{title}</p>
      {children && <p className="mt-1.5 max-w-sm text-sm text-balance text-muted">{children}</p>}
    </div>
  );
}
