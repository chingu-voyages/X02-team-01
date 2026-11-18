import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ForgotPasswordForm from "./ForgotPasswordForm";
import ResetPasswordForm from "./ResetPasswordForm";

const fetchMock = vi.fn();

afterEach(() => {
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

describe("ForgotPasswordForm (JHEP-124 AC1)", () => {
  it("shows the generic confirmation for any email", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        message:
          "If an account exists for that email, a password-reset link has been sent.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Email"), "whoever@example.com");
    await user.click(screen.getByText("Send reset link"));

    await waitFor(() => {
      expect(screen.getByText("Check your email")).toBeTruthy();
    });
    expect(
      screen.getByText(
        "If an account exists for that email, a password-reset link is on its way. It works once and expires in an hour.",
      ),
    ).toBeTruthy();
  });

  it("surfaces the rate-limit message without revealing anything", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ message: "Wait 60 seconds before requesting another reset link" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText("Email"), "whoever@example.com");
    await user.click(screen.getByText("Send reset link"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(
        screen.getByText("Wait 60 seconds before requesting another reset link"),
      ).toBeTruthy();
    });
  });
});

describe("ResetPasswordForm (JHEP-124 AC2/AC3)", () => {
  it("explains a missing token instead of rendering a form", () => {
    render(<ResetPasswordForm token="" />);

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Reset link missing")).toBeTruthy();
    expect(screen.queryByText("Choose a new password")).toBeNull();
  });

  it("rejects policy violations client-side before the request", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm token="some-token" />);

    await user.type(screen.getByLabelText("New password"), "weak");
    await user.type(screen.getByLabelText("Confirm new password"), "weak");
    await user.click(screen.getByText("Update password"));

    expect(
      screen.getByText("Password must contain at least 8 characters"),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits the token + new password and shows the confirmation", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: "Password updated." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ResetPasswordForm token="some-token" />);

    await user.type(screen.getByLabelText("New password"), "BrandNew123");
    await user.type(screen.getByLabelText("Confirm new password"), "BrandNew123");
    await user.click(screen.getByText("Update password"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/auth/reset-password",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            token: "some-token",
            new_password: "BrandNew123",
          }),
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText("Password updated")).toBeTruthy();
    });
    expect(screen.getByText("Sign in")).toBeTruthy();
  });

  it("surfaces the invalid/expired-link state from the backend", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        message: "This reset link is invalid",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ResetPasswordForm token="dead-token" />);

    await user.type(screen.getByLabelText("New password"), "BrandNew123");
    await user.type(screen.getByLabelText("Confirm new password"), "BrandNew123");
    await user.click(screen.getByText("Update password"));

    await waitFor(() => {
      expect(screen.getByText("This reset link is invalid")).toBeTruthy();
    });
  });
});
