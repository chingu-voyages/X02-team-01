import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import RegisterScreen from "./RegisterScreen";

describe("RegisterScreen Form Logic", () => {
  it("renders all registration fields and submit button", () => {
    render(<RegisterScreen />);

    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/create password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create account/i }),
    ).toBeInTheDocument();
  });

  it("updates password strength indicator as user types", async () => {
    render(<RegisterScreen />);

    const passwordInput = screen.getByLabelText(/create password/i);
    await userEvent.type(passwordInput, "Abc123xyz!");

    // Verify strength indicator text appears
    expect(screen.getByText(/weak|fair|good|strong/i)).toBeInTheDocument();
  });

  it("triggers validation errors when submitting empty required fields", async () => {
    render(<RegisterScreen />);

    const submitButton = screen.getByRole("button", {
      name: /create account/i,
    });
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getAllByText(/required|invalid|match/i).length,
      ).toBeGreaterThan(0);
    });
  });
});
