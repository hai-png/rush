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

  if (remote && !isTrustedProxy(remote)) {
    return remote;
  }

  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      return parts[0]!;
    }
  }

  if (remote) return remote;

  return 'unknown';
}

/** Sentinel for "no IP could be determined". Rate-limit callers should refuse
 *  to bucket on this value to avoid a single global bucket DoSing all anon
 *  users. */
export const UNKNOWN_IP = 'unknown';
