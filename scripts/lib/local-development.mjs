import { execFile as execFileChild, spawn as spawnChild, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { delimiter, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parse as parseDotenv } from "dotenv";

const PROFILE_PROJECTS = Object.freeze({ api: ["@madeup-video/api"], storefront: ["@madeup-video/storefront"], admin: ["@madeup-video/admin"], full: ["@madeup-video/storefront", "@madeup-video/admin"] });
const PROFILE_APPLICATIONS = Object.freeze({ api: ["api"], storefront: ["api", "storefront"], admin: ["api", "admin"], full: ["api", "storefront", "admin"] });
const PROFILE_NAMES = Object.keys(PROFILE_PROJECTS);

export class LocalDevelopmentError extends Error {
  constructor(message, options = {}) { super(message, options); this.name = "LocalDevelopmentError"; this.exitCode = options.exitCode; }
}

export function developmentProjects(profile) {
  if (typeof profile !== "string" || !Object.hasOwn(PROFILE_PROJECTS, profile)) {
    const received = profile === undefined ? "missing" : JSON.stringify(profile);
    throw new LocalDevelopmentError(`Unknown local-development profile ${received}. Choose one of: ${PROFILE_NAMES.join(", ")}.`);
  }
  return [...PROFILE_PROJECTS[profile]];
}

function readPort(environment, name, fallback) {
  const port = Number(environment[name] ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new LocalDevelopmentError(`${name} must be an integer from 1 through 65535.`);
  return port;
}

function readOrigin(environment, name, fallback) {
  let url;
  try { url = new URL(environment[name] ?? fallback); } catch { throw new LocalDevelopmentError(`${name} must be a valid HTTP URL containing only an origin.`); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new LocalDevelopmentError(`${name} must be a valid HTTP URL containing only an origin.`);
  return url.origin;
}

const originPort = (origin) => { const url = new URL(origin); return Number(url.port || (url.protocol === "https:" ? 443 : 80)); };

function requireLocalHttpOrigin(name, origin, hosts) {
  const url = new URL(origin);
  if (url.protocol !== "http:") throw new LocalDevelopmentError(`${name} must use plain HTTP because the local development server does not provide TLS.`);
  if (!hosts.includes(url.hostname)) throw new LocalDevelopmentError(`${name} must use ${hosts.join(" or ")} because that is where the local development server binds.`);
}

export function readDevelopmentEnvironment(rootDirectory, environment = process.env) {
  let fileEnvironment = {};
  try { fileEnvironment = parseDotenv(readFileSync(resolve(rootDirectory, ".env"), "utf8")); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  return { ...fileEnvironment, ...environment };
}

export function createDevelopmentPlan(profile, options = {}) {
  const projects = developmentProjects(profile);
  const applicationNames = PROFILE_APPLICATIONS[profile];
  const environment = options.environment ?? process.env;
  const portInputs = {
    api: ["API_PORT", 3333],
    storefront: ["STOREFRONT_PORT", 3000],
    admin: ["ADMIN_PORT", 3200],
  };
  const ports = Object.fromEntries(applicationNames.map((name) => [name, readPort(environment, ...portInputs[name])]));
  for (const [index, leftApplication] of applicationNames.entries()) for (const rightApplication of applicationNames.slice(index + 1)) {
    const [left, leftName] = [ports[leftApplication], portInputs[leftApplication][0]];
    const [right, rightName] = [ports[rightApplication], portInputs[rightApplication][0]];
    if (left === right) throw new LocalDevelopmentError(`${leftName} and ${rightName} both resolve to ${left}; application ports must be unique.`);
  }
  const apiOrigin = readOrigin(environment, "API_URL", `http://127.0.0.1:${ports.api}`);
  const publicOriginInputs = applicationNames.flatMap((name) => name === "storefront" ? ["NEXT_PUBLIC_API_URL"] : name === "admin" ? ["VITE_API_URL"] : []);
  const publicOrigins = publicOriginInputs.map((name) => readOrigin(environment, name, apiOrigin));
  if (originPort(apiOrigin) !== ports.api || publicOrigins.some((origin) => origin !== apiOrigin)) throw new LocalDevelopmentError(["API_URL", ...publicOriginInputs].join(", ") + " must match and use API_PORT.");
  requireLocalHttpOrigin("API_URL", apiOrigin, ["127.0.0.1"]);
  const storefrontOrigin = applicationNames.includes("storefront") ? readOrigin(environment, "STOREFRONT_URL", `http://localhost:${ports.storefront}`) : undefined;
  const adminOrigin = applicationNames.includes("admin") ? readOrigin(environment, "ADMIN_URL", `http://127.0.0.1:${ports.admin}`) : undefined;
  if (storefrontOrigin && originPort(storefrontOrigin) !== ports.storefront) throw new LocalDevelopmentError("STOREFRONT_URL must use the port selected by STOREFRONT_PORT.");
  if (adminOrigin && originPort(adminOrigin) !== ports.admin) throw new LocalDevelopmentError("ADMIN_URL must use the port selected by ADMIN_PORT.");
  if (storefrontOrigin) requireLocalHttpOrigin("STOREFRONT_URL", storefrontOrigin, ["localhost", "127.0.0.1"]);
  if (adminOrigin) requireLocalHttpOrigin("ADMIN_URL", adminOrigin, ["127.0.0.1"]);
  if (!environment.DATABASE_URL) throw new LocalDevelopmentError("DATABASE_URL is required by the API. Run pnpm setup or configure .env before starting development.");
  let databaseUrl;
  try { databaseUrl = new URL(environment.DATABASE_URL); } catch { throw new LocalDevelopmentError("DATABASE_URL must be a valid PostgreSQL URL with a host and database name."); }
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol) || !databaseUrl.hostname || !databaseUrl.pathname.slice(1)) throw new LocalDevelopmentError("DATABASE_URL must be a PostgreSQL URL with a host and database name.");
  const definition = (name, origin, pathname, expectedJson) => {
    const parsedOrigin = new URL(origin);
    const application = {
      name,
      host: parsedOrigin.hostname.replace(/^\[|\]$/gu, ""),
      port: ports[name],
      url: new URL(pathname, `${origin}/`).href,
    };
    return expectedJson ? { ...application, expectedJson } : application;
  };
  const definitions = {
    api: definition("api", apiOrigin, "api/health", { status: "ok" }),
    ...(storefrontOrigin ? { storefront: definition("storefront", storefrontOrigin, "") } : {}),
    ...(adminOrigin ? { admin: definition("admin", adminOrigin, "") } : {}),
  };
  return { profile, projects, applications: applicationNames.map((name) => definitions[name]) };
}

export function createDevelopmentCommand(profile, options = {}) {
  const rootDirectory = resolve(options.rootDirectory ?? process.cwd());
  return { command: options.nodeExecutable ?? process.execPath, args: [resolve(rootDirectory, "node_modules/nx/dist/bin/nx.js"), "run-many", "--target=dev", `--projects=${developmentProjects(profile).join(",")}`] };
}

export function formatDevelopmentCommand({ command, args }) { return [command, ...args].map((part) => (/\s/u.test(part) ? JSON.stringify(part) : part)).join(" "); }

export function createNxEnvironment(rootDirectory, environment) {
  const searchPaths = [
    resolve(rootDirectory, "node_modules/nx/node_modules"),
    resolve(rootDirectory, "node_modules"),
    resolve(rootDirectory, "node_modules/.pnpm/node_modules"),
    environment.NODE_PATH,
  ].filter(Boolean);
  return {
    ...environment,
    NODE_PATH: searchPaths.join(delimiter),
    NX_DAEMON: "false",
  };
}

export async function checkAvailablePort({ application }) {
  return new Promise((resolveCheck, rejectCheck) => {
    const server = createServer(); server.unref();
    server.once("error", (error) => ["EADDRINUSE", "EACCES"].includes(error.code) ? resolveCheck(false) : rejectCheck(error));
    server.listen(application.port, application.host, () => server.close((error) => error ? rejectCheck(error) : resolveCheck(true)));
  });
}

function formatDiagnostic(value) {
  const text = (value instanceof Error ? value.message : String(value))
    .replace(/\b(authorization|cookie|set-cookie)\s*[:=][^\r\n]*(?:\r?\n[\t ]*[^\r\n]*)*/giu, "$1: [redacted]")
    .replace(/\r?\n[\t ]+/gu, " ")
    .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s<>"']+/giu, "[redacted URL]")
    .replace(/([?&][^\s=&#"']+)=([^\s&#"']*)/gu, "$1=[redacted]")
    .replace(/\b([\w-]*(?:password|passwd|pwd|secret|token|api[_-]?key|credential|username)[\w-]*)["']?\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&}]+)/giu, "$1=[redacted]")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}

async function discardResponseBody(response) {
  try { await response.body?.cancel?.(); } catch {}
}

export async function probeApplicationReadiness({ application, fetch: fetchImplementation = globalThis.fetch }) {
  let response;
  try {
    response = await fetchImplementation(application.url, { signal: AbortSignal.timeout(750) });
  } catch (error) { return { ready: false, kind: "refused", detail: formatDiagnostic(error) }; }
  if (!response.ok) {
    await discardResponseBody(response);
    return { ready: false, kind: "invalid-payload", detail: `HTTP ${response.status}` };
  }
  if (application.expectedJson) {
    let body;
    try { body = await response.json(); } catch { return { ready: false, kind: "invalid-payload", detail: "response was not valid JSON" }; }
    if (JSON.stringify(body) !== JSON.stringify(application.expectedJson)) return { ready: false, kind: "invalid-payload", detail: "response JSON did not match the expected health payload" };
  }
  else await discardResponseBody(response);
  return { ready: true };
}

export async function terminateWindowsTree(pid, executor, options = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Tree root PID must be a positive integer");
  if (!executor || typeof executor.start !== "function") {
    throw new Error("Taskkill requires a controlled executor with start, completion, and terminate capabilities.");
  }
  const timeoutMs = options.timeoutMs ?? 2_000;
  const scheduleTimeout = options.setTimeout ?? setTimeout;
  const cancelTimeout = options.clearTimeout ?? clearTimeout;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Taskkill timeout must be a positive integer");
  const abort = new AbortController();
  let executionDeadline, cancellationDeadline;
  try {
    const started = executor.start("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      signal: abort.signal,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    if (!started || typeof started !== "object" || !("completion" in started) || typeof started.terminate !== "function") {
      throw new Error("Taskkill requires a controlled executor with completion and terminate capabilities.");
    }
    let terminated = false;
    const terminate = () => {
      if (terminated) return undefined;
      terminated = true;
      return started.terminate();
    };
    const execution = Promise.resolve(started.completion);
    const timedOut = Symbol("timed-out");
    const result = await Promise.race([
      execution,
      new Promise((resolveTimeout) => { executionDeadline = scheduleTimeout(() => resolveTimeout(timedOut), timeoutMs); }),
    ]);
    if (result === timedOut) {
      abort.abort();
      terminate();
      const cancellationTimedOut = Symbol("cancellation-timed-out");
      const cancellation = await Promise.race([
        execution,
        new Promise((resolveTimeout) => { cancellationDeadline = scheduleTimeout(() => resolveTimeout(cancellationTimedOut), options.cancellationTimeoutMs ?? 250); }),
      ]);
      if (cancellation === cancellationTimedOut) throw new Error(`taskkill did not finish within ${timeoutMs}ms and its executor did not cancel.`);
      throw new Error(`taskkill did not finish within ${timeoutMs}ms.`);
    }
    if (result.error?.killed || result.error?.code === "ETIMEDOUT" || result.error?.code === "ABORT_ERR") throw new Error(`taskkill did not finish within ${timeoutMs}ms.`);
    if (result.code !== 0) throw new Error(`taskkill failed with exit ${result.code}`);
  } finally {
    cancelTimeout(executionDeadline);
    cancelTimeout(cancellationDeadline);
  }
}

export function parsePosixProcessSnapshot(output) {
  return output.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/u);
    if (!match) return [];
    const pid = Number(match[1]);
    const group = Number(match[2]);
    if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(group) || group <= 0) return [];
    return [{ pid, group, state: match[3] }];
  });
}

export function readPosixProcesses(options = {}) {
  const result = (options.spawnSync ?? spawnSync)("ps", ["-A", "-o", "pid=", "-o", "pgid=", "-o", "stat="], {
    encoding: "utf8",
    timeout: options.timeoutMs ?? 5_000,
    maxBuffer: options.maxBuffer ?? 1_048_576,
    shell: false,
  });
  if (result.error?.code === "ETIMEDOUT") throw new Error("POSIX process inspection timed out.");
  if (result.error?.code === "ENOBUFS") throw new Error("POSIX process inspection exceeded its output limit.");
  if (result.status !== 0) throw new Error("Cannot inspect the POSIX process group.");
  return parsePosixProcessSnapshot(result.stdout ?? "");
}

const executeFile = {
  start(command, args, options) {
    let child;
    const completion = new Promise((resolveExecution) => {
      child = execFileChild(command, args, options, (error) => resolveExecution({ code: error?.code ?? 0, error }));
    });
    let terminated = false;
    return {
      completion,
      terminate: () => {
        if (terminated) return;
        terminated = true;
        if (child && !child.killed) child.kill("SIGKILL");
      },
    };
  },
};

const sameWindowsIdentity = (left, right) => Boolean(
  left
  && right
  && left.pid === right.pid
  && left.birth === right.birth,
);

function creationTime(value) {
  if (typeof value !== "string" || !value) return NaN;
  if (/^\d+(?:\.\d+)?$/u.test(value)) return Number(value);
  const powershell = value.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/u);
  if (powershell && Number.isSafeInteger(Number(powershell[1]))) return Number(powershell[1]);
  const iso = Date.parse(value);
  if (Number.isFinite(iso)) return iso;
  const cim = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{6})([+-])(\d{3})$/u);
  if (!cim) return NaN;
  const [, year, month, day, hour, minute, second, micros, sign, offset] = cim;
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(micros.slice(0, 3)));
  return utc - (sign === "+" ? 1 : -1) * Number(offset) * 60_000;
}

