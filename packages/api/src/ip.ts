// SEC-002 / SEC-004: IP extraction.
//
// Round-1 code returned the RIGHTMOST entry of X-Forwarded-For, which is the
// value set by the LAST hop — fully attacker-controllable if the attacker can
// prepend their own XFF header. The correct entry is the LEFTMOST, but only
// when the immediate connection comes from a trusted proxy (e.g. Caddy,
// Vercel Edge). When no trusted proxy is configured, we fall back to the TCP
// peer address. When even that is unavailable (e.g. Vercel Edge runtime where
// `c.env` is the Vercel env, not a `{remoteAddr}` object), we return
// 'unknown' — but rate-limit callers MUST refuse to bucket on 'unknown' to
// avoid a single global bucket DoSing all anonymous users (SEC-004).

const TRUSTED_PROXY_CIDRS: readonly string[] = (() => {
  const raw = process.env.TRUSTED_PROXIES ?? '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
})();

/** Returns true if `ip` is within `cidr` (IPv4 only; IPv6 always returns false). */
function ipInCidr(ip: string, cidr: string): boolean {
  const [netRaw, prefixStr] = cidr.split('/');
  if (!netRaw) return false;
  const prefix = prefixStr ? parseInt(prefixStr, 10) : 32;
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) return false;
  const parts = netRaw.split('.').map(p => parseInt(p, 10));
  const ipParts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || ipParts.length !== 4) return false;
  if (parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return false;
  if (ipParts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return false;
  const netNum = (parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!;
  const ipNum = (ipParts[0]! << 24) | (ipParts[1]! << 16) | (ipParts[2]! << 8) | ipParts[3]!;
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  return (netNum & mask) === (ipNum & mask);
}

function isTrustedProxy(ip: string): boolean {
  if (!TRUSTED_PROXY_CIDRS.length) return false;
  return TRUSTED_PROXY_CIDRS.some(cidr => ipInCidr(ip, cidr));
}

export function clientIp(c: { req: { header: (name: string) => string | undefined }; env?: any }): string {
  const remote = c.env?.remoteAddr?.address ?? c.env?.remoteAddr?.address;
  const xff = c.req.header('x-forwarded-for');

  // If we have a TCP peer address and it's NOT a trusted proxy, ignore XFF
  // entirely — the connection is direct from an untrusted source, so XFF is
  // attacker-controlled.
  if (remote && !isTrustedProxy(remote)) {
    return remote;
  }

  // Either there's no TCP peer (Edge runtime) or the peer is a trusted proxy.
  // Take the LEFTMOST XFF entry — that's the original client per RFC 7239.
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      return parts[0]!;
    }
  }

  // Fall back to the TCP peer if available (e.g. trusted-proxy case where XFF
  // was stripped by the proxy).
  if (remote) return remote;

  // SEC-004: no IP determinable — callers MUST NOT bucket rate limits on this.
  return 'unknown';
}

/** Sentinel for "no IP could be determined". Rate-limit callers should refuse
 *  to bucket on this value to avoid a single global bucket DoSing all anon
 *  users. */
export const UNKNOWN_IP = 'unknown';
