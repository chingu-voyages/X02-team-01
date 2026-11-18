import { apiRequest } from "@/lib/api-client";

import type {
  CategoryExamRequest,
  CategoryListResponse,
  PracticeCategory,
} from "@/types/category-api.types";

import type { ExamCreatedResponse } from "@/types/exam-api.types";

export async function getAvailableCategories(
  token: string,
): Promise<PracticeCategory[]> {
  const response = await apiRequest<CategoryListResponse>(
    "/categories",
    token,
    {
      method: "GET",
    },
  );

  return response.categories;
}

export async function startCategoryExam(
  token: string,
  category: PracticeCategory,
  questionCount: number,
): Promise<ExamCreatedResponse> {
  const maximum = Math.min(category.available_question_count, 100);

  if (
    !Number.isInteger(questionCount) ||
    questionCount < 1 ||
    questionCount > maximum
  ) {
    throw new RangeError(
      `Question count must be between 1 and ${maximum}`,
    );
  }

  const payload: CategoryExamRequest = {
    certification_id: category.certification_id,
    category_id: category.id,
    question_count: questionCount,
  };

  return apiRequest<ExamCreatedResponse>(
    "/exams",
    token,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}