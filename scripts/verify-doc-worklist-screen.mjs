import { chromium } from 'playwright-core';
const APP = process.env.APP || 'http://localhost:4882';
let pass=0,fail=0; const t=(n,c,d='')=>{if(c){pass++;console.log('  ✓ '+n)}else{fail++;console.log('  ✗ '+n+(d?' — '+d:''))}};
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p=await b.newPage({viewport:{width:1280,height:1000}});
const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text())}); p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
await p.goto(APP+'/',{waitUntil:'domcontentloaded'});
await p.fill('input[name="name"], input[placeholder*="ame" i]','Dani Control').catch(()=>{});
await p.fill('input[type="password"]','DocSecret2026');
await p.click('button[type="submit"]'); await p.waitForTimeout(2500);
await p.goto(APP+'/?tab=doc-review',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(3000);
const body=await p.locator('body').innerText();
t('the worklist is on the Document Control screen', /Revisions to work through/i.test(body));
t('it says how much is handled', /of\s+\d+\s+handled/i.test(body), body.slice(0,300));
t('nothing is applied until ticked, in words', /nothing is applied until you tick it/i.test(body));
t('there is an Add documents control', await p.locator('label', {hasText:/Add documents/}).count()===1);

// File a real revision through the SCREEN and work it.
const fileInput = p.locator('input[type="file"]').first();
const fs = await import('fs');
fs.writeFileSync('/tmp/SOP-777_Browser_Test_V9.md','# Browser Test Procedure\n\nRevision: V9\nEffective date: 2026-09-01\n\nA finalised body long enough for the proposal to offer it.');
// the document must exist to match
await p.evaluate(async () => {
  await fetch('/api/documents', { method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('auth_token')},
    body: JSON.stringify({ doc_type:'sop', doc_number:'SOP 777', title:'Browser Test Procedure', category:'quality', revision:'V1', status:'active', content:'old body' }) });
});
await fileInput.setInputFiles('/tmp/SOP-777_Browser_Test_V9.md');
await p.waitForTimeout(4000);
const after=await p.locator('body').innerText();
t('the uploaded file appears in the queue', /SOP-777_Browser_Test_V9\.md/.test(after), after.slice(-300));
t('it is labelled by what it is asking for', /Revision has moved/i.test(after));
t('the proposed change is shown with both values', /V1\s*→\s*V9/.test(after.replace(/\s+/g,' ')), after.slice(-400));
const apply=p.locator('button',{hasText:/Apply \d+ change/});
t('an Apply button naming the count is offered', await apply.count()>=1, await apply.first().innerText().catch(()=>''));
await apply.first().click(); await p.waitForTimeout(3000);
const done=await p.locator('body').innerText();
t('applying clears it from the queue', !/SOP-777_Browser_Test_V9\.md/.test(done), done.slice(-200));
// Not a fixed number — this DB may already carry items from the API check.
// What matters is that everything filed is now handled.
const m = done.match(/(\d+) of (\d+) handled/);
t('everything filed is handled', m && m[1] === m[2] && Number(m[2]) > 0, m ? m[0] : 'no count');
t('no render errors', !errs.some(e=>/is not a function|render failed|Cannot read/i.test(e)), errs.find(e=>/is not a function|Cannot read/i.test(e))?.slice(0,140)||'');
await b.close(); console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
