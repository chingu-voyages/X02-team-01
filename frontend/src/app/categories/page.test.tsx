import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import userEvent from "@testing-library/user-event";

import CategoriesPage from "./page";
import {
  getAvailableCategories,
  startCategoryExam,
} from "@/lib/category-api";

import { ApiError } from "@/lib/api-client";

const { mockPush, mockHandleError } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockHandleError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({
    token: "demo-token",
    ready: true,
    handleError: mockHandleError,
  }),
}));

vi.mock("@/lib/category-api", () => ({
  getAvailableCategories: vi.fn(),
  startCategoryExam: vi.fn(),
}));

const category = {
  id: "11111111-1111-4111-8111-111111111111",
  certification_id:
    "22222222-2222-4222-8222-222222222222",
  name: "Agile Fundamentals",
  certification_name: "Agile Demo",
  available_question_count: 3,
};

const secondCategory = {
  ...category,
  id: "66666666-6666-4666-8666-666666666666",
  name: "Scrum Fundamentals",
};

const existingAttemptId =
  "77777777-7777-4777-8777-777777777777";

async function selectAndStart() {
  const user = userEvent.setup();

  render(<CategoriesPage />);

  await user.click(
    await screen.findByRole("button", {
      name: /View exam.*Agile Fundamentals/i,
    }),
  );

  await user.click(
    screen.getByRole("button", {
      name: "Start Exam",
    }),
  );

  return user;
}

describe("CategoriesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getAvailableCategories).mockResolvedValue([
      category,
    ]);

    vi.mocked(startCategoryExam).mockResolvedValue({
      attempt_id:
        "33333333-3333-4333-8333-333333333333",
      certification_id: category.certification_id,
      status: "in_progress",
      question_count: 3,
      questions: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("loads categories from the backend", async () => {
    render(<CategoriesPage />);

    expect(
      await screen.findByText("Agile Fundamentals"),
    ).toBeTruthy();

    expect(getAvailableCategories).toHaveBeenCalledWith(
      "demo-token",
    );
  });

  it("shows an empty state", async () => {
    vi.mocked(getAvailableCategories).mockResolvedValue([]);

    render(<CategoriesPage />);

    expect(
      await screen.findByText(
        "No practice categories are currently available.",
      ),
    ).toBeTruthy();
  });

  it("starts an exam and navigates to the attempt", async () => {
    await selectAndStart();

    await waitFor(() => {
      expect(startCategoryExam).toHaveBeenCalledWith(
        "demo-token",
        category,
        3,
      );

      expect(mockPush).toHaveBeenCalledWith(
        "/exams/33333333-3333-4333-8333-333333333333",
      );
    });
  });

  it("handles expired authentication", async () => {
    vi.mocked(getAvailableCategories).mockRejectedValue(
      new ApiError(401, "Session expired"),
    );

    render(<CategoriesPage />);

    await waitFor(() => {
      expect(mockHandleError).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 401,
        }),
      );
    });
  });

  it("shows an API loading error", async () => {
    vi.mocked(getAvailableCategories).mockRejectedValue(
      new ApiError(503, "Service unavailable"),
    );

    render(<CategoriesPage />);

    expect(
      await screen.findByRole("alert"),
    ).toBeTruthy();

    expect(
      screen.getByRole("button", {
        name: "Retry loading categories",
      }),
    ).toBeTruthy();
  });

  it("offers recovery when an exam is already in progress", async () => {
    vi.mocked(startCategoryExam).mockRejectedValueOnce(
      new ApiError(409, "Conflict", {
        code: "ATTEMPT_IN_PROGRESS",
        attempt_id: existingAttemptId,
      }),
    );

    const user = await selectAndStart();

    expect(
      await screen.findByRole("alert"),
    ).toBeTruthy();

    await user.click(
      screen.getByRole("button", {
        name: "Continue existing exam",
      }),
    );

    expect(mockPush).toHaveBeenCalledWith(
      `/exams/${existingAttemptId}`,
    );
  });

  it("does not offer recovery for other 409 errors", async () => {
    vi.mocked(startCategoryExam).mockRejectedValueOnce(
      new ApiError(409, "Conflict", {
        code: "INSUFFICIENT_QUESTIONS",
        requested: 3,
        available: 2,
      }),
    );

    await selectAndStart();

    expect(
      await screen.findByRole("alert"),
    ).toBeTruthy();

    expect(
      screen.queryByRole("button", {
        name: "Continue existing exam",
      }),
    ).toBeNull();
  });

  it("rejects an invalid recovered attempt ID", async () => {
    vi.mocked(startCategoryExam).mockRejectedValueOnce(
      new ApiError(409, "Conflict", {
        code: "ATTEMPT_IN_PROGRESS",
        attempt_id: "//untrusted.example/path",
      }),
    );

    await selectAndStart();

    expect(
      await screen.findByRole("alert"),
    ).toBeTruthy();

    expect(
      screen.queryByRole("button", {
        name: "Continue existing exam",
      }),
    ).toBeNull();
  });

  it("clears recovery when another category is selected", async () => {
    vi.mocked(getAvailableCategories).mockResolvedValue([
      category,
      secondCategory,
    ]);

    vi.mocked(startCategoryExam).mockRejectedValueOnce(
      new ApiError(409, "Conflict", {
        code: "ATTEMPT_IN_PROGRESS",
        attempt_id: existingAttemptId,
      }),
    );

    const user = await selectAndStart();

    expect(
      await screen.findByRole("button", {
        name: "Continue existing exam",
      }),
    ).toBeTruthy();

    await user.click(
      screen.getByRole("button", {
        name: /View exam.*Scrum Fundamentals/i,
      }),
    );

    expect(
      screen.queryByRole("button", {
        name: "Continue existing exam",
      }),
    ).toBeNull();
  });
});
