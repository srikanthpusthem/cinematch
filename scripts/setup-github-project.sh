#!/usr/bin/env bash
# Sets up GitHub Projects tracking for CineMatch: labels, milestones M0-M5,
# 36 issues, and a project board with every issue added.
#
# Prerequisites (one time):
#   brew install gh
#   gh auth login
#   gh auth refresh -s project      # needed for GitHub Projects access
#
# Usage:
#   ./setup-github-project.sh                 # real run
#   DRY_RUN=1 ./setup-github-project.sh       # print what it would do
#   OWNER=yourname REPO=cinematch ./setup-github-project.sh
set -euo pipefail

OWNER="${OWNER:-srikanthpusthem}"
REPO="${REPO:-cinematch}"
PROJECT_TITLE="${PROJECT_TITLE:-CineMatch}"
DRY_RUN="${DRY_RUN:-0}"
FULL="$OWNER/$REPO"
COUNT=0

log() { printf '%s\n' "$*" >&2; }

# Run a gh command, or print it in dry-run mode.
run() {
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY: gh $*"
    return 0
  fi
  gh "$@"
}

if [ "$DRY_RUN" != "1" ]; then
  command -v gh >/dev/null || { log "gh is not installed. Run: brew install gh"; exit 1; }
  gh auth status >/dev/null 2>&1 || { log "Not logged in. Run: gh auth login"; exit 1; }
  if ! gh auth status 2>&1 | grep -q "project"; then
    log "Missing the 'project' scope. Run: gh auth refresh -s project"
    exit 1
  fi
fi

# --- Repo ---
if [ "$DRY_RUN" = "1" ]; then
  log "DRY: ensure repo $FULL exists (create private if missing)"
elif gh repo view "$FULL" >/dev/null 2>&1; then
  log "Repo $FULL exists."
else
  log "Creating private repo $FULL"
  gh repo create "$FULL" --private --add-readme
fi

# --- Labels ---
label() { run label create "$1" --repo "$FULL" --color "$2" --description "$3" --force >/dev/null; }
label feature     0E8A16 "New user-facing or system capability"
label chore       C5DEF5 "Setup, tooling, maintenance"
label research    FBCA04 "Decision or investigation needed"
label bug         D73A4A "Something is broken"
label frontend    1D76DB "UI and client code"
label backend     5319E7 "API, database, server code"
label data        0052CC "Catalog and availability data"
label recommender B60205 "Retrieval, ranking, LLM"
label infra       BFD4F2 "CI, deploys, environments"
label agent:claude 7057FF "Claimed by Claude Code"
label agent:codex  10A37F "Claimed by Codex"
label agent:grok   000000 "Claimed by Grok"
label blocked      E99695 "Cannot proceed, see comments"

# --- Milestones ---
milestone() {
  local title="$1" desc="$2"
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY: milestone '$title'"
    return 0
  fi
  if gh api "repos/$FULL/milestones?state=all&per_page=100" --jq '.[].title' | grep -Fxq "$title"; then
    log "Milestone '$title' exists."
  else
    gh api "repos/$FULL/milestones" -f title="$title" -f description="$desc" >/dev/null
    log "Created milestone '$title'."
  fi
}
milestone "M0 Foundation"        "Repo, CI and preview deploys green; empty app live on a URL"
milestone "M1 Catalog"           "20k+ movies and 5k+ series with metadata and US streaming availability in the database"
milestone "M2 Recommender"       "Given 3 titles and a mood, returns 5 sensible picks in under 3 seconds"
milestone "M3 Product UI"        "Full four-screen flow works on phone and laptop"
milestone "M4 Accounts and polish" "Signed-in sync, PWA install, accessibility pass"
milestone "M5 Beta"              "20 real users have used it and given feedback"

# --- Project board ---
if [ "$DRY_RUN" = "1" ]; then
  PROJECT_NUM="DRY"
  log "DRY: create project '$PROJECT_TITLE' for $OWNER"
