import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import { Nav } from './components/Nav';
import { TaskNotifications } from './components/TaskNotifications';
import { AccountButton } from './components/AccountButton';
import { EmbedTesterButton } from './components/EmbedTesterButton';
import { AuthProvider } from './lib/auth';
import { NavActionsProvider } from './lib/navActions';
import { ChatViewProvider } from './lib/chatView';
import { ChatDock } from './components/chat/ChatDock';
import { AppRoutes, PAGE_GRID } from './AppRoutes';
import { Embed } from './pages/Embed';

// The embed widget is what gets iframed on someone else's site, so it has no Nav and
// no layout grid — nothing but the widget (pages/Embed.tsx). It keeps its own router:
// the bare /embed browses the app's screens in memory, so a visitor clicking around
// never changes the iframe's address — that address is the embed's setting.
// /embed/:domain/:slug and /embed/:datasetId pin it to one dataset instead.
const inEmbed = /^\/embed(\/|$)/.test(window.location.pathname);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {inEmbed ? (
      // It does track the session (AuthProvider, no gate): a private collection embeds
      // too, behind the widget's own sign-in form.
      <AuthProvider>
        <Embed />
      </AuthProvider>
    ) : (
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    )}
  </React.StrictMode>,
);

function AppShell() {
  return (
    // Tracks the session app-wide (lib/auth.tsx), but doesn't block rendering — only
    // /personal/new (RequireSignIn, AppRoutes.tsx) is gated on being signed in; a private
    // dataset asks for it itself when it can't be read.
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
        <div className={`${PAGE_GRID} pb-8 pt-5`}>
          <div className="hidden lg:block" />
          {/* Tight bottom padding: the map is sized to fit the window without
              scrolling, and six rems of dead space under it was the difference
              between fitting and not. Screens that do scroll lose nothing by it.
              `min-w-0`: a grid item's default `min-width: auto` lets its content's
              intrinsic size push it past its track — harmless today (nothing inside
              is wider than the track) but cheap insurance against it happening. */}
          <main className="min-w-0">
            <AppRoutes />
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
