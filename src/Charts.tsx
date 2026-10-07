import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { fmtShort, keyFromDayNumber } from './utils';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(Math.max(260, Math.round(el.getBoundingClientRect().width)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceTicks(lo: number, hi: number, count = 4) {
  const span = hi - lo || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  const start = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  // Always end on a tick at or above the data's maximum so nothing is clipped.
  for (let v = start; ; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
    if (v >= hi - step * 0.001) break;
  }
  return ticks;
}

export interface Series {
  name: string;
  pts: { x: number; y: number }[];
  color: string;
  dashed?: boolean;
  dots?: boolean;
}

interface LineProps {
  series: Series[];
  goal?: number | null;
  unit: string;
  height?: number;
  label: string;
}

export function LineChart({ series, goal, unit, height = 280, label }: LineProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 44, r: goal != null ? 58 : 16, t: 14, b: 28 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;

  const all = series.flatMap((s) => s.pts);
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y).concat(goal != null ? [goal] : []);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const rawLo = Math.min(...ys);
  const rawHi = Math.max(...ys);
  const pad = (rawHi - rawLo || 1) * 0.15;
  const ticks = niceTicks(rawLo - pad, rawHi + pad);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const sx = (x: number) => m.l + ((x - x0) / (x1 - x0 || 1)) * iw;
  const sy = (y: number) => m.t + (1 - (y - y0) / (y1 - y0 || 1)) * ih;

  const main = series[0];
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bd = Infinity;
    main.pts.forEach((p, i) => {
      const d = Math.abs(sx(p.x) - px);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best);
  };

  const hp = hover != null ? main.pts[hover] : null;
  const labelEvery = Math.max(1, Math.ceil(main.pts.length / Math.max(2, Math.floor(iw / 78))));
  const pathOf = (s: Series) => s.pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');

  return (
    <div className="chart" ref={ref}>
      <div className="legend" aria-hidden="true">
        {series.map((s) => (
          <span key={s.name} className="legend-item">
            <i className={s.dashed ? 'swatch dashed' : 'swatch'} style={{ ['--c' as string]: s.color }} />
            {s.name}
          </span>
        ))}
        {goal != null && (
          <span className="legend-item">
            <i className="swatch goal" />
            Goal
          </span>
        )}
      </div>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        className="plot"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={m.l - 8} y={sy(t) + 4} textAnchor="end" className="axis">
              {t}
            </text>
          </g>
        ))}
        {main.pts.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={p.x} x={sx(p.x)} y={height - 8} textAnchor="middle" className="axis">
              {fmtShort(keyFromDayNumber(p.x))}
            </text>
          ) : null,
        )}
        {goal != null && (
          <g>
            <line x1={m.l} x2={width - m.r} y1={sy(goal)} y2={sy(goal)} className="goal-line" />
            <text x={width - m.r + 6} y={sy(goal) + 4} className="axis goal-text">
              Goal {goal}
            </text>
          </g>
        )}
        {series.map((s) => (
          <g key={s.name}>
            <path d={pathOf(s)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 5' : undefined} strokeLinecap="round" strokeLinejoin="round" />
            {s.dots &&
              s.pts.map((p) => (
                <circle key={p.x} cx={sx(p.x)} cy={sy(p.y)} r={4} fill={s.color} stroke="var(--steel-1)" strokeWidth={2} />
              ))}
          </g>
        ))}
        {hp && (
          <g pointerEvents="none">
            <line x1={sx(hp.x)} x2={sx(hp.x)} y1={m.t} y2={m.t + ih} className="crosshair" />
            <circle cx={sx(hp.x)} cy={sy(hp.y)} r={6} fill={main.color} stroke="var(--chalk)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hp && (
        <div className="tip" style={{ left: Math.min(Math.max(sx(hp.x), 70), width - 70), top: Math.max(sy(hp.y) - 12, 4) }}>
          <b>
            {hp.y} {unit}
          </b>
          <span>{fmtShort(keyFromDayNumber(hp.x))}</span>
        </div>
      )}
    </div>
  );
}

export interface Bar {
  label: string;
  value: number;
  detail: string;
}

export function BarChart({ bars, color, unit, label, height = 200 }: { bars: Bar[]; color: string; unit: string; label: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 44, r: 8, t: 12, b: 28 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const ticks = niceTicks(0, max, 3);
  const top = ticks[ticks.length - 1];
  const slot = iw / bars.length;
  const bw = Math.min(34, slot * 0.6);
  const sy = (v: number) => m.t + (1 - v / top) * ih;

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={label} className="plot" onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={m.l - 8} y={sy(t) + 4} textAnchor="end" className="axis">
              {t}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const cx = m.l + slot * i + slot / 2;
          const h = Math.max(b.value > 0 ? 2 : 0, ih - (sy(b.value) - m.t));
          return (
            <g key={b.label} onPointerEnter={() => setHover(i)}>
              <rect x={m.l + slot * i} y={m.t} width={slot} height={ih} fill="transparent" />
              <path
                d={`M${cx - bw / 2},${m.t + ih} V${m.t + ih - h + 4} Q${cx - bw / 2},${m.t + ih - h} ${cx - bw / 2 + 4},${m.t + ih - h} H${cx + bw / 2 - 4} Q${cx + bw / 2},${m.t + ih - h} ${cx + bw / 2},${m.t + ih - h + 4} V${m.t + ih} Z`}
                fill={color}
                opacity={hover == null || hover === i ? 1 : 0.45}
              />
              {i % Math.max(1, Math.ceil(64 / slot)) === 0 && (
                <text x={cx} y={height - 8} textAnchor="middle" className="axis">
                  {b.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div
          className="tip"
          style={{
            left: Math.min(Math.max(m.l + slot * hover + slot / 2, 70), width - 70),
            top: Math.max(sy(bars[hover].value) - 12, 4),
          }}
        >
          <b>
            {bars[hover].value} {unit}
          </b>
          <span>{bars[hover].detail}</span>
        </div>
      )}
    </div>
  );
}

export function Sparkline({ values, color, label }: { values: number[]; color: string; label: string }) {
  const w = 160;
  const h = 44;
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const sx = (i: number) => 4 + (i / (values.length - 1)) * (w - 8);
  const sy = (v: number) => 6 + (1 - (v - lo) / (hi - lo || 1)) * (h - 12);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="spark">
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={sx(values.length - 1)} cy={sy(values[values.length - 1])} r={4} fill={color} stroke="var(--steel-2)" strokeWidth={2} />
    </svg>
  );
}
