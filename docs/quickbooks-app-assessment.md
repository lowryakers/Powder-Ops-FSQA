# Getting past Intuit's app assessment questionnaire

**The rejection we got:**

> Your app must be relevant and clearly related to QuickBooks, accounting,
> payments, workflows, finance, and other acceptable uses. Your app should do at
> least one of the following:
> i. enhance, streamline, or improve your or other QuickBooks customer's experience
> ii. facilitate a business process (e.g. syncing QuickBooks data to another service)

## What actually went wrong

This is the **relevance** bar, and it is the easiest one to fail by accident.
ReadyDoc plainly clears it — clause (ii) says *"syncing QuickBooks data to
another service"*, and that is a literal description of what our integration
does. So the app doesn't need to change.

What tripped it is almost certainly the **description**. ReadyDoc is a food
safety and manufacturing system that happens to contain an accounting module. If
the app profile leads with FSQA, production records, sanitation logs and
training, a reviewer skims it and concludes "this is a food plant app, not an
accounting app" — which, given what they were reading, is a fair call.

The fix is to describe **the Intuit app**, not the whole platform. The thing
being registered with Intuit is an accounting integration. That it lives inside a
larger system is true, and worth one sentence, but it isn't the headline.

**Nothing below overstates what we do.** If any of it stops being accurate,
change it rather than leaving it in — a description that doesn't match the app is
a much worse problem than a rejected questionnaire.

---

## 1. Fix the app profile first

The questionnaire is judged against what's in **App details**, so correct that
before resubmitting.

**App name:** `ReadyDoc Accounting Sync`
(Not just "ReadyDoc". The name is the first thing read, and it should say what
the integration is.)

**Short description:**

> Syncs QuickBooks Online bills, invoices, chart of accounts, vendors and
> customers into Powder Ops' internal accounts payable, accounts receivable and
> bank reconciliation system. Private, single-company, read-only.

**Long description:**

> ReadyDoc Accounting Sync is a private integration used by one company, Powder
> Ops LLC, to bring its own QuickBooks Online data into its internal accounting
> workflow.
>
> It reads Bills into accounts payable, Invoices into accounts receivable, and
> the chart of accounts, vendor and customer lists as reference data. Staff then
> work those records alongside bank statement lines, expense reimbursements and
> a partner netting arrangement — matching payments to invoices, resolving
> unexplained lines, and closing each period once the difference is zero.
>
> This facilitates a business process by syncing QuickBooks data to another
> service, and streamlines the QuickBooks experience for our own accounting
> staff by putting bills and invoices in the same place as the documents and
> bank activity they are reconciled against.
>
> The integration is read-only. It contains no code that writes to QuickBooks,
> so it cannot create, modify or delete anything in the company file. It is not
> distributed, not listed, and not offered to other QuickBooks customers.

The third paragraph is deliberately worded to echo their own criteria, because
the reviewer is checking against that list.

**Categories:** Accounting / Bookkeeping. **Not** manufacturing, inventory, or
anything food-related — those describe the wider platform, not this app.

**Regulated industries (the blue banner on the questionnaire page):** go to that
settings page and confirm it. If we've ticked something like food, health or a
similar regulated category, we're inviting extra scrutiny for a private
read-only app that has no reason to attract it. Answer for **the integration**:
it handles our own accounting records, not consumer or patient data.

---

## 2. Questionnaire answers

The questions vary slightly, but these are the ones that decide it.

**"What does your app do?"** — use the long description above.

**"Which of the acceptable uses applies?"** — pick **both** if it lets you:
- *Facilitates a business process* — this is the strongest one. Say plainly:
  "syncs QuickBooks data to another service (our internal AP/AR and bank
  reconciliation system)."
- *Enhances the QuickBooks customer's experience* — "our accounting staff work
  bills and invoices alongside the source documents and bank lines they're
  reconciled against, rather than switching between systems."

**"Who are your users?"** — "Internal only. Approximately 3 staff at one
company, Powder Ops LLC. The app is not distributed or offered to other
QuickBooks customers."

**"How many QuickBooks companies will connect?"** — **One.** Our own.

**"Which scopes / what data do you access?"** — `com.intuit.quickbooks.accounting`
only. Bills, Invoices, Accounts, Vendors, Customers, CompanyInfo — **read
access only**. No payroll, no payments processing, no personally identifiable
consumer data.

**"Do you write data back to QuickBooks?"** — **No.** Worth stating flatly: the
integration has no write code at all. Reviewers are mainly assessing risk, and
read-only single-company is close to the lowest-risk thing they see.

**Security questions** (data storage, encryption, access control) — answer
straight:
- Data is stored in our own private database on our hosted infrastructure
  (Railway), not shared with any third party.
- All API traffic is HTTPS/TLS.
- Access requires an authenticated ReadyDoc account; the QuickBooks screens are
  restricted to administrators.
- OAuth tokens are stored server-side only and are never sent to a browser.
- The app has an audit log recording every sync and who ran it.

All of those are true of what's built. Don't claim a policy we don't have — if
a question asks for something we genuinely lack (a formal pen test, SOC 2), say
so and note that the app is private, single-company and read-only.

**Privacy policy / EULA / support URLs** — these are usually required fields and
a common silent blocker. Any reachable page satisfies them; a short page on
powder-ops.com saying the integration is internal, read-only, and stores data
only on our own systems is enough.

---

## 3. If it's rejected again

Ask them directly. There's a **Help → Contact support** on developer.intuit.com,
and the app review team does respond. Quote the rejection text, say the app is a
private single-company read-only integration that syncs QuickBooks data into an
internal AP/AR system under criterion (ii), and ask which specific answer failed.
That's usually faster than another blind resubmission.

## Meanwhile

Development keys still work, and they're worth using: they read Intuit's sandbox
company and prove the whole chain end to end — OAuth, the token rotation,
paging, discovery, the full pull. What they cannot do is read our books.

To use them, set in Railway:

```
QBO_ENV = sandbox
```

plus the **sandbox company's** realm id (from the OAuth Playground, *not* the
Company ID in our real QuickBooks settings — different numbers) and a refresh
token generated with the Playground's environment set to **Sandbox**.

The QuickBooks tab labels a sandbox connection on every screen, because a
discovery report from the sandbox is a perfectly convincing set of numbers about
somebody else's business, and deciding anything about our own books from it
would be worse than having no numbers at all.
