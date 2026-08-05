import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createCourseEnvironment,
  getCourseVolumeName,
} from "../../scripts/lib/local-environment.mjs";

for (const variableName of [
  "POSTGRES_PORT",
  "DATABASE_URL",
  "TEST_DATABASE_URL",
]) {
  delete process.env[variableName];
}

const compose = {
  command: "docker",
  prefix: ["compose"],
};

const standaloneCompose = {
  command: "docker-compose",
  prefix: [],
};

function pinnedComposeCommand({
  rootDirectory = process.cwd(),
  projectName = "madeup-video",
  composeCommand = compose,
  args,
}) {
  return [
    composeCommand.command,
    ...composeCommand.prefix,
    "--project-name",
    projectName,
    "--file",
    join(rootDirectory, "compose.yaml"),
    "--project-directory",
    rootDirectory,
    ...args,
  ];
}

function result({ status = 0, stdout = "", stderr = "", error } = {}) {
  return { status, stdout, stderr, error };
}

function trustedComposeConfiguration(
  projectName = "madeup-video",
  publishedPort = "5432",
) {
  return JSON.stringify({
    name: projectName,
    services: {
      postgres: {
        environment: {
          POSTGRES_DB: "madeup_video",
          POSTGRES_PASSWORD: "postgres",
          POSTGRES_USER: "postgres",
        },
        healthcheck: {
          test: [
            "CMD-SHELL",
            "pg_isready --username=postgres --dbname=madeup_video",
          ],
        },
        image: "postgres:17-alpine",
        ports: [
          {
            mode: "ingress",
            published: publishedPort,
            protocol: "tcp",
            target: 5432,
          },
        ],
        volumes: [
          {
            source: "postgres-data",
            target: "/var/lib/postgresql/data",
            type: "volume",
          },
        ],
      },
    },
    volumes: {
      "postgres-data": {
        name: `${projectName}_postgres-data`,
        labels: {
          "com.madeup-video.course.resource":
            "madeup-video-postgres-data",
        },
      },
    },
  });
}

function createRunner(handler = () => result()) {
  const calls = [];

  const runCommand = async (command, args, options = {}) => {
    const call = { command, args, options };
    calls.push(call);
    return handler(call, calls.length - 1);
  };

  return { calls, runCommand };
}

function isDockerMutation({ command, args }) {
  if (command === "docker" && args[0] === "volume" && args[1] === "rm") {
    return true;
  }

  return ["up", "rm", "down", "stop"].some((subcommand) =>
    args.includes(subcommand),
  );
}

function successfulPrerequisiteHandler(call) {
  if (call.args.includes("config")) {
    return result({ stdout: trustedComposeConfiguration() });
  }

  if (call.command === "docker" && call.args[0] === "--version") {
    return result({ stdout: "Docker version 28.5.0" });
  }

  if (call.command === "docker" && call.args[0] === "info") {
    return result({ stdout: "28.4.0" });
  }

  if (
    call.command === "docker" &&
    call.args[0] === "compose" &&
    call.args[1] === "version"
  ) {
    return result({ stdout: "2.39.4" });
  }

  return result();
}

test("the pnpm workspace explicitly includes the root package", async () => {
  const workspacePath = fileURLToPath(
    new URL("../../pnpm-workspace.yaml", import.meta.url),
  );
  const workspace = await readFile(workspacePath, "utf8");

  assert.match(workspace, /^packages:\s*\n\s+- \.\s*$/mu);
});

test("environment-sensitive test targets are never replayed from cache", async () => {
  const nxConfigPath = fileURLToPath(
    new URL("../../nx.json", import.meta.url),
  );
  const nxConfig = JSON.parse(await readFile(nxConfigPath, "utf8"));

  assert.equal(nxConfig.targetDefaults.test.cache, false);
  assert.equal(nxConfig.targetDefaults.e2e.cache, false);
});

async function createEnvironmentFiles({
  developmentUrl = "postgresql://postgres:postgres@localhost:5432/madeup_video?schema=public",
  testUrl = "postgresql://postgres:postgres@localhost:5432/madeup_video_test?schema=public",
} = {}) {
  const rootDirectory = await mkdtemp(
    join(tmpdir(), "madeup-video-environment-test-"),
  );

  await writeFile(
    join(rootDirectory, ".env.example"),
    `DATABASE_URL=${developmentUrl}\n`,
  );
  await writeFile(
    join(rootDirectory, ".env.test.example"),
    `TEST_DATABASE_URL=${testUrl}\n`,
  );
  await writeFile(
    join(rootDirectory, "compose.yaml"),
    [
      "name: madeup-video",
      "services:",
      "  postgres:",
      "    image: postgres:17-alpine",
      "volumes:",
      "  postgres-data:",
      "    labels:",
      "      com.madeup-video.course.resource: madeup-video-postgres-data",
      "",
    ].join("\n"),
  );

  return rootDirectory;
}

