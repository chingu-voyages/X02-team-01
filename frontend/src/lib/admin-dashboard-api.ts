import { apiRequest } from "@/lib/api-client";

export type DashboardPeriod = "7" | "30" | "90" | "all" | "custom";

export interface AttemptByExam {
  exam_id: string | null;
  title: string;
  count: number;
}

export interface DashboardOverview {
  registered_learners: number;
  completed_attempts: number;
  participating_learners: number;
  pending_question_reviews: number;
  review_breakdown: {
    submitted: number;
    in_review: number;
  };
  attempts_by_exam: AttemptByExam[];
  filters: Record<string, unknown>;
  generated_at: string;
}

export interface DashboardFilters {
  period: DashboardPeriod;
  from?: string;
  to?: string;
  exam_id?: string;
}

export async function getDashboardOverview(
  token: string,
  filters: DashboardFilters,
): Promise<DashboardOverview> {
  const params = new URLSearchParams();
  params.set("period", filters.period);

  if (filters.period === "custom") {
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
  }

  if (filters.exam_id) params.set("exam_id", filters.exam_id);

  return apiRequest<DashboardOverview>(
    `/admin/dashboard/overview?${params.toString()}`,
    token,
  );
}
