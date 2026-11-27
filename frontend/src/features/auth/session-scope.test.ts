import { describe, expect, it } from "vitest";
import { isEnrollmentOnlyToken } from "./session-scope";

const token = (claims: object) => `header.${btoa(JSON.stringify(claims)).replace(/=/g, "")}.signature`;

describe("Enrollment-only UI scope", () => {
  it("recognizes the restricted enrollment scope", () => {
    expect(isEnrollmentOnlyToken(token({ role: "administrator", mfa: "enrollment" }))).toBe(true);
  });
  it.each([null, "", "invalid", "a.!.b", token({ role: "administrator" }), token({ mfa: "pending" })])("does not misclassify an ordinary or malformed token", (value) => {
    expect(isEnrollmentOnlyToken(value)).toBe(false);
  });
});