export function readWindowsProcesses(options = {}) {
  const script = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress";
  const result = (options.spawnSync ?? spawnSync)("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeoutMs ?? 5_000,
    maxBuffer: options.maxBuffer ?? 1_048_576,
    shell: false,
  });
  if (result.error?.code === "ETIMEDOUT") throw new Error("Windows process inspection timed out.");
  if (result.error?.code === "ENOBUFS") throw new Error("Windows process inspection exceeded its output limit.");
  if (result.status !== 0) throw new Error("Cannot inspect the owned Nx process tree on Windows.");
  let processes;
  try { processes = JSON.parse(result.stdout || "[]"); } catch { throw new Error("Cannot parse the Windows Nx process snapshot."); }
  return (Array.isArray(processes) ? processes : [processes]).flatMap((process) => {
    const pid = Number(process.ProcessId);
    const ppid = Number(process.ParentProcessId);
    const birth = process.CreationDate;
    if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(ppid) || ppid < 0 || !Number.isFinite(creationTime(birth))) return [];
    return [{ pid, ppid, birth, createdAt: creationTime(birth) }];
  });
}

function createWindowsOwnershipTracker(rootPid) {
  let rootIdentity; let rootRetired = false;
  const owned = new Map();
  const identityKey = ({ pid, birth }) => `${pid}:${birth}`;
  const remember = (record) => { owned.set(identityKey(record), record); };
  const isKnown = (record) => owned.has(identityKey(record));
  const currentOwned = (rows) => rows.filter(isKnown);
  const capture = (rows, rootAlive) => {
    const root = rows.find(({ pid }) => pid === rootPid);
    if (!rootAlive || (!rootIdentity && !root?.birth)) rootRetired = true;
    if (!rootRetired && !rootIdentity && rootAlive && root?.birth) {
      rootIdentity = root;
      remember(root);
    }
    const rootCanExtendOwnership = !rootRetired && rootAlive && sameWindowsIdentity(rootIdentity, root);
    if (rootCanExtendOwnership) {
      const knownPids = new Set(currentOwned(rows).map(({ pid }) => pid));
      let changed = true;
      while (changed) {
        changed = false;
        for (const row of rows) {
          const parent = rows.find(({ pid }) => pid === row.ppid);
          if (knownPids.has(row.ppid) && !isKnown(row) && (!parent || !Number.isFinite(creationTime(row.birth)) || !Number.isFinite(creationTime(parent.birth)) || creationTime(row.birth) <= creationTime(parent.birth))) {
            throw new Error("Cannot verify Windows descendant creation-time ownership.");
          }
          if (knownPids.has(row.ppid) && !isKnown(row) && parent && creationTime(row.birth) > creationTime(parent.birth)) {
            remember(row);
            knownPids.add(row.pid);
            changed = true;
          }
        }
      }
    }

    if (!rootCanExtendOwnership) {
      const historicalPids = new Set([...owned.values()].map(({ pid }) => pid));
      for (const row of rows) {
        if (historicalPids.has(row.ppid) && !isKnown(row)) {
          throw new Error("Cannot verify Windows descendant ownership after the root process exited.");
        }
      }
    }
    return currentOwned(rows);
  };
  return {
    capture,
    hasRootIdentity: () => Boolean(rootIdentity),
    isKnown,
    currentOwned,
  };
}

