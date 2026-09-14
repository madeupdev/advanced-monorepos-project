import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  LocalDevelopmentError,
  createDevelopmentCommand,
  createDevelopmentPlan,
  createProcessTreeAdapter,
  developmentProjects,
  probeApplicationReadiness,
  readPosixProcesses,
  readWindowsProcesses,
  terminateWindowsTree,
  runDevelopment,
} from "../../scripts/lib/local-development.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const workspaceRoot = resolve(root, "fixtures", "workspace");
const workspaceNxCli = resolve(
  workspaceRoot,
  "node_modules/nx/dist/bin/nx.js",
);

test("keeps command expectations independent of POSIX-only workspace paths", async () => {
  const testSource = await readFile(new URL(import.meta.url), "utf8");
  const hardCodedPosixRoot = ['"', "/", "workspace", '"'].join("");

  assert.equal(testSource.includes(hardCodedPosixRoot), false);
});

test("maps each named local-development profile to its stable projects", () => {
  assert.deepEqual(developmentProjects("api"), ["@madeup-video/api"]);
  assert.deepEqual(developmentProjects("storefront"), [
    "@madeup-video/storefront",
  ]);
  assert.deepEqual(developmentProjects("admin"), ["@madeup-video/admin"]);
  assert.deepEqual(developmentProjects("full"), [
    "@madeup-video/storefront",
    "@madeup-video/admin",
  ]);
});

for (const [profile, received] of [
  [undefined, "missing"],
  ["", '""'],
  ["mobile", '"mobile"'],
  ["toString", '"toString"'],
  ["constructor", '"constructor"'],
  ["__proto__", '"__proto__"'],
]) {
  test(`rejects the unsupported ${received} profile with a focused message`, () => {
    assert.throws(
      () => developmentProjects(profile),
      (error) => {
        assert.ok(error instanceof LocalDevelopmentError);
        assert.equal(
          error.message,
          `Unknown local-development profile ${received}. Choose one of: api, storefront, admin, full.`,
        );
        return true;
      },
    );
  });
}

test("builds a direct Node command for the installed Nx CLI", () => {
  assert.deepEqual(
    createDevelopmentCommand("admin", {
      rootDirectory: workspaceRoot,
      nodeExecutable: "node",
    }),
    {
      command: "node",
      args: [
        workspaceNxCli,
        "run-many",
        "--target=dev",
        "--projects=@madeup-video/admin",
      ],
    },
  );
});

test("returns and prints the dry-run command without spawning", async () => {
  let spawned = false;
  const output = [];
  const command = await runDevelopment("storefront", {
    rootDirectory: workspaceRoot,
    nodeExecutable: "node",
    dryRun: true,
    write: (line) => output.push(line),
    spawn: () => {
      spawned = true;
    },
  });

  assert.equal(spawned, false);
  assert.deepEqual(command, {
    command: "node",
    args: [
      workspaceNxCli,
      "run-many",
      "--target=dev",
      "--projects=@madeup-video/storefront",
    ],
  });
  assert.match(output.join(""), /@madeup-video\/storefront/);
});

test("supervises one structured Nx child without a shell and preserves its failure", async () => {
  const calls = [];
  const spawn = (...args) => {
    calls.push(args);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 17));
    return child;
  };

  await assert.rejects(
    runDevelopment("api", {
      environment: { ...validEnvironment, NX_DAEMON: "caller-selected-value" },
      rootDirectory: workspaceRoot,
      nodeExecutable: "node",
      checkPort: async () => true,
      stopTree: async () => {},
      spawn,
    }),
    /exit code 17/i,
  );

  assert.deepEqual(calls, [[
    "node",
    [
      workspaceNxCli,
      "run-many",
      "--target=dev",
      "--projects=@madeup-video/api",
    ],
    {
      cwd: workspaceRoot,
      env: {
        ...validEnvironment,
        NODE_PATH: [
          resolve(workspaceRoot, "node_modules/nx/node_modules"),
          resolve(workspaceRoot, "node_modules"),
          resolve(workspaceRoot, "node_modules/.pnpm/node_modules"),
        ].join(delimiter),
        NX_DAEMON: "false",
      },
      shell: false,
      detached: process.platform !== "win32",
      stdio: "inherit",
    },
  ]]);
});

test("provides root scripts for the focused local profiles", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url)),
  );

  assert.equal(packageJson.scripts.dev, "node scripts/dev.mjs full");
  assert.equal(packageJson.scripts["dev:api"], "node scripts/dev.mjs api");
  assert.equal(
    packageJson.scripts["dev:storefront"],
    "node scripts/dev.mjs storefront",
  );
  assert.equal(packageJson.scripts["dev:admin"], "node scripts/dev.mjs admin");
  assert.equal(packageJson.scripts["dev:full"], "node scripts/dev.mjs full");
});

test("documents the full and focused local-development workflows", async () => {
  const readme = await readFile(new URL("../../README.md", import.meta.url), "utf8");

  assert.match(readme, /`pnpm dev` starts the API, storefront, and admin/i);
  assert.match(readme, /pnpm dev:api/);
  assert.match(readme, /pnpm dev:storefront/);
  assert.match(readme, /pnpm dev:admin/);
  assert.match(readme, /pnpm dev:full/);
  assert.match(readme, /http:\/\/localhost:3000/);
  assert.match(readme, /http:\/\/localhost:3333/);
  assert.match(readme, /http:\/\/127\.0\.0\.1:3200/);
});

test("setup completion guidance describes the full development workflow", async () => {
  const setupScript = await readFile(
    new URL("../../scripts/setup.mjs", import.meta.url),
    "utf8",
  );

  assert.match(
    setupScript,
    /Run "pnpm dev" to start the API, storefront, and admin applications\./,
  );
});

test("CLI dry-run is inspectable without starting Nx", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, ["scripts/dev.mjs", "admin", "--dry-run"], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /node_modules[\\/]nx[\\/]dist[\\/]bin[\\/]nx\.js/);
  assert.match(result.stdout, /--projects=@madeup-video\/admin(?:\s|$)/);
  assert.doesNotMatch(result.stdout, /--projects=[^\n]*@madeup-video\/api/);
});

const validEnvironment = Object.freeze({
  API_PORT: "43120",
  STOREFRONT_PORT: "43121",
  ADMIN_PORT: "43122",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/madeup_video?schema=public",
  API_URL: "http://127.0.0.1:43120",
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:43120",
  VITE_API_URL: "http://127.0.0.1:43120",
  STOREFRONT_URL: "http://localhost:43121",
  ADMIN_URL: "http://127.0.0.1:43122",
});

