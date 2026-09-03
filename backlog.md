# Backlog

* [API] prune `refresh_tokens`. create cleanup job to clean revoked or expired refresh token.
  keep rows younger than the 30s grace (`REVOKE_GRACE_MS`).
* [desktop] multiple app login shared 1 localStorage can cause refresh token conflict race
  condition. quick block: `app.requestSingleInstanceLock()`. real fix: refresh owned by main
  process, renderers ask over IPC.
* sync client and server time. fast client clock reads the access token as expired early and
  refreshes every request. server checks refresh token expiry itself, so it is unaffected.
* grace window mints an independent chain per hit. a client retrying 5x in 30s ends with 5 live
  30-day chains and 5 orphan rows. acceptable while there is no reuse detection.
* set `NODE_ENV=production` in deploy. tRPC returns full stack traces to clients by default.
