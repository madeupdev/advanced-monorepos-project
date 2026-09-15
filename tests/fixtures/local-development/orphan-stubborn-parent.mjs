import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const stubbornChild = fileURLToPath(
  new URL("./stubborn-child.mjs", import.meta.url),
);

const child = spawn(process.execPath, [stubbornChild, process.argv[2]], {
  detached: false,
  env: process.env,
  shell: false,
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});

child.unref();
child.once("message", (ready) => {
  process.stdout.write(`${JSON.stringify({ pid: child.pid, ...ready })}\n`);
  process.exit(0);
});