test("validates the complete selected profile and defines its readiness contract before spawning", () => {
  assert.deepEqual(createDevelopmentPlan("storefront", { environment: validEnvironment }), {
    profile: "storefront",
    projects: ["@madeup-video/storefront"],
    applications: [
      { name: "api", host: "127.0.0.1", port: 43120, url: "http://127.0.0.1:43120/api/health", expectedJson: { status: "ok" } },
      { name: "storefront", host: "localhost", port: 43121, url: "http://localhost:43121/" },
    ],
  });

  assert.throws(
    () => createDevelopmentPlan("full", { environment: { ...validEnvironment, ADMIN_PORT: "43121" } }),
    /STOREFRONT_PORT and ADMIN_PORT both resolve to 43121/i,
  );
  assert.throws(
    () => createDevelopmentPlan("api", { environment: { ...validEnvironment, DATABASE_URL: "https://example.test/private?token=secret-value" } }),
    (error) => /DATABASE_URL must be a PostgreSQL URL/i.test(error.message) && !/secret-value/.test(error.message),
  );
});

test("validates only the applications and public origin required by each focused profile", () => {
  const apiPlan = createDevelopmentPlan("api", {
    environment: {
      ...validEnvironment,
      STOREFRONT_PORT: validEnvironment.API_PORT,
      STOREFRONT_URL: "not a URL",
      ADMIN_PORT: "invalid",
      ADMIN_URL: "not a URL",
      NEXT_PUBLIC_API_URL: "not a URL",
      VITE_API_URL: "not a URL",
    },
  });
  assert.deepEqual(apiPlan.applications.map(({ name }) => name), ["api"]);
  assert.throws(
    () => createDevelopmentPlan("api", {
      environment: { ...validEnvironment, API_URL: "not a URL" },
    }),
    /API_URL must be a valid HTTP URL/i,
  );

  const storefrontPlan = createDevelopmentPlan("storefront", {
    environment: {
      ...validEnvironment,
      ADMIN_PORT: validEnvironment.API_PORT,
      ADMIN_URL: "not a URL",
      VITE_API_URL: "not a URL",
    },
  });
  assert.deepEqual(storefrontPlan.applications.map(({ name }) => name), [
    "api",
    "storefront",
  ]);
  assert.throws(
    () => createDevelopmentPlan("storefront", {
      environment: { ...validEnvironment, NEXT_PUBLIC_API_URL: "not a URL" },
    }),
    /NEXT_PUBLIC_API_URL must be a valid HTTP URL/i,
  );

  const adminPlan = createDevelopmentPlan("admin", {
    environment: {
      ...validEnvironment,
      STOREFRONT_PORT: validEnvironment.API_PORT,
      STOREFRONT_URL: "not a URL",
      NEXT_PUBLIC_API_URL: "not a URL",
    },
  });
  assert.deepEqual(adminPlan.applications.map(({ name }) => name), [
    "api",
    "admin",
  ]);
  assert.throws(
    () => createDevelopmentPlan("admin", {
      environment: { ...validEnvironment, VITE_API_URL: "not a URL" },
    }),
    /VITE_API_URL must be a valid HTTP URL/i,
  );
});

test("rejects origins that the plain local dev servers cannot bind or serve", () => {
  for (const [profile, override, expected] of [
    ["api", { API_URL: "https://127.0.0.1:43120" }, /API_URL.*plain HTTP/i],
    ["api", { API_URL: "http://localhost:43120" }, /API_URL.*127\.0\.0\.1/i],
    ["storefront", { STOREFRONT_URL: "https://localhost:43121" }, /STOREFRONT_URL.*plain HTTP/i],
    ["storefront", { STOREFRONT_URL: "http://storefront.localhost:43121" }, /STOREFRONT_URL.*localhost.*127\.0\.0\.1/i],
    ["admin", { ADMIN_URL: "https://127.0.0.1:43122" }, /ADMIN_URL.*plain HTTP/i],
    ["admin", { ADMIN_URL: "http://localhost:43122" }, /ADMIN_URL.*127\.0\.0\.1/i],
  ]) {
    assert.throws(
      () => createDevelopmentPlan(profile, { environment: { ...validEnvironment, ...override } }),
      expected,
    );
  }
});

test("classifies malformed API health JSON as an unexpected payload", async () => {
  const result = await probeApplicationReadiness({
    application: { name: "api", url: "http://127.0.0.1:43120/api/health", expectedJson: { status: "ok" } },
    fetch: async () => ({ ok: true, json: async () => { throw new SyntaxError("bad JSON"); } }),
  });
  assert.equal(result.kind, "invalid-payload");
  assert.match(result.detail, /valid JSON/i);
});

test("cancels non-OK and successful frontend readiness response bodies", async () => {
  const cancelled = [];
  const response = (ok, status, label) => ({
    ok,
    status,
    body: { cancel: async () => { cancelled.push(label); } },
  });

  const unavailable = await probeApplicationReadiness({
    application: { name: "api", url: "http://127.0.0.1:43120/api/health" },
    fetch: async () => response(false, 503, "unavailable"),
  });
  const frontend = await probeApplicationReadiness({
    application: { name: "storefront", url: "http://localhost:43121/" },
    fetch: async () => response(true, 200, "storefront"),
  });

  assert.equal(unavailable.ready, false);
  assert.equal(frontend.ready, true);
  assert.deepEqual(cancelled, ["unavailable", "storefront"]);
});

const unsafeProbeDetail = 'ECONNREFUSED https://dev-user:credential-secret@127.0.0.1:43120/api/health?token=query-secret password="quoted-secret" api_key=key-secret\n\u001b[31m' + "x".repeat(2_000);

function assertSafeDiagnostic(detail, maximumLength = 240) {
  assert.ok(detail.length <= maximumLength, `diagnostic exceeds ${maximumLength} characters`);
  for (const secret of ["dev-user", "credential-secret", "query-secret", "quoted-secret", "key-secret"]) {
    assert.equal(detail.includes(secret), false, `diagnostic exposed ${secret}`);
  }
  assert.equal(/[\r\n\u001b]/u.test(detail), false, "diagnostic contains terminal controls");
}

test("bounds and redacts readiness fetch error diagnostics", async () => {
  const result = await probeApplicationReadiness({
    application: { url: "http://127.0.0.1:43120/api/health" },
    fetch: async () => { throw new Error(unsafeProbeDetail); },
  });

  assert.equal(result.kind, "refused");
  assertSafeDiagnostic(result.detail);
  assert.match(result.detail, /ECONNREFUSED/);
});

