import path from "node:path";
import fs from "node:fs/promises";
import { Prisma } from "@prisma/client";

import prisma from "../src/config/prisma.js";
import { deleteStoredFile } from "../src/utils/file-storage.js";

const INVOICE_NUMBER = "APX-INV-001";
const ACTIVE_JOB_STATUSES = ["QUEUED", "RUNNING", "RETRY_WAIT"];
const ACTIVE_RUN_STATUSES = ["QUEUED", "IN_PROGRESS"];

const decimal = (value) => new Prisma.Decimal(value ?? 0);

function resolveStoredInvoicePath(relativeFilePath) {
  const storageRoot = path.resolve(process.cwd(), "storage");
  const absolutePath = path.resolve(storageRoot, relativeFilePath);

  if (
    absolutePath === storageRoot ||
    !absolutePath.startsWith(storageRoot + path.sep)
  ) {
    throw new Error(`Refusing to delete file outside storage: ${relativeFilePath}`);
  }

  return absolutePath;
}

function auditTarget(entityType, entityId) {
  return { entityType, entityId };
}

async function recalculatePOStatus(tx, purchaseOrderId) {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: {
      items: {
        include: {
          allocations: true,
        },
      },
    },
  });

  if (!po) return null;

  const totalAllocatedQuantity = po.items.reduce((poSum, item) => {
    const lineAllocated = item.allocations.reduce(
      (lineSum, allocation) => lineSum.plus(allocation.allocatedQuantity),
      decimal(0)
    );

    return poSum.plus(lineAllocated);
  }, decimal(0));

  const totalAllocatedAmount = po.items.reduce((poSum, item) => {
    const lineAllocated = item.allocations.reduce(
      (lineSum, allocation) => lineSum.plus(allocation.allocatedAmount),
      decimal(0)
    );

    return poSum.plus(lineAllocated);
  }, decimal(0));

  const allLinesFullyAllocated =
    po.items.length > 0 &&
    po.items.every((item) => {
      const allocatedQuantity = item.allocations.reduce(
        (sum, allocation) => sum.plus(allocation.allocatedQuantity),
        decimal(0)
      );

      const allocatedAmount = item.allocations.reduce(
        (sum, allocation) => sum.plus(allocation.allocatedAmount),
        decimal(0)
      );

      const requiredAmount = decimal(item.quantity).mul(item.unitPrice);

      return (
        allocatedQuantity.gte(item.quantity) &&
        allocatedAmount.gte(requiredAmount)
      );
    });

  const nextStatus =
    totalAllocatedQuantity.eq(0) && totalAllocatedAmount.eq(0)
      ? "OPEN"
      : allLinesFullyAllocated
        ? "CLOSED"
        : "PARTIALLY_INVOICED";

  return tx.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { status: nextStatus },
  });
}

