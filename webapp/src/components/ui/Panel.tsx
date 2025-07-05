import React from 'react';
import { tokens, radius } from './theme';

interface PanelProps {
  title?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  padded?: boolean;
}

/** Standard surface used across the app — subtle border, small header. */
export default function Panel({ title, aside, children, padded = true }: PanelProps) {
  return (
    <div style={{
      background: tokens.bg.surface,
      border: `1px solid ${tokens.border.subtle}`,
      borderRadius: radius.md,
      padding: padded ? '14px' : 0,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    }}>
      {(title || aside) && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: padded ? '10px' : '0',
          padding: padded ? 0 : '14px',
        }}>
          {title && <PanelTitle>{title}</PanelTitle>}
          {aside && <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>{aside}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: '11px',
      color: tokens.text.secondary,
      textTransform: 'uppercase',
      letterSpacing: '0.14em',
    }}>
      {children}
    </span>
  );
}
