/**
 * Which proxies may vouch for the client address (Express `trust proxy`)
 */

import { BlockList, isIPv4 } from "node:net";

/**
 * The Google front-end ranges Firebase Hosting reaches this function from. Every Hosting request
 * in 30 days of logs came from one of these; all are Google-owned and none is in the Google Cloud
 * customer ranges (gstatic.com/ipranges/cloud.json), so no client can send from them.
 */
const FIREBASE_HOSTING_EGRESS = new BlockList();
for (const [network, prefix] of [
  ["64.233.160.0", 19],
  ["66.102.0.0", 20],
  ["66.249.64.0", 19],
  ["74.125.0.0", 16],
  ["142.250.0.0", 15],
  ["192.178.0.0", 15],
] as const) {
  FIREBASE_HOSTING_EGRESS.addSubnet(network, prefix, "ipv4");
}

/**
 * Express `trust proxy` function: decides which proxies may vouch for the client address.
 *
 * Measured on 2026-10-05, the function sees one of two `X-Forwarded-For` chains:
 *   - function URL (run.app, cloudfunctions.net): `<anything the client sent>, <client>`
 *   - Firebase Hosting rewrite: `<client>, <Hosting egress>`. Hosting replaces the header, so the
 *     client cannot add entries.
 * The socket peer is Cloud Run's own front end in both cases. No fixed hop count fits both: 1
 * makes every Hosting request look like it came from Hosting (spreading one user over hundreds of
 * limiter buckets), and 2 lets a client forge its address on the function URL.
 *
 * So the socket peer is always trusted, the next hop only when it is Hosting's egress, and
 * nothing further. If Hosting ever egresses from a range not listed above, `req.ip` becomes the
 * Hosting address: limits get coarser, but the address still cannot be forged.
 *
 * @param addr An address from the chain, nearest first.
 * @param hop Its position: 0 is the socket peer, 1 the rightmost `X-Forwarded-For` entry.
 * @returns Whether `addr` is a proxy whose report of the previous hop can be believed.
 */
export function trustCloudRunProxies(addr: string, hop: number): boolean {
  if (hop === 0) return true;
  if (hop !== 1) return false;
  const v4 = addr.startsWith("::ffff:") ? addr.slice("::ffff:".length) : addr;
  return isIPv4(v4) && FIREBASE_HOSTING_EGRESS.check(v4, "ipv4");
}
