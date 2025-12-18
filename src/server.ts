import http from "http";
import app from "./app";
import { env, validateEnv } from "./config/env";
import { connectDatabase } from "./config/db";
import { initializeSocketServer } from "./sockets/socketServer";
import { logger } from "./utils/logger";

// Validate environment variables
validateEnv();

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
initializeSocketServer(server);

// Start server
async function startServer(): Promise<void> {
  try {
    // Connect to MongoDB
    await connectDatabase();

    // Start listening
    server.listen(env.PORT, () => {
      logger.info(`🚀 Server running on port ${env.PORT}`);
      logger.info(`📱 Environment: ${env.NODE_ENV}`);
      logger.info(`🔗 API: http://localhost:${env.PORT}/api`);
      logger.info(`❤️  Health: http://localhost:${env.PORT}/health`);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Graceful shutdown
function gracefulShutdown(signal: string): void {
  logger.info(`${signal} received, shutting down gracefully...`);

  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error(
      "Could not close connections in time, forcefully shutting down"
    );
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Start the server
startServer();
