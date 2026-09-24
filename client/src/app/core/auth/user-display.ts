import { CurrentUser } from './auth.models';

const AVATAR_COLORS = ['#CDBEF7', '#F6C9A8', '#BFE3D0', '#A9D4F5', '#F3D98B', '#E9B8C9'];
const HIDDEN_ROLES = ['offline_access', 'uma_authorization'];
const ROLE_LABELS: Record<string, string> = { user: 'Nutzer', admin: 'Admin' };

export function initialsOf(user: CurrentUser | null): string {
  if (!user) return '';
  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.trim();
  return (initials || user.email.slice(0, 2)).toUpperCase();
}

/** Stable pastel per user, same palette as the contact avatars. */
export function avatarColorOf(user: CurrentUser | null): string {
  if (!user) return AVATAR_COLORS[0];
  let hash = 0;
  for (const ch of user.id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function visibleRoles(user: CurrentUser): string[] {
  return user.roles
    .filter((r) => !HIDDEN_ROLES.includes(r) && !r.startsWith('default-roles'))
    .map((r) => ROLE_LABELS[r] ?? r);
}
