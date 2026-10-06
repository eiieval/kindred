// The one shared flight registry for /api/agent and /api/brief, and the generic error shape of a failed run.
import { createFlights, flightKey, follow } from './flights.js';
import { publicMessage, errorCode } from './errors.js';

// Runs in progress on this instance (agent and compare share the concurrency cap).
export const load = { running: 0 };
export const flights = createFlights();
export { flightKey, follow };

export function failure(e) {
  if (!e?.public) console.error('[agent]', e);
  return { message: publicMessage(e), code: errorCode(e) };
}
