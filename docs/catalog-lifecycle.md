# Catalog lifecycle

What happens when a TMDB record disappears, comes back, or turns into a
different work (issue #70). Code: `src/catalog/lifecycle.ts` (pure rules),
`lifecycle-service.ts` (repository contract and operator report),
`lifecycle-store.ts` (Postgres, table `title_lifecycle` from migration 0002).

**Titles are never deleted by the lifecycle.** The internal `titles.id` is
stable through every transition, so feedback and other references stay valid.

## States

| Status        | Meaning                                                    | Recommendable |
| ------------- | ---------------------------------------------------------- | ------------- |
| _(no row)_    | Not yet observed by a lifecycle run; treated as active     | yes           |
| `active`      | Last observation found the record                          | yes           |
| `unavailable` | Recently missing from the source; may be a transient issue | no            |
| `tombstoned`  | Missing for a sustained period, or source id reused        | no            |

`isPresentable(record)` is the single check for "may this title be shown?"

## Observations

A refresh run reports one observation per title:

- `found`: the source returned the record, with its identity (title and release year).
- `missing`: the source answered but the record is gone (HTTP 404 or an empty body).
- `error`: timeout, outage, 5xx or malformed data. **This says nothing about the
  record and never changes its state.**

## Transitions (default policy)

| From \ observed | found                                                   | missing                                                                                                         |
| --------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| _(no row)_      | `active` (`first_seen`)                                 | `unavailable` (`first_seen_missing`)                                                                            |
| `active`        | `active` (`seen`)                                       | `unavailable`, `missingSince` set (`became_unavailable`)                                                        |
| `unavailable`   | `active` (`recovered`)                                  | `tombstoned` / `source_deleted` once **≥ 3 consecutive misses span ≥ 7 days**; else stays (`still_unavailable`) |
| `tombstoned`    | `active`, `restoredAt`, `restoreCount + 1` (`restored`) | stays (`still_tombstoned`)                                                                                      |

**Source-id collision:** if a `found` observation's identity differs from the
stored one in an identity-sensitive way (the release year moved by **more than
one year** _and_ the accent-, case- and punctuation-insensitive title changed),
the old title is tombstoned with reason `source_id_collision` and the run emits a
`create_new_title` action. A rename alone, or a date correction alone, is an
ordinary update.

Executing `create_new_title` is an **operator follow-up**, not automatic. The new
work can't reuse the old title's `(kind, tmdb_id)` key until that key is released,
which needs a follow-up decision.

**Idempotency:**

- An observation carrying the run id already recorded is ignored
  (`ignored_duplicate_run`).
- One older than the last observation is ignored (`ignored_out_of_order`).
- A batch is applied in (time, run id, title id) order, so input order doesn't matter.

## Availability expiry

Availability (`title_availability.fetched_at`) expires independently of title
metadata. `presentableAvailability(offers, checkedAt, now)` returns:

- `current` with the offers while the check is ≤ 48 hours old
- `stale` with **no offers** after that, so the UI shows "last checked" instead
  and stale offers are never presented as current
- `unknown` if the title was never checked

## Retention and purge

`purgeEligibility(record, feedbackReferences, now)` is a **policy output only**.
A record is eligible when it has been tombstoned for ≥ 180 days and has zero
feedback references. Unknown feedback references (`null`) mean "keep".
Feedback isn't stored yet, so the operator summary reports
`purgeEligible: null` with `purgeBlockedReason: "feedback_references_unknown"`.
There is **no purge command**. Adding one would need its own reviewed issue.

## Operator reports

`applyObservations` returns, per run:

- observation count
- events by type
- the status of each observed title afterward
- newly tombstoned counts by reason
- restores
- titles left unchanged by errors
- `create_new_title` actions

`createLifecycleStore(db).summary(now)` returns catalog-wide counts:

- titles, and titles not yet observed
- counts by status
- tombstones by reason
- how many are past retention

## Policy defaults

`DEFAULT_LIFECYCLE_POLICY`:

- tombstone after 3 misses spanning 7 days
- availability max age 48 hours
- retention 180 days

The nightly refresh (#8) will feed observations. Wiring it is part of #8, not #70.
