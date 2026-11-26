import { CheckCircle2, XCircle } from "lucide-react";
import ScoreBar from "./ScoreBar";
import ScoreRing from "./ScoreRing";
import StatTile from "./StatTile";

interface ResultSummaryCardProps {
  scorePercent: number | null;
  correctCount: number;
  incorrectCount: number;
  totalQuestions: number;
  isPassed: boolean | null;
  passingScorePercent: number | null;
  hasManualGrading?: boolean;
}

export default function ResultSummaryCard({
  scorePercent,
  correctCount,
  incorrectCount,
  totalQuestions,
  isPassed,
  passingScorePercent,
  hasManualGrading = false,
}: ResultSummaryCardProps) {
  const hasScore = scorePercent !== null && isPassed !== null;
  const formattedScore =
    scorePercent === null ? "—" : `${Math.round(scorePercent)}%`;

  const outcomeHeading = !hasScore
    ? "Not assessed"
    : isPassed
      ? "Pass"
      : "Fail";

  const missingCorrectCount =
    !isPassed &&
    !hasManualGrading &&
    passingScorePercent !== null &&
    totalQuestions > 0 &&
    totalQuestions === correctCount + incorrectCount
      ? Math.max(
          1,
          Math.ceil((passingScorePercent / 100) * totalQuestions) - correctCount,
        )
      : null;

  const guidanceMessage = !hasScore
    ? "No automatically graded score is available for this attempt. This does not mean the exam was failed."
    : isPassed
      ? "Great work — you cleared the pass mark. Review the explanations to lock in what you learned."
      : missingCorrectCount !== null
        ? `You're ${missingCorrectCount} correct ${
            missingCorrectCount === 1 ? "answer" : "answers"
          } away from the pass mark. Review the questions you missed, then try again when you're ready.`
        : "Review the questions you missed, then try again when you're ready.";

  return (
    <div className="hidden overflow-hidden rounded-2xl border border-brand-border bg-white shadow-xs md:grid md:grid-cols-[290px_minmax(0,1fr)] lg:grid-cols-[330px_minmax(0,1fr)]">
      {/* Left dark score panel */}
      <div className="flex flex-col items-center justify-center gap-6 bg-linear-to-br from-[#24236b] via-[#19184a] to-[#342348] p-8 text-white">
        <ScoreRing
          scorePercent={scorePercent}
          passingScorePercent={passingScorePercent}
          size="large"
        />

        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-medium text-white/85">
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full bg-brand-secondary"
            />
            Score {formattedScore}
          </span>

          {passingScorePercent !== null && (
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-3 w-1 rounded-full bg-brand-accent"
              />
              Pass mark {Math.round(passingScorePercent)}%
            </span>
          )}
        </div>
      </div>

      {/* Right white breakdown panel */}
      <div className="flex flex-col justify-between gap-6 p-7 lg:p-8">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-brand-text/60">
              Exam result
            </span>

            {!hasScore ? (
              <span className="inline-flex items-center rounded-full border border-brand-border bg-brand-surface px-3 py-0.5 text-xs font-bold text-brand-text">
                Not assessed
              </span>
            ) : isPassed ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-0.5 text-xs font-bold text-emerald-700">
                <CheckCircle2
                  aria-hidden="true"
                  className="size-3.5 stroke-[2.5]"
                />
                Passed
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-0.5 text-xs font-bold text-red-700">
                <XCircle
                  aria-hidden="true"
                  className="size-3.5 stroke-[2.5]"
                />
                Not passed
              </span>
            )}
          </div>

          <p
            role="status"
            className="text-4xl font-bold tracking-tight text-brand-text"
          >
            {outcomeHeading}
          </p>

          <p className="text-base font-bold text-brand-text">
            {scorePercent !== null
              ? `${formattedScore} scored`
              : "Score unavailable"}

            {passingScorePercent !== null && (
              <>
                <span className="mx-2 text-brand-text/45" aria-hidden="true">
                  •
                </span>
                <span>{Math.round(passingScorePercent)}% required to pass</span>
              </>
            )}
          </p>

          <p className="max-w-xl text-sm leading-6 text-brand-text/75">
            {guidanceMessage}
          </p>
        </div>

        {scorePercent !== null && passingScorePercent !== null && (
          <ScoreBar
            scorePercent={scorePercent}
            passingScorePercent={passingScorePercent}
          />
        )}

        <div className="grid grid-cols-3 gap-3.5">
          <StatTile variant="correct" count={correctCount} />
          <StatTile variant="incorrect" count={incorrectCount} />
          <StatTile variant="questions" count={totalQuestions} />
        </div>
      </div>
    </div>
  );
}
