import {
  spawnSync,
} from "node:child_process";
import path from "node:path";

function runSeed(
  moduleName: string,
) {
  const frontendDir =
    process.cwd();

  const backendDir =
    path.resolve(
      frontendDir,
      "../backend",
    );

  const python =
    path.join(
      backendDir,
      ".venv/bin/python",
    );

  const result =
    spawnSync(
      python,
      [
        "-m",
        moduleName,
        "--confirm-local",
      ],
      {
        cwd:
          backendDir,
        env:
          process.env,
        stdio:
          "inherit",
      },
    );

  if (
    result.status !== 0
  ) {
    throw new Error(
      `Unable to run ${moduleName}. ` +
        "Confirm local PostgreSQL is running " +
        "and the backend .venv is installed.",
    );
  }
}

export default async function globalSetup() {
  runSeed(
    "scripts.seed_demo_exams",
  );

  runSeed(
    "scripts.seed_demo_admin",
  );
}
