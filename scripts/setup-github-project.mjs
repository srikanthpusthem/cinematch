import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const marker = (key) => `<!-- cinematch-plan:${key} -->`;

export function matchIssues(plan, existing) {
  const keys = new Set();
  const matched = new Set();
  return plan.issues.map((entry) => {
    if (keys.has(entry.key))
      throw new Error(`Duplicate plan key: ${entry.key}`);
    keys.add(entry.key);
    if (!plan.milestones.some((m) => m.title === entry.milestone))
      throw new Error(`Unknown milestone: ${entry.milestone}`);
    if (
      entry.existingNumber &&
      !existing.some((issue) => issue.number === entry.existingNumber)
    )
      throw new Error(
        `Expected existing issue #${entry.existingNumber} is missing.`,
      );
    const candidates = existing.filter(
      (issue) =>
        issue.number === entry.existingNumber ||
        issue.body?.includes(marker(entry.key)) ||
        issue.title === entry.title,
    );
    if (candidates.length > 1)
      throw new Error(
        `Ambiguous existing issues for ${entry.key}; resolve manually.`,
      );
    const issue = candidates[0];
    if (entry.existingNumber && !issue)
      throw new Error(
        `Expected existing issue #${entry.existingNumber} is missing.`,
      );
    if (issue && matched.has(issue.number))
      throw new Error(`Issue #${issue.number} matches multiple plan entries.`);
    if (issue) matched.add(issue.number);
    return { entry, issue };
  });
}