async function writeLocalEnvironment({
  rootDirectory,
  port = "5432",
  developmentDatabase = "madeup_video",
  testDatabase = "madeup_video_test",
  developmentExtra = "",
} = {}) {
  await writeFile(
    join(rootDirectory, ".env"),
    [
      developmentExtra,
      `POSTGRES_PORT=${port}`,
      `DATABASE_URL=postgresql://postgres:postgres@localhost:${port}/${developmentDatabase}?schema=public`,
      "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  await writeFile(
    join(rootDirectory, ".env.test"),
    `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:${port}/${testDatabase}?schema=public\n`,
  );
}

async function assertUntrustedComposeDefinition(mutateConfiguration) {
  const rootDirectory = await createEnvironmentFiles();
  await writeLocalEnvironment({ rootDirectory });
  const resolvedConfiguration = JSON.parse(
    trustedComposeConfiguration(),
  );
  mutateConfiguration(resolvedConfiguration);
  const { runCommand } = createRunner((call) => {
    if (call.args.includes("config")) {
      return result({ stdout: JSON.stringify(resolvedConfiguration) });
    }

    return result();
  });
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    compose,
  });
  const configuration = await environment.readDatabaseConfiguration();

  await assert.rejects(
    environment.validateComposeDefinition(configuration),
    /trusted PostgreSQL-only definition/,
  );
}

test("reports when the Docker executable is missing", async () => {
  const { runCommand } = createRunner((call) => {
    if (call.command === "docker") {
      return result({
        status: null,
        error: Object.assign(new Error("spawn docker ENOENT"), {
          code: "ENOENT",
        }),
      });
    }

    return result();
  });
  const environment = createCourseEnvironment({ runCommand });

  await assert.rejects(
    environment.checkPrerequisites(),
    /Docker is required but the "docker" executable was not found/,
  );
});

test("reports when neither Docker Compose v2 form is available", async () => {
  const { runCommand } = createRunner((call) => {
    if (call.command === "docker" && call.args[0] === "--version") {
      return result({ stdout: "Docker version 28.5.0" });
    }

    if (call.command === "docker" && call.args[0] === "info") {
      return result({ stdout: "28.4.0" });
    }

    return result({ status: 1, stderr: "unknown command" });
  });
  const environment = createCourseEnvironment({ runCommand });

  await assert.rejects(
    environment.checkPrerequisites(),
    /Docker Compose v2 is required/,
  );
});

test("launches pnpm.cmd through cmd.exe on native Windows", async () => {
  const rootDirectory = await createEnvironmentFiles();
  const { calls, runCommand } = createRunner((call) => {
    if (
      call.command === "cmd.exe" &&
      call.args.at(-2) === "pnpm.cmd" &&
      call.args.at(-1) === "--version"
    ) {
      return result({ stdout: "11.17.0\n" });
    }

    return result();
  });
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    platform: "win32",
    commandInterpreter: "cmd.exe",
  });

  await environment.validateToolchain();

  assert.equal(calls[0].command, "cmd.exe");
  assert.deepEqual(calls[0].args, [
    "/d",
    "/s",
    "/c",
    "pnpm.cmd",
    "--version",
  ]);
});

test("reports when Docker is installed but its daemon is unavailable", async () => {
  const { runCommand } = createRunner((call) => {
    if (call.command === "docker" && call.args[0] === "--version") {
      return result({ stdout: "Docker version 28.5.0" });
    }

    if (call.command === "docker" && call.args[0] === "info") {
      return result({
        status: 1,
        stderr: "Cannot connect to the Docker daemon",
      });
    }

    return result();
  });
  const environment = createCourseEnvironment({ runCommand });

  await assert.rejects(
    environment.checkPrerequisites(),
    /Docker is installed, but its daemon is unavailable/,
  );
});

test("creates missing environment files from committed examples without replacing existing files", async () => {
  const rootDirectory = await createEnvironmentFiles();
  await writeFile(
    join(rootDirectory, ".env"),
    "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/preserved?schema=public\n",
  );
  const environment = createCourseEnvironment({ rootDirectory });

  const created = await environment.ensureEnvironmentFiles();

  assert.deepEqual(created, [".env.test"]);
  assert.match(await readFile(join(rootDirectory, ".env"), "utf8"), /preserved/);
  assert.match(
    await readFile(join(rootDirectory, ".env.test"), "utf8"),
    /madeup_video_test/,
  );
});

