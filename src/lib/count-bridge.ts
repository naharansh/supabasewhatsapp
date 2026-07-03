type Counts = { contactCount: number; messageCount: number };
type Updater = (counts: Counts) => void;

let updater: Updater | null = null;

export function registerUpdater(fn: Updater): () => void {
  updater = fn;
  return () => { updater = null; };
}

export function pushCounts(contactCount: number, messageCount: number): void {
  updater?.({ contactCount, messageCount });
}
