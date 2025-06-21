import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRecordings, createRecording, deleteRecording } from '../api';

export default function Recordings() {
  const queryClient = useQueryClient();
  const { data: recordings = [], isLoading } = useQuery({ queryKey: ['recordings'], queryFn: getRecordings });

  const createMut = useMutation({
    mutationFn: createRecording,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recordings'] }),
  });

  const deleteMut = useMutation({
    mutationFn: deleteRecording,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recordings'] }),
  });

  const [channel, setChannel] = useState('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (channel.trim()) {
      createMut.mutate({ channel: channel.trim(), start_time: Date.now() / 1000 });
      setChannel('');
    }
  };

  const STATUS_COLORS: Record<string, string> = {
    scheduled: '#ffaa00',
    recording: '#ff4444',
    completed: '#44bb44',
    failed: '#adadb8',
  };

  return (
    <div>
      <h2 style={{ fontSize: '20px', marginBottom: '20px' }}>Recordings</h2>

      <form onSubmit={handleCreate} style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        <input
          type="text"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          placeholder="Channel name..."
          style={{ flex: 1, padding: '10px 14px', background: '#1f1f23', border: '1px solid #3a3a3d', borderRadius: '4px', color: '#efeff1', fontSize: '14px', outline: 'none' }}
        />
        <button
          type="submit"
          disabled={!channel.trim()}
          style={{ background: '#9147ff', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '4px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
        >
          Start Recording
        </button>
      </form>

      {isLoading ? (
        <p style={{ color: '#adadb8' }}>Loading...</p>
      ) : recordings.length === 0 ? (
        <p style={{ color: '#adadb8' }}>No recordings. Start one above or schedule from the Matches page.</p>
      ) : (
        <div>
          {recordings.map((rec: any) => (
            <div key={rec.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#1f1f23', borderRadius: '4px', marginBottom: '8px' }}>
              <div>
                <span style={{ fontWeight: 600, marginRight: '12px' }}>#{rec.channel}</span>
                <span style={{ fontSize: '12px', color: STATUS_COLORS[rec.status] || '#adadb8', textTransform: 'uppercase', fontWeight: 600 }}>
                  {rec.status}
                </span>
                {rec.title && <span style={{ fontSize: '12px', color: '#adadb8', marginLeft: '12px' }}>{rec.title}</span>}
              </div>
              <button
                onClick={() => deleteMut.mutate(rec.id)}
                style={{ background: 'none', border: '1px solid #ff4444', color: '#ff4444', padding: '4px 10px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