test("rejects missing environment configuration with a focused recovery message", async () => {
  const rootDirectory = await mkdtemp(
    join(tmpdir(), "madeup-video-missing-environment-test-"),
  );
  const environment = createCourseEnvironment({ rootDirectory });

  await assert.rejects(
    environment.readDatabaseConfiguration(),
    /Missing \.env\. Run "pnpm run setup" to create it from \.env\.example/,
  );
});

test("rejects a development URL that does not target the course database", async () => {
  const rootDirectory = await createEnvironmentFiles();
  await writeFile(
    join(rootDirectory, ".env"),
    "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/someone_elses_database?schema=public\n",
  );
  await writeFile(
    join(rootDirectory, ".env.test"),
    "TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/madeup_video_test?schema=public\n",
  );
  const environment = createCourseEnvironment({ rootDirectory });

  await assert.rejects(
    environment.readDatabaseConfiguration(),
    /DATABASE_URL must target the course-owned "madeup_video" database/,
  );
});

test("reads the Compose host port from .env and validates both database URLs against it", async () => {
  const rootDirectory = await createEnvironmentFiles({
    developmentUrl:
      "postgresql://postgres:postgres@localhost:5544/madeup_video?schema=public",
    testUrl:
      "postgresql://postgres:postgres@localhost:5544/madeup_video_test?schema=public",
  });
  await writeFile(
    join(rootDirectory, ".env"),
    "POSTGRES_PORT=5544\nDATABASE_URL=postgresql://postgres:postgres@localhost:5544/madeup_video?schema=public\n",
  );
  await writeFile(
    join(rootDirectory, ".env.test"),
    "TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5544/madeup_video_test?schema=public\n",
  );
  const environment = createCourseEnvironment({ rootDirectory });

  assert.deepEqual(await environment.readDatabaseConfiguration(), {
    port: "5544",
    databaseUrl:
      "postgresql://postgres:postgres@localhost:5544/madeup_video?schema=public",
    testDatabaseUrl:
      "postgresql://postgres:postgres@localhost:5544/madeup_video_test?schema=public",
  });
});

test("resolves one trusted absolute Compose identity beneath the repository root", async () => {
  const rootDirectory = await createEnvironmentFiles();
  const environment = createCourseEnvironment({
    rootDirectory,
    env: {
      COURSE_COMPOSE_PROJECT_NAME: "madeup-video-verification",
      COMPOSE_PROJECT_NAME: "madeup-video-hostile-process",
    },
  });

  assert.deepEqual(environment.getComposeIdentity(), {
    projectName: "madeup-video-verification",
    projectDirectory: rootDirectory,
    composeFile: join(rootDirectory, "compose.yaml"),
    volumeName: "madeup-video-verification_postgres-data",
  });
});

test("pins project and file flags before plugin Compose subcommands", async () => {
  const rootDirectory = await createEnvironmentFiles();
  await writeFile(
    join(rootDirectory, ".env"),
    [
      "COMPOSE_PROJECT_NAME=madeup-video-hostile",
      "COMPOSE_FILE=hostile-from-dotenv.yaml",
      "POSTGRES_PORT=5432",
      "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/madeup_video?schema=public",
      "",
    ].join("\n"),
  );
  const { calls, runCommand } = createRunner();
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    compose,
    env: {
      COURSE_COMPOSE_PROJECT_NAME: "madeup-video-verification",
      COMPOSE_PROJECT_NAME: "madeup-video-hostile-process",
      COMPOSE_FILE: "hostile-compose.yaml",
    },
  });

  await environment.startDatabase({
    skipPrerequisites: true,
    skipReadiness: true,
  });

  assert.deepEqual(
    calls.map(({ command, args }) => [command, ...args]),
    [
      pinnedComposeCommand({
        rootDirectory,
        projectName: "madeup-video-verification",
        args: ["up", "--detach", "postgres"],
      }),
    ],
  );
  assert.equal(calls[0].options.env.COMPOSE_FILE, undefined);
  assert.equal(calls[0].options.env.COMPOSE_PROJECT_NAME, undefined);
});

test("pins global options before standalone Compose v2 subcommands", async () => {
  const rootDirectory = await createEnvironmentFiles();
  const { calls, runCommand } = createRunner();
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    compose: standaloneCompose,
    env: {
      COURSE_COMPOSE_PROJECT_NAME: "madeup-video-standalone",
    },
  });

  await environment.stopDatabase({ skipPrerequisites: true });

  assert.deepEqual(
    calls.map(({ command, args }) => [command, ...args]),
    [
      pinnedComposeCommand({
        rootDirectory,
        projectName: "madeup-video-standalone",
        composeCommand: standaloneCompose,
        args: ["stop", "postgres"],
      }),
    ],
  );
});

