/** UI navigation only. The server verifies JWT signatures and account state. */
export function isEnrollmentOnlyToken(token: string | null): boolean {
  if (!token) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) return false;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { mfa?: unknown } | null;
    return payload?.mfa === "enrollment";
  } catch {
    return false;
  }
}
