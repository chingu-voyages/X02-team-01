"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import Navbar from "@/components/layouts/Navbar";
import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import {
  getPublishedPracticeExams,
  startPublishedPracticeExam,
} from "@/lib/practice-exam-api";

import type { PublishedPracticeExam } from "@/types/practice-exam-api.types";

type LoadStatus = "loading" | "ready" | "error";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function existingAttemptIdFromError(detail: unknown): string | null {
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
  return uuidPattern.test(detail.attempt_id) ? detail.attempt_id : null;
}

export default function CategoriesPage() {
  const router = useRouter();
  const { token, ready, handleError } = useDemoSession();

  const [exams, setExams] = useState<PublishedPracticeExam[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [certificationFilter, setCertificationFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [existingAttemptId, setExistingAttemptId] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !token) return;

    let cancelled = false;
    getPublishedPracticeExams(token)
      .then((data) => {
        if (cancelled) return;
        setExams(data);
        setSelectedId((id) => (data.some((exam) => exam.id === id) ? id : null));
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
          error instanceof Error ? error.message : "Unable to load practice exams.",
        );
        setLoadStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [ready, token, reloadKey, handleError]);

  const certifications = Array.from(
    new Map(
      exams.map((exam) => [
        exam.certification_id,
        { id: exam.certification_id, name: exam.certification_name },
      ]),
    ).values(),
  );

  const visibleExams = exams.filter(
    (exam) =>
      certificationFilter === "all" ||
      exam.certification_id === certificationFilter,
  );
  const selectedExam = exams.find((exam) => exam.id === selectedId) ?? null;

  function clearStartState() {
    setStartError("");
    setExistingAttemptId(null);
  }

  function reloadExams() {
    setLoadStatus("loading");
    setLoadError("");
    clearStartState();
    setReloadKey((value) => value + 1);
  }

  async function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selectedExam || isStarting) return;

    setIsStarting(true);
    clearStartState();
    try {
      const attempt = await startPublishedPracticeExam(token, selectedExam);
      router.push(`/exams/${encodeURIComponent(attempt.attempt_id)}`);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        handleError(error);
        return;
      }
      if (error instanceof ApiError && error.status === 409) {
        const existingId = existingAttemptIdFromError(error.detail);
        if (existingId) {
          setExistingAttemptId(existingId);
          setStartError("You already have an unfinished exam for this certification.");
        } else {
          setStartError(
            "This practice exam is no longer available as shown. Reload the list and try again.",
          );
        }
        return;
      }
      setStartError(
        error instanceof Error ? error.message : "Unable to start practice exam.",
      );
    } finally {
      setIsStarting(false);
    }
  }

  if (!ready || !token) {
    return <p role="status" className="p-6">Checking session...</p>;
  }

  return (
    <main
      className="min-h-screen bg-[#f3f4f5] px-4 py-6 text-[#2c3134] sm:px-6 lg:px-8"
      style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      <div className="mx-auto max-w-7xl space-y-6">
        <Navbar />
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Select a practice exam
          </h1>
          <p className="text-sm text-[#687178]">
            Choose an available exam. Only exams published by an administrator
            appear here, with their configured number of questions.
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
              certificationFilter === "all" ? "text-[#303639]" : "text-[#747b80]"
            }`}
          >
            All exams
          </button>
          <div className="h-4 w-px bg-gray-300" aria-hidden="true" />
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
            className="max-w-full rounded bg-transparent py-1 text-sm text-[#4c5459] focus-visible:outline-2 focus-visible:outline-offset-2"
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
          <p role="status" className="py-10 text-sm text-gray-600">
            Loading practice exams...
          </p>
        )}
        {loadStatus === "error" && (
          <div role="alert" className="rounded-md border bg-white p-6">
            <p className="mb-4 text-red-700">{loadError}</p>
            <button
              type="button"
              onClick={reloadExams}
              className="rounded bg-[#343a3e] px-4 py-2 text-sm text-white"
            >
              Retry loading practice exams
            </button>
          </div>
        )}
        {loadStatus === "ready" && exams.length === 0 && (
          <p role="status" className="rounded-md border bg-white p-6">
            No published practice exams are currently available.
          </p>
        )}
        {loadStatus === "ready" && exams.length > 0 && (
          <>
            <section
              aria-label="Available practice exams"
              className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
            >
              {visibleExams.map((exam) => {
                const isSelected = selectedId === exam.id;
                return (
                  <article
                    key={exam.id}
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
                      <h2 className="text-xl font-bold">{exam.name}</h2>
                      <p className="mt-3 text-sm leading-6 text-[#747d83]">
                        {exam.certification_name} / {exam.category_name}
                      </p>
                    </div>
                    <div className="mt-5 border-t border-[#e2e5e7] pt-4 text-sm text-[#747d83]">
                      <p>{exam.question_count} questions per exam</p>
                    </div>
                    <button
                      type="button"
                      aria-label={`View exam — ${exam.name}`}
                      aria-pressed={isSelected}
                      onClick={() => {
                        setSelectedId(exam.id);
                        clearStartState();
                      }}
                      className="mt-4 w-fit rounded-md bg-[#343a3e] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#1e2427] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#343a3e]"
                    >
                      {isSelected ? "Selected" : "View exam"}
                    </button>
                  </article>
                );
              })}
            </section>

            {visibleExams.length === 0 && (
              <p className="rounded-md border bg-white p-6 text-sm text-gray-600">
                No published exams match this certification.
              </p>
            )}

            {selectedExam && (
              <form
                onSubmit={handleStart}
                className="space-y-5 rounded-md border border-[#cbd0d3] bg-white p-6"
              >
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Selected practice exam
                  </p>
                  <h2 className="text-xl font-bold">Start {selectedExam.name}</h2>
                  <p className="mt-2 text-sm text-gray-500">
                    {selectedExam.certification_name} / {selectedExam.category_name}
                  </p>
                </div>
                <div className="rounded-md border border-[#e2e5e7] bg-[#f3f4f5] p-4">
                  <p className="text-sm font-semibold">
                    {selectedExam.question_count} questions
                  </p>
                  <p className="mt-1 text-sm text-[#687178]">
                    Exam length is set by an administrator.
                  </p>
                </div>
                {startError && (
                  <p role="alert" className="text-sm text-red-700">
                    {startError}
                  </p>
                )}
                {existingAttemptId && (
                  <div className="rounded-md border border-[#cbd0d3] bg-[#f3f4f5] p-4">
                    <p className="mb-3 text-sm text-[#4c5459]">
                      Continue your existing attempt instead of starting another exam.
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        router.push(`/exams/${encodeURIComponent(existingAttemptId)}`)
                      }
                      className="rounded-md bg-[#343a3e] px-5 py-3 text-sm font-medium text-white hover:bg-[#1e2427]"
                    >
                      Continue existing exam
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap gap-3">
                  <button
                    type="submit"
                    disabled={isStarting}
                    className="rounded-md bg-[#343a3e] px-6 py-3 text-sm font-medium text-white hover:bg-[#1e2427] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isStarting ? "Starting exam..." : "Start Exam"}
                  </button>
                  {startError && (
                    <button
                      type="button"
                      onClick={reloadExams}
                      className="rounded-md border border-[#cbd0d3] bg-white px-6 py-3 text-sm font-medium hover:bg-[#f3f4f5]"
                    >
                      Reload available exams
                    </button>
                  )}
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
