import React, { useEffect, useRef } from 'react';

interface TwitchPlayerProps {
  channel: string;
}

export default function TwitchPlayer({ channel }: TwitchPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!channel || !containerRef.current) return;
    containerRef.current.innerHTML = '';

    const params = new URLSearchParams({
      channel,
      parent: window.location.hostname,
      muted: 'true',
      autoplay: 'true',
      controls: 'true',
    });

    const iframe = document.createElement('iframe');
    iframe.src = `https://player.twitch.tv/?${params.toString()}`;
    iframe.width = '100%';
    iframe.height = '100%';
    iframe.allowFullscreen = true;
    iframe.style.border = 'none';
    iframe.style.borderRadius = '6px';
    iframe.title = `${channel} stream preview`;
    containerRef.current.appendChild(iframe);

    return () => {
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, [channel]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        aspectRatio: '16/9',
        background: '#000',
        borderRadius: '6px',
        overflow: 'hidden',
      }}
    />
  );
}
