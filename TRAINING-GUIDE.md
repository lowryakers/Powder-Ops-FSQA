# Powder Ops FSQA — Quick Start Guide

## What Is This?

Powder Ops FSQA is our compliance and preventive maintenance platform. It tracks everything we need for SQF/NSF audits in one place: equipment, PM schedules, sanitation, calibration, CAPA, SOPs, training, and more.

---

## How to Log In

Go to the main URL in your browser. Enter your **email** and **PIN** to sign in.

| Name | Email | PIN | Role |
|------|-------|-----|------|
| Admin (Lowry) | lowry@powder-ops.com | 1234 | Admin |
| Adam B. | adam@powder-ops.com | 1111 | Operator |
| Ricardo A. | ricardo@powder-ops.com | 2222 | Operator |
| Spencer R. | spencer@powder-ops.com | 3333 | Operator |
| QA Tech | qa@powder-ops.com | 4444 | Operator (QA) |
| Cleaning Tech | cleaning@powder-ops.com | 5555 | Operator (Cleaning) |
| Auditor | auditor@powder-ops.com | 9999 | Auditor |

> **Admin** can change PINs and add/remove users under **Settings**.

---

## Three Ways to Access the System

| View | URL | Who Uses It | What It Does |
|------|-----|-------------|--------------|
| **Main Dashboard** | `/` | Admin, Supervisors | Full sidebar with all modules — the command center |
| **Operator View** | `/operator` | Warehouse, QA, Cleaning | Simplified task list — see your assigned work orders and log completions |
| **Work Order Submission** | `/submit` | Anyone (no login needed) | Quick form to submit a new maintenance request |

---

## Sidebar Modules — What's What

### Overview
- **Dashboard** — Audit readiness score, compliance checklist, trend charts. Start here every morning.
- **Operator View** — Same as the `/operator` page, embedded in the main app.

### Maintenance
- **Preventive Maintenance** — PM schedules and work orders. Filter by status, assign work, mark complete.
- **Equipment** — Master equipment list. Every piece of equipment ties to PM schedules, calibration, and LOTO.
- **Calibration** — Scale/instrument calibration log. Tracks due dates and certificates.
- **Lockout / Tagout** — LOTO procedures by equipment. Required for audit.

### Quality & Safety
- **Sanitation** — Cleaning records and checklists. QA and Cleaning teams log entries here.
- **Chemicals** — Approved chemical registry with SDS tracking.
- **Hygienic Design** — Equipment hygienic design assessments.

### Compliance
- **CAPA / Complaints** — Two tabs: *Complaint Log* (customer complaints) and *CAPA Report Log* (corrective/preventive actions). CAPAs link to complaints when applicable.
- **SOP Registry** — Document index with links to Google Drive. Track revision dates and review due dates.
- **Training Records** — Who was trained on what, and when. Links to SOPs. Has a Training Matrix view.
- **Mock Recall** — Annual mock recall exercises (SQF requirement). Log results and effectiveness.

### System
- **Audit Log** — Every create/update/delete action is recorded with who, what, and when.
- **Settings** — (Admin only) Manage users, PINs, roles, and departments.

---

## How Things Connect

```
Equipment ──> PM Schedules ──> Work Orders ──> Operator Tasks
    │
    ├──> Calibration Records
    ├──> LOTO Procedures
    └──> Hygienic Design Assessments

Customer Complaint ──> CAPA (if needed) ──> Corrective Action ──> Verification

SOPs ──> Training Records (who was trained on which SOP)
```

---

## Daily Responsibilities

| Role | What To Do |
|------|-----------|
| **Warehouse Operators** | Open `/operator`, complete assigned PMs, log work orders as done |
| **QA Tech** | Log sanitation inspections, review calibration due dates, manage complaints |
| **Cleaning Tech** | Open `/operator`, complete cleaning checklists and sanitation tasks |
| **Admin / Supervisor** | Review Dashboard daily, manage CAPAs, ensure PM completion stays above 95% |

---

## Key Rules

1. **Every action is logged.** The audit trail is automatic — no way to turn it off.
2. **PM target is 95%+ completion.** The dashboard tracks this. Don't let work orders go overdue.
3. **CAPAs must be closed with verification.** Open CAPAs are audit flags.
4. **Calibrations have due dates.** Overdue calibrations show as red on the dashboard.
5. **Anyone can submit a work order** at `/submit` — no login required.

---

*Questions? See Lowry or check the Dashboard for current compliance status.*
