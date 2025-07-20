import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import CsApp from './CsApp';

// Two standalone tools share one bundle: the streamlined chat highlighter at
// `/` and the CS-match companion at `/cs`. They're distinct enough that a
// hard navigation between them (plain <a>) is fine — no client router needed.
// Cloudflare Pages serves index.html for /cs via public/_redirects.
const isCs = window.location.pathname.replace(/\/+$/, '') === '/cs';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isCs ? <CsApp /> : <App />}
  </React.StrictMode>,
);
