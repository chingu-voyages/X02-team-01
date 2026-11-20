"use client";

import Link from "next/link";
import {
  useMemo,
  useState,
  type FormEvent,
} from "react";

import {
  useRouter,
} from "next/navigation";

import {
  CircleAlert,
  Plus,
  X,
} from "lucide-react";

import AdminQuestionImageField from "@/features/questions/AdminQuestionImageField";

import {
  removeManagedQuestionImage,
  replaceManagedQuestionImage,
  uploadManagedQuestionImage,
} from "@/lib/admin-question-api";

import {
  ApiError,
} from "@/lib/api-client";

import type {
  PracticeCategory,
} from "@/types/category-api.types";

import type {
  AdminDifficulty,
  AdminQuestionDetail,
  AdminQuestionDraftCreateRequest,
  AdminQuestionDraftEditRequest,
  AdminQuestionType,
} from "@/types/admin-question-api.types";


const maxImageBytes =
  5 * 1024 * 1024;

const allowedImageTypes =
  new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
  ]);


type OptionState = {
  id: string;
  text: string;
  isCorrect: boolean;
};


type FormErrors = {
  category?: string;
  questionText?: string;
  options?: string;
  explanation?: string;
  expectedAnswer?: string;
  image?: string;
};


type CommonProps = {
  token: string;
  categories: PracticeCategory[];
  onUnauthorized: (
    error: ApiError,
  ) => void;
};


type CreateProps =
  CommonProps & {
    mode: "create";

    initialQuestion?: never;

    onSubmit: (
      payload: AdminQuestionDraftCreateRequest,
    ) => Promise<string>;
  };


type EditProps =
  CommonProps & {
    mode: "edit";

    initialQuestion: AdminQuestionDetail;

    onSubmit: (
      payload: AdminQuestionDraftEditRequest,
    ) => Promise<string>;
  };


type AdminQuestionFormProps =
  | CreateProps
  | EditProps;


function shortQuestionId(
  id: string,
) {
  return `Q-${id
    .replace(/-/g, "")
    .slice(0, 8)
    .toUpperCase()}`;
}


function optionId(
  index: number,
) {
  return `option-${index + 1}`;
}


function initialOptions(
  question?: AdminQuestionDetail,
): OptionState[] {
  if (
    question?.question_type ===
      "multiple_choice" &&
    question.options.length > 0
  ) {
    return question.options.map(
      (
        option,
        index,
      ) => ({
        id: optionId(
          index,
        ),
        text:
          option.option_text,
        isCorrect:
          option.is_correct,
      }),
    );
  }

  return Array.from(
    {
      length: 4,
    },
    (
      _,
      index,
    ) => ({
      id: optionId(
        index,
      ),
      text: "",
      isCorrect: false,
    }),
  );
}


function questionErrorMessage(
  error: unknown,
) {
  if (
    !(error instanceof ApiError)
  ) {
    return (
      "Unable to save the question. " +
      "Please try again."
    );
  }

  if (error.status === 403) {
    return (
      "You do not have permission " +
      "to save this question."
    );
  }

  if (error.status === 404) {
    return (
      "This question no longer exists " +
      "or is outside your permitted scope."
    );
  }

  if (error.status === 409) {
    if (
      typeof error.detail ===
      "string"
    ) {
      return error.detail;
    }

    return (
      "This question cannot be edited " +
      "in its current state."
    );
  }

  if (error.status === 422) {
    return (
      "Review the required fields and " +
      "answer configuration before saving."
    );
  }

  return (
    "Unable to save the question. " +
    "Please try again."
  );
}


function imageErrorMessage(
  error: unknown,
) {
  if (
    !(error instanceof ApiError)
  ) {
    return (
      "The question was saved, but the " +
      "image could not be updated."
    );
  }

  if (
    error.status === 413 ||
    error.status === 415 ||
    error.status === 422 ||
    error.status === 409
  ) {
    if (
      typeof error.detail ===
      "string"
    ) {
      return error.detail;
    }
  }

  if (error.status === 503) {
    return (
      "The question was saved, but image " +
      "storage is temporarily unavailable."
    );
  }

  return (
    "The question was saved, but the " +
    "image could not be updated."
  );
}


