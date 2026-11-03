
import type { ExamResultsResponse } from "@/types/exam-api.types";

export async function getExamResults(
  attemptId: string,
  accessToken: string,
): Promise<ExamResultsResponse> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  if (!apiUrl) {
    throw new Error("API URL is not configured.");
  }

  const response = await fetch(
    `${apiUrl.replace(/\/$/, "")}/exams/${encodeURIComponent(attemptId)}/results`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to retrieve exam results (${response.status})`,
    );
  }

  return (await response.json()) as ExamResultsResponse;
}
