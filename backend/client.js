// Framework-independent browser client; tokens remain in caller memory.
export function createTripClient(baseUrl = '') {
  async function request(path, method, body, token) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
        ...(token ? {Authorization: `Bearer ${token}`} : {}),
      },
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? '요청을 처리하지 못했습니다.');
    return payload;
  }
  return {
    places: () => request('/places', 'GET'),
    calculate: (roomId, token, strategy = 'fairness') => request(`/rooms/${encodeURIComponent(roomId)}/calculate`, 'POST', {strategy}, token),
    createRoom: (input) => request('/rooms', 'POST', input),
    submit: (roomId, memberId, token, input) => request(`/rooms/${encodeURIComponent(roomId)}/submissions/${encodeURIComponent(memberId)}`, 'PUT', input, token),
    getResult: (roomId, token) => request(`/rooms/${encodeURIComponent(roomId)}/results`, 'GET', undefined, token),
  };
}
