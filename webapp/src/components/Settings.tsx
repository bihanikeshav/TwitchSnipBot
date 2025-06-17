import React from 'react';
import type { AppState } from '../App';

interface SettingsProps {
  sensitivity: number;
  bufferLength: number;
  onUpdate: (updates: Partial<AppState>) => void;
  onClose: () => void;
}

export default function Settings({ sensitivity, bufferLength, onUpdate, onClose }: SettingsProps) {
  return (
    <div style={{
      maxWidth: '500px',
      margin: '24px auto',
      padding: '24px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ margin: 0, fontSize: '18px' }}>Settings</h2>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: '1px solid #3a3a3d',
            color: '#efeff1',
            padding: '6px 12px',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', fontSize: '14px', marginBottom: '8px', color: '#dedee3' }}>
          Detection Sensitivity: {(sensitivity * 100).toFixed(0)}%
        </label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={sensitivity}
          onChange={(e) => onUpdate({ sensitivity: parseFloat(e.target.value) })}
          style={{ width: '100%', accentColor: '#9147ff' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#adadb8' }}>
          <span>Less sensitive (fewer alerts)</span>
          <span>More sensitive (more alerts)</span>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', fontSize: '14px', marginBottom: '8px', color: '#dedee3' }}>
          Recording Buffer: {bufferLength}s
        </label>
        <input
          type="range"
          min="15"
          max="60"
          step="5"
          value={bufferLength}
          onChange={(e) => onUpdate({ bufferLength: parseInt(e.target.value) })}
          style={{ width: '100%', accentColor: '#9147ff' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#adadb8' }}>
          <span>15s (~4 MB)</span>
          <span>60s (~15 MB)</span>
        </div>
      </div>

      <div style={{
        padding: '12px',
        background: '#1f1f23',
        borderRadius: '8px',
        fontSize: '12px',
        color: '#adadb8',
      }}>
        <strong style={{ color: '#dedee3' }}>How it works:</strong>
        <ul style={{ margin: '8px 0 0 0', paddingLeft: '16px', lineHeight: '1.8' }}>
          <li>Chat messages are analyzed in real-time for activity spikes</li>
          <li>When a spike is detected, it's classified as exciting, funny, or surprising</li>
          <li>If recording is active, the buffered video is saved as a clip</li>
          <li>Clips can be previewed and downloaded directly from the browser</li>
          <li>No API keys or authentication required</li>
        </ul>
      </div>
    </div>
  );
}
