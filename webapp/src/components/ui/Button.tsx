import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { tokens, radius, transition } from './theme';
import Spinner from './Spinner';

export type ButtonVariant = 'primary' | 'ghost' | 'soft';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  uppercase?: boolean;
  type?: 'button' | 'submit';
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}

const sizeMap: Record<ButtonSize, { padding: string; fontSize: string }> = {
  sm: { padding: '6px 12px', fontSize: '11px' },
  md: { padding: '9px 18px', fontSize: '12px' },
  lg: { padding: '12px 28px', fontSize: '14px' },
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingText,
  disabled = false,
  fullWidth = false,
  uppercase = true,
  type = 'button',
  onClick,
  children,
}: ButtonProps) {
  const [pressed, setPressed] = useState(false);
  const [hover, setHover] = useState(false);
  const isDisabled = disabled || loading;

  const palette = paletteFor(variant, { hover, disabled: isDisabled, loading });
  const { padding, fontSize } = sizeMap[size];

  return (
    <motion.button
      type={type}
      disabled={isDisabled}
      onClick={onClick}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => { setHover(false); setPressed(false); }}
      onPointerDown={() => !isDisabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      animate={{ scale: pressed ? 0.96 : 1 }}
      transition={{ type: 'spring', stiffness: 620, damping: 32 }}
      style={{
        background: palette.bg,
        color: palette.fg,
        border: palette.border ? `1px solid ${palette.border}` : 'none',
        padding,
        borderRadius: radius.sm,
        fontSize,
        fontWeight: 600,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        textTransform: uppercase ? 'uppercase' : 'none',
        letterSpacing: uppercase ? '0.08em' : '0',
        width: fullWidth ? '100%' : 'auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        fontFamily: 'inherit',
        transition: `background ${transition.med}, border-color ${transition.med}, color ${transition.med}`,
      }}
    >
      {loading && <Spinner />}
      <span>{loading && loadingText ? loadingText : children}</span>
    </motion.button>
  );
}

interface PaletteState { hover: boolean; disabled: boolean; loading: boolean }

function paletteFor(variant: ButtonVariant, s: PaletteState): { bg: string; fg: string; border: string | null } {
  if (variant === 'primary') {
    if (s.disabled && !s.loading) return { bg: tokens.border.default, fg: tokens.text.muted, border: null };
    if (s.loading) return { bg: tokens.brandActive, fg: '#fff', border: null };
    return { bg: s.hover ? tokens.brandHover : tokens.brand, fg: '#fff', border: null };
  }
  if (variant === 'ghost') {
    return {
      bg: s.hover && !s.disabled ? '#2f2f35' : 'transparent',
      fg: s.disabled ? tokens.text.muted : tokens.text.primary,
      border: s.disabled ? tokens.border.subtle : tokens.border.default,
    };
  }
  // soft
  return {
    bg: s.hover && !s.disabled ? '#2f2f35' : tokens.bg.raised,
    fg: s.disabled ? tokens.text.muted : tokens.text.primary,
    border: tokens.border.subtle,
  };
}
