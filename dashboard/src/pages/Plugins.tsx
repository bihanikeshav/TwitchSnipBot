import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPlugins, updatePlugin } from '../api';

export default function Plugins() {
  const queryClient = useQueryClient();
  const { data: plugins = [], isLoading } = useQuery({ queryKey: ['plugins'], queryFn: getPlugins });

  const toggleMut = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      updatePlugin(name, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plugins'] }),
  });

  return (
    <div>
      <h2 style={{ fontSize: '20px', marginBottom: '20px' }}>Plugins</h2>

      {isLoading ? (
        <p style={{ color: '#adadb8' }}>Loading...</p>
      ) : plugins.length === 0 ? (
        <p style={{ color: '#adadb8' }}>No plugins installed.</p>
      ) : (
        <div>
          {plugins.map((plugin: any) => (
            <div key={plugin.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: '#1f1f23', borderRadius: '4px', marginBottom: '8px' }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                  {plugin.name}
                  <span style={{ fontSize: '12px', color: '#adadb8', fontWeight: 400, marginLeft: '8px' }}>
                    v{plugin.version}
                  </span>
                </div>
                {plugin.description && (
                  <div style={{ fontSize: '13px', color: '#adadb8' }}>{plugin.description}</div>
                )}
              </div>
              <button
                onClick={() => toggleMut.mutate({ name: plugin.name, enabled: !plugin.enabled })}
                style={{
                  background: plugin.enabled ? '#44bb44' : '#3a3a3d',
                  color: '#fff',
                  border: 'none',
                  padding: '6px 16px',
                  borderRadius: '4px',
                  fontSize: '13px',
                  cursor: 'pointer',
                  minWidth: '80px',
                }}
              >
                {plugin.enabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: '24px', padding: '16px', background: '#1f1f23', borderRadius: '8px', fontSize: '13px', color: '#adadb8' }}>
        <strong style={{ color: '#dedee3' }}>Installing plugins:</strong>
        <ul style={{ margin: '8px 0 0', paddingLeft: '16px', lineHeight: '1.8' }}>
          <li>Drop a Python file in <code style={{ color: '#9147ff' }}>~/.snipbot/plugins/</code></li>
          <li>Or install via pip: <code style={{ color: '#9147ff' }}>pip install snipbot-plugin-valorant</code></li>
        </ul>
      </div>
    </div>
  );
}
