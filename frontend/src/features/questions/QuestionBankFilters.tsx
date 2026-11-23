"use client";

import { Search } from "lucide-react";

type QuestionBankFiltersProps = {
  search: string;
  questionType: string;
  statusFilter: string;
  categoryFilter: string;
  categories: string[];
  onSearchChange: (value: string) => void;
  onQuestionTypeChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onCategoryFilterChange: (value: string) => void;
};

export default function QuestionBankFilters({
  search,
  questionType,
  statusFilter,
  categoryFilter,
  categories,
  onSearchChange,
  onQuestionTypeChange,
  onStatusFilterChange,
  onCategoryFilterChange,
}: QuestionBankFiltersProps) {
  return (
    <div className="mb-4 grid gap-3 md:grid-cols-[minmax(240px,1.6fr)_minmax(140px,0.8fr)_minmax(140px,0.8fr)_minmax(160px,0.9fr)]">
      <label className="relative">
        <span className="sr-only">Search questions</span>
        <Search
          aria-hidden="true"
          className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-brand-text/55"
        />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search by question or ID"
          className="h-11 w-full rounded-md border border-brand-border bg-white pl-9 pr-3 text-sm text-brand-text shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
        />
      </label>

      <select
        aria-label="Question type"
        value={questionType}
        onChange={(event) => onQuestionTypeChange(event.target.value)}
        className="h-11 cursor-pointer rounded-md border border-brand-border bg-white px-3 text-sm text-brand-text shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
      >
        <option value="all">Question Type</option>
        <option value="multiple_choice">Multiple Choice</option>
        <option value="short_answer">Short Answer</option>
      </select>

      <select
        aria-label="Status"
        value={statusFilter}
        onChange={(event) => onStatusFilterChange(event.target.value)}
        className="h-11 cursor-pointer rounded-md border border-brand-border bg-white px-3 text-sm text-brand-text shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
      >
        <option value="all">Status</option>
        <option value="Published">Published</option>
        <option value="Draft">Draft</option>
        <option value="Rejected">Rejected</option>
        <option value="Retired">Retired</option>
      </select>

      <select
        aria-label="Category"
        value={categoryFilter}
        onChange={(event) => onCategoryFilterChange(event.target.value)}
        className="h-11 cursor-pointer rounded-md border border-brand-border bg-white px-3 text-sm text-brand-text shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
      >
        <option value="all">Category</option>
        {categories.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </select>
    </div>
  );
}