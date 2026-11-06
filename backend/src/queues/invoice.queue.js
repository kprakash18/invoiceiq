import { Queue } from "bullmq";
import { redisConnection } from "../config/redis.js";

export const invoiceQueue = new Queue("invoice-processing", {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: false,
    },
});
