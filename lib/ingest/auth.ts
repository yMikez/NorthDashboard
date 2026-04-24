import { timingSafeEqual } from 'node:crypto';

export function checkIngestSecret(received: string | null): boolean {
  const expected = process.env.INGEST_SECRET;
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
