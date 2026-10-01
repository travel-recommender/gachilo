// Poll existing aggregate results; never fetch another member's private input.
export function startStatusPolling({read, onData, onError, active = () => true,
  intervalMs = 3000, maxDelayMs = 30000, schedule = setTimeout, cancel = clearTimeout}) {
  let stopped = false, running = false, timer, controller, failures = 0;
  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      if (active()) {
        controller = new AbortController();
        const data = await read(controller.signal);
        if (!stopped) { failures = 0; onData(data); }
      }
    } catch (e) {
      if (!stopped) { failures++; onError(e); }
    } finally {
      running = false;
      if (!stopped) timer = schedule(tick, Math.min(maxDelayMs, intervalMs * 2 ** Math.min(failures, 4)));
    }
  }
  tick();
  return () => { stopped = true; cancel(timer); controller?.abort(); };
}