test("summarizes unexpected health JSON without repeating response secrets", async () => {
  const result = await probeApplicationReadiness({
    application: { url: "http://127.0.0.1:43120/api/health", expectedJson: { status: "ok" } },
    fetch: async () => ({ ok: true, json: async () => ({ password: "credential-secret", unexpected: unsafeProbeDetail }) }),
  });

  assert.equal(result.kind, "invalid-payload");
  assertSafeDiagnostic(result.detail);
  assert.match(result.detail, /health payload/i);
});

for (const detail of [
  "AUTHORIZATION=Bearer header-secret",
  "Cookie=session=header-secret",
  "Set-Cookie=session=header-secret; HttpOnly",
  "Authorization: Bearer\r\n header-secret\r\nNext: ordinary",
  "Cookie=session=ordinary\n\theader-secret",
  "Set-Cookie: session=ordinary\r\n header-secret",
]) {
  test(`redacts sensitive header diagnostics: ${detail.split(/[=:]/u)[0]}`, async () => {
    const result = await probeApplicationReadiness({
      application: { url: "http://127.0.0.1:43120/api/health" },
      fetch: async () => { throw new Error(detail); },
    });
    assertSafeDiagnostic(result.detail);
    assert.equal(result.detail.includes("header-secret"), false);
  });
}

test("redacts bare-newline sensitive header continuations before flattening diagnostics", async () => {
  const secret = "bare-continuation-secret";
  const result = await probeApplicationReadiness({
    application: { url: "http://127.0.0.1:43120/api/health" },
    fetch: async () => { throw new Error(`Authorization: Bearer\n${secret}\nNext: ordinary`); },
  });

  assert.equal(result.kind, "refused");
  assert.equal(result.detail.includes(secret), false);
});

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 12345;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => true;
  return child;
}

function lifecycleOptions(overrides = {}) {
  const child = overrides.child ?? fakeChild();
  const signals = new EventEmitter();
  const output = [];
  const cleanup = [];
  let now = 0;
  return {
    environment: validEnvironment,
    rootDirectory: workspaceRoot,
    nodeExecutable: "node",
    spawn: () => child,
    signalSource: signals,
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
    checkPort: async () => true,
    probeReadiness: async ({ application }) => ({ ready: true, detail: `${application.name} ready` }),
    stopTree: async (reason) => { cleanup.push(reason); child.exitCode = 0; child.emit("close", 0, null); },
    write: (line) => output.push(line),
    readinessTimeoutMs: 100,
    readinessIntervalMs: 10,
    monitorIntervalMs: 10,
    child,
    signals,
    output,
    cleanup,
    ...overrides,
  };
}

test("refuses an occupied selected application port before spawning", async () => {
  let spawned = false;
  await assert.rejects(
    runDevelopment("admin", lifecycleOptions({
      spawn: () => { spawned = true; return fakeChild(); },
      checkPort: async ({ application }) => application.name !== "admin",
    })),
    /admin.*43122.*already in use.*choose an available port/i,
  );
  assert.equal(spawned, false);
});

test("installs interrupt handlers before spawn and removes them when spawn throws synchronously", async () => {
  let observed;
  const options = lifecycleOptions({
    spawn: () => {
      observed = [options.signals.listenerCount("SIGINT"), options.signals.listenerCount("SIGTERM")];
      throw new Error("injected synchronous spawn failure");
    },
  });

  await assert.rejects(runDevelopment("api", options), /Could not start.*synchronous spawn failure/i);
  assert.deepEqual(observed, [1, 1]);
  assert.equal(options.signals.listenerCount("SIGINT"), 0);
  assert.equal(options.signals.listenerCount("SIGTERM"), 0);
});

test("retries delayed readiness, reports time-to-readiness, and monitors after startup", async () => {
  let apiAttempts = 0;
  let interrupted = false;
  const options = lifecycleOptions({
    probeReadiness: async ({ application, phase }) => {
      if (application.name === "api" && ++apiAttempts < 3) return { ready: false, kind: "refused", detail: "connection refused" };
      if (phase === "monitor" && !interrupted) {
        interrupted = true;
        queueMicrotask(() => options.signals.emit("SIGINT"));
      }
      return { ready: true };
    },
  });
  await assert.rejects(
    runDevelopment("api", options),
    (error) => error.exitCode === 130 && !/Cleanup also failed/.test(error.message),
  );
  assert.ok(apiAttempts >= 3);
  assert.match(options.output.join(""), /api ready in 20ms/i);
  assert.deepEqual(options.cleanup, ["SIGINT"]);
});

test("does not probe dependent frontends until the API is ready", async () => {
  let apiAttempts = 0;
  let apiReady = false;
  let interrupted = false;
  const options = lifecycleOptions({
    probeReadiness: async ({ application, phase }) => {
      if (application.name === "api" && phase === "startup") {
        apiAttempts += 1;
        apiReady = apiAttempts >= 2;
        return apiReady ? { ready: true } : { ready: false, kind: "refused", detail: "starting" };
      }
      assert.ok(apiReady, `${application.name} was probed before its API dependency was ready`);
      if (phase === "monitor" && !interrupted) {
        interrupted = true;
        queueMicrotask(() => options.signals.emit("SIGINT"));
      }
      return { ready: true };
    },
  });

  await assert.rejects(runDevelopment("full", options), (error) => error.exitCode === 130);
  assert.equal(apiAttempts, 2);
});

test("fails immediately for a reachable endpoint with the wrong health payload", async () => {
  const options = lifecycleOptions({
    probeReadiness: async () => ({ ready: false, kind: "invalid-payload", detail: 'received {"status":"starting"}' }),
  });
  await assert.rejects(runDevelopment("api", options), /api readiness returned an unexpected payload.*starting/i);
  assert.deepEqual(options.cleanup, ["failure"]);
});

test("fails with a focused timeout after retryable connection refusal", async () => {
  const options = lifecycleOptions({
    probeReadiness: async () => ({ ready: false, kind: "refused", detail: "ECONNREFUSED" }),
    readinessTimeoutMs: 30,
  });
  await assert.rejects(runDevelopment("api", options), /api did not become ready within 30ms.*ECONNREFUSED/i);
  assert.deepEqual(options.cleanup, ["failure"]);
});