else
  EXISTING="$(gh project list --owner "$OWNER" --format json --jq ".projects[] | select(.title==\"$PROJECT_TITLE\") | .number" | head -n1)"
  if [ -n "$EXISTING" ]; then
    PROJECT_NUM="$EXISTING"
    log "Project '$PROJECT_TITLE' exists (#$PROJECT_NUM)."
  else
    PROJECT_NUM="$(gh project create --owner "$OWNER" --title "$PROJECT_TITLE" --format json --jq '.number')"
    log "Created project #$PROJECT_NUM."
  fi
  gh project link "$PROJECT_NUM" --owner "$OWNER" --repo "$FULL" >/dev/null 2>&1 || true
fi

# --- Issues ---
# issue <milestone> <labels> <title> <body>
issue() {
  local ms="$1" labels="$2" title="$3" body="$4" url
  COUNT=$((COUNT + 1))
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY: issue [$ms] ($labels) $title"
    return 0
  fi
  if gh issue list --repo "$FULL" --state all --limit 500 --json title --jq '.[].title' | grep -Fxq "$title"; then
    log "Skip (exists): $title"
    return 0
  fi
  url="$(gh issue create --repo "$FULL" --title "$title" --body "$body" --label "$labels" --milestone "$ms")"
  gh project item-add "$PROJECT_NUM" --owner "$OWNER" --url "$url" >/dev/null
  log "Created: $title"
}

DOD=$'\n\nDefinition of done: merged via PR, CI green, tests for new logic, checked at phone width if it touches UI.'

# M0 Foundation
M="M0 Foundation"
issue "$M" "chore,infra"       "Create repo, add CLAUDE.md, protect main" $'Add CLAUDE.md to the repo root. Enable branch protection on main: require PR and passing CI.'"$DOD"
issue "$M" "chore,frontend"    "Scaffold Next.js with TypeScript, Tailwind, ESLint, Prettier" $'App Router, strict tsconfig, responsive home page that says CineMatch and works at phone width.'"$DOD"
issue "$M" "chore,backend"     "Set up Postgres, migrations and pgvector" $'Local dev database, migration tool, first migration enables the pgvector extension. Document in README.'"$DOD"
issue "$M" "chore,infra"       "GitHub Actions: lint, typecheck, unit tests, Playwright smoke test" $'Runs on every PR. Vitest with one example test; Playwright loads the home page.'"$DOD"
issue "$M" "chore,infra"       "Deploy to Vercel with preview deploys" $'Every PR gets a preview URL; main deploys to production URL.'"$DOD"
issue "$M" "chore,infra"       "Add .env.example and secrets handling" $'Placeholders for DATABASE_URL, TMDB_API_KEY, LLM_API_KEY. Real env files gitignored.'"$DOD"

# M1 Catalog
M="M1 Catalog"
issue "$M" "feature,data"      "TMDB client with rate limiting and typed responses" $'Wrapper around the TMDB API with retry and rate limiting. Typed models for movies, series, seasons, providers.'"$DOD"
issue "$M" "feature,data"      "Import movies into Postgres" $'Import 20k+ movies with title, overview, genres, keywords, runtime, poster, ratings.'"$DOD"
issue "$M" "feature,data"      "Import series with seasons and episode runtimes" $'Import 5k+ series with seasons, episode runtimes and season counts.'"$DOD"
issue "$M" "feature,data"      "Sync US watch-provider availability" $'Store which services each title streams on in the US, with a last-checked date.'"$DOD"
issue "$M" "feature,infra"     "Nightly catalog and availability refresh (Vercel Cron)" $'Scheduled job refreshes changed titles and availability. Logs failures.'"$DOD"
issue "$M" "chore,frontend"    "TMDB and JustWatch attribution in the footer" $'Add required attribution wherever TMDB data and provider data are shown.'"$DOD"
issue "$M" "research,data"     "Decide streaming-availability source and check TMDB commercial terms" $'Compare TMDB watch providers, Watchmode (paid tier from $349/month for commercial use and deeplinks) and Streaming Availability API. Record the decision in the repo. Needed before M5.'

