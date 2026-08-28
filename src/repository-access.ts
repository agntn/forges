import type { RepositoryPermission } from "./types.ts";

interface BooleanRepositoryPermissions {
  admin?: boolean;
  maintain?: boolean;
  push?: boolean;
  triage?: boolean;
  pull?: boolean;
}

/** Maps permission flags used by GitHub and Gitea to the viewer's highest role. */
export function mapBooleanRepositoryPermission(
  permissions: BooleanRepositoryPermissions | null | undefined,
): RepositoryPermission | null {
  if (permissions === undefined || permissions === null) return null;
  if (permissions.admin) return "admin";
  if (permissions.maintain) return "maintain";
  if (permissions.push) return "write";
  if (permissions.triage) return "triage";
  if (permissions.pull) return "read";
  return "none";
}
