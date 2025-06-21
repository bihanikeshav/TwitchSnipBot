import React from 'react';
import { Outlet, NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { path: '/recordings', label: 'Recordings' },
  { path: '/matches', label: 'Matches' },
  { path: '/highlights', label: 'Highlights' },
  { path: '/clips', label: 'Clips' },
  { path: '/plugins', label: 'Plugins' },
  { path: '/settings', label: 'Settings' },
];

export default function Layout() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0e0e10', color: '#efeff1', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {/* Sidebar */}
      <nav style={{ width: '200px', background: '#18181b', borderRight: '1px solid #1f1f23', padding: '16px 0' }}>
        <h1 style={{ fontSize: '16px', fontWeight: 700, padding: '0 16px', marginBottom: '24px' }}>
          SnipBot
        </h1>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            style={({ isActive }) => ({
              display: 'block',
              padding: '10px 16px',
              color: isActive ? '#9147ff' : '#adadb8',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: isActive ? 600 : 400,
              borderLeft: isActive ? '3px solid #9147ff' : '3px solid transparent',
              background: isActive ? 'rgba(145, 71, 255, 0.1)' : 'transparent',
            })}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
        <Outlet />
      </main>
    </div>
  );
}
