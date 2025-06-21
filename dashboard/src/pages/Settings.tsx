import React from 'react';

export default function Settings() {
  return (
    <div>
      <h2 style={{ fontSize: '20px', marginBottom: '20px' }}>Settings</h2>

      <div style={{ maxWidth: '600px' }}>
        <Section title="Detection">
          <SettingRow label="Window Size" value="10s" description="Duration of each analysis window" />
          <SettingRow label="Stride" value="5s" description="Overlap between consecutive windows" />
          <SettingRow label="Z-Score Threshold" value="2.5" description="Minimum Z-score to trigger highlight detection" />
          <SettingRow label="Sensitivity" value="0.7" description="Overall detection sensitivity (0-1)" />
        </Section>

        <Section title="Clipping">
          <SettingRow label="Pre-Highlight Buffer" value="15s" description="Seconds before detected moment to include" />
          <SettingRow label="Post-Highlight Buffer" value="10s" description="Seconds after detected moment to include" />
          <SettingRow label="Output Format" value="mp4" description="Clip output format (mp4/webm)" />
          <SettingRow label="Quality" value="720p" description="Output video quality" />
        </Section>

        <Section title="Upload">
          <SettingRow label="YouTube Upload" value="Disabled" description="Auto-upload compiled highlights to YouTube" />
          <SettingRow label="Privacy" value="Unlisted" description="Default privacy setting for uploads" />
        </Section>

        <div style={{ marginTop: '24px', padding: '12px', background: '#1f1f23', borderRadius: '4px', fontSize: '12px', color: '#adadb8' }}>
          Settings are loaded from <code style={{ color: '#9147ff' }}>config.yaml</code> and environment variables.
          Edit the config file directly for full control.
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '24px' }}>
      <h3 style={{ fontSize: '16px', marginBottom: '12px', color: '#dedee3' }}>{title}</h3>
      <div style={{ background: '#1f1f23', borderRadius: '8px', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

function SettingRow({ label, value, description }: { label: string; value: string; description: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #2a2a2e' }}>
      <div>
        <div style={{ fontSize: '14px', marginBottom: '2px' }}>{label}</div>
        <div style={{ fontSize: '12px', color: '#adadb8' }}>{description}</div>
      </div>
      <span style={{ fontSize: '14px', color: '#9147ff', fontWeight: 600 }}>{value}</span>
    </div>
  );
}
