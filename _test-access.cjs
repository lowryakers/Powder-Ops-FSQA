const http=require('http');const Database=require('better-sqlite3');const {randomUUID}=require('crypto');
const PORT=4617;const DB=process.env.DB_PATH;const BASE=`http://127.0.0.1:${PORT}`;
function req(m,p,b,t){return new Promise((res,rej)=>{const d=b?JSON.stringify(b):null;const r=http.request(BASE+p,{method:m,headers:{'Content-Type':'application/json',...(t?{Authorization:`Bearer ${t}`}:{}),...(d?{'Content-Length':Buffer.byteLength(d)}:{})}},x=>{let s='';x.on('data',c=>s+=c);x.on('end',()=>res({status:x.statusCode,body:s&&s[0]!=='<'?JSON.parse(s):null}))});r.on('error',rej);if(d)r.write(d);r.end()})}
function tok(role){const db=new Database(DB);const u=db.prepare('SELECT * FROM users WHERE role=? LIMIT 1').get(role);const t=randomUUID();db.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,datetime('now','+1 day'))").run(t,u.id);db.close();return{t,id:u.id}}
(async()=>{const admin=tok('admin');const op=tok('operator');let p=0,f=0;const ck=(n,c,e)=>{c?(p++,console.log('  PASS',n)):(f++,console.log('  FAIL',n,e||''))};
// make an extra public channel with no members
const db=new Database(DB);const secret=randomUUID();db.prepare("INSERT INTO chat_channels (id,kind,name,created_by) VALUES (?,'public',?,'system')").run(secret,'warehouse-only');db.close();
const opChans=await req('GET','/api/comms/channels',null,op.t);
const opNames=(opChans.body||[]).map(c=>c.name);
ck('operator sees default channels',opNames.includes('general')&&opNames.includes('announcements'),JSON.stringify(opNames));
ck('operator does NOT see non-member public channel',!opNames.includes('warehouse-only'),JSON.stringify(opNames));
const adminChans=await req('GET','/api/comms/channels',null,admin.t);
ck('admin sees the channel',(adminChans.body||[]).some(c=>c.name==='warehouse-only'),'admin missing it');
// operator cannot read messages of a channel they're not in
const opRead=await req('GET',`/api/comms/channels/${secret}/messages`,null,op.t);
ck('operator blocked from non-member channel messages (404)',opRead.status===404,opRead.status);
// admin adds operator, now visible
await req('POST',`/api/comms/channels/${secret}/members`,{user_ids:[op.id]},admin.t);
const opChans2=await req('GET','/api/comms/channels',null,op.t);
ck('operator sees channel after being added',(opChans2.body||[]).some(c=>c.name==='warehouse-only'),'still hidden');
console.log(`\n${p} passed, ${f} failed`);process.exit(f?1:0)})();
