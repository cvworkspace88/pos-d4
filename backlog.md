# Backlog

* [API] prune `refresh_tokens`. create cleanup job to clean revoked or expired refresh token.
  keep rows younger than the 30s grace (`REVOKE_GRACE_MS`).
* [desktop] multiple app login shared 1 localStorage can cause refresh token conflict race
  condition. quick block: `app.requestSingleInstanceLock()`. real fix: refresh owned by main
  process, renderers ask over IPC.
* sync client and server time. fast client clock reads the access token as expired early and
  refreshes every request. server checks refresh token expiry itself, so it is unaffected.
* set `NODE_ENV=production` in deploy. tRPC returns full stack traces to clients by default.

# Consider 

* Grace period refresh token rotation if refresh 5 times in 30 seconds with same refresh token it can cause user to have 5 refresh token. Low probability no security risk. [LOW]