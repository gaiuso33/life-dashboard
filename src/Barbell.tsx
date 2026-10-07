import { ITEMS } from './derive';
import type { DayStatus } from './derive';

// One plate per daily item, heaviest and largest closest to the centre.
const PLATES = [
  { w: 24, h: 188 },
  { w: 22, h: 158 },
  { w: 20, h: 126 },
  { w: 18, h: 96 },
];

export function Barbell({ status }: { status: DayStatus }) {
  const loaded = ITEMS.filter((i) => status[i.key]).length;
  const cy = 110;
  const innerLeft = 196;
  const innerRight = 464;

  const plate = (idx: number, side: -1 | 1) => {
    const item = ITEMS[idx];
    const p = PLATES[idx];
    const on = status[item.key];
    let offset = 0;
    for (let i = 0; i < idx; i++) offset += PLATES[i].w + 3;
    const x = side === -1 ? innerLeft - offset - p.w : innerRight + offset;
    const shift = side === -1 ? -16 : 16;
    return (
      <g
        key={`${item.key}${side}`}
        style={{ transform: `translateX(${on ? 0 : shift}px)`, opacity: on ? 1 : 0.9, transition: 'transform 420ms cubic-bezier(.2,.9,.3,1.2), opacity 200ms' }}
      >
        <rect
          x={x}
          y={cy - p.h / 2}
          width={p.w}
          height={p.h}
          rx={5}
          fill={on ? item.color : 'transparent'}
          stroke={item.color}
          strokeWidth={on ? 0 : 1.5}
          strokeDasharray={on ? undefined : '4 5'}
          opacity={on ? 1 : 0.55}
        />
        {on && <rect x={x + p.w * 0.5 - 1} y={cy - p.h / 2 + 8} width={2} height={p.h - 16} rx={1} fill="rgba(255,255,255,.28)" />}
      </g>
    );
  };

  return (
    <svg viewBox="0 0 660 220" className="barbell" role="img" aria-label={`${loaded} of 4 plates loaded today`}>
      <rect x={14} y={cy - 5} width={632} height={10} rx={5} fill="#3a4558" />
      <rect x={14} y={cy - 9} width={170} height={18} rx={4} fill="#2b3444" />
      <rect x={476} y={cy - 9} width={170} height={18} rx={4} fill="#2b3444" />
      <g stroke="#566176" strokeWidth={1}>
        {Array.from({ length: 22 }).map((_, i) => (
          <line key={i} x1={238 + i * 8} x2={238 + i * 8} y1={cy - 4} y2={cy + 4} />
        ))}
      </g>
      {[0, 1, 2, 3].map((i) => plate(i, -1))}
      {[0, 1, 2, 3].map((i) => plate(i, 1))}
    </svg>
  );
}
