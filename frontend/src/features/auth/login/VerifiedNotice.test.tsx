import { describe, expect, it } from "vitest";
import { verificationNoticeMessage } from "./VerifiedNotice";

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("verification notice mapping (JHEP-24 verify redirect)", () => {
  it("welcomes a successful verification", () => {
    const notice = verificationNoticeMessage(params("verified=1"));
    expect(notice?.tone).toBe("success");
    expect(notice?.message).toMatch(/verified/i);
    expect(notice?.message).toMatch(/sign in/i);
  });

  it("explains an invalid, expired, or replayed link", () => {
    const notice = verificationNoticeMessage(params("verification=invalid"));
    expect(notice?.tone).toBe("warning");
    expect(notice?.message).toMatch(/invalid|expired|already used/i);
  });

  it("renders nothing for a plain login visit", () => {
    expect(verificationNoticeMessage(params(""))).toBeNull();
    expect(verificationNoticeMessage(params("other=param"))).toBeNull();
  });
});