test("an automatic override file is excluded from repository Compose commands", async () => {
  const rootDirectory = await createEnvironmentFiles();
  await writeFile(
    join(rootDirectory, "compose.override.yaml"),
    "services:\n  application:\n    image: hostile/application\n",
  );
  const { calls, runCommand } = createRunner();
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    compose,
  });

  await environment.startDatabase({
    skipPrerequisites: true,
    skipReadiness: true,
  });

  const invoked = [calls[0].command, ...calls[0].args];
  assert.deepEqual(
    invoked,
    pinnedComposeCommand({
      rootDirectory,
      args: ["up", "--detach", "postgres"],
    }),
  );
  assert.equal(
    invoked.includes(join(rootDirectory, "compose.override.yaml")),
    false,
  );
});

test("rejects a declared PostgreSQL volume that is not mounted", async () => {
  await assertUntrustedComposeDefinition((configuration) => {
    configuration.services.postgres.volumes = [];
  });
});

test("rejects the PostgreSQL volume mounted at the wrong target", async () => {
  await assertUntrustedComposeDefinition((configuration) => {
    configuration.services.postgres.volumes[0].target =
      "/var/lib/postgresql/other-data";
  });
});

test("rejects a bind mount replacing the named PostgreSQL volume", async () => {
  await assertUntrustedComposeDefinition((configuration) => {
    configuration.services.postgres.volumes[0] = {
      source: "./local-postgres-data",
      target: "/var/lib/postgresql/data",
      type: "bind",
    };
  });
});

test("rejects a missing PostgreSQL health check", async () => {
  await assertUntrustedComposeDefinition((configuration) => {
    delete configuration.services.postgres.healthcheck;
  });
});

test("rejects an incorrect PostgreSQL health check", async () => {
  await assertUntrustedComposeDefinition((configuration) => {
    configuration.services.postgres.healthcheck.test = [
      "CMD-SHELL",
      "pg_isready --username=postgres --dbname=another_database",
    ];
  });
});

test("rejects the wrong PostgreSQL container port", async () => {
  await assertUntrustedComposeDefinition((configuration) => {
    configuration.services.postgres.ports[0].target = 55432;
  });
});

test("rejects a published PostgreSQL port that differs from configuration", async () => {
  await assertUntrustedComposeDefinition((configuration) => {
    configuration.services.postgres.ports[0].published = "55432";
  });
});

test("rejects an altered local PostgreSQL database setting", async () => {
  await assertUntrustedComposeDefinition((configuration) => {
    configuration.services.postgres.environment.POSTGRES_DB =
      "another_database";
  });
});

test("rejects an altered local PostgreSQL user setting", async () => {
  await assertUntrustedComposeDefinition((configuration) => {
    configuration.services.postgres.environment.POSTGRES_USER =
      "another_user";
  });
});

test("rejects an altered local PostgreSQL password setting", async () => {
  await assertUntrustedComposeDefinition((configuration) => {
    configuration.services.postgres.environment.POSTGRES_PASSWORD =
      "another_password";
  });
});

test("times out with a focused diagnostic when PostgreSQL never becomes ready", async () => {
  let clock = 0;
  const { runCommand } = createRunner((call) => {
    if (call.args.includes("pg_isready")) {
      return result({ status: 1, stderr: "no response" });
    }

    if (call.args.includes("logs")) {
      return result({ stdout: "database system is starting up" });
    }

    return result();
  });
  const environment = createCourseEnvironment({
    runCommand,
    compose,
    now: () => clock,
    delay: async (milliseconds) => {
      clock += milliseconds;
    },
    readinessTimeoutMs: 2,
    readinessPollMs: 1,
  });

  await assert.rejects(
    environment.startDatabase({ skipPrerequisites: true }),
    /PostgreSQL did not become healthy within 2ms.*Recent PostgreSQL logs are included below.*pnpm run db:logs.*database system is starting up/s,
  );
});

test("repository-owned config, logs, and status commands use the pinned interface", async () => {
  const rootDirectory = await createEnvironmentFiles();
  await writeLocalEnvironment({ rootDirectory });
  const { calls, runCommand } = createRunner((call) => {
    if (call.args.includes("config")) {
      return result({ stdout: trustedComposeConfiguration() });
    }

    return result({ stdout: "command output\n" });
  });
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    compose,
  });

  await environment.showComposeConfiguration({ skipPrerequisites: true });
  await environment.showDatabaseLogs({ skipPrerequisites: true });
  await environment.showDatabaseStatus({ skipPrerequisites: true });

  assert.deepEqual(
    calls.map(({ command, args }) => [command, ...args]),
    [
      pinnedComposeCommand({
        rootDirectory,
        args: ["config", "--format", "json"],
      }),
      pinnedComposeCommand({
        rootDirectory,
        args: ["logs", "--no-color", "--tail", "50", "postgres"],
      }),
      pinnedComposeCommand({
        rootDirectory,
        args: ["ps", "postgres"],
      }),
    ],
  );
  assert.equal(calls.every(({ options }) => options.displayOutput), true);
});

