import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getClips, compileClips } from '../api';

export default function Clips() {
  const { data: clips = [], isLoading } = useQuery({ queryKey: ['clips'], queryFn: getClips });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const compileMut = useMutation({ mutationFn: compileClips });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCompile = () => {
    if (selected.size > 0) {
      compileMut.mutate(Array.from(selected));
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '20px', margin: 0 }}>Clips</h2>
        {selected.size > 0 && (
          <button
            onClick={handleCompile}
            disabled={compileMut.isPending}
            style={{ background: '#9147ff', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '4px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
          >
            {compileMut.isPending ? 'Compiling...' : `Compile ${selected.size} Clips`}
          </button>
        )}
      </div>

      {compileMut.isSuccess && (
        <div style={{ padding: '12px', background: '#1a3a1a', borderRadius: '4px', marginBottom: '16px', fontSize: '13px', color: '#44bb44' }}>
          Highlight reel compiled successfully!
        </div>
      )}

      {isLoading ? (
        <p style={{ color: '#adadb8' }}>Loading...</p>
      ) : clips.length === 0 ? (
        <p style={{ color: '#adadb8' }}>No clips yet. Process a recording to generate clips.</p>
      ) : (
        <div>
          {clips.map((clip: any) => (
            <div
              key={clip.id}
              onClick={() => toggleSelect(clip.id)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                background: selected.has(clip.id) ? '#2a2a3e' : '#1f1f23',
                borderRadius: '4px',
                marginBottom: '8px',
                cursor: 'pointer',
                border: selected.has(clip.id) ? '1px solid #9147ff' : '1px solid transparent',
              }}
            >
              <div>
                <span style={{ fontWeight: 600 }}>Clip #{clip.id.slice(0, 8)}</span>
                <span style={{ fontSize: '12px', color: '#adadb8', marginLeft: '12px' }}>
                  {clip.category} &middot; {(clip.duration || 0).toFixed(1)}s
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {clip.uploaded && <span style={{ fontSize: '11px', color: '#44bb44' }}>Uploaded</span>}
                <a
                  href={`/api/clips/${clip.id}/download`}
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: '#9147ff', fontSize: '12px', textDecoration: 'none' }}
                >
                  Download
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