function selectWindowsTerminationRoots(records) {
  const livePids = new Set(records.map(({ pid }) => pid));
  return records.filter(({ ppid }) => !livePids.has(ppid));
}

function waitForChildOrTimer(childCompletion, milliseconds, options = {}) {
  const schedule = options.setTimeout ?? setTimeout;
  const cancel = options.clearTimeout ?? clearTimeout;
  let handle;
  return Promise.race([
    childCompletion,
    new Promise((resolveTimeout) => { handle = schedule(resolveTimeout, milliseconds); }),
  ]).finally(() => cancel(handle));
}

export function createProcessTreeAdapter(child, options = {}) {
  if ((options.platform ?? process.platform) === "win32") {
    let childExited = false;
    const childCompletion = new Promise((resolveCompletion) => child.once("close", () => { childExited = true; resolveCompletion(); }));
    const readProcesses = options.readProcesses ?? ((readOptions) => readWindowsProcesses(readOptions));
    const tracker = createWindowsOwnershipTracker(child.pid);
    const cleanupDeadlineMs = options.windowsCleanupTimeoutMs ?? options.cleanupTimeoutMs ?? 5_000;
    const now = options.now ?? Date.now;
    const capture = (deadline) => {
      const remaining = deadline === undefined ? options.processSnapshotTimeoutMs ?? 5_000 : deadline - now();
      if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("Windows process-tree cleanup did not terminate within the cleanup deadline.");
      return tracker.capture(readProcesses({ timeoutMs: Math.min(options.processSnapshotTimeoutMs ?? 5_000, remaining) }), !childExited);
    };
    return { capture, async stop() {
      const deadline = now() + cleanupDeadlineMs;
      capture(deadline);
      if (!tracker.hasRootIdentity()) throw new Error("Cannot verify Windows process containment because the root identity was not captured.");
      await waitForChildOrTimer(childCompletion, Math.min(options.gracefulShutdownMs ?? 1_000, Math.max(0, deadline - now())), options);
      let live = capture(deadline);
      if (childExited && !tracker.hasRootIdentity()) throw new Error("Cannot verify Windows process containment because the root identity was not captured.");
      for (const candidate of selectWindowsTerminationRoots(live)) {
        if (now() >= deadline) throw new Error("Windows process-tree cleanup did not terminate within the cleanup deadline.");
        // Re-read immediately before each destructive action: taskkill only gets a PID.
        live = capture(deadline);
        const matchingCandidate = live.find((row) => sameWindowsIdentity(row, candidate));
        if (!matchingCandidate) continue;
        await terminateWindowsTree(matchingCandidate.pid, options.executeFile ?? executeFile, {
          timeoutMs: Math.min(options.taskkillTimeoutMs ?? 2_000, Math.max(1, deadline - now())),
        });
      }
      const remaining = capture(deadline);
      if (remaining.length) {
        throw new Error("Windows process-tree cleanup did not terminate within the cleanup deadline.");
      }
    } };
  }
  const now = options.now ?? Date.now, sleep = options.sleep ?? delay, readProcesses = options.readProcesses ?? readPosixProcesses, kill = options.kill ?? process.kill.bind(process);
  const cleanupDeadlineMs = options.posixCleanupTimeoutMs ?? options.cleanupTimeoutMs ?? 5_000;
  const capture = (deadline) => {
    const remaining = deadline === undefined ? options.processSnapshotTimeoutMs ?? 5_000 : deadline - now();
    if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("POSIX process-group cleanup did not terminate within the cleanup deadline.");
    return readProcesses({ timeoutMs: Math.min(options.processSnapshotTimeoutMs ?? 5_000, remaining) })
      .filter(({ group }) => group === child.pid);
  };
  const liveOwned = (deadline) => capture(deadline).filter(({ state }) => !state.startsWith("Z"));
  const signalRootGroup = (deadline, signal) => {
    if (!liveOwned(deadline).length) return false;
    if (now() >= deadline) throw new Error("POSIX process-group cleanup did not terminate within the cleanup deadline.");
    try { kill(-child.pid, signal); } catch (error) {
      if ((error?.code === "ESRCH" || error?.code === "EPERM") && !liveOwned(deadline).length) return false;
      throw error;
    }
    return true;
  };
  return { capture, async stop(reason) {
    const deadline = now() + cleanupDeadlineMs;
    const signals = [reason === "SIGTERM" ? "SIGTERM" : "SIGINT", "SIGTERM", "SIGKILL"];
    const waits = [options.gracefulShutdownMs ?? 1_000, options.escalationTimeoutMs ?? 2_000, options.escalationTimeoutMs ?? 2_000];
    for (const [index, signal] of signals.entries()) {
      if (!liveOwned(deadline).length) return;
      signalRootGroup(deadline, signal);
      if (!liveOwned(deadline).length) return;
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error("POSIX process-group cleanup did not terminate within the cleanup deadline.");
      await sleep(Math.min(waits[index], remaining));
    }
    if (liveOwned(deadline).length) throw new Error("POSIX process-group cleanup did not terminate within the cleanup deadline.");
  } };
}

