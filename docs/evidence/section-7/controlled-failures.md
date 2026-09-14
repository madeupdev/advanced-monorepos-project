# Controlled local-development failures

Date: 2026-09-13. Runtime: Node.js 24.18.0, pnpm 11.17.0, Nx 23.1.1,
macOS (Darwin arm64). PostgreSQL was an independently managed, healthy
PostgreSQL 17 container before and after these rehearsals.

The focused lifecycle suite uses injected clocks, port checks, HTTP probes,
spawn functions, signal sources, a simulated cleanup hook, and fake children.
Those mocked failure demonstrations assert launcher/cleanup-hook behavior;
they are not claims of real process cleanup. The separate localhost
stubborn-child adapter proof requires permission to bind localhost and was run
with that permission.

## Rehearsed failures

1. **Occupied application port.** The injected port check reported admin port
   43122 occupied. The launcher returned a focused recovery message and the
   spawn adapter recorded no call, proving validation occurs before Nx starts.
2. **Unexpected health payload.** The API probe returned
   `{"status":"starting"}`. The launcher failed immediately, named the API and
   endpoint, and invoked the simulated cleanup hook once.
3. **Readiness timeout.** Repeated `ECONNREFUSED` results advanced an injected
   clock to the fixed 30 ms test deadline. The error included the application,
   endpoint, deadline, and last probe result; the simulated cleanup hook ran
   once.
4. **Early child exit.** The fake Nx child exited 17 before readiness. The
   launcher preserved exit code 17 and ran the child-exit cleanup path.

The same mocked suite covers delayed readiness, required-readiness loss after
startup, repeated interrupt coalescing, successful child exit, and listener
removal. The real POSIX leader-exit adapter fixture leaves a child in the
detached leader's group after the leader exits. It ignores SIGINT and SIGTERM,
is escalated to SIGKILL through that root group, and then has its disposable
port rebound immediately by the test.

## Ownership boundary

The launcher spawns exactly one Nx child with structured arguments and
`shell: false`; on POSIX, `detached: true` creates the isolated session and
process group used for cleanup. It forces `NX_DAEMON=false` after caller
environment values are applied. POSIX inspection is a bounded, shell-free
`ps -A -o pid= -o pgid= -o stat=` snapshot. Cleanup owns only the detached
leader's PGID (`child.pid`), ignores every other group, treats `Z` rows as
terminated, and refreshes the exact group before signalling `-child.pid`.
Grace and escalation share one absolute cleanup deadline; ESRCH is accepted
only after a confirming disappearance snapshot, while EPERM with a live group
is surfaced as a cleanup failure.

This is a pragmatic process-group contract, not proof of absolute containment:
a PID/PGID TOCTOU window remains between the final snapshot and the kernel
signal. `setsid`, `setpgid`, job-control changes, and detached descendants that
leave the original group are out of contract. The fixture proves leader-exit
group cleanup and port reuse, not broader process ancestry recovery.

On Windows, the adapter assertions are injected-contract tests only: they
capture root and descendant PID, parent, and creation-time identities, then
model structured `taskkill.exe /PID <pid> /T /F` execution with `shell: false`,
`windowsHide: true`, an `AbortSignal`, and bounded command execution. A
native-Windows-only integration release gate exists, creates and cleans only
its own disposable Node child, and is skipped on other platforms.

`taskkill` accepts only a PID. Even with an immediate identity recheck, a
theoretical destructive PID-reuse TOCTOU remains between that snapshot and the
operating-system action. This boundary is explicit: this work does not add Job
Objects or a generic supervisor to claim stronger Windows containment.

Native Windows and real WSL execution were not run. Both remain explicit
release gates; the POSIX results on this macOS host and the injected Windows
adapter tests must not be presented as substitutes for those platform runs.

Commands used:

```sh
node --test tests/tooling/local-development.test.mjs
corepack pnpm test:tooling
```

The final 2026-09-14 localhost-enabled verification passed 86/87 focused tests
with one intentional native-Windows skip. The full tooling suite passed 251/252
with that same skip. No failure fixture starts, stops, resets, or signals
PostgreSQL.
