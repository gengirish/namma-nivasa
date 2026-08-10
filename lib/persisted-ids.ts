/**
 * localStorage-backed slug lists (shortlist, recently viewed) exposed as external stores.
 * `useSyncExternalStore` reads them straight from storage on the client while hydrating
 * against an empty server snapshot, so there is no flash of "nothing saved" and no
 * effect-driven cascade on mount.
 *
 * Keyed by **slug**, not database id. A visitor's shortlist has to survive a reseed, a restore,
 * or a move between environments — none of which preserve a cuid, and all of which preserve the
 * URL the home is published at.
 */
type Listener = () => void;

const EMPTY: readonly string[] = Object.freeze([]);

export interface SlugStore {
  subscribe: (listener: Listener) => () => void;
  getSnapshot: () => readonly string[];
  getServerSnapshot: () => readonly string[];
  set: (next: readonly string[]) => void;
}

function createSlugStore(key: string): SlugStore {
  let cache: readonly string[] | null = null;
  const listeners = new Set<Listener>();

  const read = (): readonly string[] => {
    try {
      const parsed: unknown = JSON.parse(window.localStorage.getItem(key) || "[]");
      return Array.isArray(parsed)
        ? parsed.filter((s): s is string => typeof s === "string")
        : EMPTY;
    } catch {
      return EMPTY;
    }
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      // Keep tabs in step when the same browser has Nivasa open twice.
      const onStorage = (e: StorageEvent) => {
        if (e.key !== key) return;
        cache = null;
        for (const l of listeners) l();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
    getSnapshot() {
      if (cache === null) cache = read();
      return cache;
    },
    getServerSnapshot() {
      return EMPTY;
    },
    set(next) {
      cache = next;
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* private mode / quota — the list still works for this session */
      }
      for (const l of listeners) l();
    },
  };
}

export const savedStore = createSlugStore("nivasa_saved");
export const recentStore = createSlugStore("nivasa_recent");