const lifecycleError = (message, exitCode = 1) => new LocalDevelopmentError(message, { exitCode });

export async function runDevelopment(profile, options = {}) {
  const rootDirectory = resolve(options.rootDirectory ?? process.cwd());
  const command = createDevelopmentCommand(profile, { rootDirectory, nodeExecutable: options.nodeExecutable });
  if (options.dryRun) { (options.write ?? process.stdout.write.bind(process.stdout))(`${formatDevelopmentCommand(command)}\n`); return command; }
  const environment = options.environment ?? readDevelopmentEnvironment(rootDirectory);
  const plan = createDevelopmentPlan(profile, { environment });
  const checkPort = options.checkPort ?? checkAvailablePort;
  for (const application of plan.applications) if (!(await checkPort({ application }))) throw lifecycleError(`${application.name} port ${application.port} is already in use. Stop the owning process or choose an available port in .env, then retry.`);
  const spawn = options.spawn ?? spawnChild;
  const signalSource = options.signalSource ?? process;
  let interrupt;
  const onSigint = () => { interrupt ??= "SIGINT"; };
  const onSigterm = () => { interrupt ??= "SIGTERM"; };
  signalSource.on("SIGINT", onSigint); signalSource.on("SIGTERM", onSigterm);
  let child;
  try { child = spawn(command.command, command.args, { cwd: rootDirectory, env: createNxEnvironment(rootDirectory, environment), shell: false, detached: (options.platform ?? process.platform) !== "win32", stdio: "inherit" }); }
  catch (error) {
    signalSource.off("SIGINT", onSigint); signalSource.off("SIGTERM", onSigterm);
    throw lifecycleError(`Could not start the Nx development command: ${formatDiagnostic(error)}`);
  }
  let childError; let childClose;
  const onChildError = (error) => { childError ??= error; };
  const onChildClose = (code, signal) => { childClose ??= { code, signal }; };
  child.once("error", onChildError); child.once("close", onChildClose);
  const childResult = () => childError ? { error: childError } : childClose;
  const normalizedExitCode = (code) => Number.isSafeInteger(code) && code > 0 ? code : 1;
  const now = options.now ?? Date.now, sleep = options.sleep ?? delay, probe = options.probeReadiness ?? probeApplicationReadiness, write = options.write ?? process.stdout.write.bind(process.stdout);
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 60_000, readinessIntervalMs = options.readinessIntervalMs ?? 250, monitorIntervalMs = options.monitorIntervalMs ?? 1_000;
  const tree = options.stopTree ? { capture() {}, stop: options.stopTree } : createProcessTreeAdapter(child, { rootDirectory, platform: options.platform });
  const startedAt = now(), deadline = startedAt + readinessTimeoutMs;
  const pending = new Map(plan.applications.map((application) => [application.name, application]));
  let failure, cleanupReason;
  try {
    while (pending.size && !failure && !interrupt && !childResult()) {
      tree.capture();
      for (const application of [...pending.values()]) {
        if (application.name !== "api" && pending.has("api")) continue;
        const result = await probe({ application, phase: "startup" });
        if (childResult() || interrupt) break;
        if (result.ready && now() >= deadline) { failure = lifecycleError(`${application.name} did not become ready within ${readinessTimeoutMs}ms at ${application.url}. Last probe: readiness arrived after the deadline.`); break; }
        if (result.ready) { pending.delete(application.name); write(`${application.name} ready in ${now() - startedAt}ms (${application.url})\n`); }
        else if (result.kind === "invalid-payload") { failure = lifecycleError(`${application.name} readiness returned an unexpected payload at ${application.url}: ${formatDiagnostic(result.detail)}.`); break; }
        else if (now() >= deadline) { failure = lifecycleError(`${application.name} did not become ready within ${readinessTimeoutMs}ms at ${application.url}. Last probe: ${formatDiagnostic(result.detail ?? "connection refused")}.`); break; }
      }
      if (!failure && pending.size && !childResult() && !interrupt) await sleep(Math.min(readinessIntervalMs, Math.max(0, deadline - now())));
    }
    const earlyResult = childResult();
    if (earlyResult && pending.size) {
      cleanupReason = "child-exit";
      failure = earlyResult.error
        ? lifecycleError(`Nx development command failed: ${formatDiagnostic(earlyResult.error)}.`)
        : lifecycleError(`Nx development command exited before readiness with exit code ${earlyResult.code ?? "unknown"}.`, normalizedExitCode(earlyResult.code));
    }
    while (!failure && !interrupt && !childResult()) {
      tree.capture();
      for (const application of plan.applications) { const result = await probe({ application, phase: "monitor" }); if (childResult() || interrupt) break; if (!result.ready) { failure = lifecycleError(`${application.name} readiness was lost at ${application.url}: ${formatDiagnostic(result.detail ?? result.kind ?? "probe failed")}.`); break; } }
      if (!failure && !interrupt && !childResult()) await sleep(monitorIntervalMs);
    }
    const finalResult = childResult();
    if (interrupt) { cleanupReason = interrupt; failure = lifecycleError(`Local development interrupted by ${interrupt}.`, interrupt === "SIGINT" ? 130 : 143); }
    else if (!failure && finalResult?.error) { cleanupReason = "child-exit"; failure = lifecycleError(`Nx development command failed: ${formatDiagnostic(finalResult.error)}.`); }
    else if (!failure && finalResult && finalResult.code !== 0) { cleanupReason = "child-exit"; failure = lifecycleError(`Nx development command exited with exit code ${finalResult.code ?? "unknown"}.`, normalizedExitCode(finalResult.code)); }
    else if (failure) cleanupReason ??= "failure";
    else cleanupReason ??= "child-exit";
  } catch (error) {
    failure = lifecycleError(`Local development supervision failed: ${formatDiagnostic(error)}.`);
    cleanupReason = "failure";
  } finally {
    try { await tree.stop(cleanupReason); } catch (cleanupError) {
      child.unref?.();
      child.off("error", onChildError);
      child.off("close", onChildClose);
      if (!failure) failure = lifecycleError(`Nx process-tree cleanup failed: ${formatDiagnostic(cleanupError)}.`); else failure.message += ` Cleanup also failed: ${formatDiagnostic(cleanupError)}.`;
    }
    finally { signalSource.off("SIGINT", onSigint); signalSource.off("SIGTERM", onSigterm); }
  }
  if (failure) throw failure;
  return command;
}
