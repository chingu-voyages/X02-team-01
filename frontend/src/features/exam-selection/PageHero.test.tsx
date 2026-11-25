import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import PageHero from "./PageHero";

describe("PageHero", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the default eyebrow, h1 title, and description", () => {
    render(
      <PageHero
        title="Select a practice exam"
        description="Choose a certification or category."
      />,
    );

    expect(screen.getByText("Practice exams")).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 1, name: "Select a practice exam" }),
    ).toBeTruthy();
    expect(screen.getByText("Choose a certification or category.")).toBeTruthy();
  });

  it("renders a custom eyebrow when provided", () => {
    render(
      <PageHero
        eyebrow="Certification catalog"
        title="Browse exams"
        description="Start any published exam."
      />,
    );

    expect(screen.getByText("Certification catalog")).toBeTruthy();
    expect(screen.queryByText("Practice exams")).toBeNull();
  });
});