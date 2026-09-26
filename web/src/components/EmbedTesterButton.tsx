import { useLocation } from 'react-router-dom';
import { useDevice, useEditMode } from '../pages/IframeTester';


// The mobile/desktop and edit switches for /iframe (the embed widget's preview page). The way
// in is the account menu (AccountButton). Mounted alongside the account button
// the same way it is: fixed in the window's right margin at `xl`+, inline in the nav
// pill below that.
export function EmbedTesterButton({ className = '' }: { className?: string }) {
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

  // Off the tester there's nothing to show: the way in lives in the account menu
  // (AccountButton), and only for a signed-in user.
  return null;
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
