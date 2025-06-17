import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

interface ChatTimelineProps {
  data: number[];
  timestamps: number[];
  highlights: Array<{ timestamp: number }>;
}

export default function ChatTimeline({ data, timestamps, highlights }: ChatTimelineProps) {
  const chartData = data.map((rate, i) => ({
    time: timestamps[i] ? new Date(timestamps[i]).toLocaleTimeString() : i.toString(),
    rate,
    timestamp: timestamps[i] || 0,
  }));

  // Compute mean for reference line
  const mean = data.length > 0 ? data.reduce((a, b) => a + b, 0) / data.length : 0;

  return (
    <div style={{
      background: '#1f1f23',
      borderRadius: '8px',
      padding: '16px',
    }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#adadb8' }}>
        Chat Activity
      </h3>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="chatGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#9147ff" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#9147ff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: '#adadb8' }}
            interval="preserveStartEnd"
            tickCount={6}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#adadb8' }}
            width={35}
            label={{ value: 'msg/s', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#adadb8' }}
          />
          <Tooltip
            contentStyle={{
              background: '#18181b',
              border: '1px solid #3a3a3d',
              borderRadius: '4px',
              fontSize: '12px',
            }}
            labelStyle={{ color: '#efeff1' }}
            formatter={(value: number) => [`${value.toFixed(1)} msg/s`, 'Rate']}
          />
          <ReferenceLine
            y={mean}
            stroke="#adadb8"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
          {highlights.map((h, i) => {
            const idx = timestamps.findIndex((t) => Math.abs(t - h.timestamp) < 5000);
            if (idx >= 0 && chartData[idx]) {
              return (
                <ReferenceLine
                  key={i}
                  x={chartData[idx].time}
                  stroke="#ff4444"
                  strokeWidth={2}
                  strokeOpacity={0.7}
                />
              );
            }
            return null;
          })}
          <Area
            type="monotone"
            dataKey="rate"
            stroke="#9147ff"
            fill="url(#chatGradient)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
