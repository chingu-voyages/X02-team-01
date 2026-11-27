"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { AlertCircle, FolderPlus, Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import {
  getImportCatalogPlan,
  type ImportCatalogConfirmation,
  type ImportCatalogPlan,
  type ImportCertificationConfiguration,
} from "@/lib/question-import-catalog-api";

type Configuration = {
  name: string;
  threshold: string;
  feedbackMode: "immediate" | "deferred";
};
type FieldErrors = Partial<Record<"name" | "threshold", string>>;

interface Props {
  batchId: string;
  token: string;
  role: string | null;
  busy: boolean;
  onConfirm: (payload: ImportCatalogConfirmation) => Promise<void>;
  onUnauthorized: (error: ApiError) => void;
}

const emptyConfiguration: Configuration = {
  name: "",
  threshold: "",
  feedbackMode: "deferred",
};
const secondaryButton = "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-[#cfd2d5] bg-white px-4 py-2 text-sm font-semibold text-[#3f4549] hover:bg-[#f5f6f7] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 sm:w-auto";

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "Only an administrator can create catalog records.";
    if (error.status === 404) return "This import is no longer available. Reopen it from Recent Imports.";
    if (error.status === 409) {
      const detail = error.detail;
      if (detail !== null && typeof detail === "object" && "message" in detail && typeof detail.message === "string") {
        return `${detail.message} Refresh the catalog preview before trying again.`;
      }
      return "The catalog or import has changed. Refresh the catalog preview before trying again.";
    }
    if (error.status === 422) return "Check the certification names and passing thresholds, then review the confirmation again.";
  }
  return "The request could not be completed. Check your connection and refresh the catalog preview to verify the current state.";
}

function RowReferences({ numbers }: { numbers: number[] }) {
  return (
    <details className="mt-1 min-w-0 text-xs text-[#62696e]">
      <summary className="cursor-pointer py-1">{numbers.length} affected {numbers.length === 1 ? "row" : "rows"}</summary>
      <p className="mt-1 wrap-anywhere">Workbook rows: {numbers.join(", ")}</p>
    </details>
  );
}

