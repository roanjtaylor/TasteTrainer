import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { Nav } from './components/Nav';
import { TaskNotifications } from './components/TaskNotifications';
import { RankerProvider } from './lib/ranker';
import { NavActionsProvider } from './lib/navActions';
import { DomainSelect } from './pages/DomainSelect';
import { Home } from './pages/Home';
import { CurateRoute } from './pages/Curate';
import { DatasetView } from './pages/DatasetView';
import { WorldReview } from './pages/WorldReview';
import { FilterPicker } from './pages/FilterPicker';
import { LegacyDatasetRedirect, LegacyMapRedirect } from './pages/LegacyRedirect';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RankerProvider>
      <NavActionsProvider>
      <BrowserRouter>
        {/* Below `lg` there's no reliable margin for the gutter column below to sit
            in, so the queue falls back to a small floating box here. */}
        <TaskNotifications variant="overlay" />
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
          </main>
          <div className="hidden lg:flex">
            <TaskNotifications variant="rail" />
          </div>
        </div>
      </BrowserRouter>
      </NavActionsProvider>
    </RankerProvider>
  </React.StrictMode>,
);
