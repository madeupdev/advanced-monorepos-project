import { spawn as nodeSpawn } from 'node:child_process';

const DEFAULT_MAX_DIAGNOSTIC_BYTES = 32 * 1024;

export function createControlledEnvironment({
  inherited,
  home,
  cache,
  databaseUrl,
  testDatabaseUrl,
}) {
  const environment = {
    PATH: inherited.PATH,
    HOME: home,
    XDG_CACHE_HOME: cache,
    NX_CACHE_DIRECTORY: `${cache}/nx`,
    CI: 'true',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: testDatabaseUrl,
  };
  return Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value !== undefined),
  );
}

function redact(value, sensitiveValues) {
  let redacted = value;
  for (const sensitive of [...new Set(sensitiveValues)]
    .filter((item) => typeof item === 'string' && item.length > 0)
    .sort((left, right) => right.length - left.length)) {
    redacted = redacted.replaceAll(sensitive, '[REDACTED]');
  }
  return redacted;
}

export function runTrustedCommand(
  command,
  {
    cwd,
    environment,
    spawn = nodeSpawn,
    sensitiveValues,
    maxDiagnosticBytes = DEFAULT_MAX_DIAGNOSTIC_BYTES,
  },
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.arguments, {
      cwd,
      env: environment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let diagnostics = '';
    let truncated = false;
    const retain = (chunk) => {
      if (diagnostics.length >= maxDiagnosticBytes) {
        truncated = true;
        return;
      }
      const remaining = maxDiagnosticBytes - diagnostics.length;
      const text = Buffer.from(chunk).toString('utf8');
      diagnostics += text.slice(0, remaining);
      if (text.length > remaining) truncated = true;
    };
    child.stdout.on('data', retain);
    child.stderr.on('data', retain);
    child.once('error', (error) => {
      reject(new Error(
        `Could not execute ${command.executable}: ${redact(error.message, sensitiveValues)}`,
      ));
    });
    child.once('close', (exitCode, signal) => {
      if (exitCode === 0) {
        resolve({ exitCode, diagnostics: redact(diagnostics, sensitiveValues) });
        return;
      }
      const status = signal === null
        ? `exit ${String(exitCode)}`
        : `signal ${String(signal)}`;
      const detail = diagnostics.trim() === ''
        ? ''
        : `\n${redact(diagnostics.trim(), sensitiveValues)}`;
      const suffix = truncated ? '\n[diagnostics truncated]' : '';
      reject(new Error(`Command ${command.executable} failed with ${status}${detail}${suffix}`));
    });
  });
}

export async function runTrustedStateCommands(state, options) {
  const commands = [
    state.trustedCI.install,
    ...state.trustedCI.setup,
    ...state.trustedCI.database,
    ...state.trustedCI.verification,
  ];
  for (const command of commands) {
    await runTrustedCommand(command, options);
  }
}
