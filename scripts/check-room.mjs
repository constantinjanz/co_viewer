import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const origin=process.argv[2] || 'http://localhost:3001';
const code=(await readFile('.local/room-code.txt','utf8')).trim();
const tokens=[];
const protectionHeaders=process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? {'x-vercel-protection-bypass':process.env.VERCEL_AUTOMATION_BYPASS_SECRET} : {};
async function api(path,method='GET',body,token){
 const response=await fetch(`${origin}${path}`,{method,headers:{...protectionHeaders,Origin:origin,...(token?{Authorization:`Bearer ${token}`}:{ }),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
 const data=await response.json().catch(()=>null);return {status:response.status,data};
}
try{
 assert.equal((await api('/api/access')).status,401);
 assert.equal((await api('/api/room')).status,401);
 assert.equal((await api('/api/media')).status,401);
 const invalid=await api('/api/access','POST',{code:'invalid-code-123456'});
 assert.equal(invalid.status,401);
 assert.equal(invalid.data.film,undefined);
 const foreignGate=await fetch(`${origin}/api/access`,{method:'POST',headers:{...protectionHeaders,Origin:'https://unrelated.example','Content-Type':'application/json'},body:JSON.stringify({code})});assert.equal(foreignGate.status,403);
 const unlocked=await api('/api/access','POST',{code});assert.equal(unlocked.status,200);
 const accessToken=unlocked.data.accessToken;assert.equal(typeof accessToken,'string');assert.ok(unlocked.data.film.title);assert.ok(unlocked.data.film.duration>0);assert.equal(unlocked.data.media,undefined);
 const restored=await api('/api/access','GET',undefined,accessToken);assert.equal(restored.status,200);assert.deepEqual(restored.data,unlocked.data);
 assert.equal((await api('/api/room','GET',undefined,accessToken)).status,401);
 assert.equal((await api('/api/media','GET',undefined,accessToken)).status,401);
 const joined=await Promise.all(['Probe A','Probe B'].map(name=>api('/api/join','POST',{accessToken,name})));
 for(const value of joined){assert.equal(value.status,200);tokens.push(value.data.token);}
 assert.equal((await api('/api/join','POST',{accessToken,name:'Probe C'})).status,409);
 let room=(await api('/api/room','GET',undefined,tokens[0])).data;
 assert.equal(room.members.length,2);
 const command={commandId:randomUUID(),kind:'seek',position:120,paused:true,baseRevision:room.playback.revision};
 const moved=await api('/api/room','POST',command,tokens[0]);assert.equal(moved.status,200);
 const duplicate=await api('/api/room','POST',command,tokens[0]);assert.equal(duplicate.status,200);assert.equal(duplicate.data.playback.revision,moved.data.playback.revision);
 const other=(await api('/api/room','GET',undefined,tokens[1])).data;assert.equal(other.playback.position,120);assert.equal(other.playback.paused,true);
 const stale=await api('/api/room','POST',{...command,commandId:randomUUID(),kind:'play'},tokens[1]);assert.equal(stale.status,409);
 room=(await api('/api/room','POST',{commandId:randomUUID(),kind:'play',position:120,paused:false,baseRevision:other.playback.revision},tokens[1])).data;
 assert.equal(room.playback.paused,false);
 const playing=(await api('/api/room','GET',undefined,tokens[0])).data;assert.equal(playing.playback.paused,false);assert.equal(playing.playback.revision,room.playback.revision);
 room=(await api('/api/room','POST',{commandId:randomUUID(),kind:'pause',position:123,paused:true,baseRevision:room.playback.revision},tokens[0])).data;assert.equal(room.playback.paused,true);
 const heartbeat=await api('/api/heartbeat','POST',undefined,tokens[0]);assert.equal(heartbeat.status,200);assert.equal(heartbeat.data.playback.revision,room.playback.revision);
 const forbidden=await fetch(`${origin}/api/heartbeat`,{method:'POST',headers:{...protectionHeaders,Origin:'https://unrelated.example',Authorization:`Bearer ${tokens[0]}`}});assert.equal(forbidden.status,403);
 const media=await api('/api/media','GET',undefined,tokens[0]);assert.equal(media.status,200);assert.ok(media.data.url.startsWith('https://'));
 const range=await fetch(media.data.url,{headers:{Range:'bytes=0-63'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,64);
 const reset=await api('/api/room','POST',{commandId:randomUUID(),kind:'seek',position:0,paused:true,baseRevision:room.playback.revision},tokens[0]);assert.equal(reset.status,200);
 console.log(JSON.stringify({status:'passed',checks:['private-metadata-gate','wrong-code','cross-origin-gate-refused','lobby-token-is-not-membership','gate-restoration','concurrent-two-person-join','third-person-refused','seek-visible-to-peer','command-replay','stale-command-refused','play-and-pause','heartbeat-preserves-playback','cross-origin-refused','signed-video-range']}));
}catch(error){console.error(JSON.stringify({status:'failed',type:error.name,message:error.message.slice(0,200)}));process.exitCode=1;}
finally{for(const token of tokens){const left=await api('/api/leave','POST',undefined,token);if(left.status!==200)console.log(JSON.stringify({cleanup:'leave-failed',status:left.status}));}}
