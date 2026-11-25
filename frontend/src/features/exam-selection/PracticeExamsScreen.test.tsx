import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PracticeExamsScreen from "./PracticeExamsScreen";
import {
  getPublishedPracticeExams,
  startPublishedPracticeExam,
} from "@/lib/practice-exam-api";
import { ApiError } from "@/lib/api-client";
import type { ExamCreatedResponse } from "@/types/exam-api.types";
import type { PublishedPracticeExam } from "@/types/practice-exam-api.types";

const { mockPush, mockHandleError } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockHandleError: vi.fn(),
}));

let mockSession = {
  token: "demo-token" as string | null,
  ready: true,
  handleError: mockHandleError,
};

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => mockSession,
}));
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
  question_count: 3,
  available_question_count: 10,
};
const otherExam: PublishedPracticeExam = {
  ...exam,
  id: "44444444-4444-4444-8444-444444444444",
  name: "Advanced Science Practice",
};
const differentCert: PublishedPracticeExam = {
  ...exam,
  id: "99999999-9999-4999-8999-999999999999",
  certification_id: "cert-other",
  certification_name: "Scrum Certification",
  category_id: "cat-other",
  category_name: "Roles",
  name: "Scrum Roles & Events",
};
const createdAttemptId = "33333333-3333-4333-8333-333333333333";
const existingAttemptId = "77777777-7777-4777-8777-777777777777";
const otherAttemptId = "88888888-8888-4888-8888-888888888888";
const mockedGet = vi.mocked(getPublishedPracticeExams);
const mockedStart = vi.mocked(startPublishedPracticeExam);

function conflict(attemptId: string) {
  return new ApiError(409, "Conflict", {
    code: "ATTEMPT_IN_PROGRESS",
    attempt_id: attemptId,
  });
}

function startButton(item: PublishedPracticeExam) {
  return screen.getByRole("button", { name: `Start exam — ${item.name}` });
}

function resumeButton(item: PublishedPracticeExam) {
  return screen.getByRole("button", { name: `Continue exam — ${item.name}` });
}

async function startFirstExam() {
  const user = userEvent.setup();
  render(<PracticeExamsScreen />);
  await user.click(
    await screen.findByRole("button", { name: `Start exam — ${exam.name}` }),
  );
  return user;
}

