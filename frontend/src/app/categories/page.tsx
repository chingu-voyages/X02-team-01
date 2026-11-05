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

type LoadStatus = "loading" | "ready" | "error";

export default function CategoriesPage() {
  const router = useRouter();
  const { token, ready, handleError } = useDemoSession();

  const [categories, setCategories] = useState<PracticeCategory[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [questionCount, setQuestionCount] = useState(1);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState("");

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

  const selectedCategory =
    categories.find((category) => category.id === selectedId) ?? null;

  function selectCategory(category: PracticeCategory) {
    setSelectedId(category.id);
    setQuestionCount(Math.min(5, category.available_question_count));
    setStartError("");
  }

  function retryLoading() {
    setLoadStatus("loading");
    setLoadError("");
    setReloadKey((value) => value + 1);
  }

  async function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || !selectedCategory || isStarting) return;

    setIsStarting(true);
    setStartError("");

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
        setStartError(
          "This category may have changed. Please reload the categories and try again.",
        );
      } else {
        setStartError(
          error instanceof Error
            ? error.message
            : "Unable to start exam.",
        );
      }
    } finally {
      setIsStarting(false);
    }
  }

  if (!ready || !token) {
    return <p role="status" className="p-6">Checking session...</p>;
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">
          Choose a Practice Exam Category
        </h1>
        <p className="mt-2 text-gray-600">
          Select a category to begin your practice exam.
        </p>
      </header>

      {loadStatus === "loading" && (
        <p role="status">Loading categories...</p>
      )}

      {loadStatus === "error" && (
        <div role="alert" className="space-y-3">
          <p>{loadError}</p>
          <button
            type="button"
            onClick={retryLoading}
            className="rounded border px-4 py-2"
          >
            Retry loading categories
          </button>
        </div>
      )}

      {loadStatus === "ready" && categories.length === 0 && (
        <p role="status">
          No practice categories are currently available.
        </p>
      )}

      {loadStatus === "ready" && categories.length > 0 && (
        <>
          <section aria-label="Available categories" className="grid gap-4 sm:grid-cols-2">
            {categories.map((category) => {
              const isSelected = selectedId === category.id;

              return (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => selectCategory(category)}
                  className={`rounded-lg border p-5 text-left transition-colors ${
                    isSelected
                      ? "border-blue-600 bg-blue-50"
                      : "border-gray-300 bg-white hover:bg-gray-50"
                  }`}
                >
                  <h2 className="text-lg font-semibold">
                    {category.name}
                  </h2>

                  <p className="mt-1 text-sm text-gray-600">
                    {category.certification_name}
                  </p>

                  <p className="mt-3 text-sm">
                    {category.available_question_count} questions available
                  </p>

                  {isSelected && (
                    <p className="mt-2 text-sm font-semibold text-blue-700">
                      Selected
                    </p>
                  )}
                </button>
              );
            })}
          </section>

          {selectedCategory && (
            <form onSubmit={handleStart} className="space-y-4 rounded-lg border p-5">
              <h2 className="text-lg font-semibold">
                Start {selectedCategory.name}
              </h2>

              <div className="space-y-2">
                <label htmlFor="question-count" className="block font-medium">
                  Number of questions
                </label>

                <input
                  id="question-count"
                  type="number"
                  min={1}
                  max={Math.min(
                    selectedCategory.available_question_count,
                    100,
                  )}
                  value={questionCount}
                  onChange={(event) =>
                    setQuestionCount(Number(event.target.value))
                  }
                  className="w-32 rounded border px-3 py-2"
                  required
                />
              </div>

              {startError && (
                <p role="alert" className="text-red-700">
                  {startError}
                </p>
              )}

              <button
                type="submit"
                disabled={isStarting}
                className="rounded bg-blue-600 px-5 py-3 font-medium text-white disabled:opacity-50"
              >
                {isStarting ? "Starting exam..." : "Start Exam"}
              </button>
            </form>
          )}
        </>
      )}
    </main>
  );
}