for (const scenario of ["startup payload", "startup timeout", "readiness loss", "thrown probe"]) {
  test(`bounds and redacts ${scenario} diagnostics before reporting failure`, async () => {
    const options = lifecycleOptions({
      readinessTimeoutMs: 10,
      probeReadiness: async ({ phase }) => {
        if (scenario === "thrown probe") throw new Error(unsafeProbeDetail);
        if (scenario === "readiness loss" && phase === "startup") return { ready: true };
        return { ready: false, kind: scenario === "startup payload" ? "invalid-payload" : "refused", detail: unsafeProbeDetail };
      },
    });

    await assert.rejects(runDevelopment("api", options), (error) => {
      assertSafeDiagnostic(error.message, 500);
      assert.equal(error.exitCode, 1);
      return true;
    });
    assert.deepEqual(options.cleanup, ["failure"]);
  });
}

test("bounds cleanup errors and removes signal handlers after cleanup rejects", async () => {
  const options = lifecycleOptions({
    probeReadiness: async () => ({ ready: false, kind: "invalid-payload", detail: "wrong payload" }),
    stopTree: async () => {
      await Promise.resolve();
      assert.equal(options.signals.listenerCount("SIGINT"), 1);
      assert.equal(options.signals.listenerCount("SIGTERM"), 1);
      throw new Error(unsafeProbeDetail);
    },
  });

  await assert.rejects(runDevelopment("api", options), (error) => {
    assertSafeDiagnostic(error.message, 600);
    assert.match(error.message, /Cleanup also failed.*ECONNREFUSED/);
    return true;
  });
  assert.equal(options.signals.listenerCount("SIGINT"), 0);
  assert.equal(options.signals.listenerCount("SIGTERM"), 0);
});

test("releases a live child handle after cleanup fails without hiding the cleanup error", async () => {
  const child = fakeChild();
  let unreferenced = 0;
  child.unref = () => { unreferenced += 1; };
  const options = lifecycleOptions({
    child,
    stopTree: async () => { throw new Error("injected cleanup failure"); },
    probeReadiness: async () => ({ ready: false, kind: "invalid-payload", detail: "wrong payload" }),
  });

  await assert.rejects(runDevelopment("api", options), /Cleanup also failed.*injected cleanup failure/i);
  assert.equal(unreferenced, 1);
  assert.equal(child.listenerCount("close"), 0);
  assert.equal(child.listenerCount("error"), 0);
});

for (const code of [0, 17]) {
test(`fails an early Nx child exit ${code} and performs bounded cleanup`, async () => {
  const child = fakeChild();
  const options = lifecycleOptions({ child, spawn: () => { queueMicrotask(() => { child.exitCode = code; child.emit("close", code, null); }); return child; }, probeReadiness: async () => ({ ready: false, kind: "refused", detail: "starting" }) });
  await assert.rejects(runDevelopment("api", options), (error) => error.exitCode === (code || 1) && new RegExp(`before readiness.*${code}`, "i").test(error.message));
  assert.deepEqual(options.cleanup, ["child-exit"]);
});
}

for (const ending of ["close", "SIGINT", "SIGTERM"]) {
  test(`does not accept a ready probe after ${ending} arrives during that probe`, async () => {
    const options = lifecycleOptions({
      probeReadiness: async () => {
        if (ending === "close") {
          options.child.exitCode = 0;
          options.child.emit("close", 0, null);
        } else options.signals.emit(ending);
        return { ready: true };
      },
    });
    await assert.rejects(runDevelopment("api", options), (error) => error.exitCode === (ending === "close" ? 1 : ending === "SIGINT" ? 130 : 143));
    assert.deepEqual(options.output, []);
    assert.deepEqual(options.cleanup, [ending === "close" ? "child-exit" : ending]);
  });
}

test("turns continuous loss of any required readiness into failure", async () => {
  let checks = 0;
  const options = lifecycleOptions({
    probeReadiness: async ({ application, phase }) => {
      if (phase === "monitor" && application.name === "api" && ++checks === 2) {
        return { ready: false, kind: "refused", detail: "ECONNREFUSED" };
      }
      return { ready: true };
    },
  });
  await assert.rejects(runDevelopment("full", options), /api readiness was lost.*ECONNREFUSED/i);
  assert.deepEqual(options.cleanup, ["failure"]);
});

for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
test(`coalesces repeated ${signal} throughout asynchronous cleanup`, async () => {
  const options = lifecycleOptions();
  let stops = 0;
  let interrupted = false;
  let cleanupFinished = false;
  options.stopTree = async (reason) => {
    stops += 1;
    assert.equal(reason, signal);
    await Promise.resolve();
    for (const activeSignal of ["SIGINT", "SIGTERM"]) {
      assert.equal(options.signals.listenerCount(activeSignal), 1, "the coalescing handler remains installed through cleanup");
    }
    options.signals.emit("SIGINT");
    options.signals.emit("SIGTERM");
    options.child.exitCode = 0;
    options.child.emit("close", 0, null);
    cleanupFinished = true;
  };
  options.probeReadiness = async ({ phase }) => {
    if (phase === "monitor" && !interrupted) {
      interrupted = true;
      queueMicrotask(() => { options.signals.emit(signal); options.signals.emit(signal); });
    }
    return { ready: true };
  };
  await assert.rejects(runDevelopment("api", options), (error) => error.exitCode === exitCode && !/Cleanup also failed/.test(error.message));
  assert.equal(stops, 1);
  assert.equal(cleanupFinished, true);
  assert.equal(options.signals.listenerCount("SIGINT"), 0);
  assert.equal(options.signals.listenerCount("SIGTERM"), 0);
});
}

test("forwards SIGTERM once, cleans up with SIGTERM, and exits 143", async () => {
  const options = lifecycleOptions();
  let interrupted = false;
  options.probeReadiness = async ({ phase }) => {
    if (phase === "monitor" && !interrupted) {
      interrupted = true;
      queueMicrotask(() => options.signals.emit("SIGTERM"));
    }
    return { ready: true };
  };

  await assert.rejects(
    runDevelopment("api", options),
    (error) => error.exitCode === 143 && /SIGTERM/.test(error.message),
  );
  assert.deepEqual(options.cleanup, ["SIGTERM"]);
});

test("returns normally when the owned Nx child exits successfully after readiness", async () => {
  const options = lifecycleOptions();
  let exited = false;
  options.probeReadiness = async ({ phase }) => {
    if (phase === "monitor" && !exited) {
      exited = true;
      queueMicrotask(() => { options.child.exitCode = 0; options.child.emit("close", 0, null); });
    }
    return { ready: true };
  };
  await runDevelopment("api", options);
  assert.deepEqual(options.cleanup, ["child-exit"]);
});

