const terminalStatuses = new Set(["REVOKED", "EXPIRED", "SUSPENDED"]);

/** Return the HTTP failure for an activation row, or null when it may proceed. */
export function activationFailure(row, installationId, now = Date.now()) {
  if (terminalStatuses.has(row.status)) {
    return { status: 403, message: "Licence is not active" };
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) {
    return { status: 403, message: "Licence has expired", expire: true };
  }
  if (row.installation_id && row.installation_id !== installationId) {
    return {
      status: 409,
      message: "Licence is bound to another installation; contact support for transfer",
    };
  }
  return null;
}

/** Offline issue uses a distinct not-found response for terminal licences. */
export function offlineIssueFailure(row, installationId, now = Date.now()) {
  if (terminalStatuses.has(row.status)) {
    return { status: 404, message: "Eligible licence not found" };
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) {
    return { status: 403, message: "Licence has expired", expire: true };
  }
  if (row.installation_id && row.installation_id !== installationId) {
    return { status: 409, message: "Licence is already bound to another installation" };
  }
  return null;
}
