// Single-flight plus a small in-memory cache of finished briefs, per instance.
// The key is built only from the allow-listed inputs (brand, market, goal, age); entries hold the event list of the
// run (the same events the SSE stream sends), nothing about the visitor. Only complete, error-free runs are kept.
const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 60;

export const flightKey = ({ brand, market, goal, age }) => [brand, market, goal, age || ''].map((s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()).join('|');

export function createFlights({ ttl = TTL_MS, max = MAX_ENTRIES } = {}) {
  const done = new Map(); // key -> { events, at }
  const live = new Map(); // key -> { events, subs, promise }

  const lookup = (key, now = Date.now()) => {
    const hit = done.get(key);
    if (hit && now - hit.at < ttl) return hit;
    if (hit) done.delete(key);
    return null;
  };

  // work(emit) runs the agent; errors become a final 'error' event via fail(e) so every subscriber sees them.
  function start(key, work, fail) {
    const entry = { events: [], subs: new Set() };
    const emit = (type, data) => {
      const ev = { type, data };
      entry.events.push(ev);
      entry.subs.forEach((fn) => { try { fn(ev); } catch { /* subscriber went away */ } });
    };
    live.set(key, entry);
    entry.promise = (async () => {
      let ok = true;
      try {
        await work(emit);
        emit('done', {});
      } catch (e) {
        ok = false;
        emit('error', fail(e));
      } finally {
        live.delete(key);
      }
      if (ok && entry.events.some((e) => e.type === 'brief') && !entry.events.some((e) => e.type === 'error')) {
        if (done.size >= max) done.delete(done.keys().next().value);
        done.set(key, { events: entry.events, at: Date.now() });
      }
    })();
    return entry;
  }

  return {
    cached: (key) => lookup(key),
    inFlight: (key) => live.get(key) || null,
    start,
    size: () => done.size,
    clear: () => { done.clear(); live.clear(); },
  };
}

// Replays what a flight has produced so far, then follows it live. Resolves when the run ends.
export async function follow(entry, onEvent) {
  entry.events.slice().forEach(onEvent);
  entry.subs.add(onEvent);
  try { await entry.promise; } finally { entry.subs.delete(onEvent); }
}
