import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PracticeExamsScreen from "./PracticeExamsScreen";
import BrowseExamCard from "./BrowseExamCard";
import { getExamAvailabilityIssue, isValidExamCount } from "./examAvailability";
import { ApiError } from "@/lib/api-client";
import { getUnfinishedExamAttempts } from "@/lib/unfinished-exams-api";
import { getPublishedPracticeExams, startPublishedPracticeExam } from "@/lib/practice-exam-api";
import type { PublishedPracticeExam } from "@/types/practice-exam-api.types";

const { mockPush, mockHandleError } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockHandleError: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({ token: "learner-token", ready: true, handleError: mockHandleError }),
}));
vi.mock("@/lib/unfinished-exams-api", () => ({ getUnfinishedExamAttempts: vi.fn() }));
vi.mock("@/lib/practice-exam-api", () => ({
  getPublishedPracticeExams: vi.fn(),
  startPublishedPracticeExam: vi.fn(),
}));

const exam: PublishedPracticeExam = {
  id: "11111111-1111-4111-8111-111111111111",
  certification_id: "22222222-2222-4222-8222-222222222222",
  certification_name: "Computer Science",
  category_id: "66666666-6666-4666-8666-666666666666",
  category_name: "Fundamentals",
  name: "Science Practice",
  question_count: 10,
  available_question_count: 20,
};
const otherExam: PublishedPracticeExam = {
  ...exam,
  id: "44444444-4444-4444-8444-444444444444",
  name: "Advanced Practice",
};
const attemptId = "33333333-3333-4333-8333-333333333333";
const mockCatalog = vi.mocked(getPublishedPracticeExams);
const mockStart = vi.mocked(startPublishedPracticeExam);

function startButton(item = exam) {
  return screen.getByRole("button", { name: `Start exam — ${item.name}` });
}

function card(item = exam) {
  return within(screen.getByRole("article", { name: item.name }));
}

async function openCatalog() {
  const user = userEvent.setup();
  render(<PracticeExamsScreen />);
  await screen.findByRole("article", { name: exam.name });
  return user;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getUnfinishedExamAttempts).mockResolvedValue([]);
  mockCatalog.mockResolvedValue([exam]);
  mockStart.mockResolvedValue({
    attempt_id: attemptId,
    certification_id: exam.certification_id,
    status: "in_progress",
    question_count: exam.question_count,
    questions: [],
  });
});

afterEach(cleanup);

