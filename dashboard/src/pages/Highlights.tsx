import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getHighlights } from '../api';

const CATEGORIES = ['all', 'exciting', 'funny', 'surprising', 'other'];
const CATEGORY_COLORS: Record<string, string> = {
  exciting: '#ff4444',
  funny: '#44bb44',
  surprising: '#ffaa00',
  other: '#9147ff',
};

export default function Highlights() {
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['highlights', page, category],
    queryFn: () => getHighlights(page, category === 'all' ? undefined : category),
  });

  const highlights = data?.highlights || data || [];

  return (
    <div>
      <h2 style={{ fontSize: '20px', marginBottom: '20px' }}>Highlights</h2>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => { setCategory(cat); setPage(1); }}
            style={{
              background: category === cat ? '#3a3a3d' : 'transparent',
              color: cat === 'all' ? '#efeff1' : (CATEGORY_COLORS[cat] || '#efeff1'),
              border: '1px solid #3a3a3d',
              padding: '6px 14px',
              borderRadius: '4px',
              fontSize: '13px',
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p style={{ color: '#adadb8' }}>Loading...</p>
      ) : highlights.length === 0 ? (
        <p style={{ color: '#adadb8' }}>No highlights found.</p>
      ) : (
        <div>
          {highlights.map((h: any, i: number) => (
            <div key={h.id || i} style={{ padding: '12px 16px', background: '#1f1f23', borderRadius: '4px', marginBottom: '8px', borderLeft: `3px solid ${CATEGORY_COLORS[h.category] || '#9147ff'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', color: CATEGORY_COLORS[h.category] }}>
                  {h.category}
                </span>
                <span style={{ fontSize: '12px', color: '#adadb8' }}>
                  {new Date(h.timestamp * 1000).toLocaleString()}
                </span>
              </div>
              <div style={{ fontSize: '13px', color: '#dedee3', marginTop: '4px' }}>
                Score: {((h.score || h.detection_score || 0) * 100).toFixed(0)}% &middot;
                Duration: {(h.duration || 0).toFixed(1)}s
                {h.clip_path && <span style={{ color: '#44bb44', marginLeft: '8px' }}>Clipped</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
        <button
          onClick={() => setPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          style={{ background: '#3a3a3d', color: '#efeff1', border: 'none', padding: '6px 14px', borderRadius: '4px', cursor: 'pointer' }}
        >
          Previous
        </button>
        <span style={{ padding: '6px 14px', color: '#adadb8' }}>Page {page}</span>
        <button
          onClick={() => setPage(page + 1)}
          style={{ background: '#3a3a3d', color: '#efeff1', border: 'none', padding: '6px 14px', borderRadius: '4px', cursor: 'pointer' }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
