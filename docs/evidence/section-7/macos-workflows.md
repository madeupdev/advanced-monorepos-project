# macOS local-development workflow rehearsal

Date: 2026-09-07. Host: macOS (Darwin arm64). Runtime: Node.js 24.18.0,
pnpm 11.17.0, workspace Nx 23.1.1. The worktree used its own `.nx` workspace
data and cache directories. Nx output was non-interactive and cloud access was
disabled.

Readiness means every application required by a profile returned a successful
HTTP response. The API additionally had to return exactly `{"status":"ok"}`
from `/api/health`. Storefront and admin had to return a successful response
from `/`. `workflowReadyMs` is the elapsed time from launching the one Nx child
until the slowest required endpoint met that definition.

Each profile ran three times on a distinct disposable port set. After readiness,
the harness sent one SIGINT to the launcher. Every run exited 130, and every
selected application port was immediately rebound successfully. A separate
listener audit found no process on any of the 24 selected ports.

| Profile | Workflow-ready samples (ms) | Interrupt-to-exit samples (ms) |
| --- | --- | --- |
| API | 5838, 1758, 1757 | 2162, 2156, 2163 |
| Storefront + API | 3354, 3089, 2717 | 2218, 2228, 2222 |
| Admin + API | 1497, 1586, 1600 | 2165, 2173, 2244 |
| Full | 3394, 3023, 3154 | 2213, 2220, 2226 |

The first API sample includes a colder build/cache path and is retained rather
than discarded. These observations describe this host and checkout only; they
are not a universal performance claim.

`corepack pnpm db:status` reported the same PostgreSQL 17 container healthy and
up for two days both before and after the workflow sequence. The development
launcher issued no `db:*`, Docker, or PostgreSQL lifecycle command.

Raw samples, exact ports, per-application readiness, exit codes, and port reuse
are recorded in `startup-observations.json`.

After the lifecycle security review on 2026-09-08, the full profile was also
rehearsed on API/storefront/admin ports 44610/44611/44612. The launcher waited
for API readiness before probing the dependent frontends, then observed API,
admin, and storefront readiness at 7282 ms, 8068 ms, and 8790 ms respectively.
One SIGINT produced exit 130 and all three ports rebound successfully. This
historical run exercises API-first readiness ordering and port cleanup; it was
recorded against a superseded marker-based cleanup prototype and is not
evidence for the final process-group ownership mechanism. The final mechanism
is covered by the controlled-failure evidence and its leader-exit fixture. This
run is not included in the three-sample measurements above.
