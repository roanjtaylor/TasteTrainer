// A product-styled stand-in for window.confirm() — the browser dialog reads as
// "localhost says", which looks like the app is broken rather than asking a real
// question. Used anywhere accepting a change is destructive enough to confirm first
// (redrawing a map, applying a boundary fix).
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="serif text-xl">{title}</h3>
        <p className="mt-2 whitespace-pre-line text-sm text-[var(--color-muted)]">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-full border border-[var(--color-line)] px-4 py-1.5 text-sm hover:bg-[var(--color-wall-soft)]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-full bg-[var(--color-ink)] px-4 py-1.5 text-sm text-[var(--color-wall)]"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
