import { createHash } from 'node:crypto';

export type DigistoreParams = Record<string, string>;

export type SignatureVerificationResult = 'VALID' | 'INVALID' | 'MISSING';

const PLACEHOLDER_MISSING = 'no_signature_passphrase_provided';

/**
 * Digistore24 IPN SHA-512 signature.
 *
 * Algorithm (verbatim from the official Digistore24 PHP example,
 * https://www.digistore24.com/download/ipn/examples/ipn/sha_sign.php):
 *
 *   1. Remove `sha_sign` and `SHASIGN` from params.
 *   2. Sort keys with SORT_STRING (byte-wise, case-sensitive ASCII).
 *   3. For each pair WHERE VALUE IS NOT EMPTY, concatenate `${key}=${value}${passphrase}`.
 *      Empty strings are SKIPPED (not included in the signature input at all).
 *   4. SHA-512 of the concatenated string, hex digest, upper-cased.
 *
 * Digistore sends uppercase hex; we return lowercase and compare case-insensitive.
 */
export function computeDigistoreSignature(
  params: DigistoreParams,
  passphrase: string,
): string {
  const sortable = Object.entries(params)
    .filter(([key, value]) => {
      if (key === 'sha_sign' || key === 'SHASIGN') return false;
      // PHP: $is_empty = !isset($value) || $value === "" || $value === false;
      if (value === undefined || value === null) return false;
      if (value === '') return false;
      return true;
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const input = sortable.map(([k, v]) => `${k}=${v}${passphrase}`).join('');
  return createHash('sha512').update(input, 'utf8').digest('hex');
}

export function verifyDigistoreSignature(
  params: DigistoreParams,
  passphrase: string | undefined,
): SignatureVerificationResult {
  const received = params.sha_sign;
  if (!received || received === PLACEHOLDER_MISSING) return 'MISSING';
  if (!passphrase) return 'MISSING';

  const expected = computeDigistoreSignature(params, passphrase);
  return expected.toLowerCase() === received.toLowerCase() ? 'VALID' : 'INVALID';
}
