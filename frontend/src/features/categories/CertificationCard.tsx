"use client";

import type {
  AdminCategory,
  AdminCertification,
} from "@/types/admin-catalog-api.types";

type CertificationCardProps = {
  certification: AdminCertification;
  categories: AdminCategory[];
  changingPublicationId: string | null;
  onToggleCertification: (certification: AdminCertification) => void;
  onToggleCategory: (category: AdminCategory) => void;
};

export default function CertificationCard({
  certification,
  categories,
  changingPublicationId,
  onToggleCertification,
  onToggleCategory,
}: CertificationCardProps) {
  const isUpdatingCertification =
    changingPublicationId === certification.id;

  return (
    <article className="overflow-hidden rounded-md border border-brand-border bg-white text-brand-text shadow-xs">
      {/* Certification Header */}
      <div className="flex flex-col gap-4 border-b border-brand-border bg-brand-surface p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-bold">{certification.name}</h2>

            <span className="rounded-full bg-brand-secondary/50 px-3 py-1 text-xs font-semibold text-brand-text">
              {certification.code}
            </span>

            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                certification.is_published
                  ? "bg-brand-accent-tint text-brand-text"
                  : "border border-brand-border bg-white text-brand-text/70"
              }`}
            >
              {certification.is_published ? "Published" : "Draft"}
            </span>
          </div>

          <p className="mt-2 text-sm text-brand-text/70">
            Passing score:{" "}
            {certification.passing_threshold_pct ?? "Not configured"}%
            {" · "}
            Feedback: {certification.feedback_mode}
          </p>
        </div>

        <button
          type="button"
          disabled={isUpdatingCertification}
          onClick={() => onToggleCertification(certification)}
          className="cursor-pointer rounded-md border border-brand-border bg-white px-4 py-2 text-sm font-semibold text-brand-text transition-colors hover:bg-brand-secondary/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isUpdatingCertification
            ? "Updating..."
            : certification.is_published
              ? "Unpublish Certification"
              : "Publish Certification"}
        </button>
      </div>

      {/* Nested Categories List */}
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-brand-text/75">
            Categories
          </h3>

          <span className="text-xs font-medium text-brand-text/65">
            {categories.length} total
          </span>
        </div>

        {categories.length === 0 ? (
          <div className="rounded-md border border-dashed border-brand-border bg-brand-surface/50 p-6 text-sm text-brand-text/70">
            No categories have been created for this certification.
          </div>
        ) : (
          <div className="divide-y divide-brand-border rounded-md border border-brand-border">
            {categories.map((category) => {
              const isUpdatingCategory =
                changingPublicationId === category.id;

              return (
                <div
                  key={category.id}
                  className="flex flex-col gap-3 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-semibold text-brand-text">
                      {category.name}
                    </p>

                    <p className="mt-1 text-xs text-brand-text/65">
                      {category.is_published
                        ? "Published category"
                        : "Draft category"}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={isUpdatingCategory}
                    onClick={() => onToggleCategory(category)}
                    className="cursor-pointer rounded-md border border-brand-border bg-brand-surface px-4 py-2 text-sm font-medium text-brand-text transition-colors hover:bg-brand-secondary/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isUpdatingCategory
                      ? "Updating..."
                      : category.is_published
                        ? "Unpublish"
                        : "Publish"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}