import { useNavigate } from 'react-router-dom';
import { useDomain } from '../lib/domain';
import type { Domain } from '../../../shared/types';

// The domain gate (7-software-design.md): the very first screen, every session —
// choose which world of taste you're training before seeing its shelf. Plain
// in-memory state (lib/domain.tsx) means a refresh naturally re-asks.
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
          TasteTrainer splits into two worlds — physical objects and digital design. Pick one to
          see its fields.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <DomainCard
          title="Hardware"
          tagline="Physical objects — watches, cars, chairs, paintings."
          onClick={() => choose('hardware')}
        />
        <DomainCard
          title="Software"
          tagline="Digital design — websites, apps, product UI."
          onClick={() => choose('software')}
        />
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
