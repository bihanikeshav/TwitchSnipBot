import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from './Layout';
import Recordings from './pages/Recordings';
import Matches from './pages/Matches';
import Highlights from './pages/Highlights';
import Clips from './pages/Clips';
import Plugins from './pages/Plugins';
import Settings from './pages/Settings';

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/recordings" replace />} />
            <Route path="recordings" element={<Recordings />} />
            <Route path="matches" element={<Matches />} />
            <Route path="highlights" element={<Highlights />} />
            <Route path="clips" element={<Clips />} />
            <Route path="plugins" element={<Plugins />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
