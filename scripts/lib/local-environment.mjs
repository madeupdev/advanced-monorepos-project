import { spawnSync } from "node:child_process";
import {
  constants as fileSystemConstants,
  copyFile,
  readFile,
} from "node:fs/promises";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_COMPOSE_PROJECT_NAME = "madeup-video";
const POSTGRES_SERVICE = "postgres";
const POSTGRES_VOLUME = "postgres-data";
const POSTGRES_VOLUME_COURSE_LABEL = "madeup-video-postgres-data";
const DEVELOPMENT_DATABASE = "madeup_video";
const TEST_DATABASE = "madeup_video_test";
const EXPECTED_NODE_VERSION = "v24.18.0";
const EXPECTED_PNPM_VERSION = "11.17.0";

export class LocalEnvironmentError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "LocalEnvironmentError";
  }
}

function quoteCommand(command, args) {
  return [command, ...args]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

function outputFrom(result) {
  return [result.stderr, result.stdout]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join("\n");
}

async function defaultRunCommand(command, args, options = {}) {
  const child = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (options.displayOutput) {
    if (child.stdout) {
      process.stdout.write(child.stdout);
    }

    if (child.stderr) {
      process.stderr.write(child.stderr);
    }
  }

  return {
    status: child.status,
    stdout: child.stdout ?? "",
    stderr: child.stderr ?? "",
    error: child.error,
  };
}

function assertSuccessful(result, description, command, args) {
  if (result.status === 0) {
    return result;
  }

  const output = outputFrom(result);
  const detail = output ? `\n${output}` : "";

  throw new LocalEnvironmentError(
    `${description} failed while running ${quoteCommand(command, args)}.${detail}`,
    result.error ? { cause: result.error } : undefined,
  );
}

function parseEnvironment(contents) {
  const parsed = {};

  for (const line of contents.split(/\r?\n/u)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");

    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function validatePort(env, developmentEnvironment = {}) {
  const rawPort =
    env.POSTGRES_PORT ?? developmentEnvironment.POSTGRES_PORT ?? "5432";
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new LocalEnvironmentError(
      `POSTGRES_PORT must be an integer from 1 to 65535; received "${rawPort}".`,
    );
  }

  return String(port);
}

function validateDatabaseUrl(value, variableName, expectedDatabase, port) {
  if (!value) {
    throw new LocalEnvironmentError(
      `${variableName} is missing from its environment file.`,
    );
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    throw new LocalEnvironmentError(
      `${variableName} must be a valid PostgreSQL connection URL.`,
    );
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new LocalEnvironmentError(
      `${variableName} must use the postgres:// or postgresql:// protocol.`,
    );
  }

  const databaseName = decodeURIComponent(url.pathname.slice(1));

  if (databaseName !== expectedDatabase) {
    throw new LocalEnvironmentError(
      `${variableName} must target the course-owned "${expectedDatabase}" database; received "${databaseName || "(missing)"}".`,
    );
  }

  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new LocalEnvironmentError(
      `${variableName} must use localhost or 127.0.0.1 for the course Compose service.`,
    );
  }

  if ((url.port || "5432") !== port) {
    throw new LocalEnvironmentError(
      `${variableName} uses port ${url.port || "5432"}, but POSTGRES_PORT is ${port}. Make those values match.`,
    );
  }

  if (decodeURIComponent(url.username) !== "postgres") {
    throw new LocalEnvironmentError(
      `${variableName} must use the course-local "postgres" user.`,
    );
  }

  if (decodeURIComponent(url.password) !== "postgres") {
    throw new LocalEnvironmentError(
      `${variableName} must use the non-secret course-local "postgres" password.`,
    );
  }

  return url.toString();
}

function composeMajorVersion(result) {
  const match = outputFrom(result).match(/(?:^|\D)v?(\d+)\.\d+/u);
  return match ? Number(match[1]) : null;
}

export function getComposeProjectName(env = process.env) {
  const projectName =
    env.COURSE_COMPOSE_PROJECT_NAME ?? DEFAULT_COMPOSE_PROJECT_NAME;

  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(projectName)) {
    throw new LocalEnvironmentError(
      "COURSE_COMPOSE_PROJECT_NAME must contain only lowercase letters, numbers, hyphens, and underscores, and must start with a letter or number.",
    );
  }

  if (
    projectName !== DEFAULT_COMPOSE_PROJECT_NAME &&
    !projectName.startsWith(`${DEFAULT_COMPOSE_PROJECT_NAME}-`) &&
    !projectName.startsWith(`${DEFAULT_COMPOSE_PROJECT_NAME}_`)
  ) {
    throw new LocalEnvironmentError(
      'COURSE_COMPOSE_PROJECT_NAME must stay inside the "madeup-video" course namespace.',
    );
  }

  return projectName;
}

