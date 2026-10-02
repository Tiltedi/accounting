"use client";

import type { ReactNode } from "react";
import { LazyMotion, MotionConfig, domMax } from "motion/react";

// Bundles only the animation features in use (layout, drag, exit). Loaded with
// the page, not lazily: a late load re-renders this provider while streamed
// content may still be hydrating, which makes React drop the server HTML.
// Reduced-motion users get fades instead of movement.
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
