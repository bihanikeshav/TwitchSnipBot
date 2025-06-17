import React, { useEffect, useRef } from 'react';

interface TwitchPlayerProps {
  channel: string;
}

export default function TwitchPlayer({ channel }: TwitchPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!channel || !containerRef.current) return;

    // Clear previous embed
    containerRef.current.innerHTML = '';

    // Load Twitch embed via iframe (no API key needed)
    const iframe = document.createElement('iframe');
    iframe.src = `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${window.location.hostname}&muted=false`;
    iframe.width = '100%';
    iframe.height = '100%';
    iframe.allowFullscreen = true;
    iframe.style.border = 'none';
    iframe.style.borderRadius = '8px';

    containerRef.current.appendChild(iframe);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [channel]);

  if (!channel) {
    return (
      <div style={{
        width: '100%',
        aspectRatio: '16/9',
        background: '#1f1f23',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#adadb8',
        fontSize: '14px',
      }}>
        Enter a channel name to start
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        aspectRatio: '16/9',
        background: '#000',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    />
  );
}
