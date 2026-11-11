"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import AdminQuestionForm from "@/features/questions/AdminQuestionForm";
import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import {
  editManagedQuestion,
  getManagedQuestion,
} from "@/lib/admin-question-api";
import { getAvailableCategories } from "@/lib/category-api";

import type { PracticeCategory } from "@/types/category-api.types";
import type {
  AdminQuestionDetail,
  AdminQuestionDraftEditRequest,
} from "@/types/admin-question-api.types";

type LoadStatus = "loading" | "ready" | "error";

export default function EditAdminQuestionPage() {
  const params = useParams<{ questionId: string }>();
  const router = useRouter();
  const { token, ready, handleError } = useDemoSession();
  const questionId = params.questionId;

  const [question, setQuestion] = useState<AdminQuestionDetail | null>(null);
  const [categories, setCategories] = useState<PracticeCategory[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const loadData = useCallback(() => {
    if (!token) return;

    let cancelled = false;

    Promise.all([
      getManagedQuestion(token, questionId),
      getAvailableCategories(token),
    ])
      .then(([questionData, categoryData]) => {
        if (cancelled) return;
        setQuestion(questionData);
        setCategories(categoryData);
        setLoadStatus("ready");
        setLoadError("");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          handleError(error);
          return;
        }
        setLoadStatus("error");
        setLoadError(
          error instanceof ApiError && error.status === 404
            ? "Question not found or you do not have access to it."
            : "Unable to load the question editor.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [handleError, questionId, token]);

  useEffect(() => {
    if (!ready || !token) return;
    return loadData();
  }, [loadData, ready, reloadKey, token]);

  if (!ready || !token) {
    return <p role="status">Checking session...</p>;
  }

  if (loadStatus === "loading") {
    return <p role="status">Loading question editor...</p>;
  }

  if (loadStatus === "error" || !question) {
    return (
      <div className="rounded-md border border-[#cfd2d5] bg-white p-6">
        <p role="alert" className="text-sm text-red-700">
          {loadError || "Unable to load the question editor."}
        </p>
        <button
          type="button"
          onClick={() => {
            setLoadStatus("loading");
            setReloadKey((value) => value + 1);
          }}
          className="mt-4 rounded-md bg-[#3d4145] px-4 py-2 text-sm text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  if (question.publication_status === "retired") {
    return (
      <div className="rounded-md border border-[#cfd2d5] bg-white p-6 text-sm text-[#687178]">
        Retired questions are read-only and cannot be edited.
      </div>
    );
  }

  async function saveQuestion(payload: AdminQuestionDraftEditRequest) {
    const updated = await editManagedQuestion(token!, questionId, payload);
    const destination = `/admin/questions/${encodeURIComponent(updated.question_id)}`;
    router.push(destination);
    return updated.question_id;
  }

  return (
    <AdminQuestionForm
      key={question.question_version_id}
      mode="edit"
      token={token}
      categories={categories}
      initialQuestion={question}
      onUnauthorized={handleError}
      onSubmit={saveQuestion}
    />
  );
}
