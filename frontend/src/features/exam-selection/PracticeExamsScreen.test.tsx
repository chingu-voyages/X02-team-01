import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PracticeExamsScreen from "./PracticeExamsScreen";
import {
  getPublishedPracticeExams,
  startPublishedPracticeExam,
} from "@/lib/practice-exam-api";
import { ApiError } from "@/lib/api-client";
import type { PublishedPracticeExam } from "@/types/practice-exam-api.types";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

const mockHandleError = vi.fn();
let mockSession = {
  token: "token-123" as string | null,
  ready: true,
  handleError: mockHandleError,
};

vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => mockSession,
}));

vi.mock("@/lib/practice-exam-api", () => ({
  getPublishedPracticeExams: vi.fn(),
  startPublishedPracticeExam: vi.fn(),
}));

const mockedGetExams = vi.mocked(getPublishedPracticeExams);
const mockedStartExam = vi.mocked(startPublishedPracticeExam);

const sampleExams: PublishedPracticeExam[] = [
  {
    id: "exam-1",
    certification_id: "cert-agile",
    certification_name: "Agile Certification",
    category_id: "cat-1",
    category_name: "Fundamentals",
    name: "Agile Fundamentals",
    question_count: 25,
    available_question_count: 50,
  },
  {
    id: "exam-2",
    certification_id: "cert-scrum",
    certification_name: "Scrum Certification",
    category_id: "cat-2",
    category_name: "Roles",
    name: "Scrum Roles & Events",
    question_count: 30,
    available_question_count: 60,
  },
];

describe("PracticeExamsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = {
      token: "token-123",
      ready: true,
      handleError: mockHandleError,
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("renders session check message when auth is not ready", () => {
    mockSession = {
      token: null,
      ready: false,
      handleError: mockHandleError,
    };

    render(<PracticeExamsScreen />);
    expect(screen.getByRole("status").textContent).toBe("Checking session...");
    expect(mockedGetExams).not.toHaveBeenCalled();
  });

  it("loads exams, renders the hero and cards, and filters by certification", async () => {
    const user = userEvent.setup();
    mockedGetExams.mockResolvedValueOnce(sampleExams);

    render(<PracticeExamsScreen />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Agile Fundamentals" }),
      ).toBeTruthy();
    });

    expect(
      screen.getByRole("heading", { level: 1, name: "Select a practice exam" }),
    ).toBeTruthy();
    expect(screen.getByText("Recommended")).toBeTruthy();
    expect(screen.getByText("2 exams available")).toBeTruthy();

    await user.selectOptions(
      screen.getByLabelText("Certification or topic"),
      "cert-scrum",
    );

    expect(screen.queryByRole("heading", { name: "Agile Fundamentals" })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Scrum Roles & Events" }),
    ).toBeTruthy();
    expect(screen.getByText("1 exam available")).toBeTruthy();
  });

  it("starts an exam and navigates to the created attempt route", async () => {
    const user = userEvent.setup();
    mockedGetExams.mockResolvedValueOnce(sampleExams);
    mockedStartExam.mockResolvedValueOnce({
      attempt_id: "attempt-999",
    } as Awaited<ReturnType<typeof startPublishedPracticeExam>>);

    render(<PracticeExamsScreen />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Start exam — Agile Fundamentals" }),
      ).toBeTruthy();
    });

    await user.click(
      screen.getByRole("button", { name: "Start exam — Agile Fundamentals" }),
    );

    await waitFor(() => {
      expect(mockedStartExam).toHaveBeenCalledWith(
        "token-123",
        sampleExams[0],
      );
      expect(mockPush).toHaveBeenCalledWith("/exams/attempt-999");
    });
  });

  it("handles 409 ATTEMPT_IN_PROGRESS by offering continuation of the existing attempt", async () => {
    const user = userEvent.setup();
    const existingUuid = "123e4567-e89b-12d3-a456-426614174000";

    mockedGetExams.mockResolvedValueOnce(sampleExams);
    mockedStartExam.mockRejectedValueOnce(
      new ApiError(409, "Conflict", {
        code: "ATTEMPT_IN_PROGRESS",
        attempt_id: existingUuid,
      }),
    );

    render(<PracticeExamsScreen />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Start exam — Agile Fundamentals" }),
      ).toBeTruthy();
    });

    await user.click(
      screen.getByRole("button", { name: "Start exam — Agile Fundamentals" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "You already have an unfinished exam for this certification.",
      );
    });

    await user.click(
      screen.getByRole("button", { name: "Continue existing exam" }),
    );
    expect(mockPush).toHaveBeenCalledWith(`/exams/${existingUuid}`);
  });

  it("delegates 401 Unauthorized responses to handleError", async () => {
    const authError = new ApiError(401, "Unauthorized");
    mockedGetExams.mockRejectedValueOnce(authError);

    render(<PracticeExamsScreen />);

    await waitFor(() => {
      expect(mockHandleError).toHaveBeenCalledWith(authError);
    });
  });
});