describe("PracticeExamsScreen — published exam selection and isolation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSession = { token: "demo-token", ready: true, handleError: mockHandleError };
    mockedGet.mockResolvedValue([exam]);
    mockedStart.mockResolvedValue({
      attempt_id: createdAttemptId,
      certification_id: exam.certification_id,
      status: "in_progress",
      question_count: 3,
      questions: [],
    });
  });

  afterEach(() => cleanup());

  it("renders the session check message before auth is ready", () => {
    mockSession = { token: null, ready: false, handleError: mockHandleError };
    render(<PracticeExamsScreen />);
    expect(screen.getByRole("status").textContent).toBe("Checking session...");
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("uses the published catalog and displays the redesigned hero and cards", async () => {
    render(<PracticeExamsScreen />);
    const card = await screen.findByRole("article", { name: exam.name });
    expect(mockedGet).toHaveBeenCalledWith("demo-token");
    expect(screen.getByRole("heading", { level: 1, name: "Select a practice exam" })).toBeTruthy();
    expect(within(card).getByText("Recommended")).toBeTruthy();
    expect(within(card).getByText("3")).toBeTruthy();
    expect(within(card).getByText("questions")).toBeTruthy();
  });

  it("filters cards and counts by certification", async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue([exam, differentCert]);
    render(<PracticeExamsScreen />);
    await screen.findByRole("article", { name: exam.name });
    expect(screen.getByText("2 exams available")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Certification or topic"), differentCert.certification_id);
    expect(screen.queryByRole("article", { name: exam.name })).toBeNull();
    expect(screen.getByRole("article", { name: differentCert.name })).toBeTruthy();
    expect(screen.getByText("1 exam available")).toBeTruthy();
  });

  it("has no learner-editable question count", async () => {
    render(<PracticeExamsScreen />);
    await screen.findByRole("article", { name: exam.name });
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("starts the configured exam then navigates", async () => {
    await startFirstExam();
    await waitFor(() => {
      expect(mockedStart).toHaveBeenCalledWith("demo-token", exam);
      expect(mockPush).toHaveBeenCalledWith(`/exams/${createdAttemptId}`);
    });
  });

  it("shows the empty state when no exams are published", async () => {
    mockedGet.mockResolvedValue([]);
    render(<PracticeExamsScreen />);
    expect(await screen.findByText("No published practice exams are currently available.")).toBeTruthy();
  });

  it("handles catalog expiration using the shared session provider", async () => {
    const error = new ApiError(401, "Session expired");
    mockedGet.mockRejectedValue(error);
    render(<PracticeExamsScreen />);
    await waitFor(() => expect(mockHandleError).toHaveBeenCalledWith(error));
  });

  it("handles start expiration using the shared session provider", async () => {
    const error = new ApiError(401, "Session expired");
    mockedStart.mockRejectedValueOnce(error);
    await startFirstExam();
    await waitFor(() => expect(mockHandleError).toHaveBeenCalledWith(error));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("shows catalog failures with a retry option", async () => {
    mockedGet.mockRejectedValueOnce(new ApiError(503, "Unavailable"));
    const user = userEvent.setup();
    render(<PracticeExamsScreen />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry loading practice exams" }));
    expect(await screen.findByRole("article", { name: exam.name })).toBeTruthy();
  });

  it("offers continuation on the exact exam card, not a global conflict alert", async () => {
    mockedGet.mockResolvedValue([exam, otherExam]);
    mockedStart.mockRejectedValueOnce(conflict(existingAttemptId));
    const user = await startFirstExam();
    expect(await screen.findByText(`You have an unfinished attempt for ${exam.name}.`)).toBeTruthy();
    const card = screen.getByRole("article", { name: exam.name });
    expect(within(card).getByText("In progress")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(card).queryByRole("button", { name: `Start exam — ${exam.name}` })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reload exams" })).toBeNull();
    expect(startButton(otherExam).matches(":disabled")).toBe(false);
    await user.click(resumeButton(exam));
    expect(mockPush).toHaveBeenCalledWith(`/exams/${existingAttemptId}`);
    expect(mockedStart).toHaveBeenCalledTimes(1);
  });

  it("does not navigate to unsafe resume IDs", async () => {
    mockedStart.mockRejectedValueOnce(conflict("//unsafe.example/path"));
    await startFirstExam();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Continue exam/ })).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("reports stale or unpublished exams and reloads without resume controls", async () => {
    mockedStart.mockRejectedValueOnce(new ApiError(409, "Conflict", { code: "PRACTICE_EXAM_UNAVAILABLE" }));
    const user = await startFirstExam();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Continue exam/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Reload exams" }));
    expect(await screen.findByRole("button", { name: `Start exam — ${exam.name}` })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it("can start a different exam while a sibling exam is unfinished", async () => {
    mockedGet.mockResolvedValue([exam, otherExam]);
    mockedStart.mockRejectedValueOnce(conflict(existingAttemptId));
    const user = await startFirstExam();
    expect(await screen.findByRole("button", { name: `Continue exam — ${exam.name}` })).toBeTruthy();
    await user.click(startButton(otherExam));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/exams/${createdAttemptId}`));
    expect(mockedStart).toHaveBeenLastCalledWith("demo-token", otherExam);
    expect(mockPush).not.toHaveBeenCalledWith(`/exams/${existingAttemptId}`);
  });

  it("keeps distinct resume IDs for exams with identical category and count", async () => {
    mockedGet.mockResolvedValue([exam, otherExam]);
    mockedStart.mockRejectedValueOnce(conflict(existingAttemptId)).mockRejectedValueOnce(conflict(otherAttemptId));
    const user = await startFirstExam();
    await screen.findByRole("button", { name: `Continue exam — ${exam.name}` });
    await user.click(startButton(otherExam));
    await screen.findByRole("button", { name: `Continue exam — ${otherExam.name}` });
    await user.click(resumeButton(otherExam));
    await user.click(resumeButton(exam));
    expect(mockPush.mock.calls).toEqual([[`/exams/${otherAttemptId}`], [`/exams/${existingAttemptId}`]]);
    expect(mockedStart).toHaveBeenCalledTimes(2);
  });

  it("blocks other starts and filters until a pending request settles", async () => {
    mockedGet.mockResolvedValue([exam, otherExam]);
    let rejectStart!: (reason: unknown) => void;
    mockedStart.mockImplementationOnce(() => new Promise<ExamCreatedResponse>((_resolve, reject) => {
      rejectStart = reject;
    }));
    const user = await startFirstExam();
    expect(startButton(exam).matches(":disabled")).toBe(true);
    expect(startButton(otherExam).matches(":disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /All categories/i }).matches(":disabled")).toBe(true);
    expect(screen.getByLabelText("Certification or topic").matches(":disabled")).toBe(true);
    await user.click(startButton(otherExam));
    expect(mockedStart).toHaveBeenCalledTimes(1);
    await act(async () => rejectStart(conflict(existingAttemptId)));
    await screen.findByRole("button", { name: `Continue exam — ${exam.name}` });
    expect(startButton(otherExam).matches(":disabled")).toBe(false);
    expect(screen.getByLabelText("Certification or topic").matches(":disabled")).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("retains the correct resume link through certification filtering", async () => {
    mockedGet.mockResolvedValue([exam, differentCert]);
    mockedStart.mockRejectedValueOnce(conflict(existingAttemptId));
    const user = await startFirstExam();
    await screen.findByRole("button", { name: `Continue exam — ${exam.name}` });
    await user.selectOptions(screen.getByLabelText("Certification or topic"), differentCert.certification_id);
    expect(screen.queryByRole("button", { name: /Continue exam/ })).toBeNull();
    expect(startButton(differentCert)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /All categories/i }));
    expect(resumeButton(exam)).toBeTruthy();
    await user.click(resumeButton(exam));
    expect(mockPush).toHaveBeenCalledWith(`/exams/${existingAttemptId}`);
    expect(mockedStart).toHaveBeenCalledTimes(1);
  });

  it("does not expose another session's cached resume link", async () => {
    const user = userEvent.setup();
    mockedStart.mockRejectedValueOnce(conflict(existingAttemptId));
    const { rerender } = render(<PracticeExamsScreen />);
    await user.click(await screen.findByRole("button", { name: `Start exam — ${exam.name}` }));
    await screen.findByRole("button", { name: `Continue exam — ${exam.name}` });
    mockSession = { ...mockSession, token: "other-token" };
    rerender(<PracticeExamsScreen />);
    await waitFor(() => expect(mockedGet).toHaveBeenLastCalledWith("other-token"));
    expect(screen.queryByRole("button", { name: /Continue exam/ })).toBeNull();
    expect(startButton(exam)).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
