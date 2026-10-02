"use client";

import { createContext, useContext, useEffect, useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { AnimatePresence, m, useDragControls, useIsPresent, type MotionProps } from "motion/react";
import { X } from "lucide-react";
import { raiseToaster } from "@/components/toaster";
import { useMediaQuery } from "@/lib/use-media-query";

// Phones: a sheet that slides up and can be dragged down to close.
const SHEET: MotionProps = {
  initial: { y: "100%" },
  animate: { y: 0, transition: { type: "spring", duration: 0.45, bounce: 0.1 } },
  exit: { y: "100%", transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } },
};

const CENTER: MotionProps = {
  initial: { opacity: 0, scale: 0.96, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { type: "spring", duration: 0.32, bounce: 0.12 } },
  exit: { opacity: 0, scale: 0.97, y: 6, transition: { duration: 0.15, ease: "easeIn" } },
};

const DRAWER: MotionProps = {
  initial: { x: "100%" },
  animate: { x: 0, transition: { type: "spring", duration: 0.42, bounce: 0.06 } },
  exit: { x: "100%", opacity: 0.6, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } },
};

// Lets the sheet's header act as its drag handle.
const DragHandle = createContext<((event: PointerEvent) => void) | null>(null);

// Native <dialog>: focus trap, Escape to close and top-layer rendering for free.
// Bottom sheet on phones; `drawer` slides in from the right and `center`
// floats in the middle on larger screens. Content stays on screen while it
// animates out; the dialog closes once it has.
export function Dialog({
  open,
  onClose,
  variant = "center",
  width,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  variant?: "center" | "drawer";
  width?: number;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const wanted = useRef(open);
  const sheet = !useMediaQuery("(min-width: 640px)");

  useEffect(() => {
    wanted.current = open;
    const dialog = ref.current;
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      raiseToaster();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={`app-dialog ${variant}`}
      data-closing={open ? undefined : ""}
      style={width ? ({ "--dialog-width": `${width}px` } as CSSProperties) : undefined}
      onClose={() => {
        // Report closes the owner didn't ask for. When the owner closed it
        // (e.g. to open another dialog, or once it has animated out),
        // calling onClose would undo that. The event arrives a little after
        // the close: if the dialog was reopened meanwhile, it is stale.
        if (wanted.current && !ref.current?.open) onClose();
      }}
      onCancel={(event) => {
        // Escape: let the owner decide (it may ask before discarding).
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the dialog element itself is a click on the backdrop.
        if (event.target === ref.current) onClose();
      }}
    >
      <AnimatePresence
        onExitComplete={() => {
          if (!wanted.current) ref.current?.close();
        }}
      >
        {open && (
          <Panel key="panel" animation={sheet ? SHEET : variant === "drawer" ? DRAWER : CENTER} sheet={sheet} onClose={onClose}>
            {children}
          </Panel>
        )}
      </AnimatePresence>
    </dialog>
  );
}

function Panel({ animation, sheet, onClose, children }: { animation: MotionProps; sheet: boolean; onClose: () => void; children: ReactNode }) {
  const present = useIsPresent();
  const drag = useDragControls();
  const ref = useRef<HTMLDivElement>(null);
  const startDrag = sheet ? (event: PointerEvent) => drag.start(event) : null;

  // While it animates away: out of the tab order and hidden from assistive tech.
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    if (present) {
      panel.removeAttribute("aria-hidden");
      return;
    }
    if (panel.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    panel.setAttribute("aria-hidden", "true");
  }, [present]);

  return (
    <DragHandle.Provider value={startDrag}>
      <m.div
        ref={ref}
        className="dialog-panel"
        inert={!present}
        {...animation}
        drag={sheet ? "y" : false}
        dragControls={drag}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.04, bottom: 0.9 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 110 || info.velocity.y > 600) onClose();
        }}
      >
        {startDrag && (
          <div aria-hidden="true" onPointerDown={startDrag} className="flex shrink-0 touch-none justify-center pt-2.5 pb-0.5">
            <span className="h-1.5 w-10 rounded-full bg-ink/15" />
          </div>
        )}
        {children}
      </m.div>
    </DragHandle.Provider>
  );
}

export function DialogHeader({ title, onClose, children }: { title: ReactNode; onClose: () => void; children?: ReactNode }) {
  const startDrag = useContext(DragHandle);
  return (
    <div
      onPointerDown={startDrag ?? undefined}
      className={`flex items-center gap-2 border-b border-rule px-5 py-3 ${startDrag ? "touch-none pt-1.5" : ""}`}
    >
      <h2 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{title}</h2>
      {children}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="press -mr-2 grid size-10 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink"
      >
        <X className="size-5" />
      </button>
    </div>
  );
}