try {
  const invoiceBefore = await prisma.invoice.findFirst({
    where: { invoiceNumber: INVOICE_NUMBER },
    select: {
      id: true,
      invoiceNumber: true,
      filePath: true,
    },
  });

  if (!invoiceBefore) {
    throw new Error(`Invoice ${INVOICE_NUMBER} was not found.`);
  }

  const absoluteFilePath = resolveStoredInvoicePath(invoiceBefore.filePath);
  await fs.access(absoluteFilePath);

  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT id
        FROM "Invoice"
        WHERE id = ${invoiceBefore.id}
        FOR UPDATE
      `;

      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceBefore.id },
        include: {
          allocations: {
            select: {
              id: true,
              purchaseOrderId: true,
              poLineItemId: true,
              invoiceLineItemId: true,
            },
          },
          items: {
            select: { id: true },
          },
          processingRuns: {
            include: {
              stages: { select: { id: true } },
              validations: { select: { id: true } },
              decision: { select: { id: true } },
              jobs: { select: { id: true, status: true } },
            },
          },
          processingJobs: {
            select: { id: true, status: true },
          },
          reviews: {
            select: { id: true },
          },
        },
      });

      if (!invoice) {
        throw new Error(`Invoice ${INVOICE_NUMBER} disappeared before deletion.`);
      }

      const allJobIds = [
        ...invoice.processingJobs.map((job) => job.id),
        ...invoice.processingRuns.flatMap((run) => run.jobs.map((job) => job.id)),
      ];

      const uniqueJobIds = [...new Set(allJobIds)];

      if (uniqueJobIds.length > 0) {
        await tx.$queryRaw`
          SELECT id
          FROM "InvoiceProcessingJob"
          WHERE id IN (${Prisma.join(uniqueJobIds)})
          FOR UPDATE
        `;
      }

      const activeJobs = [
        ...invoice.processingJobs,
        ...invoice.processingRuns.flatMap((run) => run.jobs),
      ].filter((job) => ACTIVE_JOB_STATUSES.includes(job.status));

      const activeRuns = invoice.processingRuns.filter((run) =>
        ACTIVE_RUN_STATUSES.includes(run.status)
      );

      if (activeJobs.length > 0 || activeRuns.length > 0) {
        throw new Error(
          `Refusing to delete ${INVOICE_NUMBER}: active processing job/run exists.`
        );
      }

      const purchaseOrderIds = [
        invoice.poId,
        ...invoice.allocations.map((allocation) => allocation.purchaseOrderId),
      ].filter(Boolean);

      const uniquePurchaseOrderIds = [...new Set(purchaseOrderIds)];

      for (const purchaseOrderId of uniquePurchaseOrderIds) {
        await tx.$queryRaw`
          SELECT id
          FROM "PurchaseOrder"
          WHERE id = ${purchaseOrderId}
          FOR UPDATE
        `;

        await tx.$queryRaw`
          SELECT id
          FROM "POLineItem"
          WHERE "poId" = ${purchaseOrderId}
          FOR UPDATE
        `;
      }

      const processingRunIds = invoice.processingRuns.map((run) => run.id);
      const stageIds = invoice.processingRuns.flatMap((run) =>
        run.stages.map((stage) => stage.id)
      );
      const validationIds = invoice.processingRuns.flatMap((run) =>
        run.validations.map((validation) => validation.id)
      );
      const decisionIds = invoice.processingRuns
        .map((run) => run.decision?.id)
        .filter(Boolean);
      const reviewIds = invoice.reviews.map((review) => review.id);
      const invoiceLineItemIds = invoice.items.map((item) => item.id);
      const allocationIds = invoice.allocations.map((allocation) => allocation.id);

      const auditTargets = [
        auditTarget("Invoice", invoice.id),
        ...allocationIds.map((id) => auditTarget("POAllocation", id)),
        ...invoiceLineItemIds.map((id) => auditTarget("InvoiceLineItem", id)),
        ...processingRunIds.map((id) => auditTarget("ProcessingRun", id)),
        ...stageIds.map((id) => auditTarget("ProcessingStage", id)),
        ...validationIds.map((id) => auditTarget("ValidationResult", id)),
        ...decisionIds.map((id) => auditTarget("Decision", id)),
        ...uniqueJobIds.map((id) => auditTarget("InvoiceProcessingJob", id)),
        ...reviewIds.map((id) => auditTarget("Review", id)),
      ];

      if (auditTargets.length > 0) {
        await tx.auditLog.deleteMany({
          where: { OR: auditTargets },
        });
      }

      await tx.review.deleteMany({ where: { invoiceId: invoice.id } });
      await tx.invoiceProcessingJob.deleteMany({ where: { invoiceId: invoice.id } });

      if (processingRunIds.length > 0) {
        await tx.decision.deleteMany({
          where: { processingRunId: { in: processingRunIds } },
        });

        await tx.processingStage.deleteMany({
          where: { processingRunId: { in: processingRunIds } },
        });

        await tx.validationResult.deleteMany({
          where: { processingRunId: { in: processingRunIds } },
        });

        await tx.processingRun.deleteMany({
          where: { id: { in: processingRunIds } },
        });
      }

      await tx.pOAllocation.deleteMany({ where: { invoiceId: invoice.id } });
      await tx.invoiceLineItem.deleteMany({ where: { invoiceId: invoice.id } });
      await tx.invoice.delete({ where: { id: invoice.id } });

      for (const purchaseOrderId of uniquePurchaseOrderIds) {
        await recalculatePOStatus(tx, purchaseOrderId);
      }

      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        filePath: invoice.filePath,
        purchaseOrderIds: uniquePurchaseOrderIds,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000,
    }
  );

  try {
    await deleteStoredFile(absoluteFilePath);
  } catch (error) {
    throw new Error(
      `Database deletion committed, but file deletion failed for ${absoluteFilePath}: ${error.message}`
    );
  }

  const invoiceAfter = await prisma.invoice.findFirst({
    where: { invoiceNumber: INVOICE_NUMBER },
  });

  const invoiceAllocationCount = await prisma.pOAllocation.count({
    where: { invoiceId: result.invoiceId },
  });

  const poChecks = await Promise.all(
    result.purchaseOrderIds.map(async (purchaseOrderId) => {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: { allocations: true },
      });

      const allocatedQuantity = po.allocations.reduce(
        (sum, allocation) => sum.plus(allocation.allocatedQuantity),
        decimal(0)
      );

      const allocatedAmount = po.allocations.reduce(
        (sum, allocation) => sum.plus(allocation.allocatedAmount),
        decimal(0)
      );

      return {
        poNumber: po.poNumber,
        status: po.status,
        allocationCount: po.allocations.length,
        allocatedQuantity: allocatedQuantity.toString(),
        allocatedAmount: allocatedAmount.toString(),
      };
    })
  );

  console.table(poChecks);

  if (invoiceAfter !== null) {
    throw new Error("Verification failed: invoice still exists.");
  }

  if (invoiceAllocationCount !== 0) {
    throw new Error("Verification failed: invoice allocations still exist.");
  }

  for (const po of poChecks) {
    if (!decimal(po.allocatedQuantity).eq(0)) {
      throw new Error(
        `Verification failed: ${po.poNumber} allocated quantity is ${po.allocatedQuantity}, expected 0.`
      );
    }

    if (!decimal(po.allocatedAmount).eq(0)) {
      throw new Error(
        `Verification failed: ${po.poNumber} allocated amount is ${po.allocatedAmount}, expected 0.`
      );
    }

    if (po.status !== "OPEN") {
      throw new Error(
        `Verification failed: ${po.poNumber} status is ${po.status}, expected OPEN.`
      );
    }
  }

  console.log(`Deleted invoice ${INVOICE_NUMBER} and uploaded file ${result.filePath}.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
