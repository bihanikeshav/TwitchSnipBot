import React, { useEffect, useRef, memo } from 'react';

export interface TimelineRange {
  detTs: number;
  startTs: number;
  endTs: number;
  color: string;
}

interface ChatTimelineProps {
  data: number[];
  timestamps: number[];
  ranges: TimelineRange[];
}

/**
 * Smooth wall-clock scrolling sparkline.
 *
 * Data comes in as fixed-cadence (500ms) samples. Each sample has a real
 * timestamp; X positions are computed from (sampleTs - (now - windowMs)) per
 * frame. Because `now` advances every rAF, the whole series slides left
 * continuously instead of snapping forward when a new sample lands.
 *
 * The plotted values are first passed through a small centered moving-average
 * so a single jittery second doesn't make the line spike.
 */
function ChatTimelineInner({ data, timestamps, ranges }: ChatTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef({ data, timestamps, ranges, smoothed: [] as number[] });
  const maxYRef = useRef(1);

  useEffect(() => {
    dataRef.current.data = data;
    dataRef.current.timestamps = timestamps;
    dataRef.current.ranges = ranges;
    dataRef.current.smoothed = smooth(data, 5);
    // Track a rolling max that only decays slowly so the y-axis doesn't
    // bounce when a spike falls off the window.
    const sMax = dataRef.current.smoothed.reduce((m, v) => (v > m ? v : m), 0);
    const target = Math.max(1, sMax * 1.2);
    maxYRef.current = maxYRef.current * 0.85 + target * 0.15;
  }, [data, timestamps, ranges]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapperRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let dpr = window.devicePixelRatio || 1;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const WINDOW_MS = 60_000;
    const PADDING_X = 8;
    const PADDING_TOP = 18;
    const PADDING_BOTTOM = 6;

    const draw = () => {
      const { timestamps: ts, smoothed, ranges: rs } = dataRef.current;
      const cw = canvas.width / dpr;
      const ch = canvas.height / dpr;
      const wallNow = Date.now();
      const windowStart = wallNow - WINDOW_MS;
      const usableW = cw - PADDING_X * 2;
      const usableH = ch - PADDING_TOP - PADDING_BOTTOM;
      const maxY = maxYRef.current;

      ctx.clearRect(0, 0, cw, ch);

      // grid
      ctx.strokeStyle = 'rgba(255,255,255,0.045)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = PADDING_TOP + (usableH * i) / 4;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(cw, y);
        ctx.stroke();
      }

      const tx = (t: number) => PADDING_X + ((t - windowStart) / WINDOW_MS) * usableW;
      const vy = (v: number) => PADDING_TOP + usableH - (v / maxY) * usableH;

      // tension-range markers: shaded band + bracketing start/end lines
      for (const r of rs) {
        if (r.endTs < windowStart || r.startTs > wallNow) continue;
        const age = (wallNow - r.detTs) / 1000;
        const fade = Math.max(0.25, 1 - age / 90);
        const c = r.color;
        const xStart = tx(Math.max(r.startTs, windowStart));
        const xEnd = tx(Math.min(r.endTs, wallNow));

        // shaded band
        ctx.fillStyle = hexA(c, 0.10 * fade);
        ctx.fillRect(xStart, PADDING_TOP, xEnd - xStart, ch - PADDING_TOP - PADDING_BOTTOM);

        // start line (solid)
        if (r.startTs >= windowStart) {
          ctx.strokeStyle = hexA(c, 0.85 * fade);
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(xStart, PADDING_TOP);
          ctx.lineTo(xStart, ch - PADDING_BOTTOM);
          ctx.stroke();
          ctx.fillStyle = hexA(c, fade);
          ctx.beginPath();
          ctx.moveTo(xStart, PADDING_TOP - 1);
          ctx.lineTo(xStart + 5, PADDING_TOP - 5);
          ctx.lineTo(xStart - 5, PADDING_TOP - 5);
          ctx.closePath();
          ctx.fill();
        }

        // end line (dashed)
        if (r.endTs <= wallNow + 200) {
          ctx.strokeStyle = hexA(c, 0.65 * fade);
          ctx.lineWidth = 1.25;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(xEnd, PADDING_TOP);
          ctx.lineTo(xEnd, ch - PADDING_BOTTOM);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      if (smoothed.length < 2) {
        drawEmpty(ctx, cw, ch);
        raf = requestAnimationFrame(draw);
        return;
      }

      // Build the in-window point set. Clamp the right edge to "now" so the
      // newest sample doesn't render past the visible area while it waits
      // for the next sample to arrive.
      const pts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < smoothed.length; i++) {
        const t = ts[i];
        if (t < windowStart - 1000) continue;
        const x = tx(Math.min(t, wallNow));
        const y = vy(smoothed[i]);
        pts.push({ x, y });
      }
      // Pin the very last point to "right now" so the line keeps sliding
      // even between samples (it'll just stay at the last known value).
      if (pts.length > 0) {
        const lastY = pts[pts.length - 1].y;
        pts.push({ x: tx(wallNow), y: lastY });
      }

      const path = monotonePath(pts);

      // gradient fill under the curve
      const grad = ctx.createLinearGradient(0, PADDING_TOP, 0, ch);
      grad.addColorStop(0, 'rgba(145, 71, 255, 0.42)');
      grad.addColorStop(1, 'rgba(145, 71, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      path(ctx);
      ctx.lineTo(pts[pts.length - 1].x, ch - PADDING_BOTTOM);
      ctx.lineTo(pts[0].x, ch - PADDING_BOTTOM);
      ctx.closePath();
      ctx.fill();

      // crisp stroke with soft glow
      ctx.strokeStyle = '#b785ff';
      ctx.lineWidth = 1.75;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(145, 71, 255, 0.55)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      path(ctx);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // tiny dot at the leading edge so the live point reads as "now"
      const tip = pts[pts.length - 1];
      ctx.fillStyle = '#d8b8ff';
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // axis labels
      ctx.fillStyle = 'rgba(173,173,184,0.55)';
      ctx.font = '10px "Google Sans Mono", "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${maxY.toFixed(0)} msg/s`, PADDING_X, 12);
      ctx.fillText('0', PADDING_X, ch - 2);

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div style={{
      background: '#18181b',
      border: '1px solid #26262c',
      borderRadius: '6px',
      padding: '12px 14px',
    }}>
      <div style={{
        fontSize: '11px',
        color: '#adadb8',
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        marginBottom: '8px',
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>Chat activity</span>
        <span style={{ color: '#6a6a73' }}>last 60s</span>
      </div>
      <div ref={wrapperRef} style={{ width: '100%', height: '160px', position: 'relative' }}>
        <canvas ref={canvasRef} style={{ display: 'block' }} />
      </div>
    </div>
  );
}

// 5-point centered moving average — light smoothing without phase lag.
function smooth(arr: number[], window = 5): number[] {
  const n = arr.length;
  if (n === 0) return [];
  const half = Math.floor(window / 2);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      sum += arr[j];
      cnt++;
    }
    out[i] = sum / cnt;
  }
  return out;
}

function monotonePath(points: Array<{ x: number; y: number }>) {
  const n = points.length;
  if (n < 2) return (ctx: CanvasRenderingContext2D) => {
    if (n === 1) ctx.moveTo(points[0].x, points[0].y);
  };
  const dx = new Array(n - 1);
  const dy = new Array(n - 1);
  const m = new Array(n);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1].x - points[i].x;
    dy[i] = points[i + 1].y - points[i].y;
  }
  m[0] = dx[0] ? dy[0] / dx[0] : 0;
  m[n - 1] = dx[n - 2] ? dy[n - 2] / dx[n - 2] : 0;
  for (let i = 1; i < n - 1; i++) {
    const s1 = dx[i - 1] ? dy[i - 1] / dx[i - 1] : 0;
    const s2 = dx[i] ? dy[i] / dx[i] : 0;
    if (s1 * s2 <= 0) m[i] = 0;
    else m[i] = (s1 + s2) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    const s = dx[i] ? dy[i] / dx[i] : 0;
    if (s === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / s;
    const b = m[i + 1] / s;
    const hyp = a * a + b * b;
    if (hyp > 9) {
      const t = 3 / Math.sqrt(hyp);
      m[i] = t * a * s;
      m[i + 1] = t * b * s;
    }
  }
  return (ctx: CanvasRenderingContext2D) => {
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i];
      ctx.bezierCurveTo(
        points[i].x + h / 3,
        points[i].y + (m[i] * h) / 3,
        points[i + 1].x - h / 3,
        points[i + 1].y - (m[i + 1] * h) / 3,
        points[i + 1].x,
        points[i + 1].y,
      );
    }
  };
}

function hexA(hex: string, a: number): string {
  // accept "#rrggbb"
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

function drawEmpty(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = 'rgba(173,173,184,0.4)';
  ctx.font = '12px "Google Sans Mono", "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('waiting for chat…', w / 2, h / 2);
  ctx.textAlign = 'left';
}

export default memo(ChatTimelineInner);
