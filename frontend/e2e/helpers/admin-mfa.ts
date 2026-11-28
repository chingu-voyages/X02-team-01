import { spawnSync } from "node:child_process";
import path from "node:path";
import type { APIRequestContext } from "@playwright/test";

export type Credentials = { email: string; password: string };
type MfaAdministrator = Credentials & { totp_secret: string };
const backend = path.resolve(process.cwd(), "../backend");

export function localPython(args: string[], input?: string): string {
  const result = spawnSync(path.join(backend, ".venv/bin/python"), args, {
    cwd: backend, env: process.env, encoding: "utf8", input, timeout: 60_000,
  });
  if (result.error || result.status !== 0) {
    // Avoid accidentally printing fixture passwords or enrollment secrets.
    throw new Error("Local MFA fixture failed. Verify PostgreSQL, backend .venv and local MFA configuration.");
  }
  return result.stdout.trim();
}

export function authenticatorCode(secret: string): string {
  const code = localPython(["-c", "import sys, pyotp; print(pyotp.TOTP(sys.stdin.read().strip()).now())"], secret);
  if (!/^\d{6}$/.test(code)) throw new Error("Invalid test authenticator output");
  return code;
}

export function createUnenrolledAdministrator(): Credentials {
  return JSON.parse(localPython(["-m", "scripts.seed_admin_enrollment_e2e", "--confirm-local"])) as Credentials;
}

export async function loginMfaAdministrator(request: APIRequestContext): Promise<{ access_token: string }> {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  const secret = process.env.E2E_ADMIN_TOTP_SECRET;
  if ((email || password || secret) && !(email && password && secret)) {
    throw new Error("Custom local administrator credentials require E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD and E2E_ADMIN_TOTP_SECRET together.");
  }
  const credentials: MfaAdministrator = email && password && secret
    ? { email, password, totp_secret: secret }
    : (JSON.parse(localPython(["-m", "scripts.seed_exam_publication_e2e", "--confirm-local"])) as { administrator: MfaAdministrator }).administrator;
  const login = await request.post("/api/v1/auth/login", { data: { email: credentials.email, password: credentials.password } });
  if (!login.ok()) throw new Error(`Local administrator login failed (${login.status()})`);
  const challenge = await login.json() as { access_token: string; mfa_required?: boolean };
  if (!challenge.mfa_required) throw new Error("Administrator fixture must require MFA at sign-in.");
  const verification = await request.post("/api/v1/auth/mfa/verify", {
    headers: { Authorization: `Bearer ${challenge.access_token}` },
    data: { code: authenticatorCode(credentials.totp_secret) },
  });
  if (!verification.ok()) throw new Error(`Local MFA verification failed (${verification.status()})`);
  return await verification.json() as { access_token: string };
}
