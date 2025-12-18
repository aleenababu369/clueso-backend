import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { ProcessingStep } from "../models/recording.model";
import {
  redisSubscriber,
  redisPublisher,
  WEBSOCKET_CHANNELS,
} from "../config/redis";

let io: Server | null = null;

/**
 * Initialize Socket.io server
 */
export function initializeSocketServer(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket: Socket) => {
    logger.info(`Client connected: ${socket.id}`);

    // Join a room for a specific recording
    socket.on("join-recording", (recordingId: string) => {
      socket.join(recordingId);
      logger.info(`Client ${socket.id} joined room: ${recordingId}`);
    });

    // Leave a recording room
    socket.on("leave-recording", (recordingId: string) => {
      socket.leave(recordingId);
      logger.info(`Client ${socket.id} left room: ${recordingId}`);
    });

    // Handle disconnection
    socket.on("disconnect", (reason) => {
      logger.info(`Client disconnected: ${socket.id}, reason: ${reason}`);
    });

    // Handle errors
    socket.on("error", (error) => {
      logger.error(`Socket error for ${socket.id}:`, error);
    });
  });

  // Subscribe to Redis channels for cross-process communication
  setupRedisSubscription();

  logger.info("Socket.io server initialized");
  return io;
}

/**
 * Setup Redis subscription for receiving events from worker process
 */
function setupRedisSubscription(): void {
  // Subscribe to processing update channel
  redisSubscriber.subscribe(
    WEBSOCKET_CHANNELS.PROCESSING_UPDATE,
    WEBSOCKET_CHANNELS.PROCESSING_ERROR,
    (err, count) => {
      if (err) {
        logger.error("Failed to subscribe to Redis channels:", err);
        return;
      }
      logger.info(`Subscribed to ${count} Redis channels for WebSocket bridge`);
    }
  );

  // Handle incoming messages from Redis
  redisSubscriber.on("message", (channel, message) => {
    try {
      const data = JSON.parse(message);
      const { recordingId, step, error, timestamp } = data;

      if (!io) {
        logger.warn("Socket.io not initialized, cannot emit");
        return;
      }

      if (channel === WEBSOCKET_CHANNELS.PROCESSING_UPDATE) {
        const payload = { step, recordingId, timestamp };
        io.to(recordingId).emit("processing-update", payload);
        logger.info(
          `🔔 [Redis→WS] Emitted processing-update to ${recordingId}: step=${step}`
        );
      } else if (channel === WEBSOCKET_CHANNELS.PROCESSING_ERROR) {
        const payload = { step: "failed", recordingId, error, timestamp };
        io.to(recordingId).emit("processing-error", payload);
        logger.info(
          `🚨 [Redis→WS] Emitted processing-error to ${recordingId}: ${error}`
        );
      }
    } catch (err) {
      logger.error("Failed to process Redis message:", err);
    }
  });
}

/**
 * Get the Socket.io server instance
 */
export function getSocketServer(): Server | null {
  return io;
}

/**
 * Emit a processing update to a specific recording room
 * This now publishes to Redis so it works from any process (worker or server)
 */
export function emitProcessingUpdate(
  recordingId: string,
  step: ProcessingStep
): void {
  const payload = {
    step,
    recordingId,
    timestamp: new Date().toISOString(),
  };

  // Publish to Redis - this works from both worker and server processes
  redisPublisher
    .publish(WEBSOCKET_CHANNELS.PROCESSING_UPDATE, JSON.stringify(payload))
    .then(() => {
      logger.info(
        `📤 [Redis] Published processing-update for ${recordingId}: step=${step}`
      );
    })
    .catch((err) => {
      logger.error("Failed to publish processing update:", err);
    });
}

/**
 * Emit an error to a specific recording room
 * This now publishes to Redis so it works from any process
 */
export function emitError(recordingId: string, error: string): void {
  const payload = {
    step: "failed",
    recordingId,
    error,
    timestamp: new Date().toISOString(),
  };

  // Publish to Redis - this works from both worker and server processes
  redisPublisher
    .publish(WEBSOCKET_CHANNELS.PROCESSING_ERROR, JSON.stringify(payload))
    .then(() => {
      logger.info(
        `📤 [Redis] Published processing-error for ${recordingId}: ${error}`
      );
    })
    .catch((err) => {
      logger.error("Failed to publish processing error:", err);
    });
}

/**
 * Emit a custom event to a specific recording room
 * Note: This only works from the main server process where io is initialized
 */
export function emitToRecording(
  recordingId: string,
  event: string,
  data: any
): void {
  if (!io) {
    logger.warn("Socket.io server not initialized, cannot emit event");
    return;
  }

  io.to(recordingId).emit(event, data);
  logger.debug(`Emitted ${event} to ${recordingId}:`, data);
}

export default {
  initializeSocketServer,
  getSocketServer,
  emitProcessingUpdate,
  emitToRecording,
  emitError,
};