function controlledTaskkillExecutor(run, onTerminate = () => {}) {
  return {
    start(...args) {
      let terminated = false;
      return {
        completion: Promise.resolve().then(() => run(...args)),
        terminate: () => {
          if (terminated) return;
          terminated = true;
          onTerminate(...args);
        },
      };
    },
  };
}

test("Windows tree termination uses validated structured arguments with shell disabled", async () => {
  const calls = [];
  await terminateWindowsTree(12345, controlledTaskkillExecutor(async (...args) => { calls.push(args); return { code: 0 }; }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "taskkill.exe");
  assert.deepEqual(calls[0][1], ["/PID", "12345", "/T", "/F"]);
  assert.equal(calls[0][2].shell, false);
  assert.equal(calls[0][2].windowsHide, true);
  assert.equal(calls[0][2].timeout, 2_000);
  assert.equal(calls[0][2].killSignal, "SIGKILL");
  assert.ok(calls[0][2].signal instanceof AbortSignal);
  await assert.rejects(() => terminateWindowsTree(0, controlledTaskkillExecutor(async () => ({}))), /positive integer/i);
  await assert.rejects(() => terminateWindowsTree("12 & whoami", controlledTaskkillExecutor(async () => ({}))), /positive integer/i);
  await assert.rejects(() => terminateWindowsTree(12345, controlledTaskkillExecutor(async () => ({ code: 5 }))), /taskkill.*5/i);
});

test("Windows tree termination rejects an uncontrolled promise executor before it can act", async () => {
  let called = false;
  await assert.rejects(
    () => terminateWindowsTree(12345, async () => { called = true; return { code: 0 }; }),
    /controlled executor/i,
  );
  assert.equal(called, false);
});

test("Windows forced tree termination rejects a non-resolving executor at its deadline", async () => {
  await assert.rejects(
    () => terminateWindowsTree(12345, controlledTaskkillExecutor(async (_command, _args, options) => new Promise((resolveExecution) => {
      options.signal.addEventListener("abort", () => resolveExecution({ code: "ABORT_ERR" }), { once: true });
    })), {
      timeoutMs: 5,
    }),
    /taskkill.*within 5ms/i,
  );
});

test("Windows native executor timeout reports the same focused deadline", async () => {
  await assert.rejects(
    () => terminateWindowsTree(12345, controlledTaskkillExecutor(async () => ({
      code: "ETIMEDOUT",
      error: { code: "ETIMEDOUT", killed: true, signal: "SIGKILL" },
    })), { timeoutMs: 5 }),
    /taskkill.*within 5ms/i,
  );
});

for (const rejectDuring of ["execution", "cancellation"]) {
  test(`Windows taskkill clears its own deadline handles after ${rejectDuring} rejects`, async (t) => {
    const active = new Set();
    let scheduled = 0;
    const timers = {
      setTimeout(callback, milliseconds) {
        const handle = setTimeout(() => { active.delete(handle); callback(); }, milliseconds);
        active.add(handle);
        scheduled += 1;
        return handle;
      },
      clearTimeout(handle) { clearTimeout(handle); active.delete(handle); },
    };
    t.after(() => { for (const handle of active) clearTimeout(handle); });
    const failure = new Error("injected executor rejection");
    const execute = async (_command, _args, options) => {
      if (rejectDuring === "execution") throw failure;
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(failure), { once: true }));
    };
    await assert.rejects(terminateWindowsTree(12345, controlledTaskkillExecutor(execute), {
      timeoutMs: rejectDuring === "execution" ? 1_000 : 5,
      cancellationTimeoutMs: 1_000,
      ...timers,
    }), failure);
    assert.equal(scheduled, rejectDuring === "execution" ? 1 : 2);
    assert.equal(active.size, 0, "a rejected executor retained a deadline handle");
  });
}

test("Windows taskkill timeout cancels the actual executor child with no late action", { timeout: 5_000 }, async (t) => {
  const { execFile } = await import("node:child_process");
  const directory = await mkdtemp(join(tmpdir(), "local-development-taskkill-"));
  const sentinel = join(directory, "late-action.txt");
  t.after(() => rm(directory, { recursive: true, force: true }));
  let executorPid;
  const executor = {
    start(_command, _args, options) {
      let child;
      let terminated = false;
      const completion = new Promise((resolveExecution) => {
        child = execFile(
          process.execPath,
          ["-e", `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "late"), 300)`],
          options,
          (error) => resolveExecution({ code: error?.code ?? 0, error }),
        );
        executorPid = child.pid;
      });
      return { completion, terminate: () => {
        if (!terminated) { terminated = true; child.kill("SIGKILL"); }
      } };
    },
  };

  await assert.rejects(
    () => terminateWindowsTree(12345, executor, { timeoutMs: 20 }),
    /taskkill.*within 20ms/i,
  );
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
  await assert.rejects(access(sentinel), /ENOENT/);
  assert.throws(() => process.kill(executorPid, 0), (error) => error.code === "ESRCH");
});

test("Windows controlled executor cannot perform a late action when it ignores abort", { timeout: 5_000 }, async (t) => {
  const { execFile } = await import("node:child_process");
  const directory = await mkdtemp(join(tmpdir(), "local-development-controlled-taskkill-"));
  const sentinel = join(directory, "late-action.txt");
  t.after(() => rm(directory, { recursive: true, force: true }));
  let executorPid;
  const executor = {
    start() {
      let child;
      let terminated = false;
      const completion = new Promise((resolveCompletion) => {
        child = execFile(process.execPath, ["-e", `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "late"), 300)`], {}, (error) => resolveCompletion({ code: error?.code ?? 0 }));
        executorPid = child.pid;
      });
      return { completion, terminate: () => {
        if (!terminated) { terminated = true; child.kill("SIGKILL"); }
      } };
    },
  };
  await assert.rejects(() => terminateWindowsTree(12345, executor, { timeoutMs: 20 }), /taskkill.*within 20ms/i);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
  await assert.rejects(access(sentinel), /ENOENT/);
  assert.throws(() => process.kill(executorPid, 0), (error) => error.code === "ESRCH");
});

const windowsProcess = (pid, ppid, birth) => ({ pid, ppid, group: pid, state: "S", birth });

