"use client";

import Link from "next/link";
import {
  useParams,
} from "next/navigation";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  ArrowLeft,
  Check,
  FileImage,
} from "lucide-react";

import {
  useDemoSession,
} from "@/features/auth/AuthProvider";

import {
  ApiError,
} from "@/lib/api-client";

import {
  getManagedQuestion,
} from "@/lib/admin-question-api";

import QuestionReviewActions from "@/features/questions/QuestionReviewActions";

import type {
  AdminQuestionDetail,
} from "@/types/admin-question-api.types";


type LoadStatus =
  | "loading"
  | "ready"
  | "error";


type SessionRole =
  | "learner"
  | "contributor"
  | "administrator";


function questionTypeLabel(
  type:
    AdminQuestionDetail[
      "question_type"
    ],
) {
  return type ===
    "multiple_choice"
    ? "Multiple Choice"
    : "Short Answer";
}


function publicationLabel(question: AdminQuestionDetail) {
  if (question.publication_status === "retired") return "Retired";
  if (question.review_status === "rejected") return "Rejected";
  if (question.publication_status === "inactive") return "Inactive";
  if (question.publication_status === "active") return "Published";
  if (question.review_status === "submitted") return "Submitted";
  if (question.review_status === "in_review") return "In Review";
  if (question.review_status === "pending" && question.review_note) return "Changes Requested";
  return "Draft";
}


function roleFromToken(
  token: string | null,
): SessionRole | null {
  if (!token) {
    return null;
  }

  try {
    const parts =
      token.split(".");

    if (
      parts.length < 2 ||
      !parts[1]
    ) {
      return null;
    }

    const normalized =
      parts[1]
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    const padded =
      normalized.padEnd(
        Math.ceil(
          normalized.length / 4,
        ) * 4,
        "=",
      );

    const payload =
      JSON.parse(
        atob(padded),
      ) as {
        role?: unknown;
      };

    if (
      payload.role ===
        "learner" ||
      payload.role ===
        "contributor" ||
      payload.role ===
        "administrator"
    ) {
      return payload.role;
    }

    return null;
  } catch {
    return null;
  }
}


