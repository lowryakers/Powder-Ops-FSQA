const http=require('http');const Database=require('better-sqlite3');const {randomUUID}=require('crypto');
const PORT=4625;const DB=process.env.DB_PATH;const BASE=`http://127.0.0.1:${PORT}`;
function req(m,p,b,t){return new Promise((res,rej)=>{const d=b?JSON.stringify(b):null;const r=http.request(BASE+p,{method:m,headers:{'Content-Type':'application/json',...(t?{Authorization:`Bearer ${t}`}:{}),...(d?{'Content-Length':Buffer.byteLength(d)}:{})}},x=>{let s='';x.on('data',c=>s+=c);x.on('end',()=>res({status:x.statusCode,body:s&&s[0]!=='<'?JSON.parse(s):null}))});r.on('error',rej);if(d)r.write(d);r.end()})}
function tokById(id){const db=new Database(DB);const t=randomUUID();db.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,datetime('now','+1 day'))").run(t,id);db.close();return t}
(async()=>{let p=0,f=0;const ck=(n,c,e)=>{c?(p++,console.log('  PASS',n)):(f++,console.log('  FAIL',n,e||''))};
const db=new Database(DB);const admin=db.prepare("SELECT * FROM users WHERE role='admin' LIMIT 1").get();const general=db.prepare("SELECT * FROM chat_channels WHERE name='general'").get();db.close();
const tok=tokById(admin.id);
const parent=await req('POST',`/api/comms/channels/${general.id}/messages`,{body:'parent message'},tok);
ck('parent posted',parent.status<300,parent.status);
const r1=await req('POST',`/api/comms/channels/${general.id}/messages`,{body:'first reply',parent_id:parent.body.id},tok);
const r2=await req('POST',`/api/comms/channels/${general.id}/messages`,{body:'second reply',parent_id:parent.body.id},tok);
ck('replies posted',r1.status<300&&r2.status<300,`${r1.status}/${r2.status}`);
// main list should NOT include replies, and parent should show reply_count 2
const list=await req('GET',`/api/comms/channels/${general.id}/messages`,null,tok);
const parentInList=list.body.find(m=>m.id===parent.body.id);
const replyInList=list.body.find(m=>m.id===r1.body.id);
ck('replies excluded from main list',!replyInList,'reply leaked to main list');
ck('parent shows reply_count=2',parentInList&&parentInList.reply_count===2,parentInList&&parentInList.reply_count);
// thread endpoint returns parent + 2 replies in order
const thread=await req('GET',`/api/comms/messages/${parent.body.id}/thread`,null,tok);
ck('thread 200',thread.status===200,thread.status);
ck('thread parent matches',thread.body.parent.id===parent.body.id,'parent mismatch');
ck('thread has 2 replies in order',thread.body.replies.length===2&&thread.body.replies[0].body==='first reply',JSON.stringify(thread.body.replies.map(x=>x.body)));
console.log(`\n${p} passed, ${f} failed`);process.exit(f?1:0)})();
