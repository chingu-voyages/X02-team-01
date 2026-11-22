"use client";

import type { PracticeCategory } from "@/types/category-api.types";

type PracticeCategoryCardProps = {
  category: PracticeCategory;
  isSelected: boolean;
  onSelect: (category: PracticeCategory) => void;
};

export default function PracticeCategoryCard({
  category,
  isSelected,
  onSelect,
}: PracticeCategoryCardProps) {
  return (
    <article
      className={`flex flex-col rounded-md border bg-white p-5 text-brand-text shadow-xs transition-all ${
        isSelected
          ? "border-brand-accent ring-2 ring-brand-accent/40"
          : "border-brand-border"
      }`}
    >
      <div>
        <span className="inline-flex rounded-full bg-brand-secondary/50 px-3 py-1 text-xs font-semibold tracking-wide text-brand-text">
          AVAILABLE
        </span>
      </div>

      <div className="mt-4 flex-1">
        <h2 className="text-xl font-bold text-brand-text">{category.name}</h2>

        <p className="mt-2 text-sm leading-6 text-brand-text/70">
          {category.certification_name}
        </p>
      </div>

      <div className="mt-5 border-t border-brand-border pt-4">
        <p className="text-xs leading-5 text-brand-text/70">
          Questions drawn from active, approved bank
        </p>

        <p className="mt-1 text-xs font-medium text-brand-text/80">
          {category.available_question_count} questions available
        </p>
      </div>

      <button
        type="button"
        aria-label={`View exam — ${category.name}`}
        aria-pressed={isSelected}
        onClick={() => onSelect(category)}
        className={`mt-4 w-fit cursor-pointer rounded-md px-4 py-2.5 text-sm font-semibold transition-colors ${
          isSelected
            ? "bg-brand-accent text-brand-text"
            : "border border-brand-border bg-brand-surface text-brand-text hover:bg-brand-accent-tint"
        }`}
      >
        {isSelected ? "Selected" : "View exam"}
      </button>
    </article>
  );
}