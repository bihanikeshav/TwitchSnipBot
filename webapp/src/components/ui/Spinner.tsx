import React from 'react';
import { motion } from 'framer-motion';

interface SpinnerProps {
  size?: number;
  color?: string;
}

export default function Spinner({ size = 14, color = '#fff' }: SpinnerProps) {
  return (
    <motion.span
      animate={{ rotate: 360 }}
      transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        border: `2px solid ${hex(color, 0.25)}`,
        borderTopColor: color,
        borderRadius: '50%',
      }}
    />
  );
}

function hex(c: string, a: number): string {
  if (!c.startsWith('#') || c.length !== 7) return c;
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
