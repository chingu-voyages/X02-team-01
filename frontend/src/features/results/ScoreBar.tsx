interface ScoreBarProps {
  scorePercent: number;
  passingScorePercent: number;
}

export default function ScoreBar({
  scorePercent,
  passingScorePercent,
}: ScoreBarProps) {
  const clampedScore = Math.min(100, Math.max(0, scorePercent));
  const clampedPass = Math.min(100, Math.max(0, passingScorePercent));

  return (
    <div aria-hidden="true" className="space-y-2">
      <div className="relative h-3 w-full rounded-full bg-brand-secondary/45">
        <div
          className="h-full rounded-full bg-brand-primary transition-[width] duration-300 ease-out"
          style={{ width: `${clampedScore}%` }}
        />

        <span
          className="absolute top-1/2 h-6 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-accent shadow-[0_0_8px_rgba(249,139,36,0.85)]"
          style={{ left: `${clampedPass}%` }}
        />
      </div>

      <div className="relative flex items-center justify-between text-xs font-semibold text-brand-text/65">
        <span>0%</span>

        <span
          className="absolute -translate-x-1/2 font-bold text-brand-text"
          style={{ left: `${clampedPass}%` }}
        >
          Pass {Math.round(clampedPass)}%
        </span>

        <span>100%</span>
      </div>
    </div>
  );
}