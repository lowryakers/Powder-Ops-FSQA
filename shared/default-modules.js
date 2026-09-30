// Modules EVERY account that works here has the moment it signs in (D-124).
//
// Messages was the only thing an account got automatically (the NULL-map rule,
// 2026-08-13). Operator View joins it because EVERYBODY is assigned training,
// and a training assignment IS a work order: an account without a task list is
// one whose assignment reaches only a DM (D-105). Lowry ticked Operator View
// for the whole roster by hand on 29 September; this makes the next account
// arrive that way instead of arriving broken until somebody remembers.
//
// VIEW, NOT EDIT, and that is load-bearing. The pm router has no role gates of
// its own, so an edit grant on Operator View already lets an account create and
// rewrite PM schedules through the API. The task-doing writes a floor account
// needs are allowed by name instead (TASK_WRITES in server/module-access.js).
//
// Never for a client (is_external) — their whole boundary is Messages — and not
// for an admin or an auditor, whose levels are decided before this is asked.
// An explicit entry in Settings wins: a supervisor ticked to Edit keeps Edit.
//
// One list, imported by the server's moduleLevel and the client's, so the nav
// and the API cannot disagree about who has it.
export const DEFAULT_MODULES = { operator: 'view' };

export function defaultLevel(user, moduleId) {
  if (!user || user.is_external) return null;
  if (user.role === 'admin' || user.role === 'auditor') return null;
  return DEFAULT_MODULES[moduleId] || null;
}

export const defaultModuleIds = (user) =>
  Object.keys(DEFAULT_MODULES).filter(id => defaultLevel(user, id));
