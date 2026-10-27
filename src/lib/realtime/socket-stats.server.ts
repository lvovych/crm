import 'server-only'
import type {TaggedWebSocket} from '@/app/api/protected/ws/route'
import {roomsOf} from './rooms.server'
import {shared} from './shared-state.server'
/** Kept outside route.ts: Next route modules only allow supported handler exports. */
export function socketStats():{sockets:number;rooms:number}{
 const clients=shared('route.clients',()=>new Set<TaggedWebSocket>())
 let rooms=0
 for(const socket of clients)rooms+=roomsOf(socket).size
 return{sockets:clients.size,rooms}
}
