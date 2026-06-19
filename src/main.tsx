import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Keep the browser's default scroll restoration so a reload stays where you were
// (handy while tuning chapters further down — no forced jump back to the top).
if ('scrollRestoration' in history) history.scrollRestoration = 'auto';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
