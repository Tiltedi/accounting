"use client";

import { useEffect, useRef, useState } from "react";

// Files dropped anywhere on the page go to `onFiles`. Returns whether files
// are being dragged over the window, to show a drop target.
export function useFileDrop(onFiles: (files: File[]) => void, enabled = true) {
  const [dragging, setDragging] = useState(false);
  const handler = useRef(onFiles);
  useEffect(() => {
    handler.current = onFiles;
  }, [onFiles]);

  useEffect(() => {
    if (!enabled) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes("Files"));
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    // Capture phase: resets even when an element (a bank line) takes the drop.
    const onAnyDrop = () => {
      depth = 0;
      setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) handler.current(files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onAnyDrop, true);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("drop", onAnyDrop, true);
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      setDragging(false);
    };
  }, [enabled]);

  return enabled && dragging;
}
