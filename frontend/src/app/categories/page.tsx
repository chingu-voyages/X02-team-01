"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import {
  getAvailableCategories,
  startCategoryExam,
} from "@/lib/category-api";

import type { PracticeCategory } from "@/types/category-api.types";
import PracticeCategoryCard from "@/features/categories/PracticeCategoryCard";
import StartExamForm from "@/features/exams/StartExamForm";

type LoadStatus = "loading" | "ready" | "error";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getExistingAttemptId(detail: unknown): string | null {
  if (
    detail === null ||
    typeof detail !== "object" ||
    !("code" in detail) ||
    detail.code !== "ATTEMPT_IN_PROGRESS" ||
    !("attempt_id" in detail) ||
    typeof detail.attempt_id !== "string"
  ) {
    return null;
  }

  return uuidPattern.test(detail.attempt_id)
    ? detail.attempt_id
    : null;
}

export default function CategoriesPage() {
  const router = useRouter();
  const { token, ready, handleError } = useDemoSession();

  const [categories, setCategories] = useState<PracticeCategory[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [certificationFilter, setCertificationFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [questionCount, setQuestionCount] = useState(1);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [existingAttemptId, setExistingAttemptId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!ready || !token) return;

    let cancelled = false;

    getAvailableCategories(token)
      .then((data) => {
        if (cancelled) return;

        setCategories(data);
        setLoadStatus("ready");
        setLoadError("");
      })
      .catch((error: unknown) => {
        if (cancelled) return;

        if (error instanceof ApiError && error.status === 401) {
          handleError(error);
          return;
        }

        setLoadError(
          error instanceof Error
            ? error.message
            : "Unable to load categories.",
        );
        setLoadStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [ready, token, reloadKey, handleError]);

  const certifications = Array.from(
    new Map(
      categories.map((category) => [
        category.certification_id,
        {
          id: category.certification_id,
          name: category.certification_name,
        },
      ]),
    ).values(),
  );

  const filteredCategories = categories.filter(
    (category) =>
      certificationFilter === "all" ||
      category.certification_id === certificationFilter,
  );

  const selectedCategory =
    categories.find((category) => category.id === selectedId) ?? null;

  function clearStartState() {
    setStartError("");
    setExistingAttemptId(null);
  }

  function selectCategory(category: PracticeCategory) {
    setSelectedId(category.id);
    setQuestionCount(
      Math.min(5, category.available_question_count, 100),
    );
    clearStartState();
  }

  function retryLoading() {
    setLoadStatus("loading");
    setLoadError("");
    clearStartState();
    setReloadKey((value) => value + 1);
  }

  async function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || !selectedCategory || isStarting) return;

    setIsStarting(true);
    clearStartState();

    try {
      const exam = await startCategoryExam(
        token,
        selectedCategory,
        questionCount,
      );

      router.push(`/exams/${encodeURIComponent(exam.attempt_id)}`);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        handleError(error);
        return;
      }

      if (error instanceof ApiError && error.status === 409) {
        const attemptId = getExistingAttemptId(error.detail);

        if (attemptId) {
          setExistingAttemptId(attemptId);
          setStartError(
            "You already have an unfinished exam for this certification.",
          );
        } else {
          setStartError(
            "This category may have changed. Reload the categories and try again.",
          );
        }

        return;
      }

      setStartError(
        error instanceof Error
          ? error.message
          : "Unable to start exam.",
      );
    } finally {
      setIsStarting(false);
    }
  }

  function continueExistingExam() {
    if (!existingAttemptId) return;

    router.push(`/exams/${encodeURIComponent(existingAttemptId)}`);
  }

  if (!ready || !token) {
    return (
      <p role="status" className="text-sm text-brand-text/70">
        Checking session...
      </p>
    );
  }

  return (
    <section className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-brand-text sm:text-3xl">
          Select a practice exam
        </h1>

        <p className="text-sm text-brand-text/70">
          Choose a certification or category. Available questions are selected
          from the approved question bank.
        </p>
      </header>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-4 rounded-md border border-brand-border bg-white px-5 py-3 shadow-xs">
        <button
          type="button"
          onClick={() => {
            setCertificationFilter("all");
            setSelectedId(null);
            clearStartState();
          }}
          className={`cursor-pointer text-sm transition-colors ${
            certificationFilter === "all"
              ? "font-semibold text-brand-text"
              : "font-medium text-brand-text/65 hover:text-brand-text"
          }`}
        >
          All categories
        </button>

        <div className="h-4 w-px bg-brand-border" aria-hidden="true" />

        <label htmlFor="certification-filter" className="sr-only">
          Certification or topic
        </label>

        <select
          id="certification-filter"
          value={certificationFilter}
          onChange={(event) => {
            setCertificationFilter(event.target.value);
            setSelectedId(null);
            clearStartState();
          }}
          className="max-w-full cursor-pointer rounded bg-transparent py-1 text-sm text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <option value="all">Certification / topic</option>

          {certifications.map((certification) => (
            <option key={certification.id} value={certification.id}>
              {certification.name}
            </option>
          ))}
        </select>
      </div>

      {loadStatus === "loading" && (
        <p role="status" className="py-10 text-sm text-brand-text/70">
          Loading categories...
        </p>
      )}

      {loadStatus === "error" && (
        <div
          role="alert"
          className="rounded-md border border-brand-border bg-white p-6 shadow-xs"
        >
          <p className="mb-4 text-sm text-red-700">{loadError}</p>

          <button
            type="button"
            onClick={retryLoading}
            className="cursor-pointer rounded-md bg-brand-accent px-4 py-2 text-sm font-semibold text-brand-text transition-colors hover:bg-brand-accent-tint"
          >
            Retry loading categories
          </button>
        </div>
      )}

      {loadStatus === "ready" && categories.length === 0 && (
        <p
          role="status"
          className="rounded-md border border-brand-border bg-white p-6 text-sm text-brand-text/70 shadow-xs"
        >
          No practice categories are currently available.
        </p>
      )}

      {loadStatus === "ready" && categories.length > 0 && (
        <>
          <section
            aria-label="Available categories"
            className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
          >
            {filteredCategories.map((category) => (
              <PracticeCategoryCard
                key={category.id}
                category={category}
                isSelected={selectedId === category.id}
                onSelect={selectCategory}
              />
            ))}
          </section>

          {filteredCategories.length === 0 && (
            <p className="rounded-md border border-brand-border bg-white p-6 text-sm text-brand-text/70 shadow-xs">
              No categories match this certification.
            </p>
          )}

          {selectedCategory && (
            <StartExamForm
              category={selectedCategory}
              questionCount={questionCount}
              isStarting={isStarting}
              startError={startError}
              existingAttemptId={existingAttemptId}
              onQuestionCountChange={setQuestionCount}
              onSubmit={handleStart}
              onContinueExisting={continueExistingExam}
            />
          )}
        </>
      )}
    </section>
  );
}
