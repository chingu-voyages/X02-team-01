import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminPracticeExamsPage from "./page";
import { ApiError } from "@/lib/api-client";
import {
  getAdminCategories,
  getAdminCertifications,
} from "@/lib/admin-catalog-api";
import {
  createAdminPracticeExam,
  getAdminPracticeExam,
  getAdminPracticeExams,
  setAdminPracticeExamPublication,
} from "@/lib/admin-practice-exam-api";
import type { AdminPracticeExam } from "@/types/admin-practice-exam-api.types";

const auth = vi.hoisted(() => ({
  role: "administrator" as "administrator" | "contributor" | "learner",
  handleError: vi.fn(),
}));

vi.mock("@/features/auth/AuthProvider", () => ({
  useDemoSession: () => ({
    token: "admin-token",
    role: auth.role,
    ready: true,
    handleError: auth.handleError,
  }),
}));

vi.mock("@/lib/admin-catalog-api", () => ({
  getAdminCategories: vi.fn(),
  getAdminCertifications: vi.fn(),
}));

vi.mock("@/lib/admin-practice-exam-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-practice-exam-api")>();
  return {
    ...actual,
    getAdminPracticeExams: vi.fn(),
    getAdminPracticeExam: vi.fn(),
    createAdminPracticeExam: vi.fn(),
    setAdminPracticeExamPublication: vi.fn(),
  };
});

const certification = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Computer Science",
  code: "CS-100",
  passing_threshold_pct: 70,
  feedback_mode: "immediate" as const,
  is_published: true,
};

const category = {
  id: "33333333-3333-4333-8333-333333333333",
  certification_id: certification.id,
  certification_name: certification.name,
  name: "Science",
  is_published: true,
};

const readyExam: AdminPracticeExam = {
  id: "44444444-4444-4444-8444-444444444444",
  certification_id: certification.id,
  certification_name: certification.name,
  category_id: category.id,
  category_name: category.name,
  name: "Science practice",
  question_count: 2,
  status: "draft",
  readiness: {
    ready: true,
    required_question_count: 2,
    eligible_question_count: 5,
    issues: [],
  },
};

const blockedExam: AdminPracticeExam = {
  ...readyExam,
  id: "55555555-5555-4555-8555-555555555555",
  name: "Algebra practice",
  status: "draft",
  readiness: {
    ready: false,
    required_question_count: 8,
    eligible_question_count: 2,
    issues: [
      { code: "INSUFFICIENT_PUBLISHED_QUESTIONS", message: "Need 8 eligible published questions; only 2 available." },
    ],
  },
};

const publishedExam: AdminPracticeExam = {
  ...readyExam,
  id: "66666666-6666-4666-8666-666666666666",
  name: "Published practice",
  status: "published",
};

const mockGet = vi.mocked(getAdminPracticeExams);
const mockDetails = vi.mocked(getAdminPracticeExam);
const mockCreate = vi.mocked(createAdminPracticeExam);
const mockPublication = vi.mocked(setAdminPracticeExamPublication);
const mockCerts = vi.mocked(getAdminCertifications);
const mockCats = vi.mocked(getAdminCategories);

function setup(exams: AdminPracticeExam[] = [readyExam]) {
  mockGet.mockResolvedValue(exams);
  mockCerts.mockResolvedValue([certification]);
  mockCats.mockResolvedValue([category]);
}

beforeEach(() => {
  auth.role = "administrator";
  auth.handleError.mockReset();
  mockGet.mockReset();
  mockDetails.mockReset();
  mockCreate.mockReset();
  mockPublication.mockReset();
  mockCerts.mockReset();
  mockCats.mockReset();
  setup();
});

afterEach(cleanup);

