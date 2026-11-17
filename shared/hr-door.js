// The HR front door (D-356): one private conversation per employee with the HR
// team. `hr--<user id>` is a reserved family, the way `client--` is: the prefix
// is what makes every rule apply, so nothing renames into or out of it.
export const HR_PREFIX = 'hr--';
export const isHrDoor = (name) => String(name || '').startsWith(HR_PREFIX);
export const hrDoorOwner = (name) => (isHrDoor(name) ? String(name).slice(HR_PREFIX.length) : null);
export const HR_DOOR_ACK = 'Sent to HR. Only the HR team can read this conversation — not your supervisor or coworkers. Someone will follow up with you.\nEnviado a Recursos Humanos. Solo el equipo de RR. HH. puede leer esta conversación. Alguien se comunicará con usted.';
