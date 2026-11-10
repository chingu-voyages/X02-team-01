"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import AdminQuestionForm from "@/features/questions/AdminQuestionForm";
import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import { createManagedQuestion } from "@/lib/admin-question-api";
import { getAvailableCategories } from "@/lib/category-api";

import type { PracticeCategory } from "@/types/category-api.types";
import type { AdminQuestionDraftCreateRequest } from "@/types/admin-question-api.types";

type LoadStatus = "loading" | "ready" | "error";

export default function CreateAdminQuestionPage() {
  const router = useRouter();
  const { token, ready, handleError } = useDemoSession();
  const [categories, setCategories] = useState<PracticeCategory[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!ready || !token) {
      return;
    }

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
        setLoadStatus("error");
        setLoadError("Unable to load certification/category options.");
      });

    return () => {
      cancelled = true;
    };
  }, [handleError, ready, reloadKey, token]);

  if (!ready || !token) {
    return <p role="status">Checking session...</p>;
  }

  if (loadStatus === "loading") {
    return <p role="status">Loading question form...</p>;
  }

  if (loadStatus === "error") {
    return (
      <div className="rounded-md border border-[#cfd2d5] bg-white p-6">
        <p role="alert" className="text-sm text-red-700">{loadError}</p>
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

  if (categories.length === 0) {
    return (
      <div className="rounded-md border border-[#cfd2d5] bg-white p-6 text-sm text-[#687178]">
        No published categories are currently available for question creation.
      </div>
    );
  }

  async function saveQuestion(payload: AdminQuestionDraftCreateRequest) {
    const created = await createManagedQuestion(token!, payload);
    const destination = `/admin/questions/${encodeURIComponent(created.question_id)}`;
    router.push(destination);
    return created.question_id;
  }

  return (
    <AdminQuestionForm
      mode="create"
      token={token}
      categories={categories}
      onUnauthorized={handleError}
      onSubmit={saveQuestion}
    />
  );
}
