export interface RateSample {
  ts: number;
  rate: number;
}

export interface TensionWindow {
  startTs: number;
  endTs: number;
  baseline: number;
  /**
   * True once we've seen at least 3 consecutive samples below the calm
   * threshold after detection. The finalize poll uses this — when false,
   * tension is still ongoing and the clip should keep growing.
   */
  calmFound: boolean;
}

/**
 * Find the actual tension window around a detected highlight.
 *
 *  - baseline      = 60th-percentile rate from [detTs-90s, detTs-25s]
 *  - tension-start = walk back from detection while rate > baseline*1.4+1,
 *                    plus a 4 s pre-roll pad
 *  - tension-end   = first sample after detection where rate < baseline*1.25+0.5
 *                    for 3 consecutive 500 ms samples (~1.5 s of calm),
 *                    plus a 2 s post-roll pad
 *  - clamps: pre-roll at least 6 s before detection, post-roll at least 3 s after
 */
export function findTensionWindow(detTs: number, nowTs: number, samples: RateSample[]): TensionWindow {
  if (samples.length === 0) {
    return {
      startTs: detTs - 8_000,
      endTs: Math.min(nowTs, detTs + 6_000),
      baseline: 0,
      calmFound: false,
    };
  }

  // Baseline from the calm period before the buildup.
  const preWindow = samples.filter((s) => s.ts >= detTs - 90_000 && s.ts <= detTs - 25_000);
  let baseline = 0;
  if (preWindow.length >= 4) {
    const sorted = preWindow.map((s) => s.rate).sort((a, b) => a - b);
    baseline = sorted[Math.floor(sorted.length * 0.6)];
  } else {
    const r = samples.map((s) => s.rate).sort((a, b) => a - b);
    baseline = r[Math.floor(r.length * 0.4)] || 0;
  }

  const startThreshold = baseline * 1.4 + 1;
  const endThreshold = baseline * 1.25 + 0.5;

  // Walk back from detection to find where the spike started.
  let startTs = detTs;
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    if (s.ts > detTs) continue;
    if (s.ts < detTs - 90_000) break;
    if (s.rate > startThreshold) {
      startTs = s.ts;
    } else if (startTs < detTs) {
      // We've already found above-threshold samples and now hit a calm one
      // — stop expanding (anything earlier is unrelated pre-buildup quiet).
      break;
    }
  }
  // 8 s pre-roll pad, with a 14 s minimum before detection — gives the user
  // enough headroom to crop in or out around the actual moment.
  startTs = Math.min(startTs - 8_000, detTs - 14_000);

  // Walk forward from detection to find when calm returns.
  let endTs = detTs + 3_000;
  let belowStreak = 0;
  let calmStartTs = 0;
  let calmFound = false;
  for (const s of samples) {
    if (s.ts <= detTs) continue;
    if (s.ts > nowTs) break;
    if (s.rate < endThreshold) {
      if (belowStreak === 0) calmStartTs = s.ts;
      belowStreak += 1;
      if (belowStreak >= 3) {
        endTs = calmStartTs;
        calmFound = true;
        break;
      }
    } else {
      belowStreak = 0;
      calmStartTs = 0;
    }
  }
  // 6 s post-roll pad after the calm point; respect a 10 s minimum after
  // detection. NOTE: we DON'T clamp to nowTs here — the caller is expected
  // to either wait until wall-clock reaches endTs (so the post-roll period
  // is actually captured) or honestly truncate when force-finalizing.
  endTs = Math.max(endTs + 6_000, detTs + 10_000);

  return { startTs, endTs, baseline, calmFound };
}
