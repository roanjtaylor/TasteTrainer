// Spotify's shuffle control: two curvy arrows crossing over. Off (the default look) it is
// plain, meaning linear order; on, it is coloured with a dot at the top right, meaning a
// shuffled pass. One button in place of a shuffle/linear pair — the state is the colour.
export function ShuffleButton({
  on,
  onChange,
  className = '',
  compact = false,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  className?: string;
  /** Matches the height of a small text pill (the view switch's 22px) instead of a 30px icon button. */
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      aria-label={on ? 'Shuffle: on — switch to linear order' : 'Linear order — turn shuffle on'}
      title={on ? 'Shuffle on' : 'Shuffle off'}
      className={`relative inline-flex items-center justify-center rounded-full ${compact ? 'h-[22px] w-[22px]' : 'p-1.5'} ${
        on ? 'text-[var(--color-accent)]' : 'opacity-70 hover:opacity-100'
      } ${className}`}
    >
      <svg width={compact ? 14 : 18} height={compact ? 14 : 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 18h3.5c2 0 3.5-1 4.7-2.8l3.6-6.4C15 7 16.5 6 18.5 6H22" />
        <path d="M2 6h3.5c2 0 3.5 1 4.7 2.8" />
        <path d="M13.8 15.2C15 17 16.5 18 18.5 18H22" />
        <path d="M19 3l3 3-3 3" />
        <path d="M19 15l3 3-3 3" />
      </svg>
      {on && <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-current" />}
    </button>
  );
}
