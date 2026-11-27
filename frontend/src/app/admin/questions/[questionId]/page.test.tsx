import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminQuestionDetailPage from "./page";
import { getManagedQuestion } from "@/lib/admin-question-api";
import type { AdminQuestionDetail } from "@/types/admin-question-api.types";

const contributorToken = "header.eyJyb2xlIjoiY29udHJpYnV0b3IifQ.signature";
const { handleError, auth } = vi.hoisted(() => ({ handleError: vi.fn(), auth: { token: "" } }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ questionId: "33333333-3333-4333-8333-333333333333" }),
}));
vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({ token: auth.token, ready: true, handleError }),
}));
vi.mock("@/lib/admin-question-api", () => ({
  getManagedQuestion: vi.fn(),
  publishManagedQuestion: vi.fn(),
  rejectManagedQuestion: vi.fn(),
  retireManagedQuestion: vi.fn(),
  requestQuestionChanges: vi.fn(),
  startQuestionReview: vi.fn(),
  submitManagedQuestion: vi.fn(),
}));

const mockedGetQuestion = vi.mocked(getManagedQuestion);
const rejectedQuestion: AdminQuestionDetail = {
  question_id: "33333333-3333-4333-8333-333333333333",
  question_version_id: "44444444-4444-4444-8444-444444444444",
  version_number: 1,
  certification_id: "11111111-1111-4111-8111-111111111111",
  certification_name: "AWS Cloud Practitioner",
  category_id: "22222222-2222-4222-8222-222222222222",
  category_name: "Security",
  difficulty: "medium",
  question_text: "What is IAM?",
  question_type: "multiple_choice",
  allows_multiple_answers: false,
  explanation: "IAM manages access.",
  review_status: "rejected",
  publication_status: "inactive",
  review_note: "Please clarify why option B is incorrect.",
  is_flagged: false,
  created_by_id: "55555555-5555-4555-8555-555555555555",
  submitted_by_id: "55555555-5555-4555-8555-555555555555",
  last_updated: "2026-11-19T20:00:00Z",
  options: [
    { position: 1, option_text: "Identity and Access Management", is_correct: true },
    { position: 2, option_text: "Object storage", is_correct: false },
  ],
  expected_answer: null,
  images: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.token = contributorToken;
  mockedGetQuestion.mockResolvedValue(rejectedQuestion);
});
afterEach(cleanup);

describe("AdminQuestionDetailPage rejection feedback", () => {
  it("shows administrator feedback and explains that a rejected question is read-only", async () => {
    render(<AdminQuestionDetailPage />);
    expect(await screen.findByText("Administrator feedback")).toBeTruthy();
    expect(screen.getByText("Please clarify why option B is incorrect.")).toBeTruthy();
    expect(screen.getByText(/Rejected \/ inactive — retained as a read-only record/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve & Publish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit for Review" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    await waitFor(() => expect(mockedGetQuestion).toHaveBeenCalledWith(contributorToken, rejectedQuestion.question_id));
  });
});


describe("JHEP-207 question detail role integration", () => {
  it.each(["administrator", "contributor"] as const)("uses the signed-in %s role when the current user owns the draft", async (role) => {
    const payload = btoa(JSON.stringify({ role, sub: rejectedQuestion.created_by_id }));
    auth.token = `header.${payload}.signature`;
    mockedGetQuestion.mockResolvedValue({ ...rejectedQuestion, review_status: "pending", publication_status: "draft", review_note: null });
    render(<AdminQuestionDetailPage />);
    await screen.findByRole("heading", { name: /Question Details/ });
    expect(screen.getByRole("link", { name: "Edit" })).toBeTruthy();
    if (role === "administrator") {
      expect(screen.getByRole("button", { name: "Approve & Publish" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Submit for Review" })).toBeNull();
    } else {
      expect(screen.getByRole("button", { name: "Submit for Review" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Approve & Publish" })).toBeNull();
    }
  });
});