test("Windows cleanup allows bounded grace without killing the root before its tree", async () => {
  const child = fakeChild();
  const signals = [];
  const calls = [];
  const sleeps = [];
  let rows = [windowsProcess(child.pid, 1, "100"), windowsProcess(child.pid + 1, child.pid, "200")];
  child.kill = (signal) => { signals.push(signal); return true; };
  const adapter = createProcessTreeAdapter(child, {
    platform: "win32",
    gracefulShutdownMs: 5,
    taskkillTimeoutMs: 10,
    readProcesses: () => rows,
    setTimeout: (callback, milliseconds) => { sleeps.push(milliseconds); queueMicrotask(callback); return milliseconds; },
    clearTimeout: () => {},
    executeFile: controlledTaskkillExecutor(async (...args) => { calls.push(args); rows = []; return { code: 0 }; }),
  });

  await adapter.stop("SIGINT");

  assert.deepEqual(signals, []);
  assert.equal(sleeps[0], 5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "taskkill.exe");
  assert.deepEqual(calls[0][1], ["/PID", "12345", "/T", "/F"]);
  assert.equal(calls[0][2].shell, false);
  assert.equal(calls[0][2].windowsHide, true);
  assert.ok(calls[0][2].timeout > 0 && calls[0][2].timeout <= 10);
  assert.equal(calls[0][2].killSignal, "SIGKILL");
  assert.ok(calls[0][2].signal instanceof AbortSignal);
});

test("Windows defaults reserve cleanup time beyond the per-taskkill deadline", async () => {
  const child = fakeChild();
  const calls = [];
  let now = 0;
  let rows = [windowsProcess(child.pid, 1, "100")];
  const adapter = createProcessTreeAdapter(child, {
    platform: "win32",
    now: () => now,
    readProcesses: () => {
      now += 300;
      return rows;
    },
    setTimeout: (callback, milliseconds) => {
      now += milliseconds;
      queueMicrotask(callback);
      return milliseconds;
    },
    clearTimeout: () => {},
    executeFile: controlledTaskkillExecutor(async (...args) => {
      calls.push(args);
      now += 300;
      rows = [];
      return { code: 0 };
    }),
  });

  await adapter.stop("SIGINT");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].timeout, 2_000);
});

test("Windows cleanup still terminates captured descendants when the root closes during grace", async () => {
  const child = fakeChild();
  const signals = [];
  const calls = [];
  const descendant = windowsProcess(child.pid + 1, child.pid, "200");
  let rows = [windowsProcess(child.pid, 1, "100"), descendant];
  child.kill = (signal) => { signals.push(signal); return true; };
  const adapter = createProcessTreeAdapter(child, {
    platform: "win32",
    readProcesses: () => rows,
    setTimeout: (callback) => { child.emit("close", 0, null); rows = [descendant]; callback(); return 1; },
    clearTimeout: () => {},
    executeFile: controlledTaskkillExecutor(async (...args) => { calls.push(args); rows = []; return { code: 0 }; }),
  });

  await adapter.stop("SIGTERM");

  assert.deepEqual(signals, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "taskkill.exe");
  assert.deepEqual(calls[0][1], ["/PID", String(descendant.pid), "/T", "/F"]);
});

test("Windows cleanup fails closed when the root exited before its identity was captured", async () => {
  const child = fakeChild();
  const calls = [];
  const adapter = createProcessTreeAdapter(child, {
    platform: "win32",
    readProcesses: () => [],
    executeFile: controlledTaskkillExecutor(async (...args) => { calls.push(args); return { code: 0 }; }),
  });
  child.emit("close", 0, null);
  await assert.rejects(adapter.stop("child-exit"), /identity.*captured|cannot verify/i);
  assert.deepEqual(calls, []);
});

test("Windows cleanup fails closed when process inspection cannot capture the live root identity", async () => {
  const child = fakeChild();
  const calls = [];
  const adapter = createProcessTreeAdapter(child, {
    platform: "win32",
    readProcesses: () => [],
    sleep: async () => {},
    executeFile: controlledTaskkillExecutor(async (...args) => { calls.push(args); return { code: 0 }; }),
  });
  await assert.rejects(adapter.stop("SIGINT"), /identity.*captured|cannot verify/i);
  assert.deepEqual(calls, []);
});

test("Windows cleanup never taskkills a reused root PID while cleaning its original descendants", async () => {
  const child = fakeChild();
  const descendant = windowsProcess(child.pid + 1, child.pid, "200");
  const reusedRoot = windowsProcess(child.pid, 1, "300");
  let rows = [windowsProcess(child.pid, 1, "100"), descendant];
  const killed = [];
  const adapter = createProcessTreeAdapter(child, {
    platform: "win32",
    readProcesses: () => rows,
    setTimeout: (callback) => { child.emit("close", 0, null); rows = [reusedRoot, descendant]; callback(); return 1; },
    clearTimeout: () => {},
    executeFile: controlledTaskkillExecutor(async (_command, args) => { killed.push(Number(args[1])); rows = [reusedRoot]; return { code: 0 }; }),
  });
  await adapter.stop("SIGINT");
  assert.deepEqual(killed, [descendant.pid]);
});

test("Windows cleanup fails closed for an unobserved possible orphan after root exit", async () => {
  const child = fakeChild();
  let rows = [windowsProcess(child.pid, 1, "100")];
  const calls = [];
  const adapter = createProcessTreeAdapter(child, {
    platform: "win32",
    readProcesses: () => rows,
    setTimeout: (callback) => { child.emit("close", 0, null); rows = [windowsProcess(child.pid + 1, child.pid, "200")]; callback(); return 1; },
    clearTimeout: () => {},
    executeFile: controlledTaskkillExecutor(async (...args) => { calls.push(args); return { code: 0 }; }),
  });
  await assert.rejects(adapter.stop("SIGINT"), /cannot verify.*descendant|ownership/i);
  assert.deepEqual(calls, []);
});

test("Windows cleanup fails closed when root disappearance precedes its close event", async () => {
  const child = fakeChild();
  let rows = [windowsProcess(child.pid, 1, "100")];
  const calls = [];
  const adapter = createProcessTreeAdapter(child, {
    platform: "win32",
    readProcesses: () => rows,
    setTimeout: (callback) => { rows = [windowsProcess(child.pid + 1, child.pid, "200")]; callback(); return 1; },
    clearTimeout: () => {},
    executeFile: controlledTaskkillExecutor(async (...args) => { calls.push(args); return { code: 0 }; }),
  });
  await assert.rejects(adapter.stop("SIGINT"), /cannot verify.*descendant|ownership/i);
  assert.deepEqual(calls, []);
});

test("Windows cleanup checks live identities after taskkill reports success", async () => {
  const child = fakeChild();
  const rows = [windowsProcess(child.pid, 1, "100")];
  let now = 0;
  const adapter = createProcessTreeAdapter(child, {
    platform: "win32",
    gracefulShutdownMs: 5,
    taskkillTimeoutMs: 20,
    readProcesses: () => rows,
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
    executeFile: controlledTaskkillExecutor(async () => ({ code: 0 })),
  });
  await assert.rejects(adapter.stop("SIGINT"), /cleanup deadline|did not terminate/i);
});

