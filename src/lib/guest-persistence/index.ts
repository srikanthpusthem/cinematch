/**
 * Versioned guest localStorage for answers + result feedback.
 *
 * Isolated from the Results UI (#27): export this API and wire later.
 * Never stores credentials, provider responses, embedding vectors, or prompts.
 */

export {
  GUEST_PERSISTENCE_SCHEMA_VERSION,
  GUEST_PERSISTENCE_STORAGE_KEY,
  emptySnapshot,
  parseGuestAnswers,
  parseFeedbackEvent,
  type GuestFeedbackEvent,
  type GuestFeedbackKind,
  type GuestPersistedSnapshot,
  type KeyValueStorage,
  type StorageStatus,
  type StorageFailureReason,
  type DerivedFeedbackState,
} from "./types";

export {
  createMemoryStorage,
  getBrowserLocalStorage,
  isQuotaExceededError,
} from "./storage";

export { parseSnapshot, migrateOrReset } from "./schema";

export {
  mapPickFeedbackAction,
  createFeedbackEventId,
  createUndoEventId,
  createFeedbackEvent,
  createUndoEvent,
  deriveFeedbackState,
  appendEvent,
  undoLatestEvent,
} from "./events";

export {
  loadGuestPersistence,
  saveGuestAnswers,
  appendFeedbackEvent,
  recordFeedback,
  undoLatestFeedback,
  clearGuestPersistence,
  type GuestPersistenceResult,
  type AppendFeedbackResult,
  type UndoResult,
} from "./store";
