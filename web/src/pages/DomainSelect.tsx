import { useNavigate } from 'react-router-dom';
import { DOMAIN_LABELS, DOMAINS, type Domain } from '../../../shared/types';

const DOMAIN_EXAMPLES: Record<Domain, string> = {
  physical: 'Paintings, cars, watches',
  digital: 'Websites, apps, browsers',
  personal: 'Books, movies, family memories',
};

// The domain gate (7-software-design.md): the way in — choose which world of taste
// you're training before seeing its fields. Each choice is a URL (/physical,
// /digital), so a bookmark or a shared link can also skip straight past this.
//
// Physical vs digital, not hardware vs software: a painting isn't hardware and a
// title sequence isn't software, but every one of them sits cleanly on one side of
// "does this exist in the room with you, or on a screen?"
//
// The third card is a different KIND of world (9-personal-and-auth.md): the first two
// are objective — the best of what exists, researched — and this one is subjective,
// built by hand from what is yours. It sits beside them rather than somewhere separate
// because once a dataset exists, you browse it in exactly the same way.
export function DomainSelect() {
  const navigate = useNavigate();

  // Choosing a world *is* navigating to it — /physical and /digital are the shelves
  // (lib/domain.tsx), so there's no separate state to set.
  function choose(domain: Domain) {
    navigate(`/${domain}`);
  }

  return (
    <div className="mx-auto mt-8 max-w-5xl">
      <header className="mb-10 text-center">
        <h1 className="serif text-4xl">Which taste are you training?</h1>
      </header>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {DOMAINS.map((domain) => (
          <DomainCard key={domain} domain={domain} onClick={() => choose(domain)} />
        ))}
      </div>
    </div>
  );
}

function DomainCard({ domain, onClick }: { domain: Domain; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-10 text-center transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-wall-soft)]"
    >
      <h2 className="serif text-3xl">{DOMAIN_LABELS[domain].title}</h2>
      <p className="mt-3 text-sm italic text-[var(--color-muted)]">E.g. {DOMAIN_EXAMPLES[domain]}</p>
    </button>
  );
}