test("Windows cleanup revalidates creation identity immediately before taskkill", async () => {
  const child = fakeChild();
  let reads = 0;
  const calls = [];
  const adapter = createProcessTreeAdapter(child, {
    platform: "win32",
    readProcesses: () => [windowsProcess(child.pid, 1, ++reads >= 3 ? "300" : "100")],
    setTimeout: (callback) => { callback(); return 1; },
    clearTimeout: () => {},
    executeFile: controlledTaskkillExecutor(async (...args) => { calls.push(args); return { code: 0 }; }),
  });
  await adapter.stop("SIGINT");
  assert.ok(reads >= 3);
  assert.deepEqual(calls, []);
});

test("Windows never adopts an older process whose reused parent PID matches the root", async () => {
  const child = fakeChild();
  const calls = [];
  const adapter = createProcessTreeAdapter(child, {
    platform: "win32",
    readProcesses: () => [windowsProcess(child.pid, 1, "200"), windowsProcess(child.pid + 1, child.pid, "100")],
    sleep: async () => {},
    executeFile: controlledTaskkillExecutor(async (...args) => { calls.push(args); return { code: 0 }; }),
  });
  await assert.rejects(adapter.stop("SIGINT"), /creation|ownership|cannot verify/i);
  assert.deepEqual(calls, []);
});

test("Windows root authority is permanently retired when its first live capture is absent", async () => {
  const child = fakeChild();
  let reads = 0;
  const calls = [];
  const adapter = createProcessTreeAdapter(child, {
    platform: "win32",
    readProcesses: () => ++reads === 1 ? [] : [windowsProcess(child.pid, 1, "100")],
    sleep: async () => {},
    executeFile: controlledTaskkillExecutor(async (...args) => { calls.push(args); return { code: 0 }; }),
  });
  await assert.rejects(adapter.stop("SIGINT"), /identity.*captured|cannot verify/i);
  assert.deepEqual(calls, []);
});

test("readiness cannot accept a response that resolves after its startup deadline", async () => {
  let now = 0;
  const options = lifecycleOptions({
    now: () => now,
    readinessTimeoutMs: 100,
    probeReadiness: async ({ phase }) => {
      if (phase === "startup") { now = 150; return { ready: true }; }
      options.signals.emit("SIGINT");
      return { ready: true };
    },
  });
  await assert.rejects(runDevelopment("api", options), /did not become ready within 100ms/i);
  assert.deepEqual(options.output, []);
});

test("an async spawn error takes precedence over a following close and uses exit 1", async () => {
  const child = fakeChild();
  const options = lifecycleOptions({
    child,
    spawn: () => {
      queueMicrotask(() => {
        child.emit("error", Object.assign(new Error("spawn ENOENT token=secret"), { code: "ENOENT" }));
        child.emit("close", -1, null);
      });
      return child;
    },
    probeReadiness: async () => ({ ready: false, kind: "refused", detail: "starting" }),
  });
  await assert.rejects(runDevelopment("api", options), (error) => error.exitCode === 1 && /failed.*ENOENT/i.test(error.message) && !/secret/.test(error.message));
});

for (const [name, readProcesses] of [["POSIX", readPosixProcesses], ["Windows", readWindowsProcesses]]) {
  test(`${name} process inspection rejects timeout and output overflow with focused errors`, () => {
    const read = (spawnSync) => readProcesses({ spawnSync });
    assert.throws(
      () => read(() => ({ status: null, error: { code: "ETIMEDOUT" } })),
      /process inspection timed out/i,
    );
    assert.throws(
      () => read(() => ({ status: null, error: { code: "ENOBUFS" } })),
      /process inspection exceeded.*output limit/i,
    );
  });
}

test("parses the PowerShell 5.1 ConvertTo-Json DateTime identity without normalizing it", () => {
  const snapshot = String.raw`[{"ProcessId":4242,"ParentProcessId":1,"CreationDate":"\/Date(1726316096789)\/"}]`;
  const rows = readWindowsProcesses({
    spawnSync: () => ({ status: 0, stdout: snapshot }),
  });

  assert.deepEqual(rows, [{
    pid: 4242,
    ppid: 1,
    birth: "/Date(1726316096789)/",
    createdAt: 1_726_316_096_789,
  }]);
});

test("Windows grace clears its timer when the child closes first", async () => {
  const child = fakeChild();
  const active = new Set();
  let rows = [windowsProcess(child.pid, 1, "100")];
  const adapter = createProcessTreeAdapter(child, {
    platform: "win32",
    readProcesses: () => rows,
    setTimeout: (callback) => { const handle = { callback }; active.add(handle); return handle; },
    clearTimeout: (handle) => active.delete(handle),
  });
  queueMicrotask(() => { child.emit("close", 0, null); rows = []; });
  await adapter.stop("SIGINT");
  assert.equal(active.size, 0);
});

const posixProcess = (pid, group, state = "S") => ({ pid, group, state });

test("POSIX process parsing retains only exact pid, PGID, and state fields", async () => {
  const { parsePosixProcessSnapshot } = await import("../../scripts/lib/local-development.mjs");
  assert.deepEqual(parsePosixProcessSnapshot(" 200 200 S\nmalformed\n201 x S\n202 202 Z+\n"), [
    { pid: 200, group: 200, state: "S" },
    { pid: 202, group: 202, state: "Z+" },
  ]);
});

test("POSIX inspection is bounded, shell-free, and rejects nonzero ps", () => {
  let invocation;
  const rows = readPosixProcesses({
    timeoutMs: 123,
    spawnSync: (...args) => { invocation = args; return { status: 0, stdout: " 200 200 S\n" }; },
  });
  assert.equal(invocation[0], "ps");
  assert.deepEqual(invocation[1], ["-A", "-o", "pid=", "-o", "pgid=", "-o", "stat="]);
  assert.equal(invocation[2].shell, false);
  assert.equal(invocation[2].timeout, 123);
  assert.ok(Number.isFinite(invocation[2].maxBuffer) && invocation[2].maxBuffer > 0);
  assert.deepEqual(rows, [{ pid: 200, group: 200, state: "S" }]);
  assert.throws(() => readPosixProcesses({ spawnSync: () => ({ status: 1, stdout: "" }) }), /Cannot inspect.*process group/i);
});

