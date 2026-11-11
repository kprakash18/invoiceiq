import "dotenv/config";

const redisUrl = process.env.REDIS_URL;
const parsedRedisUrl = redisUrl ? new URL(redisUrl) : null;

export const redisConnection = {
    ...(parsedRedisUrl
        ? {
              host: parsedRedisUrl.hostname,
              port: Number(parsedRedisUrl.port || 6379),
              ...(parsedRedisUrl.username && {
                  username: decodeURIComponent(parsedRedisUrl.username),
              }),
              ...(parsedRedisUrl.password && {
                  password: decodeURIComponent(parsedRedisUrl.password),
              }),
              ...(parsedRedisUrl.protocol === "rediss:" && {
                  tls: {},
              }),
          }
        : {
              host: process.env.REDIS_HOST ?? "localhost",
              port: Number(process.env.REDIS_PORT ?? 6379),
          }),
    maxRetriesPerRequest: null,
};