test("portable database inspection also works with standalone Compose v2", async () => {
  const rootDirectory = await createEnvironmentFiles();
  await writeLocalEnvironment({ rootDirectory });
  const { calls, runCommand } = createRunner();
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    compose: standaloneCompose,
    env: {
      COURSE_COMPOSE_PROJECT_NAME: "madeup-video-standalone",
    },
  });

  await environment.showDatabaseLogs({ skipPrerequisites: true });

  assert.deepEqual(
    calls.map(({ command, args }) => [command, ...args]),
    [
      pinnedComposeCommand({
        rootDirectory,
        projectName: "madeup-video-standalone",
        composeCommand: standaloneCompose,
        args: ["logs", "--no-color", "--tail", "50", "postgres"],
      }),
    ],
  );
});

test("database check reports both databases and deterministic seed counts through the pinned interface", async () => {
  const rootDirectory = await createEnvironmentFiles();
  await writeLocalEnvironment({ rootDirectory });
  const { calls, runCommand } = createRunner((call) => {
    if (call.args.includes("config")) {
      return result({ stdout: trustedComposeConfiguration() });
    }

    if (call.args.includes("--dbname=postgres")) {
      return result({ stdout: "madeup_video\nmadeup_video_test\n" });
    }

    if (call.args.includes("--dbname=madeup_video")) {
      return result({ stdout: "6|15|0\n" });
    }

    return result();
  });
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    compose,
  });

  const state = await environment.checkDatabaseState({
    skipPrerequisites: true,
  });

  assert.deepEqual(state, {
    databases: ["madeup_video", "madeup_video_test"],
    counts: {
      titles: 6,
      physicalCopies: 15,
      rentals: 0,
    },
  });
  assert.deepEqual(
    calls.map(({ command, args }) => [command, ...args]),
    [
      pinnedComposeCommand({
        rootDirectory,
        args: ["config", "--format", "json"],
      }),
      pinnedComposeCommand({
        rootDirectory,
        args: [
          "exec",
          "--no-TTY",
          "postgres",
          "psql",
          "--username=postgres",
          "--dbname=postgres",
          "--tuples-only",
          "--no-align",
          "--command",
          "SELECT datname FROM pg_database WHERE datname IN ('madeup_video','madeup_video_test') ORDER BY datname;",
        ],
      }),
      pinnedComposeCommand({
        rootDirectory,
        args: [
          "exec",
          "--no-TTY",
          "postgres",
          "psql",
          "--username=postgres",
          "--dbname=madeup_video",
          "--tuples-only",
          "--no-align",
          "--command",
          'SELECT (SELECT count(*) FROM "Title"), (SELECT count(*) FROM "PhysicalCopy"), (SELECT count(*) FROM "Rental");',
        ],
      }),
    ],
  );
});

test("package scripts expose the portable database inspection interface", async () => {
  const packagePath = fileURLToPath(
    new URL("../../package.json", import.meta.url),
  );
  const packageManifest = JSON.parse(await readFile(packagePath, "utf8"));

  assert.equal(packageManifest.scripts["db:check"], "node scripts/db-check.mjs");
  assert.equal(packageManifest.scripts["db:config"], "node scripts/db-config.mjs");
  assert.equal(packageManifest.scripts["db:logs"], "node scripts/db-logs.mjs");
  assert.equal(packageManifest.scripts["db:status"], "node scripts/db-status.mjs");
});

test("start and stop use non-destructive service-specific Compose commands", async () => {
  const { calls, runCommand } = createRunner();
  const environment = createCourseEnvironment({ runCommand, compose });

  await environment.startDatabase({
    skipPrerequisites: true,
    skipReadiness: true,
  });
  await environment.stopDatabase({ skipPrerequisites: true });

  assert.deepEqual(
    calls.map(({ command, args }) => [command, ...args]),
    [
      pinnedComposeCommand({
        args: ["up", "--detach", "postgres"],
      }),
      pinnedComposeCommand({
        args: ["stop", "postgres"],
      }),
    ],
  );
  assert.equal(calls.some(({ args }) => args.includes("--volumes")), false);
  assert.equal(calls.some(({ args }) => args.includes("down")), false);
});

