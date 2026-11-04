// Every non-GET route the server mounts, as a full /api path — read from the
// SOURCE, so a route added tomorrow is in the list tomorrow without anybody
// remembering to register it. Used by check:apitokens to prove that every route
// named like an approval is refused to a bot token.
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export function scanRoutes(root = process.cwd(), { includeGet = false } = {}) {
  const verbs = includeGet ? 'get|post|put|patch|delete' : 'post|put|patch|delete';
  const server = readFileSync(join(root, 'server.js'), 'utf8');
  // import X, { a as b, c } from './server/api/file.js'
  const binding = new Map(); // local name -> { file, exported }
  for (const m of server.matchAll(/import\s+([^;]+?)\s+from\s+'\.\/server\/api\/([^']+)'/g)) {
    const spec = m[1].trim(), file = m[2];
    const def = spec.match(/^([A-Za-z_$][\w$]*)/);
    if (def && !spec.startsWith('{')) binding.set(def[1], { file, exported: 'default' });
    const named = spec.match(/\{([^}]*)\}/);
    if (named) {
      for (const part of named[1].split(',')) {
        const [orig, alias] = part.trim().split(/\s+as\s+/);
        if (orig) binding.set((alias || orig).trim(), { file, exported: orig.trim() });
      }
    }
  }
  const routes = [];
  for (const m of server.matchAll(/app\.use\(\s*'(\/api[^']*)'\s*,([^;]*?)\)\s*;/g)) {
    const prefix = m[1];
    const args = m[2].split(',').map(s => s.trim()).filter(Boolean);
    const ident = args[args.length - 1];
    const b = binding.get(ident);
    if (!b) continue;
    const path = join(root, 'server/api', b.file);
    if (!existsSync(path)) continue;
    const src = readFileSync(path, 'utf8');
    let varName = 'router';
    if (b.exported === 'default') {
      varName = src.match(/export\s+default\s+([A-Za-z_$][\w$]*)/)?.[1] || 'router';
    } else {
      const direct = new RegExp(`export\\s+const\\s+${b.exported}\\s*=`).test(src);
      const re = src.match(new RegExp(`export\\s*\\{[^}]*\\b([A-Za-z_$][\\w$]*)\\s+as\\s+${b.exported}\\b`));
      varName = direct ? b.exported : (re?.[1] || b.exported);
    }
    const rx = new RegExp(`\\b${varName}\\.(${verbs})\\(\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
    for (const r of src.matchAll(rx)) {
      const sub = r[2] === '/' ? '' : r[2];
      routes.push({ method: r[1].toUpperCase(), path: prefix + sub, file: `server/api/${b.file}`, mount: prefix });
    }
    // A router may mount another router file on itself (`router.use(coaPlansRouter)`,
    // `router.use('/x', sub)` — D-313). Those routes sit under the same prefix
    // and must be scanned too; the COA test-plan routes were invisible before.
    for (const use of src.matchAll(new RegExp(`\\b${varName}\\.use\\(\\s*(?:['"\`]([^'"\`]+)['"\`]\\s*,\\s*)?([A-Za-z_$][\\w$]*)\\s*\\)`, 'g'))) {
      const imp = src.match(new RegExp(`import\\s+${use[2]}\\s+from\\s*'(\\.\\/[^']+)'`));
      if (!imp) continue;
      const sub = join(root, 'server/api', imp[1]);
      if (!existsSync(sub)) continue;
      const ssrc = readFileSync(sub, 'utf8');
      const sVar = ssrc.match(/export\s+default\s+([A-Za-z_$][\w$]*)/)?.[1] || 'router';
      const pre = prefix + (use[1] && use[1] !== '/' ? use[1] : '');
      for (const r of ssrc.matchAll(new RegExp(`\\b${sVar}\\.(${verbs})\\(\\s*['"\`]([^'"\`]+)['"\`]`, 'g'))) {
        routes.push({ method: r[1].toUpperCase(), path: pre + (r[2] === '/' ? '' : r[2]), file: join('server/api', imp[1]).replace(/\\/g, '/'), mount: pre });
      }
    }
    // A router may hand itself to a helper that registers more routes on it
    // (`registerMerchRoutes(router, …)`, D-302). Those routes are mounted on the
    // same prefix and must be scanned too, or a token rule never sees them.
    for (const call of src.matchAll(new RegExp(`\\b(register\\w*Routes)\\(\\s*${varName}\\b`, 'g'))) {
      const imp = src.match(new RegExp(`import\\s*\\{[^}]*\\b${call[1]}\\b[^}]*\\}\\s*from\\s*'([^']+)'`));
      if (!imp) continue;
      const helper = join(root, 'server/api', imp[1]);
      if (!existsSync(helper)) continue;
      const hsrc = readFileSync(helper, 'utf8');
      const hrx = new RegExp(`\\brouter\\.(${verbs})\\(\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
      for (const r of hsrc.matchAll(hrx)) {
        routes.push({ method: r[1].toUpperCase(), path: prefix + (r[2] === '/' ? '' : r[2]), file: join('server/api', imp[1]).replace(/\\/g, '/'), mount: prefix });
      }
    }
  }
  for (const m of server.matchAll(new RegExp(`app\\.(${verbs})\\(\\s*'(\\/api[^']*)'`, 'g'))) {
    routes.push({ method: m[1].toUpperCase(), path: m[2], file: 'server.js', mount: m[2] });
  }
  return routes;
}

/** A concrete path for a route pattern: every :param becomes a placeholder id. */
export const concretePath = (p) => p.replace(/:([A-Za-z_]+)/g, 'x0placeholder');

// A segment that NAMES an approval-class act. Deliberately wider than the guard's
// own list, so a new spelling surfaces here as an uncovered route rather than
// sliding past both. sign-out / sign-in are a person leaving the building, and
// assign / design merely contain the letters.
const NOT_APPROVAL = /^(sign-?out|sign-?in|signout|signin|component-signout|maintenance-signout)$|assign|design/i;
const APPROVAL_WORD = /approv|decide|decision|release|sign|verif|finali[sz]e|settle|sensory/i;
export function namesApproval(path) {
  return path.split('/').filter(Boolean).some(s => !s.startsWith(':') && !NOT_APPROVAL.test(s) && APPROVAL_WORD.test(s));
}
