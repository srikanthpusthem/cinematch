import assert from "node:assert/strict";
import test from "node:test";
import { marker, matchIssues, run } from "./setup-github-project.mjs";

const plan = {
  repo: "owner/repo",
  projectTitle: "CineMatch",
  milestones: [{ title: "M0 Foundation", description: "Foundation" }],
  issues: [
    {
      key: "first",
      title: "First",
      milestone: "M0 Foundation",
      lane: "Astra",
      criteria: "Pass",
    },
  ],
};

function fakeGitHub({
  scopes = "repo, project",
  issues = [],
  items = [],
  statuses,
} = {}) {
  const state = {
    issues: structuredClone(issues),
    items: structuredClone(items),
    milestones: [],
    labels: [],
    writes: [],
    next: 20,
  };
  const project = {
    id: "project-id",
    number: 3,
    title: "CineMatch",
    url: "https://example.test/project",
  };
  const status = {
    id: "status-id",
    name: "Status",
    options: (
      statuses ?? ["Backlog", "Ready", "In progress", "In review", "Done"]
    ).map((name) => ({ id: name, name })),
  };
  const gh = (args) => {
    const encode = (data) => JSON.stringify(data);
    if (args[0] === "api" && args[1] === "--include")
      return `HTTP/2 200\nx-oauth-scopes: ${scopes}\n\n{}`;
    if (args[0] === "api") {
      const path = args[1].split("?")[0];
      const method = args.includes("--method")
        ? args[args.indexOf("--method") + 1]
        : "GET";
      if (method === "GET") {
        if (path === "repos/owner/repo") return encode({ node_id: "repo-id" });
        if (path.endsWith("/issues")) return encode(state.issues);
        if (path.endsWith("/milestones")) return encode(state.milestones);
        if (path.endsWith("/labels")) return encode(state.labels);
        throw new Error(`Unexpected read ${path}`);
      }
      const body = JSON.parse(args.at(-1).input);
      state.writes.push({ path, method, body });
      if (path === "graphql")
        return encode({ data: { linkProjectV2ToRepository: {} } });
      if (path === "repos/owner/repo/labels") {
        state.labels.push(body);
        return encode(body);
      }
      if (path.endsWith("/milestones")) {
        const m = {
          ...body,
          number: state.milestones.length + 1,
          state: "open",
        };
        state.milestones.push(m);
        return encode(m);
      }
      if (path === "repos/owner/repo/issues") {
        const number = state.next++;
        const issue = {
          ...body,
          number,
          html_url: `https://example.test/issues/${number}`,
          state: "open",
          assignees: [],
          milestone: state.milestones.find((m) => m.number === body.milestone),
          labels: body.labels.map((name) => ({ name })),
        };
        state.issues.push(issue);
        return encode(issue);
      }
      const issue = state.issues.find(
        (i) => i.number === Number(path.split("/")[4]),
      );
      if (issue && path.endsWith("/labels")) {
        for (const name of body.labels)
          if (!issue.labels.some((l) => l.name === name))
            issue.labels.push({ name });
        return encode(issue.labels);
      }
      if (issue && method === "PATCH") {
        Object.assign(
          issue,
          body,
          body.milestone
            ? {
                milestone: state.milestones.find(
                  (m) => m.number === body.milestone,
                ),
              }
            : {},
        );
        return encode(issue);
      }
      throw new Error(`Unexpected write ${path}`);
    }
    if (args[0] === "project") {
      if (args[1] === "list") return encode({ projects: [project] });
      if (args[1] === "field-list") return encode({ fields: [status] });
      if (args[1] === "item-list") return encode({ items: state.items });
      state.writes.push({ args });
      if (args[1] === "item-add") {
        const item = {
          id: `item-${state.items.length}`,
          content: { url: args[args.indexOf("--url") + 1] },
        };
        state.items.push(item);
        return encode(item);
      }
      if (args[1] === "item-edit") {
        state.items.find(
          (i) => i.id === args[args.indexOf("--id") + 1],
        ).status = args[args.indexOf("--single-select-option-id") + 1];
        return "";
      }
    }
    throw new Error(`Unexpected command ${args.join(" ")}`);
  };
  return { state, gh };
}

test("dry run makes no mutations, even with missing labels and milestones", () => {
  const { state, gh } = fakeGitHub();
  run({ gh, plan, log() {} });
  assert.equal(state.writes.length, 0);
});

test("missing project scope stops before mutation", () => {
  const { state, gh } = fakeGitHub({ scopes: "repo, read:project" });
  assert.throws(
    () => run({ gh, plan, dryRun: false, log() {} }),
    /Required project scope/,
  );
  assert.equal(state.writes.length, 0);
});

