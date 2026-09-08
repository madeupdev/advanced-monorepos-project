import { spawn as spawnChild } from "node:child_process";
import { resolve } from "node:path";

const PROFILE_PROJECTS = Object.freeze({
  api: ["@madeup-video/api"],
  storefront: ["@madeup-video/api", "@madeup-video/storefront"],
  admin: ["@madeup-video/api", "@madeup-video/admin"],
  full: [
    "@madeup-video/api",
    "@madeup-video/storefront",
    "@madeup-video/admin",
  ],
});

const PROFILE_NAMES = Object.keys(PROFILE_PROJECTS);

export class LocalDevelopmentError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "LocalDevelopmentError";
  }
}

export function developmentProjects(profile) {
  if (
    typeof profile !== "string" ||
    !Object.hasOwn(PROFILE_PROJECTS, profile)
  ) {
    const received = profile === undefined ? "missing" : JSON.stringify(profile);
    throw new LocalDevelopmentError(
      `Unknown local-development profile ${received}. Choose one of: ${PROFILE_NAMES.join(", ")}.`,
    );
  }

  return [...PROFILE_PROJECTS[profile]];
}

export function createDevelopmentCommand(profile, options = {}) {
  const rootDirectory = resolve(options.rootDirectory ?? process.cwd());
  const projects = developmentProjects(profile);

  return {
    command: options.nodeExecutable ?? process.execPath,
    args: [
      resolve(rootDirectory, "node_modules/nx/dist/bin/nx.js"),
      "run-many",
      "--target=dev",
      `--projects=${projects.join(",")}`,
    ],
  };
}

export function formatDevelopmentCommand({ command, args }) {
  return [command, ...args]
    .map((part) => (/\s/u.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

export async function runDevelopment(profile, options = {}) {
  const rootDirectory = resolve(options.rootDirectory ?? process.cwd());
  const command = createDevelopmentCommand(profile, {
    rootDirectory,
    nodeExecutable: options.nodeExecutable,
  });

  if (options.dryRun) {
    (options.write ?? process.stdout.write.bind(process.stdout))(
      `${formatDevelopmentCommand(command)}\n`,
    );
    return command;
  }

  const spawn = options.spawn ?? spawnChild;
  let child;

  try {
    child = spawn(command.command, command.args, {
      cwd: rootDirectory,
      shell: false,
      stdio: "inherit",
    });
  } catch (error) {
    throw new LocalDevelopmentError(
      `Could not start the Nx development command: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  await new Promise((resolveRun, rejectRun) => {
    child.once("error", (error) => {
      rejectRun(
        new LocalDevelopmentError(
          `Could not start the Nx development command: ${error.message}`,
          { cause: error },
        ),
      );
    });
    child.once("close", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      const error = new LocalDevelopmentError(
        `Nx development command exited with exit code ${code ?? "unknown"}.`,
      );
      error.exitCode = code ?? 1;
      rejectRun(error);
    });
  });

  return command;
}
