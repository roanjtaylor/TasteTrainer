import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { Nav } from './components/Nav';
import { TaskNotifications } from './components/TaskNotifications';
import { AccountButton } from './components/AccountButton';
import { BrainButton } from './components/BrainPanel';
import { EmbedTesterButton } from './components/EmbedTesterButton';
import { AuthProvider, PersonalGate } from './lib/auth';
import { NavActionsProvider } from './lib/navActions';
import { DomainSelect } from './pages/DomainSelect';
import { Home } from './pages/Home';
import { CurateRoute } from './pages/Curate';
import { DatasetView } from './pages/DatasetView';
import { WorldReview } from './pages/WorldReview';
import { FilterPicker } from './pages/FilterPicker';
import { LegacyDatasetRedirect, LegacyMapRedirect } from './pages/LegacyRedirect';
import { Embed } from './pages/Embed';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* No Nav, no auth provider, no layout grid — this is what gets iframed on
            someone else's site, so it has to be nothing but the widget. The bare
            /embed is the one to hand out: it's a self-contained pick-a-world ->
            pick-a-dataset -> browse widget with no dataset-specific URL to build.
            /embed/:domain/:slug and /embed/:datasetId are deep links straight into
            the browse step for one fixed dataset, skipping the picker (Embed.tsx). */}
        <Route path="/embed" element={<Embed />} />
        <Route path="/embed/:domain/:slug" element={<Embed />} />
        <Route path="/embed/:datasetId" element={<Embed />} />
        <Route path="*" element={<AppShell />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);