# M2 Recommender
M="M2 Recommender"
issue "$M" "feature,recommender" "Embedding pipeline with pgvector" $'Embed overview, genres and keywords for every title. Store vectors and add an index.'"$DOD"
issue "$M" "feature,recommender" "Taste vector from quiz picks and nearest-neighbor retrieval" $'Taste vector is the average of the picked titles. Return the nearest 50 candidates.'"$DOD"
issue "$M" "feature,recommender" "Hard filters: services, avoided genres, type, length, watched" $'Apply filters to candidates before re-rank. Movie or series toggle applies here.'"$DOD"
issue "$M" "feature,recommender" "LLM re-rank with one-line reasons" $'Given 50 candidates and a mood, return the top 5 with a one-line reason each. The model may only pick from the candidates.'"$DOD"
issue "$M" "feature,recommender" "Offline eval set of 30 hand-checked cases and eval script" $'30 quiz plus mood inputs with hand-checked acceptable outputs. Script reports a pass rate so changes can be compared.'"$DOD"
issue "$M" "chore,backend"     "LLM provider interface, response caching and cost caps" $'Small interface so the provider can be swapped. Cache repeat calls. Cap calls per session.'"$DOD"

# M3 Product UI
M="M3 Product UI"
issue "$M" "feature,frontend"  "Services picker screen" $'Tap the streaming services you have. Skippable, defaults to all.'"$DOD"
issue "$M" "feature,frontend"  "Taste quiz grid screen" $'Visual grid to pick 3 to 5 favorite titles, then genres to avoid.'"$DOD"
issue "$M" "feature,frontend"  "Mood, movie or series toggle, and length screen" $'One tap mood, toggle, and length options for movies and series.'"$DOD"
issue "$M" "feature,frontend"  "Results cards with reasons, services and deep links" $'Five picks with poster, runtime, one-line reason, services, and a Watch now link.'"$DOD"
issue "$M" "feature,frontend"  "Watched, Not for me and Show me more actions" $'Actions update the taste vector through feedback events.'"$DOD"
issue "$M" "feature,frontend"  "Guest session in local storage" $'Keep services, picks and feedback locally with no account.'"$DOD"
issue "$M" "chore,frontend"    "Loading, empty and error states" $'Every screen handles slow, empty and failed responses.'"$DOD"

# M4 Accounts and polish
M="M4 Accounts and polish"
issue "$M" "feature,backend"   "Optional sign-in with Auth.js" $'Sign in is optional. Guests keep working.'"$DOD"
issue "$M" "feature,backend"   "Sync guest data on sign-in" $'Merge local guest data into the account, sync across devices.'"$DOD"
issue "$M" "feature,frontend"  "PWA manifest and install prompt" $'Installable on phone home screen.'"$DOD"
issue "$M" "chore,frontend"    "Accessibility and Lighthouse pass" $'Fix contrast, focus order, labels. Lighthouse accessibility score of 90 or higher.'"$DOD"
issue "$M" "feature,infra"     "Analytics for time to first pick" $'Measure seconds from opening the app to the first result. Privacy-friendly analytics.'"$DOD"

# M5 Beta
M="M5 Beta"
issue "$M" "feature,frontend"  "Landing page" $'Explain the product in one screen with a Start button.'"$DOD"
issue "$M" "feature,frontend"  "Feedback form" $'In-app way to send feedback after results.'"$DOD"
issue "$M" "chore,infra"       "Error monitoring" $'Capture client and server errors with alerts.'"$DOD"
issue "$M" "chore,backend"     "Rate limits per session and IP" $'Limit LLM-backed requests to protect cost.'"$DOD"
issue "$M" "chore"             "Beta invite list and rollout plan" $'Pick 20 people, send invites, collect feedback in one place.'

log ""
log "Done. Processed $COUNT issues."
if [ "$DRY_RUN" != "1" ]; then
  log "Open the board: gh project view $PROJECT_NUM --owner $OWNER --web"
  log "One manual step: in the board's Status field, add an 'In review' option (Settings, Fields, Status)."
fi
