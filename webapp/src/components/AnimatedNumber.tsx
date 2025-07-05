import React, { useEffect, useRef, useState } from 'react';

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  format?: (n: number) => string;
}

export default function AnimatedNumber({
  value,
  duration = 450,
  decimals = 0,
  format,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = display;
    const to = value;
    if (Math.abs(to - from) < 1e-6) return;

    fromRef.current = from;
    startRef.current = null;

    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const elapsed = t - startRef.current;
      const k = Math.min(1, elapsed / duration);
      // ease-out cubic for natural deceleration
      const e = 1 - Math.pow(1 - k, 3);
      const next = fromRef.current + (to - fromRef.current) * e;
      setDisplay(next);
      if (k < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const out = format
    ? format(display)
    : decimals === 0
      ? Math.round(display).toLocaleString()
      : display.toFixed(decimals);

  return <>{out}</>;
}
