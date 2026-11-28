import { useState, type ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RadioGroup } from "@/components/ui/radio-group";
import OptionItem from "./OptionItem";

// Use the actual Base UI controls. A mocked radio would miss this regression.
const answerText = "Keep the response and offer retry";
const alternateText = "Discard the response";
type OptionProps = ComponentProps<typeof OptionItem>;
const baseProps: OptionProps = {
  questionType: "single",
  id: "answer-a",
  position: 1,
  option: answerText,
  isSelected: false,
  onSelect: () => {},
  isSubmitted: false,
  feedbackReleased: false,
  correctOptionIds: [],
};

function SingleAnswer({
  onSelect = () => {},
  isSubmitted = false,
  disabled = false,
  initialValue = "",
}: {
  onSelect?: (value: string) => void;
  isSubmitted?: boolean;
  disabled?: boolean;
  initialValue?: string;
}) {
  const [value, setValue] = useState(initialValue);
  function selectAnswer(next: string) {
    setValue(next);
    onSelect(next);
  }
  return (
    <RadioGroup aria-label="Answer choices" value={value} onValueChange={selectAnswer}>
      <OptionItem
        {...baseProps}
        isSelected={value === "answer-a"}
        isSubmitted={isSubmitted}
        disabled={disabled}
        onSelect={() => selectAnswer("answer-a")}
      />
      <OptionItem
        {...baseProps}
        id="answer-b"
        position={2}
        option={alternateText}
        isSelected={value === "answer-b"}
        isSubmitted={isSubmitted}
        disabled={disabled}
        onSelect={() => selectAnswer("answer-b")}
      />
    </RadioGroup>
  );
}

function MultipleAnswer({
  onSelect = () => {},
  isSubmitted = false,
}: { onSelect?: () => void; isSubmitted?: boolean }) {
  const [checked, setChecked] = useState(false);
  return (
    <OptionItem
      {...baseProps}
      questionType="multiple"
      isSelected={checked}
      isSubmitted={isSubmitted}
      onSelect={() => {
        setChecked((previous) => !previous);
        onSelect();
      }}
    />
  );
}

afterEach(cleanup);

describe("JHEP-120 answer control accessibility", () => {
  it("names each radio from visible answer text, excluding its letter badge", () => {
    render(<SingleAnswer />);
    const first = screen.getByRole("radio", { name: answerText });
    const second = screen.getByRole("radio", { name: alternateText });
    expect(first).toHaveAccessibleName(answerText);
    expect(second).toHaveAccessibleName(alternateText);
    const labelId = first.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)).toHaveTextContent(answerText);
    expect(second.getAttribute("aria-labelledby")).not.toBe(labelId);
  });

  it("selects the named radio with a pointer without firing the row handler twice", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SingleAnswer onSelect={onSelect} />);
    const radio = screen.getByRole("radio", { name: answerText });
    await user.click(radio);
    expect(radio).toBeChecked();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("answer-a");
    expect(radio).toHaveAccessibleName(answerText);
  });

  it("keeps the visible answer text clickable", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SingleAnswer onSelect={onSelect} />);
    await user.click(screen.getByText(answerText, { exact: true }));
    expect(screen.getByRole("radio", { name: answerText })).toBeChecked();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("answer-a");
  });

  it("supports keyboard selection using the real radio group", async () => {
    const user = userEvent.setup();
    render(<SingleAnswer initialValue="answer-a" />);
    const first = screen.getByRole("radio", { name: answerText });
    first.focus();
    expect(first).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    const second = screen.getByRole("radio", { name: alternateText });
    expect(second).toHaveFocus();
    expect(second).toBeChecked();
    expect(first).not.toBeChecked();
  });

  it("preserves locked radio answers and their accessible names", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SingleAnswer isSubmitted initialValue="answer-a" onSelect={onSelect} />);
    await user.click(screen.getByText(alternateText, { exact: true }));
    await user.click(screen.getByRole("radio", { name: alternateText }));
    expect(screen.getByRole("radio", { name: answerText })).toBeChecked();
    expect(screen.getByRole("radio", { name: alternateText })).not.toBeChecked();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not select an answer while the parent has disabled it", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SingleAnswer disabled onSelect={onSelect} />);
    await user.click(screen.getByText(answerText, { exact: true }));
    await user.click(screen.getByRole("radio", { name: answerText }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: answerText })).not.toBeChecked();
  });

  it("names the checkbox and toggles it once per click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<MultipleAnswer onSelect={onSelect} />);
    const checkbox = screen.getByRole("checkbox", { name: answerText });
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(checkbox).toHaveAccessibleName(answerText);
    await user.click(screen.getByText(answerText, { exact: true }));
    expect(checkbox).not.toBeChecked();
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("supports Space on the named checkbox", async () => {
    const user = userEvent.setup();
    render(<MultipleAnswer />);
    const checkbox = screen.getByRole("checkbox", { name: answerText });
    checkbox.focus();
    await user.keyboard(" ");
    expect(checkbox).toBeChecked();
    await user.keyboard(" ");
    expect(checkbox).not.toBeChecked();
  });

  it("keeps a submitted checkbox locked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<MultipleAnswer isSubmitted onSelect={onSelect} />);
    await user.click(screen.getByText(answerText, { exact: true }));
    await user.click(screen.getByRole("checkbox", { name: answerText }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: answerText })).not.toBeChecked();
  });

  it("keeps the label stable while answer text changes", () => {
    const { rerender } = render(<OptionItem {...baseProps} questionType="multiple" />);
    const before = screen.getByRole("checkbox", { name: answerText });
    const labelId = before.getAttribute("aria-labelledby");
    rerender(<OptionItem {...baseProps} questionType="multiple" option="Updated answer text" />);
    const after = screen.getByRole("checkbox", { name: "Updated answer text" });
    expect(after.getAttribute("aria-labelledby")).toBe(labelId);
    expect(document.getElementById(labelId!)).toHaveTextContent("Updated answer text");
  });

  it.each(["Correct", "Incorrect"] as const)(
    "keeps the answer named when %s feedback is displayed",
    (verdict) => {
      render(
        <RadioGroup aria-label="Answer choices" value="answer-a">
          <OptionItem
            {...baseProps}
            isSelected
            isSubmitted
            feedbackReleased
            correctOptionIds={verdict === "Correct" ? ["answer-a"] : []}
          />
        </RadioGroup>,
      );
      expect(screen.getByRole("radio", { name: answerText })).toHaveAccessibleName(answerText);
      expect(screen.getByText(verdict, { exact: true })).toBeInTheDocument();
    },
  );
});
