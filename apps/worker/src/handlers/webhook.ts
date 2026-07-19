/**
 * Generic webhook outbox handler. Used for outgoing webhook delivery to external
 * systems — e.g. malware-scan results from ClamAV, corporate HR system callbacks,
 * or partner integrations. Each payload carries a `kind` discriminator that this
 * handler dispatches on.
 *
 * Currently the only `kind` is `clamav_scan` (raised by documentService.upload()
 * when a contractor uploads a document). The implementation here is a stub — in
 * production this would POST the storage key to a ClamAV-sidecar service that
 * streams the file from S3, scans it, and returns a verdict. For now we just log.
 */
export async function handle(payload: { kind: string; [k: string]: unknown }) {
  switch (payload.kind) {
    case 'clamav_scan':
      // Stub: real implementation would call the ClamAV sidecar.
      console.log(`[webhook-outbox] clamav_scan storageKey=${payload.storageKey ?? '-'}`);
      return;
    default:
      console.log(`[webhook-outbox] unknown kind=${payload.kind}`);
      throw new Error(`Unknown webhook kind: ${payload.kind}`);
  }
}
