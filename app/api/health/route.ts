import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, unknown> = {};

  try {
    await db.$queryRaw`SELECT 1`;
    checks.db = { ok: true };
  } catch (err) {
    checks.db = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const platforms = await db.platform
    .findMany({ select: { slug: true, isActive: true, lastSyncAt: true } })
    .catch(() => [] as Array<{ slug: string; isActive: boolean; lastSyncAt: Date | null }>);

  const allOk = Object.values(checks).every(
    (c) => typeof c === 'object' && c !== null && (c as { ok?: boolean }).ok === true,
  );

  return NextResponse.json(
    { ok: allOk, checks, platforms, timestamp: new Date().toISOString() },
    { status: allOk ? 200 : 503 },
  );
}
