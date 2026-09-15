import { spawn as spawnChild } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readStorefrontServerConfig } from "../lib/config/server.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const supportedCommands = new Set(["dev", "start"]);

export function createStorefrontCommand(commandName, options = {}) {
  if (!supportedCommands.has(commandName)) {
    throw new Error(`Unknown storefront command ${JSON.stringify(commandName)}. Choose dev or start.`);
  }

  const rootDirectory = resolve(options.rootDirectory ?? root);
  const { port } = readStorefrontServerConfig(options.environment);

  return {
    command: options.nodeExecutable ?? process.execPath,
    args: [
      resolve(rootDirectory, "node_modules/next/dist/bin/next"),
      commandName,
      `--port=${port}`,
    ],
    options: {
      cwd: resolve(rootDirectory, "apps/storefront"),
      shell: false,
      stdio: "inherit",
    },
  };
}

export async function runStorefrontCommand(commandName, options = {}) {
  const command = createStorefrontCommand(commandName, options);
  const child = (options.spawn ?? spawnChild)(
    command.command,
    command.args,
    command.options,
  );

  return new Promise((resolveRun, rejectRun) => {
    child.once("error", rejectRun);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(
        new Error(
          `Next ${commandName} exited with ${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}.`,
        ),
      );
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runStorefrontCommand(process.argv[2]).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
