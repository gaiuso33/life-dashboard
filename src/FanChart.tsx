import type { FanChartData } from './forecast';
import { naira } from './money';

const W = 320;
const H = 150;
const M = { l: 8, r: 8, t: 10, b: 22 };

/** A small picture of a forecast: the past as a line, the likely path dashed, and a shaded range around it. */
export function FanChart({ chart, label }: { chart: FanChartData; label: string }) {
  const all = [...chart.history, ...chart.mid, ...chart.low, ...chart.high];
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y).concat(chart.goal != null ? [chart.goal] : []);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const pad = (hi - lo || 1) * 0.12;
  const y0 = lo - pad;
  const y1 = hi + pad;
  const sx = (x: number) => M.l + ((x - x0) / (x1 - x0 || 1)) * (W - M.l - M.r);
  const sy = (y: number) => M.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - M.t - M.b);
  const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const band = `${path(chart.high)}${[...chart.low].reverse().map((p) => `L${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('')}Z`;
  const fmt = (n: number) => (chart.unit === '₦' ? naira(Math.round(n)) : `${Math.round(n * 10) / 10} ${chart.unit}`);
  const endMid = chart.mid[chart.mid.length - 1];

  return (
    <svg className="fan" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {chart.goal != null && (
        <g>
          <line x1={M.l} x2={W - M.r} y1={sy(chart.goal)} y2={sy(chart.goal)} className="fan-goal" />
          <text x={W - M.r} y={sy(chart.goal) - 4} textAnchor="end" className="fan-text">
            Goal {fmt(chart.goal)}
          </text>
        </g>
      )}
      <path d={band} className="fan-band" />
      {chart.history.length > 1 && <path d={path(chart.history)} className="fan-hist" />}
      {chart.history.map((p, i) => (
        <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={2.5} className="fan-dot" />
      ))}
      <path d={path(chart.mid)} className="fan-mid" />
      <circle cx={sx(endMid.x)} cy={sy(endMid.y)} r={3} className="fan-end" />
      <text x={M.l} y={H - 6} className="fan-text">
        {chart.xLabel(x0)}
      </text>
      <text x={W - M.r} y={H - 6} textAnchor="end" className="fan-text">
        {chart.xLabel(x1)}
      </text>
    </svg>
  );
}
