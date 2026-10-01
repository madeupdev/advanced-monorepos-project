import { execFileSync } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FULL_SHA = /^[0-9a-f]{40}$/;
const ZERO_SHA = "0".repeat(40);

export class CiBaseError extends Error {}

function requireSha(value, label) {
  if (typeof value !== "string" || !FULL_SHA.test(value)) {
    throw new CiBaseError(`${label} must be a 40-character lowercase full SHA`);
  }
  return value;
}

function git(cwd, args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (allowFailure) return null;
    const detail = error.stderr?.toString().trim();
    throw new CiBaseError(`Git command failed (${args.join(" ")}): ${detail || "repository is unavailable"}`);
  }
}

function verifyRepository(cwd) {
  if (typeof cwd !== "string") throw new CiBaseError("cwd must be a repository directory");
  const actual = git(cwd, ["rev-parse", "HEAD"]);
  if (!FULL_SHA.test(actual)) throw new CiBaseError("checked-out HEAD is not a full commit SHA");
  return actual;
}

function verifyCommit(cwd, value, label) {
  requireSha(value, label);
  const verified = git(cwd, ["rev-parse", "--verify", `${value}^{commit}`], { allowFailure: true });
  if (verified !== value) throw new CiBaseError(`${label} does not name an available commit ref`);
}

function isShallow(cwd) {
  return git(cwd, ["rev-parse", "--is-shallow-repository"]) === "true";
}

function fullResult(head, reason) {
  return { base: head, head, full: true, reason };
}

function selectPullRequest({ event, head, cwd, actual }) {
  const payload = event?.pull_request;
  if (!payload || !payload.base || !payload.head) throw new CiBaseError("pull_request payload must contain base and head refs");
  const base = requireSha(payload.base.sha, "pull_request.base.sha");
  const payloadHead = requireSha(payload.head.sha, "pull_request.head.sha");
  requireSha(head, "head");
  if (payloadHead !== head || actual !== head) throw new CiBaseError("checked-out HEAD must match pull_request.head.sha");
  verifyCommit(cwd, base, "pull_request.base.sha");
  verifyCommit(cwd, payloadHead, "pull_request.head.sha");
  if (isShallow(cwd)) throw new CiBaseError("pull request validation requires a non-shallow history");
  const bases = git(cwd, ["merge-base", "--all", base, payloadHead]).split(/\s+/).filter(Boolean);
  if (bases.length === 0) throw new CiBaseError("pull request has no merge-base; fetch complete history");
  if (bases.length !== 1) throw new CiBaseError("pull request has ambiguous merge-base history");
  return { base: bases[0], head: payloadHead, full: false, reason: "pull request merge-base" };
}

function selectPush({ event, head, cwd, actual, lastSuccessfulSha }) {
  requireSha(head, "head");
  if (actual !== head) throw new CiBaseError("checked-out HEAD must match head");
  const defaultBranch = event?.repository?.default_branch;
  if (typeof defaultBranch !== "string" || !/^[A-Za-z0-9._/-]+$/.test(defaultBranch)) throw new CiBaseError("push payload has no valid default branch");
  const after = requireSha(event?.after, "push.after");
  if (after !== head) throw new CiBaseError("push.after must match checked-out HEAD");
  if (event?.ref !== `refs/heads/${defaultBranch}`) return fullResult(head, "push is not the default branch ref; full validation");
  if (isShallow(cwd)) return fullResult(head, "shallow history; full validation");
  if (event?.before === ZERO_SHA) return fullResult(head, "first push; full validation");
  if (typeof lastSuccessfulSha !== "string" || lastSuccessfulSha === ZERO_SHA) return fullResult(head, "first push; full validation");
  if (!FULL_SHA.test(lastSuccessfulSha)) return fullResult(head, "last successful SHA is unavailable; full validation");
  if (lastSuccessfulSha === head) return fullResult(head, "last successful SHA equals head; full validation");
  if (git(cwd, ["cat-file", "-e", `${lastSuccessfulSha}^{commit}`], { allowFailure: true }) === null) return fullResult(head, "last successful SHA is missing; full validation");
  const ancestor = git(cwd, ["merge-base", "--is-ancestor", lastSuccessfulSha, head], { allowFailure: true });
  if (ancestor === null) return fullResult(head, "last successful SHA is not an ancestor; full validation");
  return { base: lastSuccessfulSha, head, full: false, reason: "last successful default-branch validation" };
}

export function selectRange({ eventName, event, head, lastSuccessfulSha, cwd = process.cwd() }) {
  const actual = verifyRepository(cwd);
  requireSha(head, "head");
  if (actual !== head) throw new CiBaseError("checked-out HEAD must match head");
  if (eventName === "pull_request") return selectPullRequest({ event, head, cwd, actual });
  if (eventName === "push") return selectPush({ event, head, cwd, actual, lastSuccessfulSha });
  return fullResult(head, "unknown event; full validation");
}

function runCli() {
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const result = selectRange({
      eventName: process.env.GITHUB_EVENT_NAME,
      event,
      head: process.env.GITHUB_SHA,
      lastSuccessfulSha: process.env.LAST_SUCCESSFUL_SHA,
      cwd: process.cwd(),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `base=${result.base}\nhead=${result.head}\nfull=${result.full}\nreason=${result.reason}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) runCli();
