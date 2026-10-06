/**
 * Is this socket peer the machine the hub runs on? The hub listens on 0.0.0.0 for the tablets, and
 * until setup runs anyone who reaches it could claim the owner account. Only the desktop's own
 * renderer (127.0.0.1) may set it up. Node reports IPv4 peers on a dual-stack socket as `::ffff:a.b.c.d`.
 */
export const isLoopback = (address: string | undefined): boolean =>
  address === '::1' || /^(::ffff:)?127\./.test(address ?? '');

/**
 * Is this request's Origin one the desktop renderer can have? Absent (curl, Node), `null`/`file://`
 * (the packaged renderer loads from file://), or a localhost/127.0.0.1 http(s) origin (the
 * electron-vite dev server). Any other site in a browser on this machine is refused: CORS on the hub
 * reflects every origin, so loopback alone would let a web page set up the hub.
 */
export const isTrustedOrigin = (origin: string | undefined): boolean =>
  origin === undefined ||
  origin === 'null' ||
  origin === 'file://' ||
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
