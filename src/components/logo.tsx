export function Logo({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" className={className}>
      <rect width="512" height="512" rx="120" fill="var(--color-accent)" />
      <path
        d="M168 112h176a20 20 0 0 1 20 20v268l-34-22-37 22-37-22-37 22-37-22-34 22V132a20 20 0 0 1 20-20z"
        fill="var(--color-accent-ink)"
      />
      <rect x="198" y="176" width="116" height="22" rx="11" fill="var(--color-accent)" />
      <rect x="198" y="226" width="76" height="22" rx="11" fill="var(--color-accent)" opacity="0.55" />
      <rect x="198" y="296" width="116" height="26" rx="13" fill="var(--color-accent)" />
    </svg>
  );
}
