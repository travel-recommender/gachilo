// Credentials are kept in this tab's sessionStorage, never in localStorage.
const KEY = 'capstone.room-session.v1';
const secret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,256}$/.test(value);
export function readInvite(href) {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const query = url.searchParams;
  const hasInvite = p => ['room', 'm', 't'].some(k => p.has(k));
  if (!hasInvite(hash) && !hasInvite(query)) return null;
  const p = hasInvite(hash) ? hash : query;
  const roomId = p.get('room'), memberId = p.get('m'), token = p.get('t');
  if (p.get('role') === 'owner' && secret(roomId) && secret(token) && !p.has('m'))
    return {version: 1, role: 'owner', roomId, token};
  if (![roomId, memberId, token].every(secret)) throw new Error('초대 링크가 올바르지 않아요. 받은 링크를 다시 확인해 주세요.');
  return {version: 1, roomId, memberId, token};
}
export function inviteUrl(origin, roomId, member) {
  if (![roomId, member.id, member.submissionToken].every(secret)) throw new Error('초대 정보를 확인해 주세요.');
  const url = new URL('/join', origin);
  url.hash = new URLSearchParams({room: roomId, m: member.id, t: member.submissionToken}).toString();
  return url.href;
}
export function ownerUrl(origin, roomId, token) {
  if (![roomId, token].every(secret)) throw new Error('방장 접속 정보를 확인해 주세요.');
  const url = new URL('/join', origin);
  url.hash = new URLSearchParams({room: roomId, role: 'owner', t: token}).toString();
  return url.href;
}
export function validSession(s) {
  return s?.version === 1 && secret(s.roomId) && secret(s.token) &&
    (s.role === 'owner' || secret(s.memberId));
}
export function saveSession(storage, session) {
  if (!validSession(session)) throw new Error('접속 정보를 확인해 주세요.');
  // Store only the active identity, never every participant's credentials.
  storage.setItem(KEY, JSON.stringify(session.role === 'owner'
    ? {version: 1, role: 'owner', roomId: session.roomId, token: session.token}
    : {version: 1, roomId: session.roomId, memberId: session.memberId, token: session.token}));
}
export function loadSession(storage) {
  try { const s = JSON.parse(storage.getItem(KEY)); return validSession(s) ? s : null; }
  catch { return null; }
}
export function clearSession(storage) { storage.removeItem(KEY); }