test("reset refuses to run without an explicit --yes confirmation", async () => {
  const { calls, runCommand } = createRunner();
  const environment = createCourseEnvironment({ runCommand, compose });

  await assert.rejects(
    environment.resetDatabase({ yes: false, skipPrerequisites: true }),
    /Refusing to reset PostgreSQL without --yes/,
  );
  assert.equal(calls.length, 0);
});

test("reset rejects missing configuration before any Docker mutation", async () => {
  const rootDirectory = await createEnvironmentFiles();
  const { calls, runCommand } = createRunner();
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    compose,
  });

  await assert.rejects(
    environment.resetDatabase({
      yes: true,
      skipPrerequisites: true,
      skipReadiness: true,
    }),
    /Missing \.env/,
  );
  assert.deepEqual(calls.filter(isDockerMutation), []);
});

test("reset rejects invalid database configuration before any Docker mutation", async () => {
  const rootDirectory = await createEnvironmentFiles();
  await writeLocalEnvironment({
    rootDirectory,
    developmentDatabase: "not_the_course_database",
  });
  const { calls, runCommand } = createRunner((call) => {
    if (
      call.command === "docker" &&
      call.args[0] === "volume" &&
      call.args[1] === "inspect"
    ) {
      return result({
        stdout:
          "madeup-video|postgres-data|madeup-video-postgres-data\n",
      });
    }

    return result();
  });
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    compose,
  });

  await assert.rejects(
    environment.resetDatabase({
      yes: true,
      skipPrerequisites: true,
      skipReadiness: true,
    }),
    /DATABASE_URL must target the course-owned "madeup_video" database/,
  );
  assert.deepEqual(calls.filter(isDockerMutation), []);
});

test("reset rejects an untrusted resolved Compose definition before mutation", async () => {
  const rootDirectory = await createEnvironmentFiles();
  await writeLocalEnvironment({ rootDirectory });
  const { calls, runCommand } = createRunner((call) => {
    if (call.args.includes("config")) {
      return result({
        stdout: JSON.stringify({
          name: "madeup-video",
          services: {
            postgres: { image: "postgres:17-alpine" },
            application: { image: "hostile/application" },
          },
          volumes: {},
        }),
      });
    }

    return result();
  });
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    compose,
  });

  await assert.rejects(
    environment.resetDatabase({
      yes: true,
      skipPrerequisites: true,
      skipReadiness: true,
    }),
    /trusted PostgreSQL-only definition/,
  );
  assert.deepEqual(calls.filter(isDockerMutation), []);
});

test("reset validates the Node runtime before any Docker mutation", async () => {
  const rootDirectory = await createEnvironmentFiles();
  await writeLocalEnvironment({ rootDirectory });
  const { calls, runCommand } = createRunner();
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    compose,
    nodeVersion: "v23.0.0",
  });

  await assert.rejects(
    environment.resetDatabase({
      yes: true,
      skipReadiness: true,
    }),
    /Node\.js 24\.18\.0 is required/,
  );
  assert.deepEqual(calls.filter(isDockerMutation), []);
});

test("reset validates migration and seed executables before Docker mutation", async () => {
  const rootDirectory = await createEnvironmentFiles();
  await writeLocalEnvironment({ rootDirectory });
  const { calls, runCommand } = createRunner((call) => {
    if (call.command === "pnpm" && call.args[0] === "--version") {
      return result({ stdout: "11.17.0\n" });
    }

    if (
      call.command === "pnpm" &&
      call.args[0] === "exec" &&
      call.args[1] === "prisma"
    ) {
      return result({ status: 1, stderr: "prisma executable missing" });
    }

    return successfulPrerequisiteHandler(call);
  });
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    compose,
    nodeVersion: "v24.18.0",
  });

  await assert.rejects(
    environment.resetDatabase({
      yes: true,
      skipReadiness: true,
    }),
    /Prisma prerequisite validation.*prisma executable missing/s,
  );
  assert.deepEqual(calls.filter(isDockerMutation), []);
});

