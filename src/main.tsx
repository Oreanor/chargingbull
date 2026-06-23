import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// Keep the browser's default scroll restoration so a reload stays where you were
// (handy while tuning chapters further down — no forced jump back to the top).
if ('scrollRestoration' in history) history.scrollRestoration = 'auto';

const root = document.getElementById('root')!;
const app = (
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Prerendered build (SSG) ships server-rendered markup inside #root → hydrate it.
// Plain dev (vite) ships an empty #root → client-render. children.length counts
// only element nodes, so the `<!--app-html-->` marker comment reads as empty.
if (root.children.length > 0) {
  hydrateRoot(root, app);
} else {
  createRoot(root).render(app);
}
