import React, { memo, useEffect, useRef } from 'react';
import type { ChatMessage } from '../services/chat-reader';

const PALETTE = [
  '#ff7f50', '#9acd32', '#1e90ff', '#ff69b4', '#daa520',
  '#5f9ea0', '#d2691e', '#00ff7f', '#b22222', '#8a2be2',
  '#ff4500', '#2e8b57', '#ff1493', '#00ced1', '#9932cc',
];

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

interface ChatStreamProps {
  messages: ChatMessage[];
  totalCount?: number;
  max?: number;
}

function ChatStreamInner({ messages, totalCount, max = 120 }: ChatStreamProps) {
  const ref = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const recent = messages.slice(-max);

  useEffect(() => {
    const el = ref.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [recent.length]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = distFromBottom < 40;
  };

  return (
    <div style={{
      background: '#18181b',
      border: '1px solid #26262c',
      borderRadius: '6px',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      flex: 1,
    }}>
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid #26262c',
        fontSize: '11px',
        color: '#adadb8',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>Live chat</span>
        <span style={{ color: '#6a6a73' }}>{(totalCount ?? messages.length).toLocaleString()} total</span>
      </div>
      <div
        ref={ref}
        onScroll={onScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 14px',
          fontSize: '12.5px',
          lineHeight: 1.6,
        }}
      >
        {recent.length === 0 ? (
          <div style={{ color: '#6a6a73', fontSize: '12px' }}>
            waiting for messages…
          </div>
        ) : recent.map((msg, i) => (
          <div key={`${msg.timestamp}-${i}`} style={{ marginBottom: '2px', wordBreak: 'break-word' }}>
            <span style={{ color: colorFor(msg.username), fontWeight: 600 }}>
              {msg.username}
            </span>
            <span style={{ color: '#6a6a73' }}>: </span>
            <span style={{ color: '#efeff1' }}>{msg.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(ChatStreamInner);
