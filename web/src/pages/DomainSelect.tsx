import { useNavigate } from 'react-router-dom';
import { DOMAIN_LABELS, type Domain } from '../../../shared/types';

// The domain gate (7-software-design.md): the way in — choose which world of taste
// you're training before seeing its fields. Each choice is a URL (/physical,
// /digital), so a bookmark or a shared link can also skip straight past this.
//
// Physical vs digital, not hardware vs software: a painting isn't hardware and a
// title sequence isn't software, but every one of them sits cleanly on one side of
// "does this exist in the room with you, or on a screen?"
export function DomainSelect() {
  const navigate = useNavigate();

  // Choosing a world *is* navigating to it — /physical and /digital are the shelves
  // (lib/domain.tsx), so there's no separate state to set.
  function choose(domain: Domain) {
    navigate(`/${domain}`);
  }

  return (
    <div className="mx-auto mt-8 max-w-3xl">
      <header className="mb-10 text-center">
        <h1 className="serif text-4xl">Which taste are you training?</h1>
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
