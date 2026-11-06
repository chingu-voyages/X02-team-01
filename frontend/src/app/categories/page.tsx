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
      <p role="status" className="p-6">
        Checking session...
      </p>
    );
  }

  return (
    <main
      className="min-h-screen bg-[#f3f4f5] px-4 py-6 text-[#2c3134] sm:px-6 lg:px-8"
      style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <div className="mx-auto max-w-7xl space-y-6">
        <nav
          aria-label="Main navigation"
          className="flex flex-wrap items-center gap-x-7 gap-y-3 rounded-md border border-[#d4d8db] bg-white px-6 py-5"
        >
          <span className="text-sm font-extrabold tracking-tight">
            THE JOB HACKERS
          </span>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="font-semibold text-[#303639]">
              Exams
            </span>
            <span className="text-gray-300" aria-hidden="true">
              •
            </span>
            <span className="text-gray-400" title="Coming soon">
              My History
            </span>
            <span className="text-gray-300" aria-hidden="true">
              •
            </span>
            <span className="text-gray-400" title="Coming soon">
              Journal
            </span>
            <span className="text-gray-300" aria-hidden="true">
              •
            </span>
            <span className="text-gray-400" title="Coming soon">
              Account
            </span>
          </div>
        </nav>

        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Select a practice exam
          </h1>

          <p className="text-sm text-[#687178]">
            Choose a certification or category. Available questions
            are selected from the approved question bank.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-4 rounded-md border border-[#d4d8db] bg-white px-5 py-3">
          <button
            type="button"
            onClick={() => {
              setCertificationFilter("all");
              setSelectedId(null);
              clearStartState();
            }}
            className={`text-sm font-medium ${
              certificationFilter === "all"
                ? "text-[#303639]"
                : "text-[#747b80]"
            }`}
          >
            All categories
          </button>

          <div
            className="h-4 w-px bg-gray-300"
            aria-hidden="true"
          />

          <label
            htmlFor="certification-filter"
            className="sr-only"
          >
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
            className="max-w-full rounded bg-transparent py-1 text-sm text-[#4c5459] focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <option value="all">Certification / topic</option>

            {certifications.map((certification) => (
              <option
                key={certification.id}
                value={certification.id}
              >
                {certification.name}
              </option>
            ))}
          </select>
        </div>

        {loadStatus === "loading" && (
          <p role="status" className="py-10 text-sm text-gray-600">
            Loading categories...
          </p>
        )}

        {loadStatus === "error" && (
          <div
            role="alert"
            className="rounded-md border bg-white p-6"
          >
            <p className="mb-4 text-red-700">
              {loadError}
            </p>

            <button
              type="button"
              onClick={retryLoading}
              className="rounded bg-[#343a3e] px-4 py-2 text-sm text-white"
            >
              Retry loading categories
            </button>
          </div>
        )}

        {loadStatus === "ready" && categories.length === 0 && (
          <p
            role="status"
            className="rounded-md border bg-white p-6"
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
              {filteredCategories.map((category) => {
                const isSelected =
                  selectedId === category.id;

                return (
                  <article
                    key={category.id}
                    className={`flex min-h-[265px] flex-col rounded-md border bg-white p-5 transition-colors ${
                      isSelected
                        ? "border-[#343a3e] ring-1 ring-[#343a3e]"
                        : "border-[#cbd0d3]"
                    }`}
                  >
                    <div>
                      <span className="inline-flex rounded bg-[#e9ebed] px-2.5 py-2 text-xs font-medium text-[#41484c]">
                        AVAILABLE
                      </span>
                    </div>

                    <div className="mt-5 flex-1">
                      <h2 className="text-xl font-bold">
                        {category.name}
                      </h2>

                      <p className="mt-3 text-sm leading-6 text-[#747d83]">
                        {category.certification_name}
                      </p>
                    </div>

                    <div className="mt-5 border-t border-[#e2e5e7] pt-4">
                      <p className="text-xs leading-5 text-[#747d83]">
                        Questions drawn from active, approved bank
                      </p>

                      <p className="mt-1 text-xs text-[#747d83]">
                        {category.available_question_count} questions available
                      </p>
                    </div>

                    <button
                      type="button"
                      aria-label={`View exam — ${category.name}`}
                      aria-pressed={isSelected}
                      onClick={() => selectCategory(category)}
                      className="mt-4 w-fit rounded-md bg-[#343a3e] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#1e2427] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#343a3e]"
                    >
                      {isSelected ? "Selected" : "View exam"}
                    </button>
                  </article>
                );
              })}
            </section>

            {filteredCategories.length === 0 && (
              <p className="rounded-md border bg-white p-6 text-sm text-gray-600">
                No categories match this certification.
              </p>
            )}

            {selectedCategory && (
              <form
                onSubmit={handleStart}
                className="space-y-5 rounded-md border border-[#cbd0d3] bg-white p-6"
              >
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Selected practice exam
                  </p>

                  <h2 className="text-xl font-bold">
                    Start {selectedCategory.name}
                  </h2>

                  <p className="mt-2 text-sm text-gray-500">
                    {selectedCategory.certification_name}
                  </p>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="question-count"
                    className="block text-sm font-semibold"
                  >
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
                    className="w-36 rounded-md border border-[#d4d8db] px-3 py-3 text-sm"
                    required
                  />
                </div>

                {startError && (
                  <p
                    role="alert"
                    className="text-sm text-red-700"
                  >
                    {startError}
                  </p>
                )}

                {existingAttemptId && (
                  <div className="rounded-md border border-[#cbd0d3] bg-[#f3f4f5] p-4">
                    <p className="mb-3 text-sm text-[#4c5459]">
                      Continue your existing attempt instead
                      of starting another exam.
                    </p>

                    <button
                      type="button"
                      onClick={continueExistingExam}
                      className="rounded-md bg-[#343a3e] px-5 py-3 text-sm font-medium text-white hover:bg-[#1e2427]"
                    >
                      Continue existing exam
                    </button>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isStarting}
                  className="rounded-md bg-[#343a3e] px-6 py-3 text-sm font-medium text-white hover:bg-[#1e2427] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isStarting
                    ? "Starting exam..."
                    : "Start Exam"}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
