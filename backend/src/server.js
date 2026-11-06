import "dotenv/config";

import app from "./app.js";
import { invoiceWorker } from "./workers/invoice.worker.js";
import { invoiceQueue } from "./queues/invoice.queue.js";
import { recoverInvoiceProcessingJobs } from "./services/invoice-job.service.js";
import { prisma } from "./config/prisma.js";

const PORT = process.env.PORT || 5000;

let server;

async function startServer() {
    try {
        const recoveredCount = await recoverInvoiceProcessingJobs();

        console.log(
            `[Recovery] Republished ${recoveredCount} pending jobs.`
        );

        server = app.listen(PORT, () => {
            console.log(`InvoiceIQ API running on port ${PORT}`);
            console.log(`Health: http://localhost:${PORT}/api/health`);
            console.log("Invoice processing worker started.");
        });
    } catch (error) {
        console.error("[Startup] Recovery failed:", error);

        await invoiceWorker.close();
        await invoiceQueue.close();
        await prisma.$disconnect();

        process.exitCode = 1;
    }
}

startServer();

let shuttingDown = false;

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`${signal} received. Shutting down...`);

    try {
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) reject(error);
                else resolve();
            });
        });

        await invoiceWorker.close();
        await invoiceQueue.close();
        await prisma.$disconnect();

        console.log("Shutdown completed.");
    } catch (error) {
        console.error("Shutdown failed:", error);
        process.exitCode = 1;
    }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
