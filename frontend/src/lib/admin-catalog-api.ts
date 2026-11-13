import { apiRequest } from "@/lib/api-client";

import type { PracticeCategory } from "@/types/category-api.types";

import type {
  AdminCategory,
  AdminCategoryCreateRequest,
  AdminCategoryListResponse,
  AdminCertification,
  AdminCertificationCreateRequest,
  AdminCertificationListResponse,
} from "@/types/admin-catalog-api.types";

export async function getAdminCertifications(
  token: string,
): Promise<AdminCertification[]> {
  const response =
    await apiRequest<AdminCertificationListResponse>(
      "/admin/certifications",
      token,
      {
        method: "GET",
      },
    );

  return response.items;
}

export async function createAdminCertification(
  token: string,
  payload: AdminCertificationCreateRequest,
): Promise<AdminCertification> {
  return apiRequest<AdminCertification>(
    "/admin/certifications",
    token,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function setAdminCertificationPublication(
  token: string,
  certificationId: string,
  isPublished: boolean,
): Promise<AdminCertification> {
  return apiRequest<AdminCertification>(
    `/admin/certifications/${encodeURIComponent(
      certificationId,
    )}/publication`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({
        is_published: isPublished,
      }),
    },
  );
}

export async function getAdminCategories(
  token: string,
  certificationId?: string,
): Promise<AdminCategory[]> {
  const query = certificationId
    ? `?certification_id=${encodeURIComponent(
        certificationId,
      )}`
    : "";

  const response =
    await apiRequest<AdminCategoryListResponse>(
      `/admin/categories${query}`,
      token,
      {
        method: "GET",
      },
    );

  return response.items;
}

export async function createAdminCategory(
  token: string,
  payload: AdminCategoryCreateRequest,
): Promise<AdminCategory> {
  return apiRequest<AdminCategory>(
    "/admin/categories",
    token,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function setAdminCategoryPublication(
  token: string,
  categoryId: string,
  isPublished: boolean,
): Promise<AdminCategory> {
  return apiRequest<AdminCategory>(
    `/admin/categories/${encodeURIComponent(
      categoryId,
    )}/publication`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({
        is_published: isPublished,
      }),
    },
  );
}

export async function getAdminQuestionCategories(
  token: string,
): Promise<PracticeCategory[]> {
  const categories =
    await getAdminCategories(token);

  return categories.map((category) => ({
    id: category.id,
    certification_id:
      category.certification_id,
    certification_name:
      category.certification_name,
    name: category.name,

    // The admin question form does not use learner
    // availability counts. Preserve the existing
    // PracticeCategory contract for that form.
    available_question_count: 0,
  }));
}