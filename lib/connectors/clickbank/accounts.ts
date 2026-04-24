/**
 * ClickBank multi-account helpers.
 *
 * A single API key has access to multiple vendor accounts. The key carries both
 * read and write roles; CLICKBANK_API_KEY_READ and CLICKBANK_API_KEY_WRITE are
 * kept as separate env vars only in case splitting becomes desirable later.
 */

export interface ClickBankCredentials {
  readKey: string;
  writeKey: string;
  vendors: string[];
}

export function loadClickBankCredentials(): ClickBankCredentials | null {
  const readKey = process.env.CLICKBANK_API_KEY_READ;
  const writeKey = process.env.CLICKBANK_API_KEY_WRITE;
  const vendorsRaw = process.env.CLICKBANK_VENDORS;

  if (!readKey || !writeKey) return null;

  const vendors = (vendorsRaw ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  return { readKey, writeKey, vendors };
}

export function parseVendorList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}
