export interface RoomMember { id: string; name: string; submissionToken: string }
export interface ApiRoom { roomId: string; ownerToken: string; members: RoomMember[] }
export interface ApiPlace { id: string; name: string; category: string }
export interface ApiSubmission { longlist: string[]; picks: string[]; must: string | null; veto: string | null; budgetPerDay: number; stepLimit: number; activeMin: number }
export interface ApiResult { roomId: string; status: 'collecting' | 'awaiting_result' | 'ready'; submittedCount: number; memberCount: number; revision: number; result: null | {strategy: string; days: {date: string; placeIds: string[]}[]; summary: string} }
const BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');
async function request<T>(path: string, method = 'GET', body?: unknown, token?: string): Promise<T> {
  const response = await fetch(BASE + path, {method, cache: 'no-store', headers: {...(body === undefined ? {} : {'Content-Type':'application/json'}), ...(token ? {Authorization: `Bearer ${token}`} : {})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? '서버 요청을 처리하지 못했습니다.');
  return value as T;
}
export const roomApi = {
  places: () => request<{dataset: string; places: ApiPlace[]}>('/places'),
  create: (startDate: string, endDate: string, memberNames: string[]) => request<ApiRoom>('/rooms','POST',{startDate,endDate,memberNames}),
  submit: (room: ApiRoom, member: RoomMember, input: ApiSubmission) => request(`/rooms/${encodeURIComponent(room.roomId)}/submissions/${encodeURIComponent(member.id)}`,'PUT',input,member.submissionToken),
  result: (room: ApiRoom) => request<ApiResult>(`/rooms/${encodeURIComponent(room.roomId)}/results`,'GET',undefined,room.ownerToken),
  calculate: (room: ApiRoom, strategy: string) => request<ApiResult>(`/rooms/${encodeURIComponent(room.roomId)}/calculate`,'POST',{strategy},room.ownerToken),
};
