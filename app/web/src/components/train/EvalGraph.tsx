// The game's eval graph (win% over plies, white-POV), with your mistakes marked and
// clickable — the review surface's spine (docs/16 §8.2). Reuses the coach's winPct.
import { winPct } from "../../lib/coach";
import type { PlyAnalysis } from "../../lib/train";

export default function EvalGraph({
  plies,
  cursor,
  mistakePlies,
  onJump,
  w = 360,
  h = 96,
}: {
  plies: PlyAnalysis[];
  cursor: number; // 0..N (moves played)
  mistakePlies: Set<number>; // 1-based ply numbers that are YOUR mistakes
  onJump: (cursor: number) => void;
  w?: number;
  h?: number;
}) {
  if (!plies.length) return null;
  const n = plies.length;
  const x = (i: number) => (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (cp: number) => h - (winPct(cp) / 100) * h;
  const pts = plies.map((p, i) => `${x(i).toFixed(1)},${y(p.evalCpWhite).toFixed(1)}`).join(" ");
  const mid = h / 2;

  return (
    <svg width={w} height={h} className="overflow-visible block">
      {/* white-advantage fill above the polyline baseline */}
      <line x1={0} y1={mid} x2={w} y2={mid} stroke="var(--color-line-2)" strokeWidth={1} strokeDasharray="3 3" />
      <polyline points={pts} fill="none" stroke="var(--color-brass)" strokeWidth={1.5} strokeLinejoin="round" />
      {/* mistake markers */}
      {plies.map((p, i) =>
        mistakePlies.has(p.ply) ? (
          <circle
            key={p.ply}
            cx={x(i)}
            cy={y(p.evalCpWhite)}
            r={4}
            fill="var(--color-ember)"
            stroke="#1a1610"
            strokeWidth={1.5}
            className="cursor-pointer"
            onClick={() => onJump(Math.max(0, p.ply - 1))}
          >
            <title>Your {p.cls} on move {Math.ceil(p.ply / 2)} — click to review</title>
          </circle>
        ) : null
      )}
      {/* current cursor position */}
      {cursor > 0 && cursor <= n && (
        <line
          x1={x(cursor - 1)}
          y1={0}
          x2={x(cursor - 1)}
          y2={h}
          stroke="var(--color-ivory)"
          strokeWidth={1}
          opacity={0.5}
        />
      )}
    </svg>
  );
}
