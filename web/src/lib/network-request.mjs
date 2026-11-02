/** Bound both connection and body reads; never silently retry a write. */
export const REQUEST_TIMEOUT_MS = 12000;
// CandidateEngine (merged from #52/#53) bounds all three candidates at 135s.
export const CALCULATE_TIMEOUT_MS = 150000;
// Creating/claiming a seat is not idempotent. Leave headroom above SQLite's 10s wait.
export const CREATE_TIMEOUT_MS = 60000;
export const SCHEDULABLE_TIMEOUT_MS = 70000;
export const REJOIN_UNCERTAIN = 'PIN 재접속 결과를 확인하지 못했어요. 서버 실행·연결 상태를 확인한 뒤 PIN 재접속을 다시 시도해 주세요.';
export const CREATE_UNCERTAIN = '방 생성 결과를 확인하지 못했어요. 서버 연결을 확인하고, 이미 생성된 방 화면·초대 링크가 있는지 살펴본 뒤 다시 시도해 주세요.';
export const JOIN_UNCERTAIN = '참여 결과를 확인하지 못했어요. 서버 연결 후 초대 링크에서 내 상태를 확인해 주세요. 참여 중이면 PIN으로 재접속하고, PIN이 없으면 방장이 새 방을 만들어야 해요.';
export class NetworkRequestError extends Error {
  constructor(message) { super(message); this.name = 'NetworkRequestError'; }
}
/**
 * @param {RequestInfo | URL} url
 * @param {RequestInit} init
 * @param {{fetcher?: typeof fetch, timeoutMs?: number, uncertainMessage?: string}} options
 * @returns {Promise<{response: Response, value: any}>}
 */
export async function requestJson(url, init = {}, options = {}) {
  const { fetcher = fetch, timeoutMs = REQUEST_TIMEOUT_MS, uncertainMessage } = options;
  const controller = new AbortController();
  const external = init.signal;
  if (external?.aborted) throw external.reason;
  let rejectStop;
  /** @type {Promise<never>} */
  const stopped = new Promise((_, reject) => { rejectStop = reject; });
  const abort = () => { rejectStop(external.reason); controller.abort(external.reason); };
  external?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    const error = new NetworkRequestError(uncertainMessage || '서버 응답이 늦어지고 있어요. 연결을 확인한 뒤 다시 시도해 주세요.');
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
        // Fetch rejection cannot distinguish refusal from a lost response after a write.
        throw new NetworkRequestError(uncertainMessage || '서버 응답을 받지 못했어요. 서버가 실행 중인지와 연결 상태를 확인해 주세요. 연결이 돌아오면 다시 시도해 주세요.');
      }
    })()]);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', abort);
  }
}