test("rerun preserves claims, text, assignees and In review without duplicates", () => {
  const { state, gh } = fakeGitHub();
  run({ gh, plan, dryRun: false, log() {} });
  const issue = state.issues[0];
  issue.labels.push({ name: "agent:claude" });
  issue.assignees.push({ login: "someone" });
  issue.body += "\nHuman notes must survive.";
  state.items[0].status = "In review";
  state.writes = [];
  run({ gh, plan, dryRun: false, log() {} });
  assert.equal(state.issues.length, 1);
  assert.equal(state.milestones.length, 1);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].status, "In review");
  assert.ok(issue.body.endsWith("Human notes must survive."));
  assert.ok(issue.labels.some((l) => l.name === "agent:claude"));
  assert.equal(issue.assignees[0].login, "someone");
  assert.ok(state.writes.every((w) => w.path === "graphql"));
});

test("existing issue body is appended, not replaced; closed work is not reopened", () => {
  const old = {
    number: 3,
    title: "First",
    body: "Original acceptance criteria",
    labels: [],
    state: "closed",
    assignees: [],
    html_url: "https://example.test/issues/3",
  };
  const { state, gh } = fakeGitHub({ issues: [old] });
  run({ gh, plan, dryRun: false, log() {} });
  assert.equal(state.issues[0].state, "closed");
  assert.ok(state.issues[0].body.startsWith(old.body));
  assert.ok(state.issues[0].body.includes(marker("first")));
  assert.equal(state.items[0].status, "Backlog");
});

test("stable marker prevents duplication after a human renames the issue", () => {
  const issue = { number: 3, title: "Renamed", body: marker("first") };
  assert.equal(matchIssues(plan, [issue])[0].issue.number, 3);
});

test("ambiguous matches fail rather than selecting or modifying arbitrary work", () => {
  assert.throws(
    () =>
      matchIssues(plan, [
        { number: 1, title: "First" },
        { number: 2, body: marker("first") },
      ]),
    /Ambiguous/,
  );
  assert.throws(
    () =>
      matchIssues({ ...plan, issues: [...plan.issues, ...plan.issues] }, []),
    /Duplicate plan key/,
  );
});

test("populated board with nonstandard statuses is never reset", () => {
  const { state, gh } = fakeGitHub({
    statuses: ["Todo", "Done"],
    items: [{ id: "existing", status: "Todo" }],
  });
  assert.throws(
    () => run({ gh, plan, dryRun: false, log() {} }),
    /Refusing to replace options/,
  );
  assert.equal(state.items[0].status, "Todo");
  assert.equal(state.writes.length, 0);
  assert.ok(
    !state.writes.some((w) => w.body?.query?.includes("updateProjectV2Field")),
  );
});

test("missing explicit historical number cannot be substituted by a title match", () => {
  const numbered = {
    ...plan,
    issues: [{ ...plan.issues[0], existingNumber: 9 }],
  };
  assert.throws(
    () => matchIssues(numbered, [{ number: 10, title: "First" }]),
    /#9 is missing/,
  );
  assert.throws(
    () =>
      matchIssues(numbered, [
        { number: 9, title: "First" },
        { number: 10, body: marker("first") },
      ]),
    /Ambiguous/,
  );
});

test("conflicting milestone fails during dry run without writes", () => {
  const { state, gh } = fakeGitHub({
    issues: [
      { number: 1, title: "First", milestone: { number: 4, title: "Other" } },
    ],
  });
  assert.throws(() => run({ gh, plan, log() {} }), /conflicting milestone/);
  assert.equal(state.writes.length, 0);
});

test("rerun recovers an item when adding succeeds but status initialization fails", () => {
  const { state, gh } = fakeGitHub();
  let fail = true;
  const flaky = (args) => {
    if (args[0] === "project" && args[1] === "item-edit" && fail) {
      fail = false;
      throw new Error("Simulated network failure");
    }
    return gh(args);
  };
  assert.throws(
    () => run({ gh: flaky, plan, dryRun: false, log() {} }),
    /Simulated/,
  );
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].status, undefined);
  run({ gh, plan, dryRun: false, log() {} });
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].status, "Backlog");
});

test("a claimed item with cleared status is not automatically moved", () => {
  const { state, gh } = fakeGitHub();
  run({ gh, plan, dryRun: false, log() {} });
  state.items[0].status = undefined;
  state.issues[0].labels.push({ name: "agent:grok" });
  run({ gh, plan, dryRun: false, log() {} });
  assert.equal(state.items[0].status, undefined);
});
