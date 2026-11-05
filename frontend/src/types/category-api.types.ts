export interface PracticeCategory {
  id: string;
  certification_id: string;
  name: string;
  certification_name: string;
  available_question_count: number;
}

export interface CategoryListResponse {
  categories: PracticeCategory[];
}

export interface CategoryExamRequest {
  certification_id: string;
  category_id: string;
  question_count: number;
}