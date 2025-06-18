import React from 'react';
import type { DetectedHighlight } from './types';

interface HighlightFeedProps {
  highlights: DetectedHighlight[];
  onSelect?: (highlight: DetectedHighlight) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  exciting: '#ff4444',
  funny: '#44bb44',
  surprising: '#ffaa00',
  other: '#9147ff',
};

export default function HighlightFeed({ highlights, onSelect }: HighlightFeedProps) {
  const sorted = [...highlights].reverse();

  return (
    <div style={{ background: '#1f1f23', borderRadius: '8px', padding: '16px' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#adadb8' }}>
        Highlights ({highlights.length})
      </h3>
      <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
        {sorted.length === 0 ? (
          <p style={{ color: '#adadb8', fontSize: '13px', margin: 0 }}>No highlights detected yet.</p>
        ) : (
          sorted.map((h, i) => (
            <div
              key={h.id || i}
              onClick={() => onSelect?.(h)}
              style={{
                padding: '10px 12px',
                borderLeft: `3px solid ${CATEGORY_COLORS[h.category] || '#9147ff'}`,
                background: '#18181b',
                borderRadius: '0 4px 4px 0',
                marginBottom: '8px',
                cursor: onSelect ? 'pointer' : 'default',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', color: CATEGORY_COLORS[h.category] }}>
                  {h.category}
                </span>
                <span style={{ fontSize: '11px', color: '#adadb8' }}>
                  {new Date(h.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#dedee3', marginTop: '4px' }}>
                Score: {(h.score * 100).toFixed(0)}% &middot; {h.messageRate.toFixed(1)} msg/s
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
