import { Flag, Pencil, Send } from "lucide-react";

export default function NavigatorLegend() {
  return (
    <section aria-label="Question state legend">
      <ul className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-xs text-brand-text">
        <li className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="inline-flex size-6.5 shrink-0 rounded-[7px] bg-brand-primary ring-[3px] ring-brand-accent-tint"
          />
          <span>Current question</span>
        </li>

        <li className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="inline-flex size-6.5 shrink-0 items-center justify-center rounded-[7px] bg-brand-secondary/75 text-brand-primary-dark"
          >
            <Send className="size-3.75 stroke-[2.25]" />
          </span>
          <span>Submitted</span>
        </li>

        <li className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="inline-flex size-6.5 shrink-0 rounded-[7px] border-[1.5px] border-brand-secondary bg-white"
          />
          <span>Unanswered</span>
        </li>

        <li className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="inline-flex size-6.5 shrink-0 items-center justify-center rounded-[7px] border-[1.5px] border-brand-primary/50 bg-brand-accent-tint text-brand-primary-dark"
          >
            <Pencil className="size-3.75 stroke-[2.25]" />
          </span>
          <span>Selected but unsubmitted</span>
        </li>

        <li className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="inline-flex size-6.5 shrink-0 items-center justify-center rounded-[7px] border-[1.5px] border-dashed border-brand-primary bg-white text-brand-primary"
          >
            <Flag className="size-3.75" />
          </span>
          <span>Flagged for review</span>
        </li>

        <li className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="inline-flex size-6.5 shrink-0 items-center justify-center gap-0.5 rounded-[7px] border-[1.5px] border-dashed border-brand-primary bg-brand-secondary/75 text-brand-primary-dark"
          >
            <Send className="size-2.5" />
            <Flag className="size-2.5" />
          </span>
          <span>Submitted + flagged</span>
        </li>
      </ul>
      <p className="mt-3 text-xs leading-5 text-brand-text/70">
        Submitted means your answer was saved, not that it was correct.
      </p>
    </section>
  );
}
