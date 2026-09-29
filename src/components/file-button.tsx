"use client";

import type { ReactNode } from "react";

// A label wrapping a hidden file input: opens the picker (or camera) natively,
// with no programmatic clicks.
export function FileButton({
  accept,
  capture,
  multiple,
  disabled,
  onFiles,
  label,
  className,
  children,
}: {
  accept: string;
  capture?: boolean;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  label?: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <label
      aria-disabled={disabled || undefined}
      className={`cursor-pointer select-none has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent aria-disabled:pointer-events-none aria-disabled:opacity-50 ${className}`}
    >
      <input
        type="file"
        accept={accept}
        capture={capture ? "environment" : undefined}
        multiple={multiple}
        disabled={disabled}
        aria-label={label}
        className="sr-only"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      {children}
    </label>
  );
}