export default function AdminQuestionForm(
  props: AdminQuestionFormProps,
) {
  const router =
    useRouter();

  const {
    mode,
    categories,
    onUnauthorized,
    token,
  } = props;

  const initialQuestion =
    mode === "edit"
      ? props.initialQuestion
      : undefined;

  const existingImage =
    initialQuestion?.images?.[0];

  const publishedRevision =
    initialQuestion
      ?.publication_status ===
    "active";

  const [
    questionType,
    setQuestionType,
  ] =
    useState<AdminQuestionType>(
      initialQuestion
        ?.question_type ??
        "multiple_choice",
    );

  const [
    categoryId,
    setCategoryId,
  ] = useState(
    initialQuestion
      ?.category_id ??
      categories[0]?.id ??
      "",
  );

  const [
    difficulty,
    setDifficulty,
  ] =
    useState<AdminDifficulty>(
      initialQuestion
        ?.difficulty ??
        "medium",
    );

  const [
    questionText,
    setQuestionText,
  ] = useState(
    initialQuestion
      ?.question_text ??
      "",
  );

  const [
    allowsMultipleAnswers,
    setAllowsMultipleAnswers,
  ] = useState(
    initialQuestion
      ?.allows_multiple_answers ??
      false,
  );

  const [
    options,
    setOptions,
  ] =
    useState<OptionState[]>(
      () =>
        initialOptions(
          initialQuestion,
        ),
    );

  const [
    expectedAnswer,
    setExpectedAnswer,
  ] = useState(
    initialQuestion
      ?.expected_answer ??
      "",
  );

  const [
    explanation,
    setExplanation,
  ] = useState(
    initialQuestion
      ?.explanation ??
      "",
  );

  const [
    selectedImage,
    setSelectedImage,
  ] =
    useState<File | null>(
      null,
    );

  const [
    imageAltText,
    setImageAltText,
  ] = useState(
    existingImage
      ?.alt_text ??
      "",
  );

  const [
    removeExistingImage,
    setRemoveExistingImage,
  ] = useState(
    false,
  );

  // If create succeeds but media fails,
  // retain the created question ID so
  // retrying does not create a duplicate.
  const [
    savedCreateQuestionId,
    setSavedCreateQuestionId,
  ] =
    useState<string | null>(
      null,
    );

  const [
    errors,
    setErrors,
  ] =
    useState<FormErrors>(
      {},
    );

  const [
    submitError,
    setSubmitError,
  ] = useState(
    "",
  );

  const [
    saving,
    setSaving,
  ] = useState(
    false,
  );


  const selectedCategory =
    categories.find(
      (category) =>
        category.id ===
        categoryId,
    );


  const certifications =
    useMemo(() => {
      const grouped =
        new Map<
          string,
          {
            id: string;
            name: string;
            categories: PracticeCategory[];
          }
        >();

      for (
        const category
        of categories
      ) {
        const current =
          grouped.get(
            category.certification_id,
          );

        if (current) {
          current.categories.push(
            category,
          );
        } else {
          grouped.set(
            category.certification_id,
            {
              id:
                category.certification_id,

              name:
                category.certification_name,

              categories: [
                category,
              ],
            },
          );
        }
      }

      return Array.from(
        grouped.values(),
      );
    }, [
      categories,
    ]);


  const pageTitle =
    mode === "create"
      ? "Create Question"
      : (
          `Edit Question — ${
            shortQuestionId(
              initialQuestion!
                .question_id,
            )
          }`
        );


  const statusText =
    mode === "create"
      ? "Draft"
      : publishedRevision
        ? (
            `Draft revision (v${
              initialQuestion!
                .version_number +
              1
            })`
          )
        : "Draft";


  const submitLabel =
    savedCreateQuestionId
      ? "Retry Image Upload"
      : mode === "create"
        ? "Save Draft"
        : publishedRevision
          ? "Save Draft Revision"
          : "Save Draft";


  function updateOption(
    index: number,
    text: string,
  ) {
    setOptions(
      (current) =>
        current.map(
          (
            option,
            optionIndex,
          ) =>
            optionIndex ===
            index
              ? {
                  ...option,
                  text,
                }
              : option,
        ),
    );
  }


  function setCorrectOption(
    index: number,
    checked: boolean,
  ) {
    setOptions(
      (current) =>
        current.map(
          (
            option,
            optionIndex,
          ) => ({
            ...option,

            isCorrect:
              allowsMultipleAnswers
                ? (
                    optionIndex ===
                    index
                      ? checked
                      : option.isCorrect
                  )
                : (
                    optionIndex ===
                    index
                  ),
          }),
        ),
    );
  }


  function addOption() {
    setOptions(
      (current) => [
        ...current,

        {
          id: optionId(
            current.length,
          ),

          text: "",

          isCorrect: false,
        },
      ],
    );
  }


  function removeOption(
    index: number,
  ) {
    if (
      options.length <= 2
    ) {
      return;
    }

    setOptions(
      (current) =>
        current.filter(
          (
            _,
            optionIndex,
          ) =>
            optionIndex !==
            index,
        ),
    );
  }


  function chooseImage(
    file: File | null,
  ) {
    setErrors(
      (current) => ({
        ...current,
        image: undefined,
      }),
    );

    if (!file) {
      setSelectedImage(
        null,
      );

      return;
    }

    if (!allowedImageTypes.has(
            file.type,
    )
    ) {
      setErrors(
        (current) => ({
          ...current,

          image:
            "Choose a PNG, JPEG, or WebP image.",
        }),
      );

      return;
    }

    if (
      file.size >
      maxImageBytes
    ) {
      setErrors(
        (current) => ({
          ...current,

          image:
            "Question images must be 5 MB or smaller.",
        }),
      );

      return;
    }

    setSelectedImage(
      file,
    );

    setRemoveExistingImage(
      false,
    );
  }


  function validate(): boolean {
    const nextErrors:
      FormErrors = {};

    if (!categoryId) {
      nextErrors.category =
        "Select a certification and category.";
    }

    if (!questionText.trim()) {
      nextErrors.questionText =
        "Question text is required.";
    }

    if (!explanation.trim()) {
      nextErrors.explanation =
        "Explanation / feedback is required.";
    }

    if (
      questionType ===
      "multiple_choice"
    ) {
      const filledOptions =
        options.filter(
          (option) =>
            option.text.trim(),
        );

      const correctOptions =
        filledOptions.filter(
          (option) =>
            option.isCorrect,
        );

      if (
        filledOptions.length <
        2
      ) {
        nextErrors.options =
          "Enter at least two answer options.";
      } else if (
        correctOptions.length ===
        0
      ) {
        nextErrors.options =
          "Select at least one correct answer.";
      } else if (
        !allowsMultipleAnswers &&
        correctOptions.length !==
          1
      ) {
        nextErrors.options =
          "Single-select questions require exactly one correct answer.";
      }
    } else if (
      !expectedAnswer.trim()
    ) {
      nextErrors.expectedAnswer =
        "Expected answer is required for short-answer questions.";
    }

    const finalImageExists =
      Boolean(
        selectedImage ||
        (
          existingImage &&
          !removeExistingImage
        ),
      );

    if (
      finalImageExists &&
      !imageAltText.trim()
    ) {
      nextErrors.image =
        "Alt text is required when a question has an image.";
    }

    if (
      existingImage &&
      !selectedImage &&
      !removeExistingImage &&
      imageAltText.trim() !==
        existingImage.alt_text
    ) {
      nextErrors.image =
        "Choose a replacement image to update its alt text.";
    }

    setErrors(
      nextErrors,
    );

    return (
      Object.keys(
        nextErrors,
      ).length === 0
    );
  }


  async function saveMedia(
    questionId: string,
  ) {
    if (
      removeExistingImage &&
      existingImage
    ) {
      await removeManagedQuestionImage(
        token,
        questionId,
        existingImage.id,
      );

      return;
    }

    if (!selectedImage) {
      return;
    }

    if (existingImage) {
      await replaceManagedQuestionImage(
        token,
        questionId,
        existingImage.id,
        selectedImage,
        imageAltText.trim(),
      );

      return;
    }

    await uploadManagedQuestionImage(
      token,
      questionId,
      selectedImage,
      imageAltText.trim(),
    );
  }


  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setSubmitError(
      "",
    );

    if (!validate()) {
      return;
    }

    if (
      !selectedCategory &&
      mode === "create"
    ) {
      setErrors(
        (current) => ({
          ...current,

          category:
            "Select a valid certification and category.",
        }),
      );

      return;
    }

    const answerOptions =
      questionType ===
      "multiple_choice"
        ? options
            .filter(
              (option) =>
                option.text.trim(),
            )
            .map(
              (option) => ({
                option_text:
                  option.text.trim(),

                is_correct:
                  option.isCorrect,
              }),
            )
        : [];


    const common = {
      category_id:
        categoryId || null,

      difficulty,

      question_text:
        questionText.trim(),

      question_type:
        questionType,

      allows_multiple_answers:
        questionType ===
        "multiple_choice"
          ? allowsMultipleAnswers
          : false,

      explanation:
        explanation.trim() ||
        null,

      options:
        answerOptions,

      expected_answer:
        questionType ===
        "short_answer"
          ? expectedAnswer.trim()
          : null,
    } satisfies AdminQuestionDraftEditRequest;


    setSaving(
      true,
    );

    let questionId:
      string | null =
      savedCreateQuestionId;


    try {
      if (!questionId) {
        if (
          mode === "create"
        ) {
          questionId =
            await props.onSubmit({
              ...common,

              certification_id:
                selectedCategory!
                  .certification_id,
            });

          setSavedCreateQuestionId(
            questionId,
          );
        } else {
          questionId =
            await props.onSubmit(
              common,
            );
        }
      }

      try {
        await saveMedia(
          questionId,
        );
      } catch (
        mediaError: unknown
      ) {
        if (
          mediaError instanceof
            ApiError &&
          mediaError.status ===
            401
        ) {
          onUnauthorized(
            mediaError,
          );

          return;
        }

        setSubmitError(
          imageErrorMessage(
            mediaError,
          ),
        );

        return;
      }

      router.push(
        `/admin/questions/${encodeURIComponent(
          questionId,
        )}`,
      );

    } catch (
      error: unknown
    ) {
      if (
        error instanceof
          ApiError &&
        error.status === 401
      ) {
        onUnauthorized(
          error,
        );

        return;
      }

      setSubmitError(
        questionErrorMessage(
          error,
        ),
      );

    } finally {
      setSaving(
        false,
      );
    }
  }


  return (
    <section>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#71777c]">
        JHEP-165 / Question Management
      </p>

      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        {pageTitle}
      </h1>

      <p className="mt-2 text-sm text-[#687178]">
        {mode === "create"
          ? (
              "Create a new question. Newly saved content remains a Draft."
            )
          : publishedRevision
            ? (
                "Changes to a published question create a new draft revision."
              )
            : (
                "Update this permitted Draft question. Saved changes remain unpublished."
              )}
      </p>

      {publishedRevision && (
        <div className="mt-5 rounded-md bg-[#f1f1f1] px-4 py-3 text-sm text-[#4f565b]">
          Live version v
          {
            initialQuestion!
              .version_number
          }{" "}
          remains available; saving
          creates draft revision v
          {
            initialQuestion!
              .version_number +
            1
          }.
        </div>
      )}

      {savedCreateQuestionId && (
        <div className="mt-5 rounded-md bg-[#f1f1f1] px-4 py-3 text-sm text-[#4f565b]">
          The question draft has
          already been saved. Retry
          the image operation without
          creating another question.
        </div>
      )}

      {Object.keys(
        errors,
      ).length > 0 && (
        <div
          role="alert"
          className="mt-5 flex gap-2 rounded-md bg-[#f1f1f1] px-4 py-3 text-sm"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />

          Review required fields,
          answer configuration, and
          image details before saving.
        </div>
      )}

      <form
        onSubmit={
          handleSubmit
        }
        className="mt-5"
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.8fr)]">
          <div className="rounded-md border border-[#cfd2d5] bg-white p-5 sm:p-6">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm font-semibold">
                Question type *

                <select
                  value={
                    questionType
                  }
                  disabled={
                    Boolean(
                      savedCreateQuestionId,
                    )
                  }
                  onChange={(
                    event,
                  ) => {
                    const value =
                      event.target
                        .value as
                        AdminQuestionType;

                    setQuestionType(
                      value,
                    );

                    if (
                      value ===
                      "short_answer"
                    ) {
                      setAllowsMultipleAnswers(
                        false,
                      );
                    }
                  }}
                  className="mt-2 w-full rounded-md border border-[#cfd2d5] bg-white px-3 py-3 font-normal disabled:bg-[#f1f1f1]"
                >
                  <option value="multiple_choice">
                    Multiple Choice
                    (MCQ)
                  </option>

                  <option value="short_answer">
                    Short Answer
                  </option>
                </select>
              </label>

              <label className="text-sm font-semibold">
                Certification /
                Category *

                <select
                  value={
                    categoryId
                  }
                  disabled={
                    publishedRevision ||
                    Boolean(
                      savedCreateQuestionId,
                    )
                  }
                  onChange={(
                    event,
                  ) =>
                    setCategoryId(
                      event.target
                        .value,
                    )
                  }
                  className="mt-2 w-full rounded-md border border-[#cfd2d5] bg-white px-3 py-3 font-normal disabled:bg-[#f1f1f1]"
                >
                  <option value="">
                    Select category
                  </option>

                  {certifications.map(
                    (
                      certification,
                    ) => (
                      <optgroup
                        key={
                          certification.id
                        }
                        label={
                          certification.name
                        }
                      >
                        {certification.categories.map(
                          (
                            category,
                          ) => (
                            <option
                              key={
                                category.id
                              }
                              value={
                                category.id
                              }
                            >
                              {
                                category.name
                              }
                            </option>
                          ),
                        )}
                      </optgroup>
                    ),
                  )}
                </select>

                {errors.category && (
                  <span className="mt-2 block text-xs text-red-700">
                    {
                      errors.category
                    }
                  </span>
                )}
              </label>
            </div>

            <label className="mt-5 block text-sm font-semibold">
              Question prompt *

              <textarea
                value={
                  questionText
                }
                disabled={
                  Boolean(
                    savedCreateQuestionId,
                  )
                }
                onChange={(
                  event,
                ) =>
                  setQuestionText(
                    event.target
                      .value,
                  )
                }
                placeholder="Enter the question text..."
                rows={4}
                className="mt-2 w-full resize-y rounded-md border border-[#cfd2d5] px-3 py-3 font-normal disabled:bg-[#f1f1f1]"
              />

              {errors.questionText && (
                <span className="mt-2 block text-xs text-red-700">
                  {
                    errors.questionText
                  }
                </span>
              )}
            </label>

            <AdminQuestionImageField
              existingImage={
                existingImage
              }
              selectedFile={
                selectedImage
              }
              altText={
                imageAltText
              }
              removeExisting={
                removeExistingImage
              }
              disabled={
                saving
              }
              error={
                errors.image
              }
              onFileChange={
                chooseImage
              }
              onAltTextChange={
                setImageAltText
              }
              onRemoveExisting={() => {
                setRemoveExistingImage(
                  true,
                );

                setSelectedImage(
                  null,
                );

                setErrors(
                  (current) => ({
                    ...current,
                    image:
                      undefined,
                  }),
                );
              }}
              onRestoreExisting={() => {
                setRemoveExistingImage(
                  false,
                );

                setImageAltText(
                  existingImage
                    ?.alt_text ??
                    "",
                );
              }}
            />

            {questionType ===
            "multiple_choice" ? (
              <div className="mt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold">
                    Answer options *
                  </p>

                  <label className="flex items-center gap-2 text-xs text-[#5f666b]">
                    <input
                      type="checkbox"
                      checked={
                        allowsMultipleAnswers
                      }
                      disabled={
                        Boolean(
                          savedCreateQuestionId,
                        )
                      }
                      onChange={(
                        event,
                      ) => {
                        const checked =
                          event.target
                            .checked;

                        setAllowsMultipleAnswers(
                          checked,
                        );

                        if (
                          !checked
                        ) {
                          const firstCorrect =
                            options.findIndex(
                              (
                                option,
                              ) =>
                                option.isCorrect,
                            );

                          setOptions(
                            (
                              current,
                            ) =>
                              current.map(
                                (
                                  option,
                                  index,
                                ) => ({
                                  ...option,

                                  isCorrect:
                                    firstCorrect >=
                                    0
                                      ? (
                                          index ===
                                          firstCorrect
                                        )
                                      : false,
                                }),
                              ),
                          );
                        }
                      }}
                    />

                    Allow multiple
                    correct answers
                  </label>
                </div>

                <div className="mt-3 space-y-2.5">
                  {options.map(
                    (
                      option,
                      index,
                    ) => (
                      <div
                        key={
                          option.id
                        }
                        className="flex items-center gap-3"
                      >
                        <input
                          type={
                            allowsMultipleAnswers
                              ? "checkbox"
                              : "radio"
                          }
                          name="correct-answer"
                          checked={
                            option.isCorrect
                          }
                          disabled={
                            Boolean(
                              savedCreateQuestionId,
                            )
                          }
                          onChange={(
                            event,
                          ) =>
                            setCorrectOption(
                              index,
                              event.target
                                .checked,
                            )
                          }
                          aria-label={`Mark option ${index + 1} correct`}
                          className="size-4 shrink-0"
                        />

                        <input
                          value={
                            option.text
                          }
                          disabled={
                            Boolean(
                              savedCreateQuestionId,
                            )
                          }
                          onChange={(
                            event,
                          ) =>
                            updateOption(
                              index,
                              event.target
                                .value,
                            )
                          }
                          placeholder={`Option ${String.fromCharCode(
                            65 +
                              index,
                          )}`}
                          className="min-w-0 flex-1 rounded-md border border-[#cfd2d5] px-3 py-2.5 text-sm disabled:bg-[#f1f1f1]"
                        />

                        {options.length >
                          2 && (
                          <button
                            type="button"
                            disabled={
                              Boolean(
                                savedCreateQuestionId,
                              )
                            }
                            onClick={() =>
                              removeOption(
                                index,
                              )
                            }
                            aria-label={`Remove option ${index + 1}`}
                            className="rounded p-2 text-[#72787d] hover:bg-[#f1f1f1] disabled:opacity-40"
                          >
                            <X
                              aria-hidden="true"
                              className="size-4"
                            />
                          </button>
                        )}
                      </div>
                    ),
                  )}
                </div>

                <button
                  type="button"
                  disabled={
                    Boolean(
                      savedCreateQuestionId,
                    )
                  }
                  onClick={
                    addOption
                  }
                  className="mt-4 inline-flex items-center gap-2 rounded-md border border-[#cfd2d5] px-4 py-2 text-sm font-medium hover:bg-[#f5f5f5] disabled:opacity-40"
                >
                  <Plus
                    aria-hidden="true"
                    className="size-4"
                  />

                  Add option
                </button>

                {errors.options && (
                  <p className="mt-3 text-xs text-red-700">
                    {
                      errors.options
                    }
                  </p>
                )}
              </div>
            ) : (
              <label className="mt-5 block text-sm font-semibold">
                Expected answer *

                <textarea
                  value={
                    expectedAnswer
                  }
                  disabled={
                    Boolean(
                      savedCreateQuestionId,
                    )
                  }
                  onChange={(
                    event,
                  ) =>
                    setExpectedAnswer(
                      event.target
                        .value,
                    )
                  }
                  placeholder="Enter the expected short answer..."
                  rows={3}
                  className="mt-2 w-full resize-y rounded-md border border-[#cfd2d5] px-3 py-3 font-normal disabled:bg-[#f1f1f1]"
                />

                {errors.expectedAnswer && (
                  <span className="mt-2 block text-xs text-red-700">
                    {
                      errors.expectedAnswer
                    }
                  </span>
                )}
              </label>
            )}

            <label className="mt-5 block text-sm font-semibold">
              Explanation /
              feedback *

              <textarea
                value={
                  explanation
                }
                disabled={
                  Boolean(
                    savedCreateQuestionId,
                  )
                }
                onChange={(
                  event,
                ) =>
                  setExplanation(
                    event.target
                      .value,
                  )
                }
                placeholder="Explain why the correct answer is correct..."
                rows={4}
                className="mt-2 w-full resize-y rounded-md border border-[#cfd2d5] px-3 py-3 font-normal disabled:bg-[#f1f1f1]"
              />

              {errors.explanation && (
                <span className="mt-2 block text-xs text-red-700">
                  {
                    errors.explanation
                  }
                </span>
              )}
            </label>

            <p className="mt-4 text-xs leading-5 text-[#777e83]">
              Saved drafts are not
              published to learners.
              Question images are
              stored in Cloudflare R2
              and remain associated
              with the question
              version.
            </p>
          </div>

          <aside className="rounded-md border border-[#cfd2d5] bg-white p-5 sm:p-6">
            <h2 className="text-lg font-bold">
              Question details
            </h2>

            <label className="mt-5 block text-sm font-semibold">
              Status

              <input
                value={
                  statusText
                }
                readOnly
                className="mt-2 w-full rounded-md border border-[#cfd2d5] bg-[#f7f7f7] px-3 py-3 font-normal"
              />
            </label>

            <label className="mt-5 block text-sm font-semibold">
              Difficulty

              <select
                value={
                  difficulty
                }
                disabled={
                  publishedRevision ||
                  Boolean(
                    savedCreateQuestionId,
                  )
                }
                onChange={(
                  event,
                ) =>
                  setDifficulty(
                    event.target
                      .value as
                      AdminDifficulty,
                  )
                }
                className="mt-2 w-full rounded-md border border-[#cfd2d5] bg-white px-3 py-3 font-normal disabled:bg-[#f1f1f1]"
              >
                <option value="easy">
                  Easy
                </option>

                <option value="medium">
                  Medium
                </option>

                <option value="hard">
                  Hard
                </option>
              </select>
            </label>

            <div className="mt-5">
              <p className="text-sm font-semibold">
                Tags
              </p>

              <div className="mt-2 rounded-md border border-[#cfd2d5] bg-[#f7f7f7] px-3 py-3 text-xs text-[#777e83]">
                Tags are not included
                in the current MVP
                data model.
              </div>
            </div>

            <div className="mt-5 rounded-md border border-[#cfd2d5] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide">
                Image support
              </p>

              <p className="mt-2 text-xs leading-5 text-[#777e83]">
                PNG, JPEG, and WebP
                images are supported.
                Images are uploaded
                through the backend
                and stored in
                Cloudflare R2.
              </p>
            </div>

            <p className="mt-4 text-xs leading-5 text-[#777e83]">
              {publishedRevision
                ? (
                    `Published version v${initialQuestion!.version_number} stays unchanged until approval.`
                  )
                : (
                    "Only an Administrator can approve or publish questions."
                  )}
            </p>
          </aside>
        </div>

        {submitError && (
          <div
            role="alert"
            className="mt-4 flex gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700"
          >
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />

            {submitError}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-3">
          <Link
            href={
              mode === "edit"
                ? (
                    `/admin/questions/${encodeURIComponent(
                      initialQuestion!
                        .question_id,
                    )}`
                  )
                : "/admin/questions"
            }
            className="rounded-md border border-[#cfd2d5] bg-white px-5 py-2.5 text-sm font-medium hover:bg-[#f5f5f5]"
          >
            Cancel
          </Link>

          <button
            type="submit"
            disabled={
              saving ||
              categories.length ===
                0
            }
            className="rounded-md bg-brand-accent px-7 py-2.5 text-sm font-medium text-white hover:bg-brand-accent/80 hover:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving
              ? "Saving..."
              : submitLabel}
          </button>
        </div>
      </form>
    </section>
  );
}