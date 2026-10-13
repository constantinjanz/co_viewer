import {randomBytes,createHash} from 'node:crypto';
import {writeFile,appendFile} from 'node:fs/promises';
const raw=randomBytes(10).toString('hex').toUpperCase();
const code=raw.match(/.{1,4}/g).join('-');
const values={ROOM_CODE_HASH:createHash('sha256').update(raw).digest('hex'),SESSION_SECRET:randomBytes(48).toString('base64url'),MEDIA_BLOB_PATH:'media/video.mp4',VERCEL_BLOB_RETRIES:'1'};
await writeFile('.local/room-code.txt',code);
for(const [key,value] of Object.entries(values)){await writeFile(`.local/${key}.txt`,value);await appendFile('.env.local',`\n${key}=${value}\n`);}
console.log('Room credentials generated in ignored local files.');
