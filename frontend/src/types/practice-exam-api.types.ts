/** Learner-visible catalog entry. Draft and unpublished exams are never sent. */
export interface PublishedPracticeExam {
  id: string;
  certification_id: string;
  certification_name: string;
  category_id: string;
  category_name: string;
  name: string;
  question_count: number;
  available_question_count: number;
}

export interface PublishedPracticeExamListResponse {
  exams: PublishedPracticeExam[];
}
