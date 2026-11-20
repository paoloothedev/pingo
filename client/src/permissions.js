// Mirrors server/routes/auth.js: admins can do everything, others need one of the listed permissions.
// The server is the real gate (403); this only hides UI the user can't use.
export function can(user, ...perms) {
  if (!user) return false
  if (user.role === 'admin' || perms.length === 0) return true
  const has = user.permissions || []
  return perms.some(p => has.includes(p))
}

// The logged-in user, set by App during render (same pattern as setCurrentProjectId in api.js),
// so deep components can check permissions without prop drilling.
let currentUser = null
export function setCurrentUser(user) { currentUser = user || null }
export function canI(...perms) { return can(currentUser, ...perms) }
