import { CheckCircle2, HelpCircle, XCircle } from "lucide-react";

interface StatTileProps {
  variant: "correct" | "incorrect" | "questions";
  count: number;
}

const tilePresentation = {
  correct: {
    label: "Correct",
    Icon: CheckCircle2,
    headerClass: "text-emerald-700",
  },
  incorrect: {
    label: "Incorrect",
    Icon: XCircle,
    headerClass: "text-red-700",
  },
  questions: {
    label: "Questions",
    Icon: HelpCircle,
    headerClass: "text-brand-primary",
  },
} as const;

export default function StatTile({ variant, count }: StatTileProps) {
  const { label, Icon, headerClass } = tilePresentation[variant];

  return (
    <div className="rounded-xl border border-brand-border bg-brand-surface/75 px-4 py-3.5">
      <p
        className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${headerClass}`}
      >
        <Icon aria-hidden="true" className="size-3.5 shrink-0 stroke-[2.25]" />
        <span>{label}</span>
      </p>

      <p className="mt-2 text-2xl font-bold tracking-tight text-brand-text">
        {count}
      </p>
    </div>
  );
}