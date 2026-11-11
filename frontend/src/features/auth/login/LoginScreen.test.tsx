import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import LoginScreen from "./LoginScreen";

// Mock next/navigation router
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
}));

describe("LoginScreen Layout & Structure", () => {
  it("renders the main page header and subtitle", () => {
    render(<LoginScreen />);

    expect(screen.getByRole("heading", { name: /your practice workspace/i })).toBeInTheDocument();
    expect(screen.getByText(/sign in to access exams and retain your attempt history/i)).toBeInTheDocument();
  });

  it("renders the benefits card alongside the form", () => {
    render(<LoginScreen />);

    expect(screen.getByText(/practice, learn, repeat/i)).toBeInTheDocument();
    expect(screen.getByText(/practice from approved question sets/i)).toBeInTheDocument();
  });

  it("maintains proper form landmark structure", () => {
    render(<LoginScreen />);

    expect(screen.getByRole("textbox", { name: /email address/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
  });
});