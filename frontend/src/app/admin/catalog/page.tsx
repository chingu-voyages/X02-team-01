"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { CircleAlert, Plus } from "lucide-react";

import PageHeader from "@/components/layouts/PageHeader";
import { useDemoSession } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api-client";
import {
  createAdminCategory,
  createAdminCertification,
  getAdminCategories,
  getAdminCertifications,
  setAdminCategoryPublication,
  setAdminCertificationPublication,
} from "@/lib/admin-catalog-api";

import type {
  AdminCategory,
  AdminCertification,
  AdminFeedbackMode,
} from "@/types/admin-catalog-api.types";

type LoadStatus = "loading" | "ready" | "error";

export default function AdminCatalogPage() {
  const { token, ready, handleError } = useDemoSession();

  const [certifications, setCertifications] = useState<
    AdminCertification[]
  >([]);

  const [categories, setCategories] = useState<
    AdminCategory[]
  >([]);

  const [loadStatus, setLoadStatus] =
    useState<LoadStatus>("loading");

  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  const [
    showCertificationForm,
    setShowCertificationForm,
  ] = useState(false);

  const [
    showCategoryForm,
    setShowCategoryForm,
  ] = useState(false);

  const [
    certificationName,
    setCertificationName,
  ] = useState("");

  const [
    certificationCode,
    setCertificationCode,
  ] = useState("");

  const [threshold, setThreshold] = useState("70");

  const [feedbackMode, setFeedbackMode] =
    useState<AdminFeedbackMode>("immediate");

  const [
    categoryCertificationId,
    setCategoryCertificationId,
  ] = useState("");

  const [categoryName, setCategoryName] =
    useState("");

  const [
    savingCertification,
    setSavingCertification,
  ] = useState(false);

  const [
    savingCategory,
    setSavingCategory,
  ] = useState(false);

  const [
    changingPublicationId,
    setChangingPublicationId,
  ] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    if (!token) {
      return;
    }

    try {
      const [
        certificationData,
        categoryData,
      ] = await Promise.all([
        getAdminCertifications(token),
        getAdminCategories(token),
      ]);

      setCertifications(
        certificationData,
      );

      setCategories(
        categoryData,
      );

      setLoadStatus("ready");
      setLoadError("");

      setCategoryCertificationId(
        (current) =>
          current ||
          certificationData[0]?.id ||
          "",
      );
    } catch (error: unknown) {
      if (
        error instanceof ApiError &&
        error.status === 401
      ) {
        handleError(error);
        return;
      }

      setLoadStatus("error");

      setLoadError(
        "Unable to load the admin catalog.",
      );
    }
  }, [handleError, token]);

  useEffect(() => {
    if (!ready || !token) {
      return;
    }

    let cancelled = false;

    Promise.all([
      getAdminCertifications(token),
      getAdminCategories(token),
    ])
      .then(
        ([
          certificationData,
          categoryData,
        ]) => {
          if (cancelled) {
            return;
          }

          setCertifications(
            certificationData,
          );

          setCategories(
            categoryData,
          );

          setLoadStatus("ready");
          setLoadError("");

          setCategoryCertificationId(
            (current) =>
              current ||
              certificationData[0]?.id ||
              "",
          );
        },
      )
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        if (
          error instanceof ApiError &&
          error.status === 401
        ) {
          handleError(error);
          return;
        }

        setLoadStatus("error");

        setLoadError(
          "Unable to load the admin catalog.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    handleError,
    ready,
    token,
  ]);

  const categoriesByCertification =
    useMemo(() => {
      const map = new Map<
        string,
        AdminCategory[]
      >();

      for (const category of categories) {
        const existing =
          map.get(
            category.certification_id,
          ) ?? [];

        existing.push(category);

        map.set(
          category.certification_id,
          existing,
        );
      }

      return map;
    }, [categories]);

  function handleActionError(
    error: unknown,
    fallback: string,
  ) {
    if (
      error instanceof ApiError &&
      error.status === 401
    ) {
      handleError(error);
      return;
    }

    if (
      error instanceof ApiError &&
      error.status === 403
    ) {
      setActionError(
        "Administrator permission is required for this action.",
      );

      return;
    }

    if (
      error instanceof ApiError &&
      error.status === 409
    ) {
      setActionError(
        "That name or code is already in use.",
      );

      return;
    }

    setActionError(fallback);
  }

  async function submitCertification(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      !token ||
      savingCertification
    ) {
      return;
    }

    const parsedThreshold =
      Number(threshold);

    if (
      !certificationName.trim() ||
      !certificationCode.trim() ||
      !Number.isInteger(
        parsedThreshold,
      ) ||
      parsedThreshold < 0 ||
      parsedThreshold > 100
    ) {
      setActionError(
        "Enter a certification name, code, and passing threshold from 0–100.",
      );

      return;
    }

    setSavingCertification(true);
    setActionError("");

    try {
      await createAdminCertification(
        token,
        {
          name:
            certificationName.trim(),
          code:
            certificationCode.trim(),
          passing_threshold_pct:
            parsedThreshold,
          feedback_mode:
            feedbackMode,
        },
      );

      setCertificationName("");
      setCertificationCode("");
      setThreshold("70");

      setFeedbackMode(
        "immediate",
      );

      setShowCertificationForm(
        false,
      );

      await loadCatalog();
    } catch (error: unknown) {
      handleActionError(
        error,
        "Unable to create the certification.",
      );
    } finally {
      setSavingCertification(
        false,
      );
    }
  }

  async function submitCategory(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      !token ||
      savingCategory
    ) {
      return;
    }

    if (
      !categoryCertificationId ||
      !categoryName.trim()
    ) {
      setActionError(
        "Select a certification and enter a category name.",
      );

      return;
    }

    setSavingCategory(true);
    setActionError("");

    try {
      await createAdminCategory(
        token,
        {
          certification_id:
            categoryCertificationId,
          name:
            categoryName.trim(),
        },
      );

      setCategoryName("");

      setShowCategoryForm(
        false,
      );

      await loadCatalog();
    } catch (error: unknown) {
      handleActionError(
        error,
        "Unable to create the category.",
      );
    } finally {
      setSavingCategory(false);
    }
  }

  async function toggleCertification(
    certification: AdminCertification,
  ) {
    if (
      !token ||
      changingPublicationId
    ) {
      return;
    }

    setChangingPublicationId(
      certification.id,
    );

    setActionError("");

    try {
      await setAdminCertificationPublication(
        token,
        certification.id,
        !certification.is_published,
      );

      await loadCatalog();
    } catch (error: unknown) {
      handleActionError(
        error,
        "Unable to change certification publication.",
      );
    } finally {
      setChangingPublicationId(
        null,
      );
    }
  }

  async function toggleCategory(
    category: AdminCategory,
  ) {
    if (
      !token ||
      changingPublicationId
    ) {
      return;
    }

    setChangingPublicationId(
      category.id,
    );

    setActionError("");

    try {
      await setAdminCategoryPublication(
        token,
        category.id,
        !category.is_published,
      );

      await loadCatalog();
    } catch (error: unknown) {
      handleActionError(
        error,
        "Unable to change category publication.",
      );
    } finally {
      setChangingPublicationId(
        null,
      );
    }
  }

  if (!ready || !token) {
    return (
      <p role="status">
        Checking session...
      </p>
    );
  }

  if (
    loadStatus === "loading"
  ) {
    return (
      <p role="status">
        Loading catalog...
      </p>
    );
  }

  if (
    loadStatus === "error"
  ) {
    return (
      <div className="rounded-md border border-[#cfd2d5] bg-white p-6">
        <p
          role="alert"
          className="text-sm text-red-700"
        >
          {loadError}
        </p>

        <button
          type="button"
          onClick={() => {
            setLoadStatus(
              "loading",
            );

            void loadCatalog();
          }}
          className="mt-4 rounded-md bg-[#3d4145] px-4 py-2 text-sm font-medium text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <section>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          stepLabel="JHEP-159 / Catalog Management"
          title="Certification & Category Catalog"
          subtitle="Create and publish certification content before it becomes available to learners."
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setActionError("");

              setShowCertificationForm(
                (current) =>
                  !current,
              );
            }}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#3d4145] px-5 text-sm font-semibold text-white hover:bg-[#292d30]"
          >
            <Plus
              aria-hidden="true"
              className="size-4"
            />
            Certification
          </button>

          <button
            type="button"
            disabled={
              certifications.length === 0
            }
            onClick={() => {
              setActionError("");

              setShowCategoryForm(
                (current) =>
                  !current,
              );
            }}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[#cfd2d5] bg-white px-5 text-sm font-semibold hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus
              aria-hidden="true"
              className="size-4"
            />
            Category
          </button>
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          className="mb-5 flex gap-2 rounded-md bg-red-50 p-4 text-sm text-red-700"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />

          {actionError}
        </div>
      )}

      {showCertificationForm && (
        <form
          onSubmit={
            submitCertification
          }
          className="mb-5 rounded-md border border-[#cfd2d5] bg-white p-5"
        >
          <h2 className="text-lg font-bold">
            New Certification
          </h2>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-semibold">
              Name *
              <input
                value={
                  certificationName
                }
                onChange={(
                  event,
                ) =>
                  setCertificationName(
                    event.target.value,
                  )
                }
                className="mt-2 w-full rounded-md border border-[#cfd2d5] px-3 py-2.5 font-normal"
                placeholder="Professional Scrum Master I"
              />
            </label>

            <label className="text-sm font-semibold">
              Code *
              <input
                value={
                  certificationCode
                }
                onChange={(
                  event,
                ) =>
                  setCertificationCode(
                    event.target.value,
                  )
                }
                className="mt-2 w-full rounded-md border border-[#cfd2d5] px-3 py-2.5 font-normal"
                placeholder="PSM-I"
              />
            </label>

            <label className="text-sm font-semibold">
              Passing Threshold *
              <input
                type="number"
                min="0"
                max="100"
                value={threshold}
                onChange={(
                  event,
                ) =>
                  setThreshold(
                    event.target.value,
                  )
                }
                className="mt-2 w-full rounded-md border border-[#cfd2d5] px-3 py-2.5 font-normal"
              />
            </label>

            <label className="text-sm font-semibold">
              Feedback Mode
              <select
                value={
                  feedbackMode
                }
                onChange={(
                  event,
                ) =>
                  setFeedbackMode(
                    event.target
                      .value as AdminFeedbackMode,
                  )
                }
                className="mt-2 w-full rounded-md border border-[#cfd2d5] bg-white px-3 py-2.5 font-normal"
              >
                <option value="immediate">
                  Immediate
                </option>

                <option value="deferred">
                  Deferred
                </option>
              </select>
            </label>
          </div>

          <p className="mt-4 text-xs text-[#687178]">
            New certifications
            are created
            unpublished.
          </p>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() =>
                setShowCertificationForm(
                  false,
                )
              }
              className="rounded-md border border-[#cfd2d5] px-4 py-2 text-sm"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={
                savingCertification
              }
              className="rounded-md bg-[#3d4145] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {savingCertification
                ? "Creating..."
                : "Create Certification"}
            </button>
          </div>
        </form>
      )}

      {showCategoryForm && (
        <form
          onSubmit={
            submitCategory
          }
          className="mb-5 rounded-md border border-[#cfd2d5] bg-white p-5"
        >
          <h2 className="text-lg font-bold">
            New Category
          </h2>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-semibold">
              Certification *
              <select
                value={
                  categoryCertificationId
                }
                onChange={(
                  event,
                ) =>
                  setCategoryCertificationId(
                    event.target.value,
                  )
                }
                className="mt-2 w-full rounded-md border border-[#cfd2d5] bg-white px-3 py-2.5 font-normal"
              >
                {certifications.map(
                  (
                    certification,
                  ) => (
                    <option
                      key={
                        certification.id
                      }
                      value={
                        certification.id
                      }
                    >
                      {
                        certification.name
                      }
                    </option>
                  ),
                )}
              </select>
            </label>

            <label className="text-sm font-semibold">
              Category Name *
              <input
                value={
                  categoryName
                }
                onChange={(
                  event,
                ) =>
                  setCategoryName(
                    event.target.value,
                  )
                }
                className="mt-2 w-full rounded-md border border-[#cfd2d5] px-3 py-2.5 font-normal"
                placeholder="Scrum Fundamentals"
              />
            </label>
          </div>

          <p className="mt-4 text-xs text-[#687178]">
            New categories are
            created unpublished.
          </p>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() =>
                setShowCategoryForm(
                  false,
                )
              }
              className="rounded-md border border-[#cfd2d5] px-4 py-2 text-sm"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={
                savingCategory
              }
              className="rounded-md bg-[#3d4145] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {savingCategory
                ? "Creating..."
                : "Create Category"}
            </button>
          </div>
        </form>
      )}

      {certifications.length ===
      0 ? (
        <div className="rounded-md border border-[#cfd2d5] bg-white p-10 text-center text-sm text-[#687178]">
          No certifications
          exist yet. Create the
          first certification to
          begin building the
          catalog.
        </div>
      ) : (
        <div className="space-y-4">
          {certifications.map(
            (
              certification,
            ) => {
              const certificationCategories =
                categoriesByCertification.get(
                  certification.id,
                ) ?? [];

              return (
                <article
                  key={
                    certification.id
                  }
                  className="overflow-hidden rounded-md border border-[#cfd2d5] bg-white"
                >
                  <div className="flex flex-col gap-4 border-b border-[#dfe1e3] bg-[#f5f5f5] p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-lg font-bold">
                          {
                            certification.name
                          }
                        </h2>

                        <span className="rounded-full bg-[#dfe2e4] px-3 py-1 text-xs font-semibold">
                          {
                            certification.code
                          }
                        </span>

                        <span className="rounded-full bg-white px-3 py-1 text-xs font-medium">
                          {certification.is_published
                            ? "Published"
                            : "Draft"}
                        </span>
                      </div>

                      <p className="mt-2 text-sm text-[#687178]">
                        Passing score:{" "}
                        {certification.passing_threshold_pct ??
                          "Not configured"}
                        %
                        {" · "}
                        Feedback:{" "}
                        {
                          certification.feedback_mode
                        }
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={
                        changingPublicationId ===
                        certification.id
                      }
                      onClick={() =>
                        void toggleCertification(
                          certification,
                        )
                      }
                      className="rounded-md border border-[#cfd2d5] bg-white px-4 py-2 text-sm font-semibold hover:bg-[#eeeeee] disabled:opacity-50"
                    >
                      {changingPublicationId ===
                      certification.id
                        ? "Updating..."
                        : certification.is_published
                          ? "Unpublish Certification"
                          : "Publish Certification"}
                    </button>
                  </div>

                  <div className="p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-bold uppercase tracking-wide">
                        Categories
                      </h3>

                      <span className="text-xs text-[#687178]">
                        {
                          certificationCategories.length
                        }{" "}
                        total
                      </span>
                    </div>

                    {certificationCategories.length ===
                    0 ? (
                      <div className="rounded-md border border-dashed border-[#cfd2d5] p-6 text-sm text-[#687178]">
                        No categories
                        have been created
                        for this
                        certification.
                      </div>
                    ) : (
                      <div className="divide-y divide-[#e2e4e6] rounded-md border border-[#d8dade]">
                        {certificationCategories.map(
                          (
                            category,
                          ) => (
                            <div
                              key={
                                category.id
                              }
                              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div>
                                <p className="font-semibold">
                                  {
                                    category.name
                                  }
                                </p>

                                <p className="mt-1 text-xs text-[#687178]">
                                  {category.is_published
                                    ? "Published category"
                                    : "Draft category"}
                                </p>
                              </div>

                              <button
                                type="button"
                                disabled={
                                  changingPublicationId ===
                                  category.id
                                }
                                onClick={() =>
                                  void toggleCategory(
                                    category,
                                  )
                                }
                                className="rounded-md border border-[#cfd2d5] px-4 py-2 text-sm font-medium hover:bg-[#f4f4f4] disabled:opacity-50"
                              >
                                {changingPublicationId ===
                                category.id
                                  ? "Updating..."
                                  : category.is_published
                                    ? "Unpublish"
                                    : "Publish"}
                              </button>
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                </article>
              );
            },
          )}
        </div>
      )}

      <p className="mt-6 text-xs leading-5 text-[#687178]">
        Learners only see
        categories when the
        certification and category
        are published and the
        category contains eligible
        approved questions.
      </p>
    </section>
  );
}