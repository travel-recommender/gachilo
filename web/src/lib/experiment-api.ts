import { request } from './room-api';
import type { RoomSession } from '../components/store';
import type { Letter } from './experiment';
export type SurveyState = {roomId:string;memberId:string;revision:number;candidateHash:string;seat:number;slots:{letter:Letter;order:number;explained:boolean}[];pre:Record<string,unknown>|null;answers:Partial<Record<Letter,Record<string,number>>>;viewed:Letter[];post:Record<string,unknown>|null;candidatesReady:boolean};
export function experimentResponse(room:RoomSession,body?:unknown) {
 return request<SurveyState>(`/rooms/${encodeURIComponent(room.roomId)}/experiment/${encodeURIComponent(room.memberId)}`,body===undefined?'GET':'PUT',body,room.token);
}
