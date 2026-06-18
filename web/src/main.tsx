import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import { Nav } from './components/Nav';
import { Home } from './pages/Home';
import { Curate } from './pages/Curate';
import { DatasetView } from './pages/DatasetView';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Nav />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-8">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/new" element={<Curate />} />
          <Route path="/dataset/:id" element={<DatasetView />} />
        </Routes>
      </main>
    </BrowserRouter>
  </React.StrictMode>,
);