function userIdFromToken(
  token: string | null,
): string | null {
  if (!token) {
    return null;
  }

  try {
    const parts = token.split(".");

    if (parts.length < 2 || !parts[1]) {
      return null;
    }

    const normalized = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const padded = normalized.padEnd(
      Math.ceil(normalized.length / 4) * 4,
      "=",
    );

    const payload = JSON.parse(
      atob(padded),
    ) as { sub?: unknown };

    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}


export default function AdminQuestionDetailPage() {
  const params =
    useParams<{
      questionId: string;
    }>();

  const {
    token,
    ready,
    handleError,
  } =
    useDemoSession();



  const questionId =
    params.questionId;

  const role =
    roleFromToken(
      token,
    );

  const isAdministrator =
    role ===
    "administrator";

  const currentUserId =
    userIdFromToken(token);

  const [
    question,
    setQuestion,
  ] =
    useState<
      AdminQuestionDetail | null
    >(null);

  const [
    loadStatus,
    setLoadStatus,
  ] =
    useState<LoadStatus>(
      "loading",
    );

  const [
    loadError,
    setLoadError,
  ] =
    useState("");

  const [
    reloadKey,
    setReloadKey,
  ] =
    useState(0);

  const loadQuestion =
    useCallback(() => {
      if (!token) {
        return;
      }

      let cancelled =
        false;

      getManagedQuestion(
        token,
        questionId,
      )
        .then(
          (data) => {
            if (
              cancelled
            ) {
              return;
            }

            setQuestion(
              data,
            );

            setLoadStatus(
              "ready",
            );

            setLoadError(
              "",
            );
          },
        )
        .catch(
          (
            error: unknown,
          ) => {
            if (
              cancelled
            ) {
              return;
            }

            if (
              error instanceof
                ApiError &&
              error.status ===
                401
            ) {
              handleError(
                error,
              );

              return;
            }

            setLoadStatus(
              "error",
            );

            setLoadError(
              error instanceof
                  ApiError &&
                error.status ===
                  404
                ? (
                    "Question not found or you do not have access to it."
                  )
                : (
                    "Unable to load this question."
                  ),
            );
          },
        );

      return () => {
        cancelled =
          true;
      };
    }, [
      handleError,
      questionId,
      token,
    ]);


  useEffect(() => {
    if (
      !ready ||
      !token
    ) {
      return;
    }

    return loadQuestion();
  }, [
    loadQuestion,
    ready,
    reloadKey,
    token,
  ]);


  if (
    !ready ||
    !token
  ) {
    return (
      <p role="status">
        Checking session...
      </p>
    );
  }


  if (
    loadStatus ===
    "loading"
  ) {
    return (
      <div
        role="status"
        className="rounded-md border border-[#d6d8db] bg-white p-8 text-sm text-[#687178]"
      >
        Loading question
        details...
      </div>
    );
  }


  if (
    loadStatus ===
      "error" ||
    !question
  ) {
    return (
      <div className="rounded-md border border-[#d6d8db] bg-white p-8">
        <p
          role="alert"
          className="text-sm text-red-700"
        >
          {loadError ||
            (
              "Unable to load this question."
            )}
        </p>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => {
              setLoadStatus(
                "loading",
              );

              setReloadKey(
                (value) =>
                  value + 1,
              );
            }}
            className="rounded-md bg-[#3d4145] px-4 py-2 text-sm font-medium text-white"
          >
            Retry
          </button>

          <Link
            href="/admin/questions"
            className="rounded-md border border-[#cfd2d5] px-4 py-2 text-sm"
          >
            Back to Question Bank
          </Link>
        </div>
      </div>
    );
  }


  const retired = question.publication_status === "retired";
  const readOnly = retired || question.publication_status === "inactive" || question.review_status === "rejected";

  return (
    <section className="min-w-0">
      <Link href="/admin/questions" className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[#3e4448] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2">
        <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
        Back to Question Bank
      </Link>
      <QuestionReviewActions
        key={`${question.question_id}:${currentUserId ?? "unknown"}:${role ?? "unknown"}`}
        question={question}
        role={role}
        userId={currentUserId}
        token={token}
        onUpdated={setQuestion}
        onUnauthorized={handleError}
        onReload={() => { setLoadStatus("loading"); setReloadKey((value) => value + 1); }}
      />

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,0.9fr)]">
        <article className="min-w-0 rounded-md border border-[#cfd2d5] bg-white p-4 [overflow-wrap:anywhere] sm:p-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide">
            {retired
              ? "Status: Retired / Inactive"
              : "Question"}
          </p>

          <h2 className="text-xl font-medium leading-relaxed">
            {question.question_text}
          </h2>


          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#555c61]">
            <span>
              Type:{" "}
              {questionTypeLabel(
                question.question_type,
              )}
            </span>

            <span>
              Category:{" "}
              {question.category_name ??
                "Uncategorized"}
            </span>

            <span>
              Status:{" "}
              {publicationLabel(
                question,
              )}
            </span>

            <span>
              Version: v
              {question.version_number}
            </span>

            <span>
              Difficulty:{" "}
              {question.difficulty}
            </span>
          </div>


          {question.images.length >
            0 && (
            <div className="mt-6">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide">
                Question Image
              </p>

              <div className="space-y-4">
                {question.images.map(
                  (image) => (
                    <figure
                      key={
                        image.id
                      }
                      className="rounded-md border border-[#d4d7da] bg-[#f8f9f9] p-4"
                    >
                      {image.url ? (
                        <>
                          {/* Native img supports runtime Cloudflare R2 URLs. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={
                              image.url
                            }
                            alt={
                              image.alt_text
                            }
                            className="mx-auto h-auto max-h-[30rem] max-w-full rounded object-contain"
                          />
                        </>
                      ) : (
                        <div
                          role="status"
                          className="rounded-md border border-dashed border-[#cfd2d5] bg-white px-4 py-8 text-center"
                        >
                          <FileImage
                            aria-hidden="true"
                            className="mx-auto size-6 text-[#777e83]"
                          />

                          <p className="mt-2 text-sm font-semibold">
                            Image unavailable
                          </p>
                        </div>
                      )}

                      <figcaption className="mt-3 border-t border-[#d7dbde] pt-3 text-xs leading-5 text-[#626b71]">
                        <span className="font-semibold">
                          Alt text:
                        </span>{" "}
                        {
                          image.alt_text
                        }
                      </figcaption>
                    </figure>
                  ),
                )}
              </div>
            </div>
          )}


          {question.question_type ===
            "multiple_choice" && (
            <div className="mt-6">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide">
                Answer Options
              </p>

              <div className="space-y-2.5">
                {question.options.map(
                  (
                    option,
                    index,
                  ) => (
                    <div
                      key={`${option.position}-${option.option_text}`}
                      className={`rounded-md border px-4 py-3 text-sm ${
                        option.is_correct
                          ? "border-[#c7cbce] bg-[#f1f1f1] font-semibold"
                          : "border-[#d4d7da] bg-white"
                      }`}
                    >
                      {String.fromCharCode(
                        65 + index,
                      )}
                      .{" "}
                      {
                        option.option_text
                      }

                      {option.is_correct && (
                        <Check
                          aria-label="Correct answer"
                          className="ml-2 inline size-3.5"
                        />
                      )}
                    </div>
                  ),
                )}
              </div>
            </div>
          )}


          {question.question_type ===
            "short_answer" && (
            <div className="mt-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide">
                Expected Answer
              </p>

              <div className="rounded-md border border-[#d4d7da] bg-[#f6f6f6] p-4 text-sm leading-6">
                {question.expected_answer ??
                  "No expected answer stored."}
              </div>
            </div>
          )}


          <div className="mt-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide">
              Explanation / Rubric
            </p>

            <div className="rounded-md bg-[#f1f1f1] p-4 text-sm leading-6 text-[#4f565b]">
              {question.explanation ??
                "No explanation provided."}
            </div>
          </div>


          {question.images.length ===
            0 && (
            <div className="mt-5 flex items-start gap-2 rounded-md bg-[#f1f1f1] p-4 text-xs leading-5 text-[#6b7277]">
              <FileImage
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />

              No image is attached
              to this question
              version.
            </div>
          )}


          {readOnly && (
            <p className="mt-5 text-sm text-[#6b7277]">
              Inactive records are
              read-only. There is
              no permanent-delete
              action.
            </p>
          )}
        </article>


        <aside className="min-w-0 rounded-md border border-[#cfd2d5] bg-white p-4 [overflow-wrap:anywhere] sm:p-6">
          <h2 className="text-lg font-bold">
            Record history
          </h2>

          <div className="mt-5 space-y-5 text-sm">
            <div>
              <p className="font-semibold">
                ●{" "}
                {publicationLabel(
                  question,
                )}
              </p>

              <p className="mt-1 text-xs text-[#6e7479]">
                Current version v
                {
                  question.version_number
                }
              </p>
            </div>

            <div>
              <p className="font-semibold">
                Review status
              </p>

              <p className="mt-1 text-xs capitalize leading-5 text-[#6e7479]">
                {
                  question.review_status.replace(/_/g, " ")
                }
              </p>
            </div>

            <div>
              <p className="font-semibold">
                Permissions
              </p>

              <p className="mt-1 text-xs leading-5 text-[#6e7479]">
                {isAdministrator
                  ? (
                      "Administrator actions depend on the current review and publication state."
                    )
                  : (
                      "Contributors can edit and submit their own drafts. Review decisions and publication are Administrator-only."
                    )}
              </p>
            </div>

            {retired && (
              <div>
                <p className="font-semibold">
                  Historical learner
                  attempts
                </p>

                <p className="mt-1 text-xs leading-5 text-[#6e7479]">
                  Past attempts keep
                  the original pinned
                  question version,
                  responses, results,
                  and media.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>


    </section>
  );
}
