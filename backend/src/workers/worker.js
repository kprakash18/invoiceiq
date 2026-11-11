import "dotenv/config";
import { invoiceWorker } from "./invoice.worker.js";
import { prisma } from "../config/prisma.js";

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[InvoiceWorker] ${signal} received. Shutting down...`);

  try {
    await invoiceWorker.close();
    await prisma.$disconnect();
    console.log("[InvoiceWorker] Shutdown completed.");
  } catch (error) {
    console.error("[InvoiceWorker] Shutdown failed:", error);
    process.exitCode = 1;
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
