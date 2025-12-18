import Redis from "ioredis";
import { env } from "./env";
import { logger } from "../utils/logger";

// Create Redis connection for BullMQ
export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Create separate Redis connections for pub/sub (required by ioredis)
// Publisher for emitting events from worker
export const redisPublisher = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Subscriber for receiving events in main server
export const redisSubscriber = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Channel names for WebSocket events
export const WEBSOCKET_CHANNELS = {
  PROCESSING_UPDATE: "ws:processing-update",
  PROCESSING_ERROR: "ws:processing-error",
};

redisConnection.on("connect", () => {
  logger.info("Redis connected successfully");
});

redisConnection.on("error", (error) => {
  logger.error("Redis connection error:", error);
});

redisConnection.on("close", () => {
  logger.warn("Redis connection closed");
});

// Export connection options for BullMQ
export const redisOptions = {
  connection: redisConnection,
};

export default redisConnection;
