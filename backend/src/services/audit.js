import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function createAuditLog(userId, action, resourceId, resourceType, details, ipAddress, userAgent) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        resourceId,
        resourceType,
        details,
        ipAddress,
        userAgent,
      }
    });
  } catch (err) {
    // Don't fail requests due to audit log errors
    console.error('Audit log error:', err);
  }
}