test("POSIX cleanup ignores unrelated PGIDs and treats zombie-only root groups as stopped", async () => {
  const child = fakeChild();
  const signals = [];
  const adapter = createProcessTreeAdapter(child, {
    platform: "darwin",
    readProcesses: () => [posixProcess(child.pid + 1, child.pid + 1), posixProcess(child.pid + 2, child.pid, "Z")],
    kill: (...args) => signals.push(args),
  });
  child.emit("close", 0, null);
  await adapter.stop("child-exit");
  assert.deepEqual(signals, []);
});

test("POSIX cleanup signals only the root PGID through INT, TERM, and KILL", async () => {
  const child = fakeChild();
  const signals = [];
  let rows = [posixProcess(child.pid + 1, child.pid), posixProcess(child.pid + 2, child.pid + 99)];
  const adapter = createProcessTreeAdapter(child, {
    platform: "darwin",
    readProcesses: () => rows,
    gracefulShutdownMs: 1,
    escalationTimeoutMs: 1,
    posixCleanupTimeoutMs: 100,
    sleep: async () => {},
    kill: (pid, signal) => { signals.push([pid, signal]); if (signal === "SIGKILL") rows = []; },
  });
  await adapter.stop("SIGINT");
  assert.deepEqual(signals, [[-child.pid, "SIGINT"], [-child.pid, "SIGTERM"], [-child.pid, "SIGKILL"]]);
});

test("POSIX cleanup accepts ESRCH only after the root group disappears", async () => {
  const child = fakeChild();
  let rows = [posixProcess(child.pid + 1, child.pid)];
  const adapter = createProcessTreeAdapter(child, {
    platform: "darwin",
    readProcesses: () => rows,
    kill: () => { rows = []; throw Object.assign(new Error("gone"), { code: "ESRCH" }); },
  });
  await adapter.stop("SIGINT");
});

test("POSIX cleanup rejects EPERM while the root group remains live", async () => {
  const child = fakeChild();
  const adapter = createProcessTreeAdapter(child, {
    platform: "darwin",
    readProcesses: () => [posixProcess(child.pid + 1, child.pid)],
    kill: () => { throw Object.assign(new Error("denied"), { code: "EPERM" }); },
  });
  await assert.rejects(adapter.stop("SIGINT"), /denied|EPERM/i);
});

test("POSIX cleanup caps every process snapshot at one absolute deadline", async () => {
  const child = fakeChild();
  let now = 0;
  let reads = 0;
  const timeouts = [];
  const signals = [];
  const adapter = createProcessTreeAdapter(child, {
    platform: "darwin",
    now: () => now,
    posixCleanupTimeoutMs: 10,
    processSnapshotTimeoutMs: 1_000,
    readProcesses: ({ timeoutMs }) => {
      timeouts.push(timeoutMs);
      if (++reads === 2) now = 10;
      return [posixProcess(child.pid + 1, child.pid)];
    },
    sleep: async (milliseconds) => { now += milliseconds; },
    gracefulShutdownMs: 10,
    kill: (...args) => signals.push(args),
  });
  await assert.rejects(adapter.stop("SIGINT"), /cleanup deadline/i);
  assert.ok(timeouts.length >= 1 && timeouts.every((timeoutMs) => timeoutMs > 0 && timeoutMs <= 10));
  assert.deepEqual(signals, []);
});

test("POSIX cleanup retains root-PGID authority after the detached leader exits", async () => {
  const child = fakeChild();
  let rows = [posixProcess(child.pid + 1, child.pid)];
  const signals = [];
  const adapter = createProcessTreeAdapter(child, {
    platform: "darwin",
    readProcesses: () => rows,
    kill: (pid, signal) => { signals.push([pid, signal]); rows = []; },
  });
  child.emit("close", 0, null);
  await adapter.stop("child-exit");
  assert.deepEqual(signals, [[-child.pid, "SIGINT"]]);
});

test("bounded POSIX cleanup terminates a leader-exit group and immediately releases its port", {
  skip: process.platform === "win32" ? "requires POSIX ps and negative-PID process-group signals" : false,
  timeout: 30_000,
}, async (t) => {
  const { spawn } = await import("node:child_process");
  const { createServer } = await import("node:net");
  const fixture = fileURLToPath(new URL("../fixtures/local-development/orphan-stubborn-parent.mjs", import.meta.url));
  const port = await new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? rejectPort(error) : resolvePort(address.port));
    });
  });
  const parent = spawn(process.execPath, [fixture, String(port)], { detached: true, shell: false, stdio: ["ignore", "pipe", "inherit"] });
  let emergencyCleanupUsed = false;
  t.after(() => {
    if (emergencyCleanupUsed) return;
    emergencyCleanupUsed = true;
    try { process.kill(-parent.pid, "SIGKILL"); } catch {}
  });
  const parentExit = new Promise((resolveExit, rejectExit) => {
    parent.once("exit", resolveExit);
    parent.once("error", rejectExit);
  });
  const ready = await new Promise((resolveReady, rejectReady) => {
    parent.once("error", rejectReady);
    parent.stdout.once("data", (chunk) => resolveReady(JSON.parse(String(chunk))));
  });
  assert.equal(ready.port, port);
  await parentExit;
  const adapter = createProcessTreeAdapter(parent, {
    platform: "darwin",
    gracefulShutdownMs: 25,
    escalationTimeoutMs: 100,
    posixCleanupTimeoutMs: 2_000,
    processSnapshotTimeoutMs: 500,
  });
  assert.ok(adapter.capture().some((row) => row.group === parent.pid && !row.state.startsWith("Z")));
  await adapter.stop("child-exit");
  emergencyCleanupUsed = true;
  const rebound = createServer();
  await new Promise((resolveListen, rejectListen) => { rebound.once("error", rejectListen); rebound.listen(port, "127.0.0.1", resolveListen); });
  await new Promise((resolveClose, rejectClose) => rebound.close((error) => error ? rejectClose(error) : resolveClose()));
});

test("native Windows integration release gate cleans only the child it creates", {
  skip: process.platform !== "win32" ? "requires native Windows PowerShell and taskkill" : false,
  timeout: 30_000,
}, async (t) => {
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], {
    shell: false,
    windowsHide: true,
    stdio: "ignore",
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once("spawn", resolveSpawn);
    child.once("error", rejectSpawn);
  });
  const childClose = new Promise((resolveClose, rejectClose) => {
    child.once("close", resolveClose);
    child.once("error", rejectClose);
  });

  const adapter = createProcessTreeAdapter(child, {
    platform: "win32",
    taskkillTimeoutMs: 2_000,
  });
  await adapter.stop("release-gate");
  await childClose;
});
