import React, { useState } from 'react';
import type { Clip } from './types';

interface ClipPreviewProps {
  clips: Clip[];
  onDownload?: (clip: Clip) => void;
  onDelete?: (clip: Clip) => void;
}

export default function ClipPreview({ clips, onDownload, onDelete }: ClipPreviewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div style={{ background: '#1f1f23', borderRadius: '8px', padding: '16px' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#adadb8' }}>
        Clips ({clips.length})
      </h3>
      <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
        {clips.length === 0 ? (
          <p style={{ color: '#adadb8', fontSize: '13px', margin: 0 }}>No clips available.</p>
        ) : (
          clips.map((clip) => (
            <div
              key={clip.id}
              onClick={() => setSelectedId(clip.id === selectedId ? null : clip.id)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 10px',
                background: selectedId === clip.id ? '#2f2f35' : '#18181b',
                borderRadius: '4px',
                marginBottom: '4px',
                cursor: 'pointer',
              }}
            >
              <div>
                <span style={{ fontSize: '13px', color: '#dedee3' }}>
                  {clip.category} — {clip.duration.toFixed(1)}s
                </span>
                {clip.uploaded && (
                  <span style={{ fontSize: '11px', color: '#44bb44', marginLeft: '8px' }}>Uploaded</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {onDownload && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDownload(clip); }}
                    style={{ background: 'none', border: '1px solid #3a3a3d', color: '#dedee3', padding: '3px 8px', borderRadius: '3px', fontSize: '11px', cursor: 'pointer' }}
                  >
                    Download
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(clip); }}
                    style={{ background: 'none', border: '1px solid #ff4444', color: '#ff4444', padding: '3px 8px', borderRadius: '3px', fontSize: '11px', cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
