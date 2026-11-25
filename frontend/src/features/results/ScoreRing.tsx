interface ScoreRingProps {
  scorePercent: number | null;
  passingScorePercent?: number | null;
  size?: "large" | "compact";
}

export default function ScoreRing({
  scorePercent,
  passingScorePercent = null,
  size = "large",
}: ScoreRingProps) {
  const isLarge = size === "large";
  const dimension = isLarge ? 196 : 84;
  const strokeWidth = isLarge ? 18 : 9;
  const radius = (dimension - strokeWidth) / 2;
  const center = dimension / 2;
  const circumference = 2 * Math.PI * radius;

  const clampedScore =
    scorePercent === null ? 0 : Math.min(100, Math.max(0, scorePercent));
  const strokeDashoffset =
    circumference - (clampedScore / 100) * circumference;

  const formattedScore =
    scorePercent === null ? "—" : `${Math.round(scorePercent)}%`;

  const passAngleDeg =
    passingScorePercent !== null
      ? (Math.min(100, Math.max(0, passingScorePercent)) / 100) * 360 - 90
      : null;

  return (
    <div
      aria-hidden="true"
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: dimension, height: dimension }}
    >
      <svg
        width={dimension}
        height={dimension}
        viewBox={`0 0 ${dimension} ${dimension}`}
        className="overflow-visible"
      >
        <defs>
          <filter
            id="score-ring-pass-glow"
            x="-40%"
            y="-40%"
            width="180%"
            height="180%"
          >
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="2.5"
              floodColor="#f98b24"
              floodOpacity="0.85"
            />
          </filter>
        </defs>

        {/* Base track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(255, 255, 255, 0.14)"
          strokeWidth={strokeWidth}
        />

        {/* Score arc */}
        {scorePercent !== null && clampedScore > 0 && (
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#cbc6f0"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="butt"
            transform={`rotate(-90 ${center} ${center})`}
          />
        )}

        {/* Pass threshold tick on large ring */}
        {isLarge && passAngleDeg !== null && (
          <g transform={`rotate(${passAngleDeg} ${center} ${center})`}>
            <line
              x1={center + radius - strokeWidth * 0.65}
              y1={center}
              x2={center + radius + strokeWidth * 0.65}
              y2={center}
              stroke="#f98b24"
              strokeWidth={4}
              strokeLinecap="round"
              filter="url(#score-ring-pass-glow)"
            />
          </g>
        )}
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center text-white">
        <span
          className={
            isLarge
              ? "text-4xl font-bold tracking-tight"
              : "text-lg font-bold tracking-tight"
          }
        >
          {formattedScore}
        </span>

        {isLarge && (
          <span className="mt-1 text-[11px] font-bold uppercase tracking-widest text-white/75">
            Your score
          </span>
        )}
      </div>
    </div>
  );
}