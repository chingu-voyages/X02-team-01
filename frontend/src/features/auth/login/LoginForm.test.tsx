import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import LoginForm from "./LoginForm";

// Mock next/navigation router
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
}));

describe("LoginForm Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders email and password inputs and submit button", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
  });

  it("shows validation errors when submitting empty required fields", async () => {
    render(<LoginForm />);

    const submitButton = screen.getByRole("button", { name: /^sign in$/i });
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/email is required/i)).toBeInTheDocument();
      expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    });
  });

  it("submits valid credentials and redirects to /exams on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: "fake-jwt-token" }),
    });

    render(<LoginForm />);

    await userEvent.type(screen.getByLabelText(/email address/i), "learner@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "Str0ngEn0ugh1");

    const submitButton = screen.getByRole("button", { name: /^sign in$/i });
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v1/auth/login",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            email: "learner@example.com",
            password: "Str0ngEn0ugh1",
          }),
        })
      );
      expect(mockPush).toHaveBeenCalledWith("/exams");
    });
  });

  it("displays error message when login fails with invalid credentials", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: "Invalid email or password." }),
    });

    render(<LoginForm />);

    await userEvent.type(screen.getByLabelText(/email address/i), "wrong@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "WrongPassword");

    const submitButton = screen.getByRole("button", { name: /^sign in$/i });
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid email or password.");
      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});