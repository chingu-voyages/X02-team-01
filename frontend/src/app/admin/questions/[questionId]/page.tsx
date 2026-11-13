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
  CircleAlert,
  FileImage,
  X,
} from "lucide-react";

import {
  useDemoSession,
} from "@/features/auth/AuthProvider";

import {
  ApiError,
} from "@/lib/api-client";

import {
  getManagedQuestion,
  publishManagedQuestion,
  rejectManagedQuestion,
  retireManagedQuestion,
} from "@/lib/admin-question-api";

import type {
  AdminQuestionDetail,
} from "@/types/admin-question-api.types";

type LoadStatus =
  | "loading"
  | "ready"
  | "error";

function shortQuestionId(
  id: string,
) {
  return `Q-${id
    .replace(/-/g, "")
    .slice(0, 8)
    .toUpperCase()}`;
}

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

function publicationLabel(
  question:
    AdminQuestionDetail,
) {
  if (
    question.publication_status ===
    "retired"
  ) {
    return "Retired";
  }

  if (
    question.publication_status ===
    "active"
  ) {
    return "Published";
  }

  if (
    question.review_status ===
    "rejected"
  ) {
    return "Rejected";
  }

  if (
    question.review_status ===
    "pending"
  ) {
    return "Pending Review";
  }

  return "Draft";
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
  } = useDemoSession();

  const questionId =
    params.questionId;

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

  const [
    publishing,
    setPublishing,
  ] =
    useState(false);

  const [
    reviewError,
    setReviewError,
  ] =
    useState("");

  const [
    showRejectModal,
    setShowRejectModal,
  ] =
    useState(false);

  const [
    rejectNote,
    setRejectNote,
  ] =
    useState("");

  const [
    rejectError,
    setRejectError,
  ] =
    useState("");

  const [
    rejecting,
    setRejecting,
  ] =
    useState(false);

  const [
    showRetireModal,
    setShowRetireModal,
  ] =
    useState(false);

  const [
    retiring,
    setRetiring,
  ] =
    useState(false);

  const [
    retireError,
    setRetireError,
  ] =
    useState("");

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
        .then((data) => {
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
        })
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
                ? "Question not found or you do not have access to it."
                : "Unable to load this question.",
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

  async function refreshQuestion() {
    if (
      !token ||
      !question
    ) {
      return;
    }

    const refreshed =
      await getManagedQuestion(
        token,
        question.question_id,
      );

    setQuestion(
      refreshed,
    );
  }

  async function publishQuestion() {
    if (
      !token ||
      !question ||
      publishing
    ) {
      return;
    }

    setPublishing(
      true,
    );

    setReviewError(
      "",
    );

    try {
      await publishManagedQuestion(
        token,
        question.question_id,
      );

      await refreshQuestion();
    } catch (
      error: unknown
    ) {
      if (
        error instanceof
          ApiError &&
        error.status === 401
      ) {
        handleError(
          error,
        );

        return;
      }

      if (
        error instanceof
          ApiError &&
        error.status === 403
      ) {
        setReviewError(
          "Only Administrators can approve and publish questions.",
        );
      } else if (
        error instanceof
          ApiError &&
        error.status === 409
      ) {
        setReviewError(
          "This question cannot be published in its current state.",
        );
      } else {
        setReviewError(
          "Unable to publish this question. Please try again.",
        );
      }
    } finally {
      setPublishing(
        false,
      );
    }
  }

  async function confirmRejection() {
    if (
      !token ||
      !question ||
      rejecting
    ) {
      return;
    }

    const note =
      rejectNote.trim();

    if (!note) {
      setRejectError(
        "Enter a reason for rejecting this question.",
      );

      return;
    }

    setRejecting(
      true,
    );

    setRejectError(
      "",
    );

    setReviewError(
      "",
    );

    try {
      await rejectManagedQuestion(
        token,
        question.question_id,
        note,
      );

      await refreshQuestion();

      setShowRejectModal(
        false,
      );

      setRejectNote(
        "",
      );
    } catch (
      error: unknown
    ) {
      if (
        error instanceof
          ApiError &&
        error.status === 401
      ) {
        handleError(
          error,
        );

        return;
      }

      if (
        error instanceof
          ApiError &&
        error.status === 403
      ) {
        setRejectError(
          "Only Administrators can reject questions.",
        );
      } else if (
        error instanceof
          ApiError &&
        error.status === 409
      ) {
        setRejectError(
          "This question cannot be rejected in its current state.",
        );
      } else if (
        error instanceof
          ApiError &&
        error.status === 422
      ) {
        setRejectError(
          "Enter a valid review reason before rejecting.",
        );
      } else {
        setRejectError(
          "Unable to reject this question. Please try again.",
        );
      }
    } finally {
      setRejecting(
        false,
      );
    }
  }

  async function confirmRetirement() {
    if (
      !token ||
      !question ||
      retiring
    ) {
      return;
    }

    setRetiring(
      true,
    );

    setRetireError(
      "",
    );

    try {
      await retireManagedQuestion(
        token,
        question.question_id,
      );

      await refreshQuestion();

      setShowRetireModal(
        false,
      );
    } catch (
      error: unknown
    ) {
      if (
        error instanceof
          ApiError &&
        error.status === 401
      ) {
        handleError(
          error,
        );

        return;
      }

      if (
        error instanceof
          ApiError &&
        error.status === 403
      ) {
        setRetireError(
          "Only Administrators can retire questions.",
        );
      } else if (
        error instanceof
          ApiError &&
        error.status === 409
      ) {
        setRetireError(
          "This question cannot be retired in its current state.",
        );
      } else {
        setRetireError(
          "Unable to retire this question. Please try again.",
        );
      }
    } finally {
      setRetiring(
        false,
      );
    }
  }

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
            "Unable to load this question."}
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
            Back to Question
            Bank
          </Link>
        </div>
      </div>
    );
  }

  const retired =
    question.publication_status ===
    "retired";

  const published =
    question.publication_status ===
    "active";

  const pendingDraft =
    question.publication_status ===
      "draft" &&
    question.review_status ===
      "pending";

  const rejectedDraft =
    question.publication_status ===
      "draft" &&
    question.review_status ===
      "rejected";

  const displayId =
    shortQuestionId(
      question.question_id,
    );

  return (
    <section>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#71777c]">
        JHEP-159 / Question
        Review
      </p>

      <Link
        href="/admin/questions"
        className="mb-4 inline-flex items-center gap-2 text-sm text-[#3e4448] hover:underline"
      >
        <ArrowLeft
          aria-hidden="true"
          className="size-4"
        />
        Back to Question
        Bank
      </Link>

      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Question Details —{" "}
            {displayId}
          </h1>
        </div>

        {!retired && (
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/admin/questions/${encodeURIComponent(
                question.question_id,
              )}/edit`}
              className="rounded-md border border-[#cfd2d5] bg-white px-5 py-2.5 text-sm font-medium hover:bg-[#f4f4f4]"
            >
              Edit
            </Link>

            {pendingDraft && (
              <>
                <button
                  type="button"
                  disabled={
                    publishing ||
                    rejecting
                  }
                  onClick={() => {
                    setReviewError(
                      "",
                    );

                    void publishQuestion();
                  }}
                  className="rounded-md bg-[#3d4145] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#292d30] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {publishing
                    ? "Publishing..."
                    : "Approve & Publish"}
                </button>

                <button
                  type="button"
                  disabled={
                    publishing ||
                    rejecting
                  }
                  onClick={() => {
                    setRejectError(
                      "",
                    );

                    setReviewError(
                      "",
                    );

                    setShowRejectModal(
                      true,
                    );
                  }}
                  className="rounded-md border border-[#cfd2d5] bg-white px-5 py-2.5 text-sm font-semibold hover:bg-[#f4f4f4] disabled:opacity-50"
                >
                  Reject
                </button>
              </>
            )}

            {published && (
              <button
                type="button"
                onClick={() => {
                  setRetireError(
                    "",
                  );

                  setShowRetireModal(
                    true,
                  );
                }}
                className="rounded-md border border-[#cfd2d5] bg-white px-5 py-2.5 text-sm font-medium hover:bg-[#f4f4f4]"
              >
                Retire
              </button>
            )}
          </div>
        )}
      </div>

      {reviewError && (
        <div
          role="alert"
          className="mb-5 flex gap-2 rounded-md bg-red-50 p-4 text-sm text-red-700"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />

          {reviewError}
        </div>
      )}

      {pendingDraft && (
        <div className="mb-5 flex items-center gap-2 rounded-md bg-[#f1f1f1] px-4 py-4 text-sm font-semibold">
          <CircleAlert
            aria-hidden="true"
            className="size-4"
          />

          PENDING REVIEW —
          approve and publish, or
          reject with feedback.
        </div>
      )}

      {rejectedDraft && (
        <div className="mb-5 flex items-center gap-2 rounded-md bg-[#f1f1f1] px-4 py-4 text-sm font-semibold">
          <X
            aria-hidden="true"
            className="size-4"
          />

          REJECTED — edit this
          question to return it
          to pending review.
        </div>
      )}

      {retired && (
        <div className="mb-5 flex items-center gap-2 rounded-md bg-[#f1f1f1] px-4 py-4 text-sm font-semibold">
          <Check
            aria-hidden="true"
            className="size-4"
          />

          RETIRED — inactive
          record; excluded from
          all future generated
          practice exams.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(260px,0.9fr)]">
        <article className="rounded-md border border-[#cfd2d5] bg-white p-5 sm:p-6">
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
                        65 +
                          index,
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
              Explanation /
              Rubric
            </p>

            <div className="rounded-md bg-[#f1f1f1] p-4 text-sm leading-6 text-[#4f565b]">
              {question.explanation ??
                "No explanation provided."}
            </div>
          </div>

          <div className="mt-5 flex items-start gap-2 rounded-md bg-[#f1f1f1] p-4 text-xs leading-5 text-[#6b7277]">
            <FileImage
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />

            Existing image/math
            references are
            preserved if present.
            Adding new media is
            handled separately.
          </div>

          {retired && (
            <p className="mt-5 text-sm text-[#6b7277]">
              Inactive records are
              read-only. There is
              no permanent-delete
              action.
            </p>
          )}
        </article>

        <aside className="rounded-md border border-[#cfd2d5] bg-white p-5 sm:p-6">
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
                  question.review_status
                }
              </p>
            </div>

            <div>
              <p className="font-semibold">
                Permissions
              </p>

              <p className="mt-1 text-xs leading-5 text-[#6e7479]">
                Administrators may
                approve, reject,
                publish, or retire.
                Contributors may
                edit permitted
                drafts.
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
                  the original
                  pinned question
                  version, responses,
                  and results.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>

      {showRejectModal && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onMouseDown={(
            event,
          ) => {
            if (
              event.target ===
                event.currentTarget &&
              !rejecting
            ) {
              setShowRejectModal(
                false,
              );
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-title"
            className="w-full max-w-xl rounded-md border border-[#cfd2d5] bg-white p-6 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="reject-title"
                  className="text-2xl font-bold"
                >
                  Reject Question
                </h2>

                <p className="mt-2 text-sm text-[#687178]">
                  {displayId}
                </p>
              </div>

              <button
                type="button"
                disabled={
                  rejecting
                }
                aria-label="Close rejection dialog"
                onClick={() =>
                  setShowRejectModal(
                    false,
                  )
                }
                className="rounded p-1 hover:bg-[#f1f1f1]"
              >
                <X
                  aria-hidden="true"
                  className="size-5"
                />
              </button>
            </div>

            <label className="mt-5 block text-sm font-semibold">
              Review feedback *
              <textarea
                rows={5}
                value={
                  rejectNote
                }
                onChange={(
                  event,
                ) => {
                  setRejectNote(
                    event.target
                      .value,
                  );

                  setRejectError(
                    "",
                  );
                }}
                placeholder="Explain what needs to be corrected before this question can be approved..."
                className="mt-2 w-full resize-y rounded-md border border-[#cfd2d5] px-3 py-3 font-normal"
              />
            </label>

            {rejectError && (
              <div
                role="alert"
                className="mt-4 flex gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700"
              >
                <CircleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                />

                {rejectError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={
                  rejecting
                }
                onClick={() =>
                  setShowRejectModal(
                    false,
                  )
                }
                className="rounded-md border border-[#cfd2d5] bg-white px-6 py-2.5 text-sm font-medium hover:bg-[#f5f5f5]"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={
                  rejecting
                }
                onClick={() =>
                  void confirmRejection()
                }
                className="rounded-md bg-[#3d4145] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#292d30] disabled:opacity-50"
              >
                {rejecting
                  ? "Rejecting..."
                  : "Reject Question"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRetireModal && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onMouseDown={(
            event,
          ) => {
            if (
              event.target ===
                event.currentTarget &&
              !retiring
            ) {
              setShowRetireModal(
                false,
              );
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="retire-title"
            className="w-full max-w-xl rounded-md border border-[#cfd2d5] bg-white p-6 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="retire-title"
                  className="text-2xl font-bold"
                >
                  Retire Question?
                </h2>

                <p className="mt-3 text-sm font-semibold">
                  {displayId} —{" "}
                  {
                    question.question_text
                  }
                </p>
              </div>

              <button
                type="button"
                aria-label="Close retirement confirmation"
                disabled={
                  retiring
                }
                onClick={() =>
                  setShowRetireModal(
                    false,
                  )
                }
                className="rounded p-1 hover:bg-[#f1f1f1]"
              >
                <X
                  aria-hidden="true"
                  className="size-5"
                />
              </button>
            </div>

            <div className="mt-5 space-y-4 text-sm leading-6 text-[#4f565b]">
              <p>
                Retiring this
                question marks it
                inactive and
                excludes it from
                new generated
                exams. The record
                is not permanently
                deleted.
              </p>

              <p>
                Previously
                completed attempts
                retain the original
                question version,
                answer history,
                and existing media
                references.
              </p>
            </div>

            {retireError && (
              <div
                role="alert"
                className="mt-5 flex gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700"
              >
                <CircleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                />

                {retireError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={
                  retiring
                }
                onClick={() =>
                  setShowRetireModal(
                    false,
                  )
                }
                className="rounded-md border border-[#cfd2d5] bg-white px-6 py-2.5 text-sm font-medium hover:bg-[#f5f5f5]"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={
                  retiring
                }
                onClick={() =>
                  void confirmRetirement()
                }
                className="rounded-md bg-[#3d4145] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#292d30] disabled:opacity-50"
              >
                {retiring
                  ? "Retiring..."
                  : "Retire Question"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}