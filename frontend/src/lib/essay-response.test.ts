import { describe, expect, it } from "vitest";
import {
  defaultEssayMaxCharacters,
  validateEssayResponse,
} from "./essay-response";

describe("JHEP-120 essay response validation", () => {
  it("uses the existing provisional 10,000-character API limit", () => {
    expect(defaultEssayMaxCharacters).toBe(10_000);
  });

  it.each(["", " ", "\n\n", "\t \n\r", "\u00a0\u2003"])(
    "does not permit submission of blank content %j",
    (value) => {
      expect(validateEssayResponse(value)).toMatchObject({
        isBlank: true,
        isOverLimit: false,
        canSubmit: false,
      });
    },
  );

  it.each([1, 9_999, 10_000])("accepts %i characters", (length) => {
    expect(validateEssayResponse("x".repeat(length))).toEqual({
      characterCount: length,
      remainingCharacters: 10_000 - length,
      isBlank: false,
      isOverLimit: false,
      canSubmit: true,
    });
  });

  it.each([10_001, 25_000])("rejects %i characters without truncation", (length) => {
    const value = "x".repeat(length);
    expect(validateEssayResponse(value)).toEqual({
      characterCount: length,
      remainingCharacters: 10_000 - length,
      isBlank: false,
      isOverLimit: true,
      canSubmit: false,
    });
    expect(value).toHaveLength(length);
  });

  it("counts spaces and newlines without altering the response", () => {
    const value = "  First paragraph.\n\nSecond paragraph.  ";
    expect(validateEssayResponse(value).characterCount).toBe(Array.from(value).length);
    expect(value).toBe("  First paragraph.\n\nSecond paragraph.  ");
  });

  it("counts supplementary Unicode characters like Python, not UTF-16 units", () => {
    expect(validateEssayResponse("😀".repeat(10_000))).toMatchObject({
      characterCount: 10_000,
      remainingCharacters: 0,
      canSubmit: true,
    });
    expect(validateEssayResponse("😀".repeat(10_001)).canSubmit).toBe(false);
  });

  it.each([
    ["中文", 2],
    ["é", 1],
    ["e\u0301", 2],
    ["🧑‍💻", 3],
    ["مرحبا", 5],
  ] as const)("counts code points in %s without normalizing", (value, count) => {
    expect(validateEssayResponse(value).characterCount).toBe(count);
    expect(validateEssayResponse(value).canSubmit).toBe(true);
  });

  it("supports a later product-approved limit without changing the component", () => {
    expect(validateEssayResponse("abc", 3).canSubmit).toBe(true);
    expect(validateEssayResponse("abcd", 3).canSubmit).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects the invalid configured limit %s",
    (limit) => {
      expect(() => validateEssayResponse("answer", limit)).toThrow(RangeError);
    },
  );
});