test("reset removes only the exact labelled Compose volume and recreates PostgreSQL", async () => {
  const rootDirectory = await createEnvironmentFiles();
  await writeLocalEnvironment({ rootDirectory });
  const { calls, runCommand } = createRunner((call) => {
    if (call.args.includes("config")) {
      return result({
        stdout: trustedComposeConfiguration("madeup-video-verification"),
      });
    }

    if (call.command === "docker" && call.args[0] === "volume") {
      if (call.args[1] === "inspect") {
        return result({
          stdout:
            "madeup-video-verification|postgres-data|madeup-video-postgres-data\n",
        });
      }
    }

    return result();
  });
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    compose,
    env: {
      COURSE_COMPOSE_PROJECT_NAME: "madeup-video-verification",
    },
  });

  await environment.resetDatabase({
    yes: true,
    skipPrerequisites: true,
    skipReadiness: true,
    prepare: false,
  });

  assert.deepEqual(
    calls.map(({ command, args }) => [command, ...args]),
    [
      pinnedComposeCommand({
        rootDirectory,
        projectName: "madeup-video-verification",
        args: ["config", "--format", "json"],
      }),
      [
        "docker",
        "volume",
        "inspect",
        "madeup-video-verification_postgres-data",
        "--format",
        '{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.volume" }}|{{ index .Labels "com.madeup-video.course.resource" }}',
      ],
      pinnedComposeCommand({
        rootDirectory,
        projectName: "madeup-video-verification",
        args: ["rm", "--force", "--stop", "postgres"],
      }),
      [
        "docker",
        "volume",
        "rm",
        "madeup-video-verification_postgres-data",
      ],
      pinnedComposeCommand({
        rootDirectory,
        projectName: "madeup-video-verification",
        args: ["up", "--detach", "postgres"],
      }),
    ],
  );
});

test("reset reuses the validated preflight configuration after PostgreSQL restarts", async () => {
  const rootDirectory = await createEnvironmentFiles();
  await writeLocalEnvironment({ rootDirectory, port: "5544" });
  const { calls, runCommand } = createRunner(async (call) => {
    if (call.args.includes("config")) {
      return result({
        stdout: trustedComposeConfiguration("madeup-video", "5544"),
      });
    }

    if (
      call.command === "docker" &&
      call.args[0] === "volume" &&
      call.args[1] === "inspect"
    ) {
      return result({ status: 1, stderr: "No such volume" });
    }

    if (call.args.includes("up")) {
      await writeFile(
        join(rootDirectory, ".env"),
        "DATABASE_URL=not-valid-after-preflight\n",
      );
    }

    if (call.args.includes("-tAc")) {
      return result({ stdout: "1\n" });
    }

    return result();
  });
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    compose,
  });

  await environment.resetDatabase({
    yes: true,
    skipPrerequisites: true,
    skipReadiness: true,
  });

  const pnpmCalls = calls.filter(({ command }) => command === "pnpm");
  assert.deepEqual(
    pnpmCalls.map(({ args }) => args),
    [["db:generate"], ["db:migrate"], ["db:seed"]],
  );
  assert.equal(
    pnpmCalls.every(
      ({ options }) =>
        options.env.DATABASE_URL.includes(":5544/madeup_video") &&
        options.env.TEST_DATABASE_URL.includes(":5544/madeup_video_test"),
    ),
    true,
  );
  const startIndex = calls.findIndex(({ args }) => args.includes("up"));
  const postStartComposeCalls = calls
    .slice(startIndex)
    .filter(({ args }) => args.includes("exec"));
  assert.equal(
    postStartComposeCalls.every(
      ({ options }) => options.env.POSTGRES_PORT === "5544",
    ),
    true,
  );
});

test("reset rejects a volume whose Compose ownership labels do not match", async () => {
  const rootDirectory = await createEnvironmentFiles();
  await writeLocalEnvironment({ rootDirectory });
  const { calls, runCommand } = createRunner((call) => {
    if (call.args.includes("config")) {
      return result({ stdout: trustedComposeConfiguration() });
    }

    if (call.command === "docker" && call.args[0] === "volume") {
      return result({ stdout: "unrelated-project|postgres-data\n" });
    }

    return result();
  });
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    compose,
  });

  await assert.rejects(
    environment.resetDatabase({
      yes: true,
      skipPrerequisites: true,
      skipReadiness: true,
      prepare: false,
    }),
    /Refusing to remove volume "madeup-video_postgres-data" because its Compose ownership labels do not match/,
  );
  assert.deepEqual(
    calls.map(({ command, args }) => [command, ...args]),
    [
      pinnedComposeCommand({
        rootDirectory,
        args: ["config", "--format", "json"],
      }),
      [
        "docker",
        "volume",
        "inspect",
        "madeup-video_postgres-data",
        "--format",
        '{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.volume" }}|{{ index .Labels "com.madeup-video.course.resource" }}',
      ],
    ],
  );
});

test("reports useful child-process output for a startup port conflict", async () => {
  const rootDirectory = await createEnvironmentFiles();
  await writeFile(
    join(rootDirectory, ".env"),
    "POSTGRES_PORT=5544\nDATABASE_URL=postgresql://postgres:postgres@localhost:5544/madeup_video?schema=public\n",
  );
  const { runCommand } = createRunner(() =>
    result({
      status: 1,
      stderr:
        "Bind for 0.0.0.0:5544 failed: port is already allocated",
    }),
  );
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    compose,
  });

  await assert.rejects(
    environment.startDatabase({
      skipPrerequisites: true,
      skipReadiness: true,
    }),
    /PostgreSQL could not start because host port 5544 is already in use.*\.env.*POSTGRES_PORT.*port is already allocated/s,
  );
});

