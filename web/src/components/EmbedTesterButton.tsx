// A quick way in to /embed-tester.html (the standalone, movable/resizable iframe
// harness for iterating on the embed widget) without hunting for the URL. Mounted
// alongside the account button the same way it is: fixed in the window's
// right margin at `xl`+, inline in the nav pill below that.
export function EmbedTesterButton({ className = '' }: { className?: string }) {
  return (
    <button
      onClick={() => window.open('/embed-tester.html', '_blank', 'noopener')}
      title="Test the embed widget"
      aria-label="Open embed tester"
      className={`h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3c2.8 2.6 4.2 5.8 4.2 9s-1.4 6.4-4.2 9c-2.8-2.6-4.2-5.8-4.2-9s1.4-6.4 4.2-9z" />
      </svg>
    </button>
  );
}
