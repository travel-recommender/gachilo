/** Bound both connection and body reads; never silently retry a write. */
export const REQUEST_TIMEOUT_MS = 12000;
// The server allows up to 135 seconds for all three candidates.
export const CALCULATE_TIMEOUT_MS = 150000;
export class NetworkRequestError extends Error {
  constructor(message) { super(message); this.name = 'NetworkRequestError'; }
}
/**
 * @param {RequestInfo | URL} url
 * @param {RequestInit} init
 * @param {{fetcher?: typeof fetch, timeoutMs?: number}} options
 * @returns {Promise<{response: Response, value: any}>}
 */
export async function requestJson(url, init = {}, options = {}) {
  const { fetcher = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const external = init.signal;
  if (external?.aborted) throw external.reason;
  let rejectStop;
  /** @type {Promise<never>} */
  const stopped = new Promise((_, reject) => { rejectStop = reject; });
  const abort = () => { rejectStop(external.reason); controller.abort(external.reason); };
  external?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    const error = new NetworkRequestError('서버 응답이 늦어지고 있어요. 연결을 확인한 뒤 다시 시도해 주세요.');
    rejectStop(error); controller.abort(error);
  }, timeoutMs);
  try {
    return await Promise.race([stopped, (async () => {
      try {
        const response = await fetcher(url, { ...init, signal: controller.signal });
        const value = await response.json().catch(error => {
          if (error instanceof SyntaxError) return null;
          throw error;
        });
        return { response, value };
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (error?.name === 'AbortError') throw error;
        throw new NetworkRequestError('서버에 연결하지 못했어요. 연결이 돌아오면 다시 시도해 주세요.');
      }
    })()]);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', abort);
  }
}
