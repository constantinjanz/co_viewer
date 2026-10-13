import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { put, head, list, issueSignedToken, presignUrl } from '@vercel/blob';
const source = process.argv[2];
if (!source) throw new Error('Provide the MP4 path.');
const path = process.env.MEDIA_BLOB_PATH || 'media/video.mp4';
const info = await stat(source);
if (info.size < 1_000_000 || info.size > 900_000_000) throw new Error('Web MP4 must be between 1 MB and 900 MB.');
// Leave room for session state. Account-wide usage and the Hobby plan must also
// be checked before this script; deleting objects does not reset prior usage.
let existingBytes = 0;
let cursor;
do {
  const page = await list({ limit: 1000, ...(cursor ? { cursor } : {}) });
  for (const blob of page.blobs) {
    if (blob.pathname === path) throw new Error('The film already exists; refusing a duplicate upload.');
    existingBytes += blob.size;
  }
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);
if (existingBytes + info.size > 950_000_000) throw new Error('Upload would leave insufficient headroom within the 1 GB Hobby allowance.');
let previous = -1;
console.log(JSON.stringify({stage:'upload',bytes:info.size,access:'private'}));
await put(path, createReadStream(source), {access:'private',addRandomSuffix:false,
  allowOverwrite:false,contentType:'video/mp4',multipart:true,
  onUploadProgress:({loaded})=> { const percent=Math.min(100,Math.floor(loaded/info.size*100));
    if(percent>=previous+10){previous=percent;console.log(JSON.stringify({stage:'upload',percent}));}
  },abortSignal:AbortSignal.timeout(35*60*1000)});
const metadata = await head(path);
if(metadata.size!==info.size || metadata.contentType!=='video/mp4')throw new Error('Upload metadata mismatch');
const validUntil=Date.now()+10*60*1000;
const token=await issueSignedToken({pathname:path,operations:['get'],validUntil});
const {presignedUrl}=await presignUrl(token,{operation:'get',pathname:path,access:'private',validUntil});
const {open}=await import('node:fs/promises');
const file=await open(source,'r');
try{
 for(const start of [0,Math.floor(info.size/2),info.size-65536]){
  const end=start+65535;
  const response=await fetch(presignedUrl,{headers:{Range:`bytes=${start}-${end}`}});
  if(response.status!==206)throw new Error('Range request not supported');
  const remote=Buffer.from(await response.arrayBuffer());
  const local=Buffer.alloc(65536);await file.read(local,0,local.length,start);
  if(!local.equals(remote))throw new Error('Range byte mismatch');
 }
}finally{await file.close();}
const anonymous=await fetch(metadata.url,{method:'HEAD'});
if(anonymous.status!==403)throw new Error('Anonymous access not refused');
const receipt={pathname:path,bytes:info.size,contentType:metadata.contentType,privateAccess:true,rangeIntegrity:true,verifiedAt:new Date().toISOString()};
await writeFile('.local/media-receipt.json',JSON.stringify(receipt,null,2));
console.log(JSON.stringify({stage:'verified',...receipt}));