export function run({ gh, log = console.log, dryRun = true, plan }) {
  const [owner] = plan.repo.split("/");
  const json = (...args) => JSON.parse(gh(args));
  const api = (path, method, data) =>
    json("api", path, "--method", method, "--input", "-", {
      input: JSON.stringify(data),
    });
  const pages = (path) => {
    const values = [];
    for (let page = 1; ; page++) {
      const batch = json(
        "api",
        `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
      values.push(...batch);
      if (batch.length < 100) return values;
    }
  };
  const headers = gh(["api", "--include", "user"]);
  const scopes = headers
    .match(/^x-oauth-scopes:\s*(.*)$/im)?.[1]
    ?.split(",")
    .map((x) => x.trim());
  if (!scopes?.includes("project"))
    throw new Error(
      "Required project scope missing. Run: gh auth refresh -h github.com -s project",
    );
  const repo = json("api", `repos/${plan.repo}`);
  const existing = pages(`repos/${plan.repo}/issues?state=all`).filter(
    (i) => !i.pull_request,
  );
  const matches = matchIssues(plan, existing);
  const milestones = pages(`repos/${plan.repo}/milestones?state=all`);
  const labels = pages(`repos/${plan.repo}/labels`);
  const projects = json(
    "project",
    "list",
    "--owner",
    owner,
    "--limit",
    "100",
    "--format",
    "json",
  ).projects.filter((p) => p.title === plan.projectTitle && !p.closed);
  if (projects.length > 1)
    throw new Error("Multiple active CineMatch boards; resolve manually.");
  let project = projects[0];
  const desired = ["Backlog", "Ready", "In progress", "In review", "Done"];
  const readStatus = () =>
    json(
      "project",
      "field-list",
      String(project.number),
      "--owner",
      owner,
      "--format",
      "json",
    ).fields.find((f) => f.name === "Status");
  let status = project ? readStatus() : undefined;
  const inventory = project
    ? json(
        "project",
        "item-list",
        String(project.number),
        "--owner",
        owner,
        "--limit",
        "1000",
        "--format",
        "json",
      )
    : { items: [] };
  const items = inventory.items;
  if (inventory.totalCount > items.length)
    throw new Error(
      "Board inventory truncated; refusing to operate with incomplete state.",
    );
  if (
    items.length &&
    !desired.every((name) => status?.options?.some((o) => o.name === name))
  )
    throw new Error(
      "Existing board has nonstandard statuses. Refusing to replace options or erase progress; configure five statuses manually and rerun.",
    );
  for (const { entry, issue } of matches) {
    if (issue?.milestone && issue.milestone.title !== entry.milestone)
      throw new Error(
        `Issue #${issue.number} has a conflicting milestone; resolve manually.`,
      );
    if (
      !issue &&
      milestones.some(
        (m) => m.title === entry.milestone && m.state === "closed",
      )
    )
      throw new Error(
        `Refusing new work in closed milestone ${entry.milestone}`,
      );
  }
  const neededLabels = [
    ...["astra", "claude", "codex", "grok"].map((name) => ({
      name: `agent:${name}`,
      color: "7057ff",
      description: `Active claim by ${name}; not a future assignment`,
    })),
    {
      name: "blocked",
      color: "d73a4a",
      description: "Cannot proceed; see issue explanation",
    },
    ...["Astra", "Claude", "Grok", "Owner", "Unassigned"].map((name) => ({
      name: `lane:${name.toLowerCase()}`,
      color: "0075ca",
      description: `Suggested ${name} lane; does not reserve or claim work`,
    })),
  ];
  log(`${dryRun ? "DRY RUN — no writes" : "APPLY"}: ${plan.repo}`);
  log(
    `${project ? "Reuse" : "Create"} project: ${project?.url ?? plan.projectTitle}`,
  );
  for (const label of neededLabels)
    if (!labels.some((l) => l.name === label.name))
      log(`Create label ${label.name}`);
  for (const milestone of plan.milestones) {
    const count = matches.filter(
      ({ entry }) => entry.milestone === milestone.title,
    ).length;
    log(
      `${milestones.some((m) => m.title === milestone.title) ? "Reuse" : "Create"} milestone ${milestone.title}: ${count} planned issues`,
    );
  }
  for (const { entry, issue } of matches)
    log(
      `${issue ? `Reuse #${issue.number}` : "Create"}: ${entry.title} [${entry.lane}]`,
    );
  log(
    `Total: ${matches.length} planned issues; ${matches.filter((m) => !m.issue).length} new.`,
  );
  if (dryRun) return;

  for (const label of neededLabels)
    if (!labels.some((l) => l.name === label.name))
      api(`repos/${plan.repo}/labels`, "POST", label);
  for (const milestone of plan.milestones)
    if (!milestones.some((m) => m.title === milestone.title))
      milestones.push(api(`repos/${plan.repo}/milestones`, "POST", milestone));
  if (!project)
    project = json(
      "project",
      "create",
      "--owner",
      owner,
      "--title",
      plan.projectTitle,
      "--format",
      "json",
    );
  const graphql = (query, variables) => {
    const result = api("graphql", "POST", { query, variables });
    if (result.errors) throw new Error(JSON.stringify(result.errors));
    return result.data;
  };
  graphql(
    "mutation($p:ID!,$r:ID!){linkProjectV2ToRepository(input:{projectId:$p,repositoryId:$r}){repository{id}}}",
    { p: project.id, r: repo.node_id },
  );
  status ??= readStatus();
  if (!desired.every((name) => status?.options?.some((o) => o.name === name))) {
    if (items.length)
      throw new Error(
        "Existing board has nonstandard statuses. Refusing to replace options or erase progress; configure five statuses manually and rerun.",
      );
    const colors = ["GRAY", "BLUE", "YELLOW", "PURPLE", "GREEN"];
    const result = graphql(
      "mutation($f:ID!,$o:[ProjectV2SingleSelectFieldOptionInput!]!){updateProjectV2Field(input:{fieldId:$f,singleSelectOptions:$o}){projectV2Field{... on ProjectV2SingleSelectField{id options{id name}}}}}",
      {
        f: status.id,
        o: desired.map((name, i) => ({
          name,
          color: colors[i],
          description: name,
        })),
      },
    );
    status = result.updateProjectV2Field.projectV2Field;
  }
  for (const { entry, issue: previous } of matches) {
    let issue = previous;
    const milestone = milestones.find((m) => m.title === entry.milestone);
    if (milestone.state === "closed" && !issue)
      throw new Error(
        `Refusing new work in closed milestone ${milestone.title}`,
      );
    const body = `${marker(entry.key)}\n\n## Acceptance criteria\n\n${entry.criteria}\n\n## Coordination\n\nSuggested lane: **${entry.lane}** (not an active claim). Follow AGENTS.md and ${project.url}. M1+ stays Backlog until M0 is complete and Srikanth explicitly opens those lanes.\n\n${entry.blocked ? "Blocked: requires owner action or completion evidence; see acceptance criteria." : "Only claim when Ready, unassigned, unblocked, and without an active agent claim."}\n\n## Verification\n\nReport commands and results, assumptions and failures. One issue per branch/PR; owner reviews and merges. No public link before LLM session/IP caps are verified; owner handles Vercel/account/billing steps.\n`;
    if (!issue) {
      issue = api(`repos/${plan.repo}/issues`, "POST", {
        title: entry.title,
        body,
        milestone: milestone.number,
        labels: [
          `lane:${entry.lane.toLowerCase()}`,
          ...(entry.blocked ? ["blocked"] : []),
        ],
      });
    } else {
      // Keep existing text, assignees, active labels and state. Do not reopen work.
      const patch = {};
      if (!issue.body?.includes(marker(entry.key)))
        patch.body = `${issue.body ?? ""}\n\n---\n\n${body}`;
      if (!issue.milestone) patch.milestone = milestone.number;
      else if (issue.milestone.number !== milestone.number)
        throw new Error(
          `Issue #${issue.number} has a conflicting milestone; resolve manually.`,
        );
      if (Object.keys(patch).length)
        issue = api(
          `repos/${plan.repo}/issues/${issue.number}`,
          "PATCH",
          patch,
        );
      const addedLabels = [`lane:${entry.lane.toLowerCase()}`];
      if (
        entry.blocked &&
        !previous.body?.includes(marker(entry.key)) &&
        previous.state === "open"
      )
        addedLabels.push("blocked");
      if (
        addedLabels.some((name) => !issue.labels.some((l) => l.name === name))
      )
        api(`repos/${plan.repo}/issues/${issue.number}/labels`, "POST", {
          labels: addedLabels,
        });
    }
    const existingItem = items.find(
      (item) => (item.content?.url ?? item.url) === issue.html_url,
    );
    const recoverUninitialized =
      existingItem &&
      !existingItem.status &&
      issue.body?.includes(marker(entry.key)) &&
      !issue.assignees?.length &&
      !issue.labels.some((l) => l.name.startsWith("agent:"));
    if (!existingItem || recoverUninitialized) {
      const item =
        existingItem ??
        json(
          "project",
          "item-add",
          String(project.number),
          "--owner",
          owner,
          "--url",
          issue.html_url,
          "--format",
          "json",
        );
      // Closed historical issues are not automatically declared verified/done.
      gh([
        "project",
        "item-edit",
        "--id",
        item.id,
        "--project-id",
        project.id,
        "--field-id",
        status.id,
        "--single-select-option-id",
        status.options.find((o) => o.name === "Backlog").id,
      ]);
    }
    log(`#${issue.number} ${entry.title}`);
  }
  log(`Board: ${project.url}`);
  log(
    "Existing board statuses preserved; new work starts in Backlog. No agent is automatically assigned or launched.",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.env.DRY_RUN && !["0", "1"].includes(process.env.DRY_RUN))
      throw new Error("DRY_RUN must be 0 or 1.");
    const plan = JSON.parse(
      readFileSync(new URL("./project-plan.json", import.meta.url), "utf8"),
    );
    run({
      plan,
      dryRun: process.env.DRY_RUN !== "0",
      gh(args) {
        const options = typeof args.at(-1) === "object" ? args.pop() : {};
        return execFileSync("gh", args, {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
          ...options,
        });
      },
    });
  } catch (error) {
    console.error(error.stderr?.toString() || error.message);
    process.exitCode = 1;
  }
}
