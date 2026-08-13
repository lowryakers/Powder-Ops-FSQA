// Literal routes must be declared BEFORE the /:param route that would match them.
//
// Express matches in declaration order, so `router.put('/:id')` above
// `router.put('/meta')` answers every /meta call with the id handler looking
// for a position called "meta". Nothing errors — the route simply never runs,
// which is why this class survives review and shows up months later as "that
// button has never worked".
//
// This has now happened four times in this codebase (/master.csv on products,
// /batch/send on nfp, /readiness on equipment, /meta on org), so it is checked
// rather than remembered:  node scripts/check-route-order.mjs
//
// Exits non-zero when a literal route is shadowed. A shared prefix is fine —
// only a same-method, same-arity path whose every literal segment matches is
// reported, which is exactly the case Express cannot distinguish.
import fs from 'fs'; import path from 'path';
const dir='server/api';
let found=0;
for (const f of fs.readdirSync(dir).filter(x=>x.endsWith('.js'))) {
  const src=fs.readFileSync(path.join(dir,f),'utf8').split('\n');
  const routes=[];
  src.forEach((l,i)=>{ const m=l.match(/^\s*(?:\w+)?[Rr]outer\.(get|post|put|delete|patch)\(\s*'([^']+)'/);
    if(m) routes.push({m:m[1],p:m[2],line:i+1}); });
  // A literal segment that sits AFTER a param route with the same prefix+arity
  const bad=[];
  for (let i=0;i<routes.length;i++){
    const a=routes[i]; const as=a.p.split('/').filter(Boolean);
    if(!as.some(s=>s.startsWith(':'))) continue;
    for (let j=i+1;j<routes.length;j++){
      const b=routes[j]; if(b.m!==a.m) continue;
      const bs=b.p.split('/').filter(Boolean);
      if(bs.length!==as.length) continue;
      let shadows=true;
      for(let k=0;k<as.length;k++){
        if(as[k].startsWith(':')) { if(bs[k].startsWith(':')) {shadows=false;break;} continue; }
        if(as[k]!==bs[k]){shadows=false;break;}
      }
      if(shadows) bad.push(`${f}: ${b.m.toUpperCase()} '${b.p}' (line ${b.line}) is shadowed by '${a.p}' (line ${a.line})`);
    }
  }
  bad.forEach(x=>{ console.log('  '+x); found++; });
}

if (found) { console.log(`\n${found} shadowed route(s) — move the literal path above the /:param one.`); process.exit(1); }
console.log('No shadowed routes.');
