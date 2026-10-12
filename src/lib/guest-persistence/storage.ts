import type { KeyValueStorage, StorageStatus } from "./types";

/** In-memory KeyValueStorage for unit tests and unavailable-storage fallbacks. */
export function createMemoryStorage(
  initial: Record<string, string> = {},
): KeyValueStorage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

/**
 * Returns browser localStorage when available, otherwise null.
 * Never throws — private-mode / SSR / disabled storage degrade to null.
 */
export function getBrowserLocalStorage(): KeyValueStorage | null {
  try {
    if (typeof globalThis === "undefined") return null;
    const storage = (globalThis as { localStorage?: KeyValueStorage })
      .localStorage;
    if (!storage || typeof storage.getItem !== "function") return null;
    const probeKey = "__cinematch_guest_probe__";
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
}

export function isQuotaExceededError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const err = error as { name?: string; code?: number; message?: string };
  if (err.name === "QuotaExceededError") return true;
  if (err.name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
  // Legacy WebKit / IE numeric codes.
  if (err.code === 22 || err.code === 1014) return true;
  if (
    typeof err.message === "string" &&
    /quota/i.test(err.message) &&
    /exceed/i.test(err.message)
  ) {
    return true;
  }
  return false;
}

export type WriteResult = { status: StorageStatus };

/** Persist a string value; maps QuotaExceeded and other failures to status. */
export function writeStorageValue(
  storage: KeyValueStorage | null | undefined,
  key: string,
  value: string,
): WriteResult {
  if (storage == null) {
    return { status: { ok: false, reason: "unavailable" } };
  }
  try {
    storage.setItem(key, value);
    return { status: { ok: true } };
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return { status: { ok: false, reason: "quota_exceeded" } };
    }
    return { status: { ok: false, reason: "write_failed" } };
  }
}

export function readStorageValue(
  storage: KeyValueStorage | null | undefined,
  key: string,
): { value: string | null; status: StorageStatus } {
  if (storage == null) {
    return { value: null, status: { ok: false, reason: "unavailable" } };
  }
  try {
    return { value: storage.getItem(key), status: { ok: true } };
  } catch {
    return { value: null, status: { ok: false, reason: "unavailable" } };
  }
}

export function clearStorageValue(
  storage: KeyValueStorage | null | undefined,
  key: string,
): WriteResult {
  if (storage == null) {
    return { status: { ok: false, reason: "unavailable" } };
  }
  try {
    storage.removeItem(key);
    return { status: { ok: true } };
  } catch {
    return { status: { ok: false, reason: "write_failed" } };
  }
}