describe("JHEP-107 learner exam configuration and error recovery", () => {
  it.each([null, undefined, 0, -1, 101, 2.5, "10", NaN, Infinity])(
    "rejects an invalid configured count (%s)",
    (count) => {
      expect(isValidExamCount(count)).toBe(false);
    },
  );

  it.each([1, 100])("accepts count boundary %s", (count) => {
    expect(isValidExamCount(count)).toBe(true);
  });

  it("does not send a start request for an invalid configured count", async () => {
    mockCatalog.mockResolvedValue([{ ...exam, question_count: 0 }]);
    const user = await openCatalog();
    expect(card().getByText("Question count unavailable")).toBeTruthy();
    expect(card().getByText("Unavailable")).toBeTruthy();
    expect(startButton().matches(":disabled")).toBe(true);
    await user.click(startButton());
    expect(mockStart).not.toHaveBeenCalled();
    expect(card().getByRole("button", { name: "Reload exams" })).toBeTruthy();
  });

  it("fails closed if the reported question pool is missing or invalid", () => {
    expect(getExamAvailabilityIssue({ ...exam, available_question_count: NaN })).toMatch(/could not be verified/);
    expect(getExamAvailabilityIssue({ ...exam, available_question_count: -1 })).toMatch(/could not be verified/);
  });

  it("blocks a start if the returned pool cannot supply the configured count", async () => {
    mockCatalog.mockResolvedValue([{ ...exam, available_question_count: 4 }]);
    const user = await openCatalog();
    expect(card().getByText(/not enough approved questions/)).toBeTruthy();
    expect(startButton().matches(":disabled")).toBe(true);
    expect(screen.getByText("0 exams available")).toBeTruthy();
    await user.click(startButton());
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("refreshes a stale configuration before sending the updated count", async () => {
    const updatedExam = { ...exam, question_count: 15 };
    mockCatalog.mockResolvedValueOnce([exam, otherExam]).mockResolvedValueOnce([updatedExam, otherExam]);
    mockStart.mockRejectedValueOnce(new ApiError(409, "Conflict", {
      code: "PRACTICE_EXAM_COUNT_MISMATCH", expected: 15, received: 10,
    }));
    const user = await openCatalog();
    await user.click(startButton());
    expect((await card().findByRole("alert")).textContent).toMatch(/exam length has changed/);
    expect(startButton().matches(":disabled")).toBe(true);
    expect(startButton(otherExam).matches(":disabled")).toBe(false);
    expect(card(otherExam).queryByRole("alert")).toBeNull();
    await user.click(startButton());
    expect(mockStart).toHaveBeenCalledTimes(1);
    await user.click(card().getByRole("button", { name: "Reload exams" }));
    await screen.findByRole("article", { name: exam.name });
    expect(card().getByText("15")).toBeTruthy();
    expect(card().queryByRole("alert")).toBeNull();
    expect(mockStart).toHaveBeenCalledTimes(1); // no automatic attempt creation
    mockStart.mockResolvedValueOnce({
      attempt_id: attemptId,
      certification_id: exam.certification_id,
      status: "in_progress",
      question_count: 15,
      questions: [],
    });
    await user.click(startButton());
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/exams/${attemptId}`));
    expect(mockStart).toHaveBeenLastCalledWith("learner-token", updatedExam);
  });

  it("explains an insufficient-pool conflict next to the affected exam", async () => {
    mockCatalog.mockResolvedValue([exam, otherExam]);
    mockStart.mockRejectedValueOnce(new ApiError(409, "Conflict", {
      code: "INSUFFICIENT_QUESTIONS", requested: 10, available: 4,
    }));
    const user = await openCatalog();
    await user.click(startButton());
    expect((await card().findByRole("alert")).textContent).toMatch(/no longer enough approved questions/);
    expect(startButton().matches(":disabled")).toBe(true);
    expect(startButton(otherExam).matches(":disabled")).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("keeps a failed network request recoverable without losing the catalog", async () => {
    mockStart.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const user = await openCatalog();
    await user.click(startButton());
    expect((await card().findByRole("alert")).textContent).toMatch(/check your connection and try again/i);
    expect(startButton().matches(":disabled")).toBe(false);
    await user.click(startButton());
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/exams/${attemptId}`));
    expect(mockStart).toHaveBeenCalledTimes(2);
    expect(mockCatalog).toHaveBeenCalledTimes(1);
  });

  it("clears a certification filter when its last available exam disappears on refresh", async () => {
    const otherCertification = { ...otherExam, certification_id: "other-cert", certification_name: "Scrum" };
    mockCatalog.mockResolvedValueOnce([exam, otherCertification]).mockResolvedValueOnce([otherCertification]);
    mockStart.mockRejectedValueOnce(new ApiError(409, "Conflict", { code: "PRACTICE_EXAM_UNAVAILABLE" }));
    const user = await openCatalog();
    await user.selectOptions(screen.getByLabelText("Certification or topic"), exam.certification_id);
    await user.click(startButton());
    await card().findByRole("alert");
    await user.click(card().getByRole("button", { name: "Reload exams" }));
    await screen.findByRole("article", { name: otherCertification.name });
    expect((screen.getByLabelText("Certification or topic") as HTMLSelectElement).value).toBe("all");
    expect(screen.queryByRole("article", { name: exam.name })).toBeNull();
  });

  it("preserves stale-configuration warnings when changing filters", async () => {
    const otherCertification = { ...otherExam, certification_id: "other-cert", certification_name: "Scrum" };
    mockCatalog.mockResolvedValue([exam, otherCertification]);
    mockStart.mockRejectedValueOnce(new ApiError(409, "Conflict", { code: "PRACTICE_EXAM_UNAVAILABLE" }));
    const user = await openCatalog();
    await user.click(startButton());
    await card().findByRole("alert");
    await user.selectOptions(screen.getByLabelText("Certification or topic"), otherCertification.certification_id);
    await user.click(screen.getByRole("button", { name: /All categories/ }));
    expect(card().getByRole("alert")).toBeTruthy();
    expect(startButton().matches(":disabled")).toBe(true);
  });

  it("clarifies the configured count when offering an existing attempt", async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onStart = vi.fn();
    render(<BrowseExamCard exam={{ ...exam, question_count: 15 }} variant="standard" isStarting={false} onContinueExam={onContinue} onStartExam={onStart} />);
    expect(screen.getByText("15")).toBeTruthy();
    expect(screen.getByText("Current length for new attempts")).toBeTruthy();
    expect(screen.getByText(/existing attempt keeps its original question count and order/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: `Continue exam — ${exam.name}` }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });


  it("consumes only the selected resume hint when continuing an attempt", async () => {
    const siblingAttemptId = "55555555-5555-4555-8555-555555555555";
    mockCatalog.mockResolvedValue([exam, otherExam]);
    mockStart
      .mockRejectedValueOnce(new ApiError(409, "Conflict", {
        code: "ATTEMPT_IN_PROGRESS", attempt_id: attemptId,
      }))
      .mockRejectedValueOnce(new ApiError(409, "Conflict", {
        code: "ATTEMPT_IN_PROGRESS", attempt_id: siblingAttemptId,
      }));
    const user = await openCatalog();
    await user.click(startButton());
    const resume = await card().findByRole("button", { name: `Continue exam — ${exam.name}` });
    await user.click(startButton(otherExam));
    await card(otherExam).findByRole("button", { name: `Continue exam — ${otherExam.name}` });

    await user.click(resume);
    expect(mockPush).toHaveBeenCalledWith(`/exams/${attemptId}`);
    expect(startButton().matches(":disabled")).toBe(false);
    expect(card(otherExam).getByRole("button", { name: `Continue exam — ${otherExam.name}` })).toBeTruthy();
    expect(mockStart).toHaveBeenCalledTimes(2);
  });

  it("clears old resume hints on cached route reactivation before starting with the refreshed count", async () => {
    const updated = { ...exam, question_count: 15 };
    const retakeId = "66666666-6666-4666-8666-666666666666";
    mockCatalog.mockResolvedValueOnce([exam]).mockResolvedValueOnce([updated]);
    mockStart.mockRejectedValueOnce(new ApiError(409, "Conflict", {
      code: "ATTEMPT_IN_PROGRESS", attempt_id: attemptId,
    }));
    const user = userEvent.setup();
    const { rerender } = render(
      <Activity mode="visible"><PracticeExamsScreen /></Activity>,
    );
    await user.click(await screen.findByRole("button", { name: `Start exam — ${exam.name}` }));
    await card().findByRole("button", { name: `Continue exam — ${exam.name}` });

    // Simulate Next.js hiding a route without unmounting its React state.
    rerender(<Activity mode="hidden"><PracticeExamsScreen /></Activity>);
    rerender(<Activity mode="visible"><PracticeExamsScreen /></Activity>);
    await waitFor(() => {
      expect(mockCatalog).toHaveBeenCalledTimes(2);
      expect(card().getByText("15")).toBeTruthy();
      expect(startButton().matches(":disabled")).toBe(false);
    });
    expect(card().queryByRole("button", { name: `Continue exam — ${exam.name}` })).toBeNull();

    mockStart.mockResolvedValueOnce({
      attempt_id: retakeId,
      certification_id: exam.certification_id,
      status: "in_progress",
      question_count: 15,
      questions: [],
    });
    await user.click(startButton());
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/exams/${retakeId}`));
    expect(mockStart).toHaveBeenLastCalledWith("learner-token", updated);
  });

  it("can rediscover a still-unfinished attempt after consuming its resume hint", async () => {
    const conflict = new ApiError(409, "Conflict", {
      code: "ATTEMPT_IN_PROGRESS", attempt_id: attemptId,
    });
    mockStart.mockRejectedValueOnce(conflict).mockRejectedValueOnce(conflict);
    const user = await openCatalog();
    await user.click(startButton());
    await user.click(await card().findByRole("button", { name: `Continue exam — ${exam.name}` }));
    await user.click(startButton());
    expect(await card().findByRole("button", { name: `Continue exam — ${exam.name}` })).toBeTruthy();
    expect(mockStart).toHaveBeenCalledTimes(2);
    expect(mockPush.mock.calls).toEqual([[`/exams/${attemptId}`]]);
  });
});
