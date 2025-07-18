import React, { useEffect, useRef, useState } from 'react';
import { ClipAssembler } from '../../services/clip-assembler';

interface ClipPreviewProps {
  clips: Blob[];
}

export default function ClipPreview({ clips }: ClipPreviewProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) ClipAssembler.revokePreviewUrl(previewUrl);
    };
  }, [previewUrl]);

  const selectClip = (index: number) => {
    if (previewUrl) ClipAssembler.revokePreviewUrl(previewUrl);
    const url = ClipAssembler.createPreviewUrl(clips[index]);
    setPreviewUrl(url);
    setSelectedIndex(index);
  };

  const downloadClip = (index: number) => {
    ClipAssembler.downloadClip(clips[index], `highlight_${index + 1}.webm`);
  };

  const downloadAll = () => {
    clips.forEach((clip, i) => {
      setTimeout(() => ClipAssembler.downloadClip(clip, `highlight_${i + 1}.webm`), i * 500);
    });
  };

  return (
    <div style={{
      background: '#1f1f23',
      borderRadius: '8px',
      padding: '16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '14px', color: '#adadb8' }}>
          Clips ({clips.length})
        </h3>
        {clips.length > 0 && (
          <button
            onClick={downloadAll}
            style={{
              background: '#9147ff',
              color: '#fff',
              border: 'none',
              padding: '4px 10px',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Download All
          </button>
        )}
      </div>

      {selectedIndex !== null && previewUrl && (
        <div style={{ marginBottom: '12px' }}>
          <video
            ref={videoRef}
            src={previewUrl}
            controls
            style={{
              width: '100%',
              borderRadius: '4px',
              background: '#000',
            }}
          />
        </div>
      )}

      <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
        {clips.length === 0 ? (
          <p style={{ color: '#adadb8', fontSize: '13px', margin: 0 }}>
            No clips yet. Start recording to capture highlights automatically.
          </p>
        ) : (
          clips.map((clip, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 10px',
                background: selectedIndex === i ? '#2f2f35' : '#18181b',
                borderRadius: '4px',
                marginBottom: '4px',
                cursor: 'pointer',
              }}
              onClick={() => selectClip(i)}
            >
              <span style={{ fontSize: '13px' }}>
                Clip {i + 1} ({(clip.size / 1024 / 1024).toFixed(1)} MB)
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  downloadClip(i);
                }}
                style={{
                  background: 'none',
                  border: '1px solid #3a3a3d',
                  color: '#dedee3',
                  padding: '3px 8px',
                  borderRadius: '3px',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                Download
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
