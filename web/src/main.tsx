import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { Nav } from './components/Nav';
import { RankerProvider } from './lib/ranker';
import { DomainSelect } from './pages/DomainSelect';
import { Home } from './pages/Home';
import { Curate } from './pages/Curate';
import { DatasetView } from './pages/DatasetView';
import { WorldReview } from './pages/WorldReview';
import { FilterPicker } from './pages/FilterPicker';
import { LegacyDatasetRedirect, LegacyMapRedirect } from './pages/LegacyRedirect';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RankerProvider>
      <BrowserRouter>
        <Nav />
        {/* Tight bottom padding: the map is sized to fit the window without scrolling,
            and six rems of dead space under it was the difference between fitting and
            not. Screens that do scroll lose nothing by it. */}
        <main className="mx-auto max-w-6xl px-6 pb-8 pt-5">
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
            <Route path="/:domain/new" element={<Curate />} />
            {/* Static segments outrank ":slug", so these always win over a field name.
                The world's MAP lives on the shelf itself (/physical); this is the
                review that draws and amends it. */}
            <Route path="/:domain/review" element={<WorldReview />} />
            <Route path="/:domain/map" element={<LegacyMapRedirect />} />
            <Route path="/:domain/:slug" element={<DatasetView />} />
            <Route path="/:domain/:slug/filters" element={<FilterPicker />} />
          </Routes>
        </main>
      </BrowserRouter>
    </RankerProvider>
  </React.StrictMode>,
);