export function getCourseVolumeName(env = process.env) {
  return `${getComposeProjectName(env)}_${POSTGRES_VOLUME}`;
}

export function createCourseEnvironment(options = {}) {
  const rootDirectory = resolve(options.rootDirectory ?? process.cwd());
  const env = options.env ?? process.env;
  const runCommand = options.runCommand ?? defaultRunCommand;
  const nodeVersion = options.nodeVersion ?? process.version;
  const delay =
    options.delay ??
    ((milliseconds) =>
      new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)));
  const now = options.now ?? Date.now;
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 60_000;
  const readinessPollMs = options.readinessPollMs ?? 1_000;
  const platform = options.platform ?? process.platform;
  const pnpmCommand = platform === "win32" ? "pnpm.cmd" : "pnpm";
  const commandInterpreter =
    options.commandInterpreter ??
    env.ComSpec ??
    process.env.ComSpec ??
    "cmd.exe";
  const projectName = getComposeProjectName(env);
  const composeIdentity = Object.freeze({
    projectName,
    projectDirectory: rootDirectory,
    composeFile: resolve(rootDirectory, "compose.yaml"),
    volumeName: `${projectName}_${POSTGRES_VOLUME}`,
  });
  let detectedCompose = options.compose;

  const childEnvironment = (extra = {}) => ({
    ...process.env,
    ...env,
    ...extra,
  });

  const run = (command, args, commandOptions = {}) =>
    runCommand(command, args, {
      cwd: rootDirectory,
      env: childEnvironment(commandOptions.env),
      displayOutput: commandOptions.displayOutput,
    });

  const runPnpm = (args, commandOptions = {}) =>
    platform === "win32"
      ? run(
          commandInterpreter,
          ["/d", "/s", "/c", pnpmCommand, ...args],
          commandOptions,
        )
      : run(pnpmCommand, args, commandOptions);

  const composeArguments = (args) => [
    ...detectedCompose.prefix,
    "--project-name",
    composeIdentity.projectName,
    "--file",
    composeIdentity.composeFile,
    "--project-directory",
    composeIdentity.projectDirectory,
    ...args,
  ];

  const composeChildEnvironment = (port, extra = {}) => {
    const sanitizedEnvironment = childEnvironment(extra);

    for (const key of Object.keys(sanitizedEnvironment)) {
      if (key.startsWith("COMPOSE_")) {
        delete sanitizedEnvironment[key];
      }
    }

    return {
      ...sanitizedEnvironment,
      COMPOSE_DISABLE_ENV_FILE: "true",
      POSTGRES_PORT: port,
    };
  };

  const runCompose = async (args, commandOptions = {}) => {
    if (!detectedCompose) {
      throw new LocalEnvironmentError(
        "Docker Compose has not been detected. Run prerequisite validation first.",
      );
    }

    const port =
      commandOptions.port ?? (await readConfiguredPostgresPort());

    return runCommand(detectedCompose.command, composeArguments(args), {
      cwd: rootDirectory,
      env: composeChildEnvironment(port, commandOptions.env),
      displayOutput: commandOptions.displayOutput,
    });
  };

  async function checkPrerequisites() {
    const dockerVersion = await run("docker", ["--version"]);

    if (
      dockerVersion.error?.code === "ENOENT" ||
      (dockerVersion.status === null && dockerVersion.error)
    ) {
      throw new LocalEnvironmentError(
        'Docker is required but the "docker" executable was not found. Install Docker with Compose v2, then rerun the command.',
        { cause: dockerVersion.error },
      );
    }

    assertSuccessful(
      dockerVersion,
      "Docker prerequisite validation",
      "docker",
      ["--version"],
    );

    const dockerInfoArgs = ["info", "--format", "{{.ServerVersion}}"];
    const dockerInfo = await run("docker", dockerInfoArgs);

    if (dockerInfo.status !== 0) {
      const detail = outputFrom(dockerInfo);
      throw new LocalEnvironmentError(
        `Docker is installed, but its daemon is unavailable. Start Docker and rerun the command.${detail ? `\n${detail}` : ""}`,
      );
    }

    const pluginArgs = ["compose", "version", "--short"];
    const pluginResult = await run("docker", pluginArgs);

    if (pluginResult.status === 0 && composeMajorVersion(pluginResult) === 2) {
      detectedCompose = { command: "docker", prefix: ["compose"] };
      return detectedCompose;
    }

    const standaloneArgs = ["version", "--short"];
    const standaloneResult = await run("docker-compose", standaloneArgs);

    if (
      standaloneResult.status === 0 &&
      composeMajorVersion(standaloneResult) === 2
    ) {
      detectedCompose = { command: "docker-compose", prefix: [] };
      return detectedCompose;
    }

    throw new LocalEnvironmentError(
      "Docker Compose v2 is required. Install or enable the Docker Compose v2 plugin, then rerun the command.",
    );
  }

  async function fileExists(path) {
    try {
      await access(path, fileSystemConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async function ensureEnvironmentFiles() {
    const created = [];

    for (const filename of [".env", ".env.test"]) {
      const destination = resolve(rootDirectory, filename);

      if (await fileExists(destination)) {
        continue;
      }

      const exampleName = `${filename}.example`;
      const source = resolve(rootDirectory, exampleName);

      if (!(await fileExists(source))) {
        throw new LocalEnvironmentError(
          `Missing ${exampleName}; cannot create ${filename}. Restore the committed example file and rerun setup.`,
        );
      }

      await copyFile(source, destination, fileSystemConstants.COPYFILE_EXCL);
      created.push(filename);
    }

    return created;
  }

  async function readRequiredEnvironmentFile(filename) {
    const path = resolve(rootDirectory, filename);

    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new LocalEnvironmentError(
          `Missing ${filename}. Run "pnpm run setup" to create it from ${filename}.example.`,
          { cause: error },
        );
      }

      throw error;
    }
  }

  async function readDatabaseConfiguration() {
    const developmentEnvironment = parseEnvironment(
      await readRequiredEnvironmentFile(".env"),
    );
    const testEnvironment = parseEnvironment(
      await readRequiredEnvironmentFile(".env.test"),
    );
    const port = validatePort(env, developmentEnvironment);

    return {
      port,
      databaseUrl: validateDatabaseUrl(
        developmentEnvironment.DATABASE_URL,
        "DATABASE_URL",
        DEVELOPMENT_DATABASE,
        port,
      ),
      testDatabaseUrl: validateDatabaseUrl(
        testEnvironment.TEST_DATABASE_URL,
        "TEST_DATABASE_URL",
        TEST_DATABASE,
        port,
      ),
    };
  }

  async function readConfiguredPostgresPort() {
    try {
      const developmentEnvironment = parseEnvironment(
        await readFile(resolve(rootDirectory, ".env"), "utf8"),
      );
      return validatePort(env, developmentEnvironment);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return validatePort(env);
      }

      throw error;
    }
  }

  async function validateComposeDefinition(
    configuration,
    { displayOutput = false } = {},
  ) {
    const port =
      configuration?.port ?? (await readConfiguredPostgresPort());
    const args = ["config", "--format", "json"];
    const resolvedConfiguration = await runCompose(args, {
      port,
      displayOutput,
    });
    assertSuccessful(
      resolvedConfiguration,
      "Trusted Compose definition validation",
      detectedCompose.command,
      composeArguments(args),
    );

    let parsedConfiguration;

    try {
      parsedConfiguration = JSON.parse(resolvedConfiguration.stdout);
    } catch (error) {
      throw new LocalEnvironmentError(
        "Resolved Compose configuration was not valid JSON.",
        { cause: error },
      );
    }

    const serviceNames = Object.keys(
      parsedConfiguration.services ?? {},
    ).sort();
    const volumeNames = Object.keys(parsedConfiguration.volumes ?? {}).sort();
    const postgresService = parsedConfiguration.services?.[POSTGRES_SERVICE];
    const postgresVolume = parsedConfiguration.volumes?.[POSTGRES_VOLUME];
    const labels = postgresVolume?.labels ?? {};
    const postgresEnvironment = postgresService?.environment ?? {};
    const postgresHealthCheck = postgresService?.healthcheck?.test ?? [];
    const postgresPorts = postgresService?.ports ?? [];
    const postgresMounts = postgresService?.volumes ?? [];
    const postgresPort = postgresPorts[0];
    const postgresMount = postgresMounts[0];
    const trusted =
      parsedConfiguration.name === composeIdentity.projectName &&
      serviceNames.length === 1 &&
      serviceNames[0] === POSTGRES_SERVICE &&
      postgresService?.image === "postgres:17-alpine" &&
      postgresEnvironment.POSTGRES_DB === DEVELOPMENT_DATABASE &&
      postgresEnvironment.POSTGRES_USER === "postgres" &&
      postgresEnvironment.POSTGRES_PASSWORD === "postgres" &&
      postgresHealthCheck.length === 2 &&
      postgresHealthCheck[0] === "CMD-SHELL" &&
      postgresHealthCheck[1] ===
        "pg_isready --username=postgres --dbname=madeup_video" &&
      postgresPorts.length === 1 &&
      Number(postgresPort?.target) === 5432 &&
      String(postgresPort?.published) === port &&
      postgresMounts.length === 1 &&
      postgresMount?.type === "volume" &&
      postgresMount?.source === POSTGRES_VOLUME &&
      postgresMount?.target === "/var/lib/postgresql/data" &&
      volumeNames.length === 1 &&
      volumeNames[0] === POSTGRES_VOLUME &&
      postgresVolume?.name === composeIdentity.volumeName &&
      labels["com.madeup-video.course.resource"] ===
        POSTGRES_VOLUME_COURSE_LABEL;

    if (!trusted) {
      throw new LocalEnvironmentError(
        "Resolved Compose configuration does not match the trusted PostgreSQL-only definition. Restore compose.yaml and rerun the command.",
      );
    }

    return parsedConfiguration;
  }

  async function readPostgresLogs({
    displayOutput = false,
    configuration,
  } = {}) {
    const args = [
      "logs",
      "--no-color",
      "--tail",
      "50",
      POSTGRES_SERVICE,
    ];
    const logs = await runCompose(args, {
      displayOutput,
      port: configuration?.port,
    });
    assertSuccessful(
      logs,
      "Reading recent PostgreSQL logs",
      detectedCompose.command,
      composeArguments(args),
    );
    return outputFrom(logs);
  }

  async function waitForPostgres(configuration) {
    const deadline = now() + readinessTimeoutMs;

    while (true) {
      const readiness = await runCompose(
        [
          "exec",
          "--no-TTY",
          POSTGRES_SERVICE,
          "pg_isready",
          "--username=postgres",
          `--dbname=${DEVELOPMENT_DATABASE}`,
        ],
        { port: configuration?.port },
      );

      if (readiness.status === 0) {
        return;
      }

      if (now() >= deadline) {
        const logs = await readPostgresLogs({ configuration });
        throw new LocalEnvironmentError(
          `PostgreSQL did not become healthy within ${readinessTimeoutMs}ms. Recent PostgreSQL logs are included below. Run "pnpm run db:logs" for a fresh view, correct the reported startup problem, and retry.${logs ? `\n${logs}` : ""}`,
        );
      }

      await delay(readinessPollMs);
    }
  }

  async function startDatabase({
    skipPrerequisites = false,
    skipReadiness = false,
    configuration,
  } = {}) {
    if (!skipPrerequisites) {
      await checkPrerequisites();
    }

    const args = ["up", "--detach", POSTGRES_SERVICE];
    const started = await runCompose(args, { port: configuration?.port });

    if (started.status !== 0) {
      const output = outputFrom(started);
      const port = await readConfiguredPostgresPort();

      if (
        /port is already allocated|address already in use|bind.*failed|ports? (?:are|is) not available|only one usage of each socket address/iu.test(
          output,
        )
      ) {
        throw new LocalEnvironmentError(
          `PostgreSQL could not start because host port ${port} is already in use. In .env, set POSTGRES_PORT to an available port and update DATABASE_URL to match; update TEST_DATABASE_URL in .env.test to the same port.\n${output}`,
        );
      }

      assertSuccessful(started, "PostgreSQL startup", detectedCompose.command, [
        ...detectedCompose.prefix,
        ...args,
      ]);
    }

    if (!skipReadiness) {
      await waitForPostgres(configuration);
    }
  }

  async function stopDatabase({ skipPrerequisites = false } = {}) {
    if (!skipPrerequisites) {
      await checkPrerequisites();
    }

    const args = ["stop", POSTGRES_SERVICE];
    const stopped = await runCompose(args);
    assertSuccessful(stopped, "PostgreSQL stop", detectedCompose.command, [
      ...detectedCompose.prefix,
      ...args,
    ]);
  }

  async function showComposeConfiguration({
    skipPrerequisites = false,
  } = {}) {
    if (!skipPrerequisites) {
      await checkPrerequisites();
    }

    const configuration = await readDatabaseConfiguration();
    return validateComposeDefinition(configuration, { displayOutput: true });
  }

  async function showDatabaseLogs({ skipPrerequisites = false } = {}) {
    if (!skipPrerequisites) {
      await checkPrerequisites();
    }

    return readPostgresLogs({ displayOutput: true });
  }

  async function showDatabaseStatus({ skipPrerequisites = false } = {}) {
    if (!skipPrerequisites) {
      await checkPrerequisites();
    }

    const args = ["ps", POSTGRES_SERVICE];
    const status = await runCompose(args, { displayOutput: true });
    assertSuccessful(
      status,
      "Reading PostgreSQL service status",
      detectedCompose.command,
      composeArguments(args),
    );
    return outputFrom(status);
  }

  async function checkDatabaseState({ skipPrerequisites = false } = {}) {
    if (!skipPrerequisites) {
      await checkPrerequisites();
    }

    const configuration = await readDatabaseConfiguration();
    await validateComposeDefinition(configuration);

    const databaseQuery =
      "SELECT datname FROM pg_database WHERE datname IN ('madeup_video','madeup_video_test') ORDER BY datname;";
    const databaseArgs = [
      "exec",
      "--no-TTY",
      POSTGRES_SERVICE,
      "psql",
      "--username=postgres",
      "--dbname=postgres",
      "--tuples-only",
      "--no-align",
      "--command",
      databaseQuery,
    ];
    const inspectedDatabases = await runCompose(databaseArgs, {
      port: configuration.port,
    });
    assertSuccessful(
      inspectedDatabases,
      "Checking course database names",
      detectedCompose.command,
      composeArguments(databaseArgs),
    );

    const databases = inspectedDatabases.stdout
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter(Boolean);

    if (
      databases.length !== 2 ||
      databases[0] !== DEVELOPMENT_DATABASE ||
      databases[1] !== TEST_DATABASE
    ) {
      throw new LocalEnvironmentError(
        `Expected both course databases; received ${databases.join(", ") || "none"}. Run "pnpm run setup" and retry.`,
      );
    }

    const countQuery =
      'SELECT (SELECT count(*) FROM "Title"), (SELECT count(*) FROM "PhysicalCopy"), (SELECT count(*) FROM "Rental");';
    const countArgs = [
      "exec",
      "--no-TTY",
      POSTGRES_SERVICE,
      "psql",
      "--username=postgres",
      `--dbname=${DEVELOPMENT_DATABASE}`,
      "--tuples-only",
      "--no-align",
      "--command",
      countQuery,
    ];
    const inspectedCounts = await runCompose(countArgs, {
      port: configuration.port,
    });
    assertSuccessful(
      inspectedCounts,
      "Checking deterministic development fixtures",
      detectedCompose.command,
      composeArguments(countArgs),
    );

    const [titles, physicalCopies, rentals] = inspectedCounts.stdout
      .trim()
      .split("|")
      .map(Number);

    if (
      ![titles, physicalCopies, rentals].every(Number.isInteger)
    ) {
      throw new LocalEnvironmentError(
        "PostgreSQL returned an invalid fixture-count result.",
      );
    }

    return {
      databases,
      counts: {
        titles,
        physicalCopies,
        rentals,
      },
    };
  }

  async function ensureDatabase(databaseName, configuration) {
    const query =
      `SELECT 1 FROM pg_database WHERE datname = '${databaseName}';`;
    const inspectArgs = [
      "exec",
      "--no-TTY",
      POSTGRES_SERVICE,
      "psql",
      "--username=postgres",
      "--dbname=postgres",
      "-tAc",
      query,
    ];
    const inspected = await runCompose(inspectArgs, {
      port: configuration?.port,
    });
    assertSuccessful(
      inspected,
      `Checking PostgreSQL database "${databaseName}"`,
      detectedCompose.command,
      [...detectedCompose.prefix, ...inspectArgs],
    );

    if (inspected.stdout.trim() === "1") {
      return false;
    }

    const createArgs = [
      "exec",
      "--no-TTY",
      POSTGRES_SERVICE,
      "createdb",
      "--username=postgres",
      databaseName,
    ];
    const created = await runCompose(createArgs, {
      port: configuration?.port,
    });
    assertSuccessful(
      created,
      `Creating PostgreSQL database "${databaseName}"`,
      detectedCompose.command,
      [...detectedCompose.prefix, ...createArgs],
    );
    return true;
  }

  async function runPnpmScript(scriptName, configuration) {
    const args = [scriptName];
    const commandResult = await runPnpm(args, {
      displayOutput: true,
      env: {
        DATABASE_URL: configuration.databaseUrl,
        TEST_DATABASE_URL: configuration.testDatabaseUrl,
      },
    });
    assertSuccessful(
      commandResult,
      `pnpm ${scriptName}`,
      pnpmCommand,
      args,
    );
  }

  async function prepareDatabases(configuration) {
    await ensureDatabase(DEVELOPMENT_DATABASE, configuration);
    await ensureDatabase(TEST_DATABASE, configuration);
    await runPnpmScript("db:generate", configuration);
    await runPnpmScript("db:migrate", configuration);
    await runPnpmScript("db:seed", configuration);
  }

  async function validateToolchain({ requireDatabaseTools = false } = {}) {
    if (nodeVersion !== EXPECTED_NODE_VERSION) {
      throw new LocalEnvironmentError(
        `Node.js ${EXPECTED_NODE_VERSION.slice(1)} is required; received ${nodeVersion.replace(/^v/u, "")}. Activate the declared Node version and rerun setup.`,
      );
    }

    const pnpmVersionArgs = ["--version"];
    const pnpmVersion = await runPnpm(pnpmVersionArgs);
    assertSuccessful(
      pnpmVersion,
      "pnpm prerequisite validation",
      pnpmCommand,
      pnpmVersionArgs,
    );

    if (pnpmVersion.stdout.trim() !== EXPECTED_PNPM_VERSION) {
      throw new LocalEnvironmentError(
        `pnpm ${EXPECTED_PNPM_VERSION} is required; received ${pnpmVersion.stdout.trim() || "unknown"}. Install the declared pnpm version and rerun setup.`,
      );
    }

    if (requireDatabaseTools) {
      for (const [label, executable] of [
        ["Prisma", "prisma"],
        ["TypeScript seed runner", "tsx"],
      ]) {
        const args = ["exec", executable, "--version"];
        const available = await runPnpm(args);
        assertSuccessful(
          available,
          `${label} prerequisite validation`,
          pnpmCommand,
          args,
        );
      }
    }
  }

  async function resetDatabase({
    yes = false,
    skipPrerequisites = false,
    skipReadiness = false,
    prepare = true,
  } = {}) {
    if (!yes) {
      throw new LocalEnvironmentError(
        "Refusing to reset PostgreSQL without --yes. This permanently removes the course Compose volume and all data stored in it.",
      );
    }

    if (!skipPrerequisites) {
      await validateToolchain({ requireDatabaseTools: true });
      await checkPrerequisites();
    }

    const configuration = await readDatabaseConfiguration();
    await validateComposeDefinition(configuration);

    const { projectName, volumeName } = composeIdentity;
    const labelFormat =
      '{{ index .Labels "com.docker.compose.project" }}|{{ index .Labels "com.docker.compose.volume" }}|{{ index .Labels "com.madeup-video.course.resource" }}';
    const inspectVolumeArgs = [
      "volume",
      "inspect",
      volumeName,
      "--format",
      labelFormat,
    ];
    const inspectedVolume = await run("docker", inspectVolumeArgs);

    if (inspectedVolume.status === 0) {
      const expectedLabels =
        `${projectName}|${POSTGRES_VOLUME}|${POSTGRES_VOLUME_COURSE_LABEL}`;

      if (inspectedVolume.stdout.trim() !== expectedLabels) {
        throw new LocalEnvironmentError(
          `Refusing to remove volume "${volumeName}" because its Compose ownership labels do not match "${expectedLabels}".`,
        );
      }
    } else if (
      !/no such volume|not found/iu.test(outputFrom(inspectedVolume))
    ) {
      assertSuccessful(
        inspectedVolume,
        `Inspecting course PostgreSQL volume "${volumeName}"`,
        "docker",
        inspectVolumeArgs,
      );
    }

    const removeContainerArgs = [
      "rm",
      "--force",
      "--stop",
      POSTGRES_SERVICE,
    ];
    const removedContainer = await runCompose(removeContainerArgs);
    assertSuccessful(
      removedContainer,
      "Removing the course PostgreSQL container",
      detectedCompose.command,
      [...detectedCompose.prefix, ...removeContainerArgs],
    );

    if (inspectedVolume.status === 0) {
      const removeVolumeArgs = ["volume", "rm", volumeName];
      const removedVolume = await run("docker", removeVolumeArgs);
      assertSuccessful(
        removedVolume,
        `Removing course PostgreSQL volume "${volumeName}"`,
        "docker",
        removeVolumeArgs,
      );
    }

    await startDatabase({
      skipPrerequisites: true,
      skipReadiness,
      configuration,
    });

    if (prepare) {
      await prepareDatabases(configuration);
    }
  }

  async function setup() {
    await validateToolchain();
    await checkPrerequisites();
    await ensureEnvironmentFiles();
    const configuration = await readDatabaseConfiguration();
    await validateComposeDefinition(configuration);

    const installArgs = ["install", "--frozen-lockfile"];
    const installation = await runPnpm(installArgs, {
      displayOutput: true,
    });
    assertSuccessful(
      installation,
      "Frozen dependency installation",
      pnpmCommand,
      installArgs,
    );

    await startDatabase({
      skipPrerequisites: true,
      configuration,
    });
    await prepareDatabases(configuration);
  }

  return {
    checkDatabaseState,
    checkPrerequisites,
    ensureEnvironmentFiles,
    getComposeIdentity: () => ({ ...composeIdentity }),
    readDatabaseConfiguration,
    resetDatabase,
    showComposeConfiguration,
    showDatabaseLogs,
    showDatabaseStatus,
    setup,
    startDatabase,
    stopDatabase,
    validateToolchain,
    validateComposeDefinition,
  };
}
