import { CheckCircle2, XCircle } from "lucide-react";
import ScoreRing from "./ScoreRing";

interface CompactResultCardProps {
  scorePercent: number | null;
  correctCount: number;
  incorrectCount: number;
  isPassed: boolean | null;
  passingScorePercent: number | null;
}

export default function CompactResultCard({
  scorePercent,
  correctCount,
  incorrectCount,
  isPassed,
  passingScorePercent,
}: CompactResultCardProps) {
  const hasScore = scorePercent !== null && isPassed !== null;
  const formattedScore =
    scorePercent === null ? "—" : `${Math.round(scorePercent)}%`;

  return (
    <div className="flex items-center gap-4 rounded-2xl bg-linear-to-br from-[#24236b] via-[#19184a] to-[#342348] p-5 text-white shadow-xs md:hidden">
      <ScoreRing
        scorePercent={scorePercent}
        passingScorePercent={passingScorePercent}
        size="compact"
      />

      <div className="min-w-0 space-y-1.5">
        {!hasScore ? (
          <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs font-bold text-white">
            Not assessed
          </span>
        ) : isPassed ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
            <CheckCircle2 aria-hidden="true" className="size-3.5 stroke-[2.5]" />
            Passed
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
            <XCircle aria-hidden="true" className="size-3.5 stroke-[2.5]" />
            Not passed
          </span>
        )}

        <p className="text-base font-bold leading-snug text-white">
          {scorePercent !== null
            ? `${formattedScore} scored`
            : "Score unavailable"}
          {passingScorePercent !== null && (
            <> · {Math.round(passingScorePercent)}% required</>
          )}
        </p>

        <p className="text-xs text-white/75">
          {correctCount} correct · {incorrectCount} incorrect
        </p>
      </div>
    </div>
  );
}