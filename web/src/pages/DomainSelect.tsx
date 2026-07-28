import { useNavigate } from 'react-router-dom';
import { useDomain } from '../lib/domain';
import { DOMAIN_LABELS, type Domain } from '../../../shared/types';

// The domain gate (7-software-design.md): the very first screen, every session —
// choose which world of taste you're training before seeing its fields. Plain
// in-memory state (lib/domain.tsx) means a refresh naturally re-asks.
//
// Physical vs digital, not hardware vs software: a painting isn't hardware and a
// title sequence isn't software, but every one of them sits cleanly on one side of
// "does this exist in the room with you, or on a screen?"
export function DomainSelect() {
  const navigate = useNavigate();
  const { setDomain } = useDomain();

  function choose(domain: Domain) {
    setDomain(domain);
    navigate('/datasets');
  }

  return (
    <div className="mx-auto mt-8 max-w-3xl">
      <header className="mb-10 text-center">
        <h1 className="serif text-4xl">Which taste are you training?</h1>
        <p className="mt-3 text-[var(--color-muted)]">
          TasteTrainer splits into two worlds — the physical and the digital. Pick one to see its
          fields.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {(['physical', 'digital'] as Domain[]).map((domain) => (
          <DomainCard
            key={domain}
            title={DOMAIN_LABELS[domain].title}
            tagline={DOMAIN_LABELS[domain].tagline}
            onClick={() => choose(domain)}
          />
        ))}
      </div>
    </div>
  );
}

function DomainCard({
  title,
  tagline,
  onClick,
}: {
  title: string;
  tagline: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-10 text-center transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-wall-soft)]"
    >
      <h2 className="serif text-3xl">{title}</h2>
      <p className="mt-3 text-sm text-[var(--color-muted)]">{tagline}</p>
    </button>
  );
}
