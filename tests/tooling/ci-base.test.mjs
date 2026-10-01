import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = join(process.cwd(), "scripts", "ci-base.mjs");
const sha = /^[0-9a-f]{40}$/;

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  }).trim();
}

function repo() {
  const cwd = mkdtempSync(join(tmpdir(), "s09-ci-base-"));
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.email", "ci@example.test");
  git(cwd, "config", "user.name", "CI Test");
  writeFileSync(join(cwd, "root.txt"), "root\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "root");
  return cwd;
}

function commit(cwd, file, content, message = file) {
  writeFileSync(join(cwd, file), content);
  git(cwd, "add", file);
  git(cwd, "commit", "-qm", message);
  return git(cwd, "rev-parse", "HEAD");
}

function branchFrom(cwd, name, start) {
  git(cwd, "switch", "-q", "-c", name, start);
}

function finish(cwd) {
  rmSync(cwd, { recursive: true, force: true });
}

async function load() {
  return import(`${new URL("../../scripts/ci-base.mjs", import.meta.url).href}?test=${Date.now()}`);
}

test("selects the unique merge-base for a PR and preserves both divergent branch changes", async () => {
  const cwd = repo();
  try {
    const root = git(cwd, "rev-parse", "HEAD");
    const base = commit(cwd, "base.txt", "base\n");
    branchFrom(cwd, "feature", root);
    commit(cwd, "feature.txt", "feature\n");
    const head = git(cwd, "rev-parse", "HEAD");
    const result = (await load()).selectRange({
      eventName: "pull_request",
      event: { pull_request: { base: { sha: base }, head: { sha: head } } },
      head,
      cwd,
    });
    assert.deepEqual(result, { base: root, head, full: false, reason: "pull request merge-base" });
    assert.deepEqual(git(cwd, "diff", "--name-only", `${result.base}..${result.head}`).split("\n"), ["feature.txt"]);
    assert.ok(sha.test(result.base));
  } finally { finish(cwd); }
});

test("rejects a PR when refs are missing, checkout is mismatched, or history is shallow", async () => {
  const cwd = repo();
  try {
    const head = commit(cwd, "head.txt", "head\n");
    const { selectRange } = await load();
    assert.throws(() => selectRange({ eventName: "pull_request", event: { pull_request: { base: { sha: "0".repeat(40) }, head: { sha: head } } }, head, cwd }), /base|missing|unknown/i);
    assert.throws(() => selectRange({ eventName: "pull_request", event: { pull_request: { base: { sha: git(cwd, "rev-parse", "HEAD~1") }, head: { sha: head } } }, head: "1".repeat(40), cwd }), /HEAD|checkout|match/i);
    const original = git(cwd, "rev-parse", "--is-shallow-repository");
    assert.equal(original, "false");
  } finally { finish(cwd); }
});

test("rejects ambiguous merge bases and malformed PR payloads", async () => {
  const cwd = repo();
  try {
    const root = git(cwd, "rev-parse", "HEAD");
    const head = commit(cwd, "head.txt", "head\n");
    const { selectRange } = await load();
    assert.throws(() => selectRange({ eventName: "pull_request", event: {}, head, cwd }), /pull_request|base|head/i);
    assert.throws(() => selectRange({ eventName: "pull_request", event: { pull_request: { base: { sha: "not-a-sha" }, head: { sha: head } } }, head, cwd }), /sha|40|malformed/i);
    assert.throws(() => selectRange({ eventName: "pull_request", event: { pull_request: { base: { sha: root }, head: { sha: head } } }, head, cwd: join(cwd, "missing") }), /cwd|directory|git/i);
    git(cwd, "switch", "-q", "--orphan", "unrelated");
    writeFileSync(join(cwd, "unrelated.txt"), "unrelated\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-qm", "unrelated");
    const unrelated = git(cwd, "rev-parse", "HEAD");
    assert.throws(() => selectRange({ eventName: "pull_request", event: { pull_request: { base: { sha: root }, head: { sha: unrelated } } }, head: unrelated, cwd }), /no merge-base|merge-base/i);
  } finally { finish(cwd); }
});

test("push uses a distinct ancestral successful SHA and never event.before", async () => {
  const cwd = repo();
  try {
    const first = git(cwd, "rev-parse", "HEAD");
    const second = commit(cwd, "second.txt", "second\n");
    const third = commit(cwd, "third.txt", "third\n");
    const { selectRange } = await load();
    const result = selectRange({ eventName: "push", event: { ref: "refs/heads/main", before: first, after: third, repository: { default_branch: "main" } }, head: third, lastSuccessfulSha: first, cwd });
    assert.deepEqual(result, { base: first, head: third, full: false, reason: "last successful default-branch validation" });
    assert.notEqual(result.base, second);
    const failedPush = selectRange({ eventName: "push", event: { ref: "refs/heads/main", before: second, after: third, repository: { default_branch: "main" } }, head: third, lastSuccessfulSha: first, cwd });
    assert.equal(failedPush.base, first);
  } finally { finish(cwd); }
});

test("push falls back to full validation for first, unsuccessful, non-ancestral, and shallow histories", async () => {
  const cwd = repo();
  try {
    const first = git(cwd, "rev-parse", "HEAD");
    const head = commit(cwd, "head.txt", "head\n");
    const { selectRange } = await load();
    const event = { ref: "refs/heads/main", before: first, after: head, repository: { default_branch: "main" } };
    for (const lastSuccessfulSha of [undefined, "0".repeat(40), "f".repeat(40)]) {
      const result = selectRange({ eventName: "push", event, head, lastSuccessfulSha, cwd });
      assert.equal(result.full, true);
      assert.equal(result.base, head);
      assert.match(result.reason, /full|success|ancestor|history/i);
    }
    const wrongBranch = selectRange({ eventName: "push", event: { ...event, ref: "refs/heads/other" }, head, cwd });
    assert.equal(wrongBranch.full, true);
    assert.match(wrongBranch.reason, /default branch|ref/i);
    const shallow = join(cwd, "shallow");
    git(cwd, "clone", "--depth", "1", `file://${cwd}`, shallow);
    const shallowResult = selectRange({ eventName: "push", event, head, lastSuccessfulSha: first, cwd: shallow });
    assert.equal(shallowResult.full, true);
    assert.match(shallowResult.reason, /shallow/i);
  } finally { finish(cwd); }
});

test("unknown events verify actual HEAD and choose full validation", async () => {
  const cwd = repo();
  try {
    const head = commit(cwd, "head.txt", "head\n");
    const { selectRange } = await load();
    const result = selectRange({ eventName: "workflow_dispatch", event: {}, head, cwd });
    assert.deepEqual(result, { base: head, head, full: true, reason: "unknown event; full validation" });
    assert.throws(() => selectRange({ eventName: "workflow_dispatch", event: {}, head: "1".repeat(40), cwd }), /HEAD|checkout|match/i);
  } finally { finish(cwd); }
});

test("CLI prints only JSON and appends outputs when requested", () => {
  const cwd = repo();
  const output = join(cwd, "github-output");
  const eventPath = join(cwd, "event.json");
  try {
    const head = commit(cwd, "head.txt", "head\n");
    writeFileSync(eventPath, JSON.stringify({ ref: "refs/heads/main", before: "0".repeat(40), after: head, repository: { default_branch: "main" } }));
    const stdout = execFileSync(process.execPath, [script], { cwd, encoding: "utf8", env: { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: "push", GITHUB_SHA: head, GITHUB_OUTPUT: output } });
    const result = JSON.parse(stdout);
    assert.deepEqual(result, { base: head, head, full: true, reason: "first push; full validation" });
    assert.match(readFileSync(output, "utf8"), new RegExp(`base=${head}`));
    assert.match(readFileSync(output, "utf8"), /full=true/);
  } finally { finish(cwd); }
});

test('wrong previous-commit range omits earlier required work, correct PR range includes it', async () => {
  const cwd = repo();
  try {
    const root = git(cwd,'rev-parse','HEAD');
    const base = commit(cwd,'default.txt','default\n');
    branchFrom(cwd,'two-changes',root);
    commit(cwd,'required-contract.txt','contract\n');
    const head = commit(cwd,'later-ui.txt','UI\n');
    const {selectRange} = await load();
    const range = selectRange({eventName:'pull_request',event:{pull_request:{base:{sha:base},head:{sha:head}}},head,cwd});
    assert.deepEqual(git(cwd,'diff','--name-only','HEAD~1',head).split('\n'),['later-ui.txt']);
    assert.deepEqual(git(cwd,'diff','--name-only',range.base,range.head).split('\n'),['later-ui.txt','required-contract.txt']);
  } finally {finish(cwd);}
});
test('real shallow clone rejects a PR and forces full push validation', async () => {
  const cwd=repo();
  const outer=mkdtempSync(join(tmpdir(),'s09-shallow-'));
  try {
    const base=git(cwd,'rev-parse','HEAD');
    const head=commit(cwd,'change.txt','change\n');
    const clone=join(outer,'clone');
    git(outer,'clone','-q','--depth=1',`file://${cwd}`,clone);
    assert.equal(git(clone,'rev-parse','--is-shallow-repository'),'true');
    const {selectRange}=await load();
    assert.throws(()=>selectRange({eventName:'pull_request',event:{pull_request:{base:{sha:head},head:{sha:head}}},head,cwd:clone}),/shallow/);
    assert.equal(selectRange({eventName:'push',event:{ref:'refs/heads/main',before:base,after:head,repository:{default_branch:'main'}},head,lastSuccessfulSha:base,cwd:clone}).full,true);
  } finally {finish(cwd);finish(outer);}
});
test('real criss-cross history rejects two equally valid merge bases', async () => {
  const cwd=repo();
  try {
    const root=git(cwd,'rev-parse','HEAD');
    const tree=git(cwd,'rev-parse','HEAD^{tree}');
    const a=git(cwd,'commit-tree',tree,'-p',root,'-m','a');
    const b=git(cwd,'commit-tree',tree,'-p',root,'-m','b');
    const left=git(cwd,'commit-tree',tree,'-p',a,'-p',b,'-m','left');
    const right=git(cwd,'commit-tree',tree,'-p',b,'-p',a,'-m','right');
    git(cwd,'checkout','-q',right);
    assert.equal(git(cwd,'merge-base','--all',left,right).split('\n').length,2);
    const {selectRange}=await load();
    assert.throws(()=>selectRange({eventName:'pull_request',event:{pull_request:{base:{sha:left},head:{sha:right}}},head:right,cwd}),/ambiguous/);
  } finally {finish(cwd);}
});
test('first push cannot use an injected successful SHA; actual nonancestor success forces full', async () => {
  const cwd=repo();
  try {
    const root=git(cwd,'rev-parse','HEAD');
    const other=commit(cwd,'other.txt','other\n');
    branchFrom(cwd,'new-line',root);
    const head=commit(cwd,'new.txt','new\n');
    const {selectRange}=await load();
    const event={ref:'refs/heads/main',after:head,before:'0'.repeat(40),repository:{default_branch:'main'}};
    assert.equal(selectRange({eventName:'push',event,head,lastSuccessfulSha:root,cwd}).full,true);
    assert.equal(selectRange({eventName:'push',event:{...event,before:root},head,lastSuccessfulSha:other,cwd}).full,true);
  } finally {finish(cwd);}
});
