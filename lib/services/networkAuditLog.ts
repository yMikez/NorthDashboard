// Generic audit log for sensitive Network entity changes. Each call writes
// one row to NetworkAuditLog with actor + before/after snapshots.

import type { AuditEntityType, Prisma } from '@prisma/client';
import { db } from '../db';

export interface AuditEntry {
  actorUserId: string;
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
}

export async function audit(entry: AuditEntry): Promise<void> {
  await db.networkAuditLog.create({
    data: {
      actorUserId: entry.actorUserId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      beforeJson: entry.before === undefined ? undefined : (entry.before as Prisma.InputJsonValue),
      afterJson: entry.after === undefined ? undefined : (entry.after as Prisma.InputJsonValue),
    },
  });
}
