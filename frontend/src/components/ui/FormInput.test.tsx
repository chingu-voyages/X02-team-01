import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import FormInput from "./FormInput";

describe("FormInput", () => {
  it("renders the label and input correctly", () => {
    render(<FormInput label="Email address" name="email" />);

    const input = screen.getByRole("textbox", { name: /email address/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("name", "email");
  });

  it("handles error states and ARIA attributes when an error is present", () => {
    render(
      <FormInput
        label="Password"
        name="password"
        type="password"
        error="At least 8 characters required"
      />,
    );

    const input = screen.getByLabelText(/password/i);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "password-error");

    const errorMessage = screen.getByText("At least 8 characters required");
    expect(errorMessage).toBeInTheDocument();
    expect(errorMessage).toHaveAttribute("id", "password-error");
  });

  it("does not apply error ARIA attributes when there is no error", () => {
    render(<FormInput label="Full name" name="fullName" />);

    const input = screen.getByRole("textbox", { name: /full name/i });
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("calls onChange handler when user types", async () => {
    const handleChange = vi.fn();
    render(
      <FormInput label="Full name" name="fullName" onChange={handleChange} />,
    );

    const input = screen.getByRole("textbox", { name: /full name/i });
    await userEvent.type(input, "Jane Doe");

    expect(handleChange).toHaveBeenCalled();
  });
});


describe("password visibility toggle (JHEP-124)", () => {
  it("keeps the field hidden until the eye button is clicked", () => {
    render(
      <FormInput label="Password" name="password" type="password" passwordToggle />,
    );

    const input = screen.getByLabelText(/^password$/i);
    expect(input).toHaveAttribute("type", "password");

    const toggle = screen.getByRole("button", { name: /show password/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(input).not.toHaveAttribute("type", "text");
  });

  it("reveals the password on click and hides it again", async () => {
    const user = userEvent.setup();
    render(
      <FormInput label="Password" name="password" type="password" passwordToggle />,
    );

    const toggle = screen.getByRole("button", { name: /show password/i });
    await user.click(toggle);

    const revealed = screen.getByLabelText(/^password$/i);
    expect(revealed).toHaveAttribute("type", "text");
    expect(
      screen.getByRole("button", { name: /hide password/i }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: /hide password/i }));
    expect(
      screen.getByLabelText(/^password$/i),
    ).toHaveAttribute("type", "password");
  });

  it("does not render a toggle when passwordToggle is not set", () => {
    render(<FormInput label="Password" name="password" type="password" />);

    expect(
      screen.queryByRole("button", { name: /show password/i }),
    ).toBeNull();
    expect(screen.getByLabelText(/password/i)).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("does not render a toggle for non-password types", () => {
    render(<FormInput label="Email" name="email" passwordToggle />);

    expect(
      screen.queryByRole("button", { name: /show password/i }),
    ).toBeNull();
  });
});
