import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import CategoriesPage from "./page";

vi.mock("@/features/exams/PracticeExamsScreen", () => ({
  default: () => <div data-testid="practice-exams-screen" />,
}));

describe("CategoriesPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders PracticeExamsScreen", () => {
    render(<CategoriesPage />);

    expect(screen.getByTestId("practice-exams-screen")).toBeTruthy();
  });
});