import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { tokens, radius, transition } from './theme';

interface IconButtonProps {
  title: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  size?: number;
  children: React.ReactNode;
}

export default function IconButton({ title, onClick, size = 24, children }: IconButtonProps) {
  const [pressed, setPressed] = useState(false);
  const [hover, setHover] = useState(false);
  return (
    <motion.button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      animate={{ scale: pressed ? 0.9 : 1 }}
      transition={{ type: 'spring', stiffness: 620, damping: 32 }}
      style={{
        background: hover ? '#26262c' : 'transparent',
        border: `1px solid ${tokens.border.default}`,
        color: tokens.text.primary,
        width: size,
        height: size,
        borderRadius: radius.sm,
        fontSize: Math.round(size * 0.55),
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        fontFamily: 'inherit',
        transition: `background ${transition.fast}, border-color ${transition.fast}`,
      }}
    >
      {children}
    </motion.button>
  );
}
