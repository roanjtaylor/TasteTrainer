import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { Nav } from './components/Nav';
import { TaskNotifications } from './components/TaskNotifications';
import { AccountButton } from './components/AccountButton';
import { EmbedTesterButton } from './components/EmbedTesterButton';
import { AuthProvider, PersonalGate } from './lib/auth';
import { NavActionsProvider } from './lib/navActions';
import { ChatViewProvider } from './lib/chatView';
import { ChatDock } from './components/chat/ChatDock';
import { DomainSelect } from './pages/DomainSelect';
import { Home } from './pages/Home';
import { PersonalNew } from './pages/PersonalNew';
import { DatasetView } from './pages/DatasetView';
import { LegacyCurateRedirect, LegacyDatasetRedirect, LegacyMapRedirect } from './pages/LegacyRedirect';
import { Embed } from './pages/Embed';
import { IframeTester } from './pages/IframeTester';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* No Nav, no layout grid — this is what gets iframed on someone else's
            site, so it has to be nothing but the widget. It does track the session
            (AuthProvider, no gate): a personal collection embeds too, behind the
            widget's own sign-in form (Embed.tsx). The bare /embed is the one to hand
            out: a self-contained pick-a-world -> pick-a-dataset -> browse widget with
            no dataset-specific URL to build. /embed/:domain/:slug and
            /embed/:datasetId are deep links straight into the browse step for one
            fixed dataset, skipping the picker. */}
        <Route path="/embed" element={<AuthProvider><Embed /></AuthProvider>} />
        <Route path="/embed/:domain/:slug" element={<AuthProvider><Embed /></AuthProvider>} />
        <Route path="/embed/:datasetId" element={<AuthProvider><Embed /></AuthProvider>} />
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
      {/* What Claude is told you are looking at (lib/chatView.tsx) — above the routes so
          the screens can report into it, and the dock, below, can read it. */}
      <ChatViewProvider>
      <NavActionsProvider>
        {/* Below `lg` there's no reliable margin for the gutter column below to sit
            in, so the queue falls back to a small floating box here. */}
        <TaskNotifications variant="overlay" />
        {/* Top-right of the window, always: fixed there at every width, with the nav
            padded on its right (below `xl`) to stay clear of it.
            The notification rail shares this margin and stops below it (`xl:top-14`).
            One shared container, not separately-positioned ones: each button in its own
            `fixed` wrapper would open its own stacking context, so the account menu's
            z-50 would only out-rank content inside its own wrapper and its neighbour
            would paint over it. A single row fixes both the layout and the stacking. */}
        <div className="fixed right-3 top-3 z-40 flex items-center gap-2">
          <EmbedTesterButton className="flex border border-[var(--color-line)] bg-[var(--color-card)]/90 shadow-sm backdrop-blur" />
          <AccountButton className="flex border border-[var(--color-line)] bg-[var(--color-card)]/90 shadow-sm backdrop-blur" />
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
                gate), and static segments outrank ":slug" in React Router's route
                ranking, so /personal/new is always the new-collection form. */}
            {/* Gates only the personal world (/personal/...) behind a sign-in screen —
                every other route renders straight through (lib/auth.tsx). */}
            <PersonalGate>
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
                <Route path="/personal/new" element={<PersonalNew />} />
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
            </PersonalGate>
          </main>
          <div className="hidden lg:flex">
            <TaskNotifications variant="rail" />
          </div>
        </div>
        {/* Claude, bottom-left, on every screen (components/chat/ChatDock.tsx). */}
        <ChatDock />
      </NavActionsProvider>
      </ChatViewProvider>
    </AuthProvider>
  );
}
