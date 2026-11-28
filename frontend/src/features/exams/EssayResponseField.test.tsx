import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import EssayResponseField, { type EssayResponseFieldProps } from "./EssayResponseField";

function EditableField({
  initialValue = "",
  ...props
}: Omit<EssayResponseFieldProps, "value" | "onChange"> & { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  return <EssayResponseField {...props} value={value} onChange={setValue} />;
}

function textbox(): HTMLTextAreaElement {
  return screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Your essay response" });
}

afterEach(cleanup);

describe("JHEP-120 essay response field", () => {
  it("has a visible associated label, instructions, limit and honest draft status", () => {
    render(<EditableField />);
    expect(textbox()).toBe(screen.getByLabelText("Your essay response"));
    expect(textbox()).toHaveAccessibleDescription(/Submitting locks this answer/);
    expect(textbox()).toHaveAccessibleDescription(/0 \/ 10,000 characters/);
    expect(screen.getByRole("status")).toHaveTextContent("Draft — not submitted.");
    expect(textbox()).not.toHaveAttribute("readonly");
    expect(textbox()).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("accepts multiline text and preserves leading and trailing spaces", async () => {
    const user = userEvent.setup();
    render(<EditableField />);
    await user.click(textbox());
    await user.type(textbox(), "  First paragraph.{Enter}{Enter}Second paragraph.  ");
    expect(textbox()).toHaveValue("  First paragraph.\n\nSecond paragraph.  ");
  });

  it("keeps Enter as a line break, not a form submission", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <EditableField />
        <button type="submit">Submit answer</button>
      </form>,
    );
    await user.click(textbox());
    await user.type(textbox(), "First{Enter}Second");
    expect(textbox()).toHaveValue("First\nSecond");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("supports keyboard entry and lets Tab move to the next control", async () => {
    const user = userEvent.setup();
    render(<><EditableField /><button type="button">Next question</button></>);
    await user.tab();
    expect(textbox()).toHaveFocus();
    await user.keyboard("My response");
    expect(textbox()).toHaveValue("My response");
    await user.tab();
    expect(screen.getByRole("button", { name: "Next question" })).toHaveFocus();
  });

  it("keeps an over-limit paste intact and shows an associated error", async () => {
    const user = userEvent.setup();
    const value = "x".repeat(10_001);
    render(<EditableField />);
    await user.click(textbox());
    await user.paste(value);
    expect(textbox()).toHaveValue(value);
    expect(textbox()).not.toHaveAttribute("maxlength");
    expect(textbox()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("10,001 / 10,000 characters")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("your text has not been cut off");
    expect(textbox()).toHaveAccessibleDescription(/over the character limit/);
  });

  it("accepts the exact limit and clears the error when an oversized draft is shortened", () => {
    render(<EditableField initialValue={"x".repeat(10_001)} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(textbox(), { target: { value: "x".repeat(10_000) } });
    expect(textbox()).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("10,000 / 10,000 characters")).toBeInTheDocument();
  });

  it("counts emoji by code point rather than UTF-16 length", () => {
    render(<EditableField initialValue={"😀".repeat(10_000)} />);
    expect(screen.getByText("10,000 / 10,000 characters")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not announce the character counter after every keystroke", () => {
    render(<EditableField />);
    const counter = screen.getByText("0 / 10,000 characters");
    expect(counter.closest('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("freezes edits during submission without claiming the answer is already saved", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EssayResponseField value="Original response" onChange={onChange} submissionState="submitting" />);
    expect(textbox()).toHaveAttribute("readonly");
    expect(textbox()).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Submitting your answer…");
    await user.type(textbox(), "Overwrite");
    expect(onChange).not.toHaveBeenCalled();
    expect(textbox()).toHaveValue("Original response");
    expect(screen.queryByText(/Answer submitted/)).not.toBeInTheDocument();
  });

  it("shows a confirmed submission as pending, not correct or incorrect", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EssayResponseField value="Submitted response" onChange={onChange} submissionState="submitted" />);
    expect(screen.getByRole("status")).toHaveTextContent("Answer submitted. Pending feedback.");
    expect(textbox()).toHaveAttribute("readonly");
    expect(textbox()).not.toBeDisabled();
    await user.tab();
    expect(textbox()).toHaveFocus();
    await user.keyboard("Overwrite");
    expect(onChange).not.toHaveBeenCalled();
    expect(textbox()).toHaveValue("Submitted response");
    expect(screen.queryByText(/correct answer|incorrect answer|failed|0%/i)).not.toBeInTheDocument();
  });

  it("separates unavailable grading from a successfully submitted answer", () => {
    render(<EssayResponseField value="Stored response" onChange={vi.fn()} submissionState="submitted" feedbackState="unavailable" />);
    expect(screen.getByRole("status")).toHaveTextContent("Answer submitted. Unable to grade.");
    expect(textbox()).toHaveValue("Stored response");
    expect(textbox()).toHaveAttribute("readonly");
    expect(screen.queryByText(/failed|incorrect|0%/i)).not.toBeInTheDocument();
  });

  it("keeps the draft visible and editable after a failed submission", async () => {
    const user = userEvent.setup();
    render(<EditableField initialValue="My preserved draft" submitError="We could not confirm submission." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Your response is still here. Try submitting again.");
    expect(textbox()).toHaveValue("My preserved draft");
    expect(textbox()).not.toHaveAttribute("readonly");
    expect(textbox()).toHaveAccessibleDescription(/could not confirm submission/);
    await user.type(textbox(), " with another sentence.");
    expect(textbox()).toHaveValue("My preserved draft with another sentence.");
  });

  it("does not mutate the controlled draft across submit, failure, retry and success states", () => {
    const value = "  Keep my paragraphs.\n\nAnd whitespace.  ";
    const onChange = vi.fn();
    const { rerender } = render(<EssayResponseField value={value} onChange={onChange} />);
    rerender(<EssayResponseField value={value} onChange={onChange} submissionState="submitting" />);
    expect(textbox()).toHaveValue(value);
    rerender(<EssayResponseField value={value} onChange={onChange} submitError="Network request failed." />);
    expect(textbox()).toHaveValue(value);
    expect(textbox()).not.toHaveAttribute("readonly");
    rerender(<EssayResponseField value={value} onChange={onChange} submissionState="submitting" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender(<EssayResponseField value={value} onChange={onChange} submissionState="submitted" />);
    expect(textbox()).toHaveValue(value);
    expect(screen.getByRole("status")).toHaveTextContent("Pending feedback");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("supports a different approved character limit", () => {
    render(<EditableField initialValue="abcdef" maxCharacters={5} />);
    expect(screen.getByText("6 / 5 characters")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("over the character limit");
  });

  it("keeps identifiers unique when more than one field is mounted", () => {
    render(<><EditableField /><EditableField /></>);
    const fields = screen.getAllByRole("textbox", { name: "Your essay response" });
    expect(fields[0].id).not.toBe(fields[1].id);
    for (const field of fields) {
      const descriptionIds = field.getAttribute("aria-describedby")!.split(" ");
      for (const id of descriptionIds) expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it("allows the parent to freeze a draft during final exam submission", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EssayResponseField value="Unchanged draft" onChange={onChange} readOnly />);
    await user.type(textbox(), "Overwrite");
    expect(textbox()).toHaveAttribute("readonly");
    expect(textbox()).toHaveValue("Unchanged draft");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders markup-looking input as plain text", () => {
    const value = '<script>alert("test")</script>\n<img src=x onerror=alert(1)>';
    const { container } = render(<EditableField initialValue={value} />);
    expect(textbox()).toHaveValue(value);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});
