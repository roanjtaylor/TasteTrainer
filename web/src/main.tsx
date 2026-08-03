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
import { FilterPicker } from './pages/FilterPicker';
import { LegacyDatasetRedirect } from './pages/LegacyRedirect';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RankerProvider>
      <BrowserRouter>
        <Nav />
        <main className="mx-auto max-w-6xl px-6 pb-24 pt-8">
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
            <Route path="/:domain/:slug" element={<DatasetView />} />
            <Route path="/:domain/:slug/filters" element={<FilterPicker />} />
          </Routes>
        </main>
      </BrowserRouter>
    </RankerProvider>
  </React.StrictMode>,
);
