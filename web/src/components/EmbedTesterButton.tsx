import { useLocation, useNavigate } from 'react-router-dom';
import { useDevice, useEditMode } from '../pages/IframeTester';

const ICON = 'h-[18px] w-[18px]';
const SVG = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

// The way in to /iframe (the embed widget's preview page) — and once you're there, the
// mobile/desktop switch for it, in the same spot. Mounted alongside the account button
// the same way it is: fixed in the window's right margin at `xl`+, inline in the nav
// pill below that.
export function EmbedTesterButton({ className = '' }: { className?: string }) {
  const navigate = useNavigate();
  const onTester = useLocation().pathname === '/iframe';
  const [device, setDevice] = useDevice();
  const [editing, setEditing] = useEditMode();

  if (onTester) {
    // Two iOS-style switches, stacked. Device: off = desktop (the default), on = mobile.
    // Mode: on = edit (the default, attributes pane showing), off = view.
    return (
      <div className={`flex-col justify-center gap-0.5 rounded-xl px-2.5 py-1 ${className}`}>
        <Switch label="Mobile" on={device === 'mobile'} onChange={(v) => setDevice(v ? 'mobile' : 'desktop')} />
        <Switch label="Edit" on={editing} onChange={setEditing} />
      </div>
    );
  }

  return (
    <button
      onClick={() => navigate('/iframe')}
      title="Test the embed widget"
      aria-label="Open embed tester"
      className={`h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] ${className}`}
    >
      <svg {...SVG} className={ICON}>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3c2.8 2.6 4.2 5.8 4.2 9s-1.4 6.4-4.2 9c-2.8-2.6-4.2-5.8-4.2-9s1.4-6.4 4.2-9z" />
      </svg>
    </button>
  );
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex h-[22px] items-center justify-between gap-2 text-sm text-[var(--color-ink)]"
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={`relative h-[20px] w-[34px] rounded-full transition-colors ${on ? 'bg-[#34c759]' : 'bg-[var(--color-line)]'}`}
      >
        <span
          className={`absolute left-[2px] top-[2px] h-[16px] w-[16px] rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[14px]' : ''}`}
        />
      </span>
    </button>
  );
}