test("recognises the native Windows Docker Desktop port-conflict message", async () => {
  const rootDirectory = await createEnvironmentFiles();
  await writeFile(
    join(rootDirectory, ".env"),
    "POSTGRES_PORT=5544\nDATABASE_URL=postgresql://postgres:postgres@localhost:5544/madeup_video?schema=public\n",
  );
  const { runCommand } = createRunner(() =>
    result({
      status: 1,
      stderr:
        "Ports are not available: exposing port TCP 0.0.0.0:5544 -> 0.0.0.0:0: listen tcp 0.0.0.0:5544: bind: Only one usage of each socket address is normally permitted.",
    }),
  );
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    compose,
  });

  await assert.rejects(
    environment.startDatabase({
      skipPrerequisites: true,
      skipReadiness: true,
    }),
    /PostgreSQL could not start because host port 5544 is already in use.*Ports are not available/s,
  );
});

test("derives the volume target only from a validated Compose project name", () => {
  assert.equal(
    getCourseVolumeName({
      COURSE_COMPOSE_PROJECT_NAME: "madeup-video-verification",
    }),
    "madeup-video-verification_postgres-data",
  );
  assert.throws(
    () =>
      getCourseVolumeName({
        COURSE_COMPOSE_PROJECT_NAME: "../../dangerous",
      }),
    /COURSE_COMPOSE_PROJECT_NAME must contain only lowercase letters, numbers, hyphens, and underscores/,
  );
  assert.throws(
    () =>
      getCourseVolumeName({
        COURSE_COMPOSE_PROJECT_NAME: "unrelated-project",
      }),
    /COURSE_COMPOSE_PROJECT_NAME must stay inside the "madeup-video" course namespace/,
  );
});

test("complete setup runs the reproducible workflow in order", async () => {
  const rootDirectory = await createEnvironmentFiles();
  const { calls, runCommand } = createRunner((call) => {
    if (call.command === "pnpm" && call.args[0] === "--version") {
      return result({ stdout: "11.17.0\n" });
    }

    if (call.args.includes("pg_isready")) {
      return result();
    }

    if (call.args.includes("-tAc")) {
      const query = call.args.at(-1);
      return result({
        stdout: query.includes("madeup_video_test") ? "" : "1\n",
      });
    }

    return successfulPrerequisiteHandler(call);
  });
  const environment = createCourseEnvironment({
    rootDirectory,
    runCommand,
    nodeVersion: "v24.18.0",
  });

  await environment.setup();

  const commands = calls.map(({ command, args }) => [command, ...args]);
  const importantCommands = commands.filter(
    ([command, ...args]) =>
      command === "pnpm" ||
      args.includes("up") ||
      args.includes("createdb"),
  );

  assert.deepEqual(importantCommands, [
    ["pnpm", "--version"],
    ["pnpm", "install", "--frozen-lockfile"],
    pinnedComposeCommand({
      rootDirectory,
      args: ["up", "--detach", "postgres"],
    }),
    pinnedComposeCommand({
      rootDirectory,
      args: [
        "exec",
        "--no-TTY",
        "postgres",
        "createdb",
        "--username=postgres",
        "madeup_video_test",
      ],
    }),
    ["pnpm", "db:generate"],
    ["pnpm", "db:migrate"],
    ["pnpm", "db:seed"],
  ]);
});

test("the database start command prints the focused missing-Docker diagnostic", async () => {
  const emptyPath = await mkdtemp(join(tmpdir(), "madeup-video-empty-path-"));
  const scriptPath = fileURLToPath(
    new URL("../../scripts/db-start.mjs", import.meta.url),
  );
  const child = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: emptyPath,
    },
  });

  assert.equal(child.status, 1);
  assert.match(
    child.stderr,
    /Docker is required but the "docker" executable was not found/,
  );
});

test("the database reset command checks confirmation before contacting Docker", () => {
  const scriptPath = fileURLToPath(
    new URL("../../scripts/db-reset.mjs", import.meta.url),
  );
  const child = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
  });

  assert.equal(child.status, 1);
  assert.match(child.stderr, /Refusing to reset PostgreSQL without --yes/);
});

test("the confirmed reset banner says preflight happens before removal", async () => {
  const scriptPath = fileURLToPath(
    new URL("../../scripts/db-reset.mjs", import.meta.url),
  );
  const script = await readFile(scriptPath, "utf8");

  assert.match(
    script,
    /Preflight must succeed before the course volume is removed/,
  );
  assert.doesNotMatch(script, /Destructive reset confirmed\. Removing only/);
});
