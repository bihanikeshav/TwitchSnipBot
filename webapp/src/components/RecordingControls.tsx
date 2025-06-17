import React from 'react';

interface RecordingControlsProps {
  isRecording: boolean;
  isConnected: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onManualClip: () => void;
}

export default function RecordingControls({
  isRecording,
  isConnected,
  onStartRecording,
  onStopRecording,
  onManualClip,
}: RecordingControlsProps) {
  return (
    <div style={{
      display: 'flex',
      gap: '8px',
      alignItems: 'center',
    }}>
      {!isRecording ? (
        <button
          onClick={onStartRecording}
          disabled={!isConnected}
          style={{
            background: isConnected ? '#ff4444' : '#3a3a3d',
            color: '#fff',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '4px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: isConnected ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#fff',
            display: 'inline-block',
          }} />
          Start Recording
        </button>
      ) : (
        <>
          <button
            onClick={onStopRecording}
            style={{
              background: '#3a3a3d',
              color: '#fff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '4px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '2px',
              background: '#ff4444',
              display: 'inline-block',
            }} />
            Stop
          </button>
          <button
            onClick={onManualClip}
            style={{
              background: '#9147ff',
              color: '#fff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '4px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Clip Now
          </button>
          <span style={{
            fontSize: '12px',
            color: '#ff4444',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}>
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#ff4444',
              display: 'inline-block',
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
            REC
          </span>
        </>
      )}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
