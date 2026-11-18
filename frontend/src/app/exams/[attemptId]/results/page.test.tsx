import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { cleanup, render, screen } from "@testing-library/react";

import ExamResultsPage from "./page";

const { mockUseParams, mockUseDemoSession } = vi.hoisted(
  () => ({
    mockUseParams: vi.fn(),
    mockUseDemoSession: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({
  useParams: mockUseParams,
}));

vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: mockUseDemoSession,
}));

vi.mock("@/features/exams/ExamResultsScreen", () => ({
  default: ({
    attemptId,
    accessToken,
  }: {
    attemptId: string;
    accessToken: string;
  }) => (
    <div
      data-testid="results-screen"
      data-attempt-id={attemptId}
      data-access-token={accessToken}
    />
  ),
}));

const attemptId = "11111111-1111-4111-8111-111111111111";

describe("ExamResultsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseParams.mockReturnValue({ attemptId });

    mockUseDemoSession.mockReturnValue({
      token: "test-token",
      ready: true,
      handleError: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders results with the authenticated attempt", () => {
    render(<ExamResultsPage />);

    const results = screen.getByTestId("results-screen");

    expect(results.getAttribute("data-attempt-id")).toBe(
      attemptId,
    );

    expect(results.getAttribute("data-access-token")).toBe(
      "test-token",
    );
  });

  it("does not fetch results without a token", () => {
    mockUseDemoSession.mockReturnValue({
      token: null,
      ready: true,
      handleError: vi.fn(),
    });

    render(<ExamResultsPage />);

    expect(screen.getByRole("status").textContent).toBe(
      "Checking session...",
    );

    expect(screen.queryByTestId("results-screen")).toBeNull();
  });

  it("rejects an invalid attempt ID", () => {
    mockUseParams.mockReturnValue({
      attemptId: "invalid-attempt-id",
    });

    render(<ExamResultsPage />);

    expect(screen.getByRole("alert").textContent).toBe(
      "Invalid exam attempt ID.",
    );

    expect(screen.queryByTestId("results-screen")).toBeNull();
  });
});
