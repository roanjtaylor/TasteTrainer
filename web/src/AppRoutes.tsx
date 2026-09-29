import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireSignIn } from './lib/auth';
import { DomainSelect } from './pages/DomainSelect';
import { Home } from './pages/Home';
import { PersonalNew } from './pages/PersonalNew';
import { DatasetView } from './pages/DatasetView';
import { LegacyCurateRedirect, LegacyDatasetRedirect, LegacyMapRedirect } from './pages/LegacyRedirect';
import { IframeTester } from './pages/IframeTester';

/** The page's column layout (explained where the app lays it out, main.tsx): a plain
 *  centred block below `lg`, a margin / content / margin grid from `lg`. The embed's
 *  back arrow sits in the same content column as the screens beneath it. */
export const PAGE_GRID =
  'mx-auto max-w-6xl px-6 lg:mx-0 lg:max-w-none lg:grid lg:grid-cols-[minmax(0,1fr)_min(72rem,74%)_minmax(0,1fr)] lg:gap-x-3 lg:px-3';

/**
 * Every screen of the app, by address. Rendered by the app itself (main.tsx, under its
 * Nav) and by the bare /embed widget (pages/Embed.tsx, with a back arrow in place of
 * the Nav) — one set of screens, so browsing in the widget is browsing the app.
 */
export function AppRoutes() {
  return (
    // The URL names the world and the field: /physical, /physical/ships.
    // ":domain" is validated by lib/domain (anything else redirects to the
    // gate), and static segments outrank ":slug" in React Router's route
    // ranking, so /personal/new is always the new-collection form.
    // No world is gated: a private dataset hides itself until the curator
    // signs in (lib/auth.tsx, DatasetView). Only /personal/new asks up front.
    <Routes>
      <Route path="/" element={<DomainSelect />} />
      {/* Pre-rename addresses, kept alive for links already out there. */}
      <Route path="/datasets" element={<Navigate to="/" replace />} />
      <Route path="/new" element={<Navigate to="/" replace />} />
      <Route path="/dataset/:id" element={<LegacyDatasetRedirect />} />
      <Route path="/:domain" element={<Home />} />
      {/* Only the personal world has a "new dataset" screen: its collections
          are hand-built, so something has to make the empty shelf. The
          researched worlds have no wizard — you ask Claude in the dock, from
          whatever world or field you're looking at. */}
      <Route
        path="/personal/new"
        element={
          <RequireSignIn title="Your personal world" blurb="Sign in to start a collection.">
            <PersonalNew />
          </RequireSignIn>
        }
      />
      <Route path="/iframe" element={<IframeTester />} />
      {/* Static segments outrank ":slug", so these always win over a field
          name. Retired addresses, kept alive for open tabs: the world's map
          lives on the shelf itself (/physical), and the curate wizard is gone. */}
      <Route path="/:domain/review" element={<LegacyMapRedirect />} />
      <Route path="/:domain/map" element={<LegacyMapRedirect />} />
      <Route path="/:domain/new" element={<LegacyCurateRedirect />} />
      <Route path="/:domain/:slug/new" element={<LegacyCurateRedirect />} />
      <Route path="/:domain/:slug" element={<DatasetView />} />
    </Routes>
  );
}
