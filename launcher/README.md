# Powder Ops launcher

A single self-contained page for **start.powder-ops.com** with two buttons —
**FSQA** and **Keychain** — so everyone has one link to remember.

## Set the two destinations
Edit `index.html` and set the two `href` values on the `.tile` links:
- **FSQA** → your FSQA app URL (the Railway domain)
- **Keychain** → `https://www.keychain.com/auth` (already set)

The FSQA link currently points at a placeholder (`https://REPLACE_WITH_FSQA_URL`).

## Deploy
It's one static HTML file — no build step. Host it anywhere and point
`start.powder-ops.com` at it:
- **Cloudflare Pages / Netlify / Vercel** — drag-and-drop this folder.
- **Railway static** — serve this folder.
- Any static web host.

Each tool keeps its own login; the launcher is just two doors (not single sign-on).