function AppShell() {
  return (
    // Tracks the session app-wide (lib/auth.tsx), but doesn't block rendering — only
    // the personal world (PersonalGate, below) is ever gated on being signed in.
    <AuthProvider>
      <NavActionsProvider>
        {/* Below `lg` there's no reliable margin for the gutter column below to sit
            in, so the queue falls back to a small floating box here. */}
        <TaskNotifications variant="overlay" />
        {/* The settings cog: top-right of the window, in the right margin — how this app
            prompts Claude (components/BrainPanel.tsx). Only from `xl`, where the margin
            is wide enough to clear the nav's own actions; Nav carries it below that. The
            notification rail shares this margin and stops below it (`xl:top-14`). */}
        {/* One shared container, not three separately-positioned ones: each button
            used to sit in its own `fixed` wrapper `div`, which meant each also opened
            its own stacking context — so the account menu's z-50 only out-ranked
            content *inside its own wrapper*, not the embed-tester button sitting in
            its neighbour, which painted over it regardless. A single row fixes both
            the layout (three buttons in line, embed tester leftmost) and the
            stacking (the account menu now out-ranks its literal siblings). The cog
            stays flush with the container's own right edge, so it's still exactly
            where BrainPanel's close button expects it (components/BrainPanel.tsx). */}
        <div className="fixed right-3 top-3 z-40 hidden items-center gap-2 xl:flex">
          <EmbedTesterButton className="flex border border-[var(--color-line)] bg-[var(--color-card)]/90 shadow-sm backdrop-blur" />
          <AccountButton className="flex border border-[var(--color-line)] bg-[var(--color-card)]/90 shadow-sm backdrop-blur" />
          <BrainButton className="flex border border-[var(--color-line)] bg-[var(--color-card)]/90 shadow-sm backdrop-blur" />
        </div>
        <Nav />
        {/* Below `lg` this is a plain `mx-auto max-w-6xl` block, unchanged from
            before. At `lg`+ it becomes a 3-column grid, and — this is the part that
            was wrong in every earlier version of this layout — the content track is
            capped at a PERCENTAGE (`min(72rem,74%)`), not just a flat pixel width.
            A flat `max-w-6xl` cap means the content column claims up to 1152px
            REGARDLESS of how much viewport is left over, so on a window only a
            little wider than that (a laptop not maximised, or a smaller external
            monitor) there's nothing left over at all — margins collapse to near
            zero, and the notification rail below has no real column to sit in. A
            percentage cap means content and margins scale down TOGETHER as the
            window narrows, so there's always a proportional margin — the same
            layout, just smaller, instead of "plenty of room" directly followed by
            "no room" a hundred pixels later.
            The outer tracks split whatever that leaves over EVENLY (`minmax(0,1fr)`
            each) so the content column sits centred: the left one is purely
            decorative spacing, the right one is where the notification rail lives
            and fills its track (TaskNotifications.tsx). An earlier 1:3 split gave the
            rail the lion's share and pushed the content visibly off-centre. Neither
            track has a hard minimum: they only ever divide space that's already
            there, so this can never force the content column to shrink below its
            own share the way an earlier version's `minmax(18rem,1fr)` did.
            The gutters at `lg` — the gap between tracks and the page's own side
            padding — are half the below-`lg` values (`gap-x-3`/`px-3` vs `px-6`): the
            rail's cards sit closer to the content pane on one side and the scrollbar
            on the other, so they get that width back rather than the margins. */}
        <div className="mx-auto max-w-6xl px-6 pb-8 pt-5 lg:mx-0 lg:max-w-none lg:grid lg:grid-cols-[minmax(0,1fr)_min(72rem,74%)_minmax(0,1fr)] lg:gap-x-3 lg:px-3">
          <div className="hidden lg:block" />
          {/* Tight bottom padding: the map is sized to fit the window without
              scrolling, and six rems of dead space under it was the difference
              between fitting and not. Screens that do scroll lose nothing by it.
              `min-w-0`: a grid item's default `min-width: auto` lets its content's
              intrinsic size push it past its track — harmless today (nothing inside
              is wider than the track) but cheap insurance against it happening. */}
          <main className="min-w-0">
            {/* The URL names the world and the field: /physical, /physical/ships.
                ":domain" is validated by lib/domain (anything else redirects to the
                gate), and the static "new" segment outranks ":slug" in React Router's
                route ranking, so /physical/new is always the curate screen. */}
            {/* Gates only the personal world (/personal/...) behind a sign-in screen —
                every other route renders straight through (lib/auth.tsx). */}
            <PersonalGate>
              <Routes>
                <Route path="/" element={<DomainSelect />} />
                {/* Pre-rename addresses, kept alive for links already out there. */}
                <Route path="/datasets" element={<Navigate to="/" replace />} />
                <Route path="/new" element={<Navigate to="/" replace />} />
                <Route path="/dataset/:id" element={<LegacyDatasetRedirect />} />
                <Route path="/dataset/:id/filters" element={<LegacyDatasetRedirect />} />
                <Route path="/:domain" element={<Home />} />
                {/* Bare "new" (no field chosen yet) and a per-field "<slug>/new" (once one
                    has). CurateRoute keys the actual page by domain+slug, so a session
                    researching one field and a session starting another are always
                    separate component instances — never the same mounted page silently
                    swapping which field's research a still-running call writes into. See
                    Curate.tsx for why that used to happen on the single shared /new URL. */}
                <Route path="/:domain/new" element={<CurateRoute />} />
                <Route path="/:domain/:slug/new" element={<CurateRoute />} />
                {/* Static segments outrank ":slug", so these always win over a field
                    name. The world's MAP lives on the shelf itself (/physical); this is
                    the review that draws and amends it. */}
                <Route path="/:domain/review" element={<WorldReview />} />
                <Route path="/:domain/map" element={<LegacyMapRedirect />} />
                <Route path="/:domain/:slug" element={<DatasetView />} />
                <Route path="/:domain/:slug/filters" element={<FilterPicker />} />
              </Routes>
            </PersonalGate>
          </main>
          <div className="hidden lg:flex">
            <TaskNotifications variant="rail" />
          </div>
        </div>
      </NavActionsProvider>
    </AuthProvider>
  );
}
