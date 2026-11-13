import { apiRequest } from "@/lib/api-client";

import type { PracticeCategory } from "@/types/category-api.types";

interface AdminCategory {
  id: string;
  certification_id: string;
  certification_name: string;
  name: string;
  is_published: boolean;
}

interface AdminCategoryListResponse {
  items: AdminCategory[];
  count: number;
}

export async function getAdminQuestionCategories(
  token: string,
): Promise<PracticeCategory[]> {
  const response =
    await apiRequest<AdminCategoryListResponse>(
      "/admin/categories",
      token,
      {
        method: "GET",
      },
    );

  return response.items.map((category) => ({
    id: category.id,
    certification_id: category.certification_id,
    certification_name: category.certification_name,
    name: category.name,

    // AdminQuestionForm does not use learner availability counts.
    // Keep the existing PracticeCategory shape so the form remains
    // compatible while sourcing its options from the admin catalog.
    available_question_count: 0,
  }));
}