describe("JHEP-126 administrator practice exam publishing UI", () => {
  it("loads exams and shows the configured count and readiness", async () => {
    render(<AdminPracticeExamsPage />);

    expect(await screen.findByRole("button", { name: "Manage Science practice" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Publication readiness" })).toBeTruthy();
    expect(screen.getByText("Ready to publish. The required configuration and eligible question pool are valid.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish exam" })).not.toHaveProperty("disabled", true);
    expect(mockGet).toHaveBeenCalledWith("admin-token");
    expect(mockCerts).toHaveBeenCalledWith("admin-token");
    expect(mockCats).toHaveBeenCalledWith("admin-token");
  });

  it("shows blockers and disables publishing", async () => {
    setup([blockedExam]);
    render(<AdminPracticeExamsPage />);

    expect(await screen.findByText("Need 8 eligible published questions; only 2 available.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish exam" })).toHaveProperty("disabled", true);
    expect(mockPublication).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation before publishing, then reflects the server result", async () => {
    mockPublication.mockResolvedValue({ ...readyExam, status: "published" });
    const user = userEvent.setup();
    render(<AdminPracticeExamsPage />);

    await screen.findByRole("button", { name: "Publish exam" });
    await user.click(screen.getByRole("button", { name: "Publish exam" }));
    expect(mockPublication).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Publish practice exam?")).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "Confirm publish" }));
    await waitFor(() => {
      expect(mockPublication).toHaveBeenCalledWith("admin-token", readyExam.id, true);
    });
    expect(await screen.findByText(/is now Published and available to learners/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unpublish exam" })).toBeTruthy();
  });

  it("can cancel a publication change without writing", async () => {
    const user = userEvent.setup();
    render(<AdminPracticeExamsPage />);

    await user.click(await screen.findByRole("button", { name: "Publish exam" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockPublication).not.toHaveBeenCalled();
  });

  it("supports Escape to dismiss a confirmation without publishing", async () => {
    const user = userEvent.setup();
    render(<AdminPracticeExamsPage />);

    await user.click(await screen.findByRole("button", { name: "Publish exam" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockPublication).not.toHaveBeenCalled();
  });

  it("unpublishes after confirmation and explains started-attempt policy", async () => {
    setup([publishedExam]);
    mockPublication.mockResolvedValue({ ...publishedExam, status: "unpublished" });
    const user = userEvent.setup();
    render(<AdminPracticeExamsPage />);

    await user.click(await screen.findByRole("button", { name: "Unpublish exam" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Started attempts can finish/)).toBeTruthy();
    expect(mockPublication).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Confirm unpublish" }));

    await waitFor(() => {
      expect(mockPublication).toHaveBeenCalledWith("admin-token", publishedExam.id, false);
    });
    expect(await screen.findByText(/New attempts are blocked/)).toBeTruthy();
  });

  it("reflects a fresh server readiness rejection instead of claiming success", async () => {
    const newerReadiness = { ...blockedExam.readiness };
    mockPublication.mockRejectedValue(
      new ApiError(409, "Conflict", {
        code: "PRACTICE_EXAM_NOT_READY",
        message: "Resolve the listed issues before publishing this exam.",
        readiness: newerReadiness,
      }),
    );
    const user = userEvent.setup();
    render(<AdminPracticeExamsPage />);

    await user.click(await screen.findByRole("button", { name: "Publish exam" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm publish" }));

    expect(await screen.findByText("Need 8 eligible published questions; only 2 available.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish exam" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/is now Published and available to learners/)).toBeNull();
  });

  it("creates a draft with a fixed count and selects its detail", async () => {
    setup([]);
    mockCreate.mockResolvedValue(readyExam);
    const user = userEvent.setup();
    render(<AdminPracticeExamsPage />);

    await user.click(await screen.findByRole("button", { name: "New exam" }));
    await user.type(screen.getByLabelText("Exam name"), "Science practice");
    await user.selectOptions(screen.getByLabelText("Category"), category.id);
    await user.clear(screen.getByLabelText("Question count (1–100)"));
    await user.type(screen.getByLabelText("Question count (1–100)"), "2");
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith("admin-token", {
        name: "Science practice",
        certification_id: certification.id,
        category_id: category.id,
        question_count: 2,
      });
    });
    expect(await screen.findByRole("button", { name: "Manage Science practice" })).toBeTruthy();
    expect(screen.getByText(/was created as a Draft/)).toBeTruthy();
    expect(mockPublication).not.toHaveBeenCalled();
  });

  it("refreshes exam readiness without publishing", async () => {
    setup([blockedExam]);
    mockDetails.mockResolvedValue({ ...blockedExam, readiness: readyExam.readiness });
    const user = userEvent.setup();
    render(<AdminPracticeExamsPage />);

    await user.click(await screen.findByRole("button", { name: "Recheck readiness" }));
    await waitFor(() => {
      expect(mockDetails).toHaveBeenCalledWith("admin-token", blockedExam.id);
    });
    expect(screen.getByRole("button", { name: "Publish exam" })).not.toHaveProperty("disabled", true);
    expect(mockPublication).not.toHaveBeenCalled();
  });

  it("filters by status without showing hidden records in the selected list", async () => {
    setup([readyExam, publishedExam]);
    const user = userEvent.setup();
    render(<AdminPracticeExamsPage />);
    await screen.findByRole("button", { name: "Manage Science practice" });

    await user.click(screen.getByRole("button", { name: "Published", pressed: false }));
    expect(screen.queryByRole("button", { name: "Manage Science practice" })).toBeNull();
    expect(screen.getByRole("button", { name: "Manage Published practice" })).toBeTruthy();
  });

  it("shows an error with a working retry when the first load fails", async () => {
    mockGet.mockRejectedValueOnce(new ApiError(503, "Backend unavailable"));
    const user = userEvent.setup();
    render(<AdminPracticeExamsPage />);
    expect(await screen.findByRole("alert")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Retry loading exams" }));
    expect(await screen.findByRole("button", { name: "Manage Science practice" })).toBeTruthy();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("routes an expired session through the shared session handler", async () => {
    mockGet.mockRejectedValueOnce(new ApiError(401, "Session expired"));
    render(<AdminPracticeExamsPage />);

    await waitFor(() => {
      expect(auth.handleError).toHaveBeenCalledWith(
        expect.objectContaining({ status: 401 }),
      );
    });
  });

  it("does not fetch or expose controls to non-administrators", () => {
    auth.role = "contributor";
    render(<AdminPracticeExamsPage />);

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New exam" })).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPublication).not.toHaveBeenCalled();
  });
});
