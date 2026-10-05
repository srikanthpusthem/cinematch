import type {
  DerivedFeedbackState,
  GuestFeedbackEvent,
  GuestFeedbackKind,
  GuestPersistedSnapshot,
} from "./types";

/** Maps #27 PickFeedbackAction values onto persisted taste kinds. */
export function mapPickFeedbackAction(
  action: "watched" | "like" | "not-for-me",
): GuestFeedbackKind {
  if (action === "not-for-me") return "dislike";
  return action;
}

/**
 * Stable default ID for a feedback attempt. Callers may pass their own ID;
 * retries with the same ID are first-write-wins (idempotent).
 * After an undo, use a fresh ID (e.g. bump attempt) to re-apply the same kind.
 */
export function createFeedbackEventId(
  kind: GuestFeedbackKind,
  contentId: string,
  attempt = 1,
): string {
  return attempt <= 1
    ? `${kind}:${contentId}`
    : `${kind}:${contentId}:${attempt}`;
}

export function createUndoEventId(targetEventId: string): string {
  return `undo:${targetEventId}`;
}

export function createFeedbackEvent(
  kind: GuestFeedbackKind,
  contentId: string,
  id?: string,
): GuestFeedbackEvent {
  return {
    id: id ?? createFeedbackEventId(kind, contentId),
    kind,
    contentId,
  };
}

export function createUndoEvent(
  targetEventId: string,
  id?: string,
): Extract<GuestFeedbackEvent, { kind: "undo" }> {
  return {
    id: id ?? createUndoEventId(targetEventId),
    kind: "undo",
    targetEventId,
  };
}

type ActiveEvent = Exclude<GuestFeedbackEvent, { kind: "undo" }>;

/**
 * Replay the event log with first-write-wins IDs (matches taste-vector).
 * Duplicate IDs and repeated undos do not change derived effects.
 */
export function deriveFeedbackState(
  snapshot: Pick<GuestPersistedSnapshot, "events">,
): DerivedFeedbackState {
  const seenEventIds = new Set<string>();
  const activeEvents = new Map<string, ActiveEvent>();
  const orderedActiveIds: string[] = [];

  for (const event of snapshot.events) {
    if (seenEventIds.has(event.id)) {
      continue;
    }
    seenEventIds.add(event.id);

    if (event.kind === "undo") {
      if (activeEvents.delete(event.targetEventId)) {
        const index = orderedActiveIds.indexOf(event.targetEventId);
        if (index >= 0) orderedActiveIds.splice(index, 1);
      }
      continue;
    }

    activeEvents.set(event.id, event);
    orderedActiveIds.push(event.id);
  }

  const suppressed = new Set<string>();
  const liked = new Set<string>();
  const disliked = new Set<string>();
  const skipped = new Set<string>();

  for (const event of activeEvents.values()) {
    if (event.kind === "watched") {
      suppressed.add(event.contentId);
      continue;
    }
    if (event.kind === "like") {
      liked.add(event.contentId);
      continue;
    }
    if (event.kind === "dislike") {
      disliked.add(event.contentId);
      continue;
    }
    skipped.add(event.contentId);
  }

  const sortIds = (ids: Set<string>) => [...ids].sort();

  return {
    suppressedContentIds: sortIds(suppressed),
    likedContentIds: sortIds(liked),
    dislikedContentIds: sortIds(disliked),
    skippedContentIds: sortIds(skipped),
    appliedEventIds: [...activeEvents.keys()],
    latestApplicableEventId:
      orderedActiveIds.length === 0
        ? null
        : orderedActiveIds[orderedActiveIds.length - 1]!,
  };
}

/**
 * Append an event idempotently. If the ID was already present, the snapshot
 * is unchanged and `applied` is false.
 */
export function appendEvent(
  snapshot: GuestPersistedSnapshot,
  event: GuestFeedbackEvent,
): { snapshot: GuestPersistedSnapshot; applied: boolean } {
  if (snapshot.events.some((existing) => existing.id === event.id)) {
    return { snapshot, applied: false };
  }
  return {
    snapshot: {
      ...snapshot,
      events: [...snapshot.events, event],
    },
    applied: true,
  };
}

/**
 * Undo the latest still-active feedback event by appending an undo record.
 * Returns undoneEventId null when there is nothing to undo or the undo ID
 * was already recorded (idempotent replay).
 */
export function undoLatestEvent(
  snapshot: GuestPersistedSnapshot,
  undoEventId?: string,
): {
  snapshot: GuestPersistedSnapshot;
  undoneEventId: string | null;
  applied: boolean;
} {
  const derived = deriveFeedbackState(snapshot);
  if (derived.latestApplicableEventId == null) {
    return { snapshot, undoneEventId: null, applied: false };
  }

  const undo = createUndoEvent(derived.latestApplicableEventId, undoEventId);
  const next = appendEvent(snapshot, undo);
  if (!next.applied) {
    return {
      snapshot: next.snapshot,
      undoneEventId: null,
      applied: false,
    };
  }
  return {
    snapshot: next.snapshot,
    undoneEventId: derived.latestApplicableEventId,
    applied: true,
  };
}