export default function ImportCatalogResolution({ batchId, token, role, busy, onConfirm, onUnauthorized }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const requestRef = useRef(false);
  const [plan, setPlan] = useState<ImportCatalogPlan | null>(null);
  const [configurations, setConfigurations] = useState<Record<string, Configuration>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, FieldErrors>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const locked = busy || loading || saving;
  const administrator = role === "administrator";

  async function loadPlan() {
    if (locked || requestRef.current) return;
    requestRef.current = true;
    setLoading(true);
    setError("");
    setAcknowledged(false);
    setFieldErrors({});
    try {
      const next = await getImportCatalogPlan(token, batchId);
      if (next.batch_id !== batchId) throw new Error("Unexpected catalog preview");
      setPlan(next);
      setConfigurations((previous) => Object.fromEntries(
        next.missing_certifications.map(({ code }) => [code, previous[code] ?? { ...emptyConfiguration }]),
      ));
      setNeedsRefresh(false);
    } catch (caught: unknown) {
      if (caught instanceof ApiError && caught.status === 401) onUnauthorized(caught);
      else setError(messageFor(caught));
      setNeedsRefresh(true);
    } finally {
      requestRef.current = false;
      setLoading(false);
    }
  }

  function closePreview() {
    if (locked || requestRef.current) return;
    setPlan(null);
    setConfigurations({});
    setFieldErrors({});
    setAcknowledged(false);
    setNeedsRefresh(false);
    setError("");
    trigger.current?.focus();
  }

  function updateConfiguration(code: string, patch: Partial<Configuration>) {
    setConfigurations((previous) => ({
      ...previous,
      [code]: { ...(previous[code] ?? emptyConfiguration), ...patch },
    }));
    setFieldErrors((previous) => ({ ...previous, [code]: {} }));
    setAcknowledged(false);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!administrator || !plan?.can_confirm || !acknowledged || needsRefresh || locked || requestRef.current) return;
    const errors: Record<string, FieldErrors> = {};
    const certifications: ImportCertificationConfiguration[] = [];
    for (const item of plan.missing_certifications) {
      const entry = configurations[item.code] ?? emptyConfiguration;
      const problems: FieldErrors = {};
      if (!entry.name.trim() || entry.name.trim().length > 255) problems.name = "Enter a certification name from 1 to 255 characters.";
      if (!/^\d+$/.test(entry.threshold) || Number(entry.threshold) > 100) problems.threshold = "Enter a whole-number passing threshold from 0 to 100.";
      if (Object.keys(problems).length > 0) errors[item.code] = problems;
      certifications.push({
        code: item.code,
        name: entry.name.trim(),
        passing_threshold_pct: Number(entry.threshold),
        feedback_mode: entry.feedbackMode,
      });
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError("Check the highlighted certification fields before creating records.");
      // Focus the first invalid field using the committed DOM on the next frame.
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    requestRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onConfirm({ plan_id: plan.plan_id, confirm: true, certifications });
      // Successful confirmation may remove this section after revalidation.
      setPlan(null);
      setAcknowledged(false);
    } catch (caught: unknown) {
      if (caught instanceof ApiError && caught.status === 401) onUnauthorized(caught);
      else setError(messageFor(caught));
      // A lost response may mean the creation succeeded. Never repeat it blindly.
      setNeedsRefresh(!(caught instanceof ApiError && caught.status === 422));
      setAcknowledged(false);
    } finally {
      requestRef.current = false;
      setSaving(false);
    }
  }

  const missingCount = plan ? plan.missing_certifications.length + plan.missing_categories.length : 0;

  return (
    <section aria-labelledby={`${id}-heading`} className="mt-5 min-w-0 rounded-md border border-amber-200 bg-white p-4 sm:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <FolderPlus aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-800" />
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-heading`} className="font-semibold text-amber-950">Resolve missing catalog records</h2>
          <p className="mt-1 text-sm leading-6 text-[#62696e]">Review the certifications and categories referenced by this workbook. Nothing is created until an administrator confirms the exact additions.</p>
          {!administrator && <p className="mt-2 text-sm font-medium text-[#414b52]">Ask an administrator to create the missing records, then revalidate this import. You can review the proposed additions below.</p>}
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button ref={trigger} type="button" disabled={locked} onClick={() => void loadPlan()} className={secondaryButton} aria-expanded={Boolean(plan)} aria-controls={plan ? `${id}-preview` : undefined}>
          {loading && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          {loading ? "Checking catalog..." : plan || needsRefresh ? "Refresh catalog preview" : "Review missing records"}
        </button>
        {plan && <button type="button" disabled={locked} onClick={closePreview} className={secondaryButton}>Close catalog preview</button>}
      </div>
      {error && <div role="alert" className="mt-4 flex min-w-0 items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900"><AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><p className="min-w-0 wrap-anywhere">{error}</p></div>}
      {plan && (
        <div id={`${id}-preview`} className="mt-4 min-w-0 space-y-4 border-t border-[#d8dbde] pt-4">
          <p role="status" className="text-sm font-medium text-[#414b52]">{plan.missing_certifications.length} new {plan.missing_certifications.length === 1 ? "certification" : "certifications"} · {plan.missing_categories.length} new {plan.missing_categories.length === 1 ? "category" : "categories"}</p>
          {plan.blocking_issues.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <p className="font-semibold">Correct these workbook or catalog references first.</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {plan.blocking_issues.map((issue, index) => <li key={`${issue.row_number}-${issue.field}-${index}`} className="wrap-anywhere">Row {issue.row_number} ({issue.field.replaceAll("_", " ")}): {issue.message}</li>)}
              </ul>
            </div>
          )}
          {missingCount === 0 && plan.blocking_issues.length === 0 && <p className="rounded-md bg-[#f4f5f6] p-3 text-sm">No missing records remain. Use Revalidate below to refresh the question import.</p>}
          <form ref={formRef} noValidate onSubmit={(event) => void submit(event)} className="min-w-0 space-y-4" aria-busy={saving}>
            {plan.missing_certifications.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">New certifications</h3>
                {plan.missing_certifications.map((item, index) => {
                  const entry = configurations[item.code] ?? emptyConfiguration;
                  const problems = fieldErrors[item.code] ?? {};
                  const fieldId = `${id}-cert-${index}`;
                  return (
                    <fieldset key={item.code} className="min-w-0 rounded-md border border-[#d8dbde] p-3 sm:p-4" disabled={locked || !administrator || !plan.can_confirm || needsRefresh}>
                      <legend className="max-w-full px-1 text-sm font-semibold wrap-anywhere">{item.code}</legend>
                      <p className="text-xs text-[#62696e]">Initial status: Unpublished</p>
                      <RowReferences numbers={item.row_numbers} />
                      {administrator && plan.can_confirm && (
                        <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                          <div className="min-w-0 sm:col-span-2">
                            <label htmlFor={`${fieldId}-name`} className="block text-sm font-semibold">Certification name ({item.code})</label>
                            <input id={`${fieldId}-name`} value={entry.name} maxLength={255} required autoComplete="off" onChange={(event) => updateConfiguration(item.code, { name: event.target.value })} aria-invalid={Boolean(problems.name) || undefined} aria-describedby={problems.name ? `${fieldId}-name-error` : undefined} className={`mt-1 min-h-11 w-full min-w-0 rounded-md border bg-white px-3 py-2 text-base sm:text-sm ${problems.name ? "border-red-600" : "border-[#cfd2d5]"}`} />
                            {problems.name && <p id={`${fieldId}-name-error`} className="mt-1 text-sm text-red-700">{problems.name}</p>}
                          </div>
                          <div className="min-w-0">
                            <label htmlFor={`${fieldId}-threshold`} className="block text-sm font-semibold">Passing threshold (%) ({item.code})</label>
                            <input id={`${fieldId}-threshold`} type="number" inputMode="numeric" min={0} max={100} step={1} required value={entry.threshold} onChange={(event) => updateConfiguration(item.code, { threshold: event.target.value })} aria-invalid={Boolean(problems.threshold) || undefined} aria-describedby={problems.threshold ? `${fieldId}-threshold-error` : undefined} className={`mt-1 min-h-11 w-full min-w-0 rounded-md border bg-white px-3 py-2 text-base sm:text-sm ${problems.threshold ? "border-red-600" : "border-[#cfd2d5]"}`} />
                            {problems.threshold && <p id={`${fieldId}-threshold-error`} className="mt-1 text-sm text-red-700">{problems.threshold}</p>}
                          </div>
                          <div className="min-w-0">
                            <label htmlFor={`${fieldId}-mode`} className="block text-sm font-semibold">Feedback mode ({item.code})</label>
                            <select id={`${fieldId}-mode`} value={entry.feedbackMode} onChange={(event) => updateConfiguration(item.code, { feedbackMode: event.target.value === "immediate" ? "immediate" : "deferred" })} className="mt-1 min-h-11 w-full min-w-0 rounded-md border border-[#cfd2d5] bg-white px-3 py-2 text-base sm:text-sm">
                              <option value="deferred">After completion</option>
                              <option value="immediate">Immediate feedback</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </fieldset>
                  );
                })}
              </div>
            )}
            {plan.missing_categories.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">New categories</h3>
                <ul className="divide-y divide-[#e1e3e5] rounded-md border border-[#d8dbde]">
                  {plan.missing_categories.map((item) => (
                    <li key={JSON.stringify([item.certification_code, item.name])} className="min-w-0 p-3">
                      <p className="font-medium wrap-anywhere">{item.name}</p>
                      <p className="mt-1 text-xs text-[#62696e] wrap-anywhere">{item.certification_code} · Unpublished</p>
                      <RowReferences numbers={item.row_numbers} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {administrator && plan.can_confirm && missingCount > 0 && (
              <div className="space-y-3 border-t border-[#d8dbde] pt-3">
                <p className="rounded-md bg-[#f4f5f6] p-3 text-sm leading-6">New catalog records remain unpublished and will stay in the catalog even if you later cancel the question import. This action does not import or publish questions.</p>
                <label className="flex min-h-11 items-start gap-3 py-2 text-sm font-medium">
                  <input type="checkbox" checked={acknowledged} disabled={locked || needsRefresh} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[#343a3e]" />
                  I confirm creation of the listed catalog records.
                </label>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button type="button" disabled={locked} onClick={closePreview} className={secondaryButton}>Cancel creation</button>
                  <button type="submit" disabled={locked || needsRefresh || !acknowledged} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#3d4145] px-4 py-2 text-sm font-semibold text-white hover:bg-[#292d30] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 sm:w-auto">
                    {saving && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                    {saving ? "Creating records..." : "Create records & revalidate"}
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      )}
    </section>
  );
}
