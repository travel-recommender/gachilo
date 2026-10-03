export function createTripClient(baseUrl = '') {
  async function request(path, method, body, token, signal, timeoutMs = 15000) {
    const timeout = new AbortController();
    const abort = () => timeout.abort();
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await fetch(baseUrl + path, {
        method, signal: timeout.signal,
        headers: {
          ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
          ...(token ? {Authorization: `Bearer ${token}`} : {}),
        },
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) {
        const error = new Error(payload.error ?? '요청을 처리하지 못했습니다.');
        error.status = response.status;
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  return {
    places: () => request('/places', 'GET'),
    realPlaces: () => request('/api/places?limit=150', 'GET'),
    room: (roomId, token) => request(`/rooms/${encodeURIComponent(roomId)}`, 'GET', undefined, token),
    ownSubmission: (roomId, memberId, token) => request(`/rooms/${encodeURIComponent(roomId)}/submissions/${encodeURIComponent(memberId)}`, 'GET', undefined, token),
    calculate: (roomId, token, strategy = 'fairness') => request(`/rooms/${encodeURIComponent(roomId)}/calculate`, 'POST', {strategy}, token, undefined, 45000),
    createRoom: input => request('/rooms', 'POST', input),
    submit: (roomId, memberId, token, input) => request(`/rooms/${encodeURIComponent(roomId)}/submissions/${encodeURIComponent(memberId)}`, 'PUT', input, token),
    getResult: (roomId, token, signal) => request(`/rooms/${encodeURIComponent(roomId)}/results`, 'GET', undefined, token, signal),
  };
}
