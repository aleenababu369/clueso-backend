import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import path from "path";
import { env } from "./config/env";
import { errorHandler, NotFoundError } from "./utils/errors";
import { logger } from "./utils/logger";
import recordingsRoutes from "./routes/recordings.routes";
import authRoutes from "./routes/auth.routes";
import { fileService } from "./services/file.service";

// Create Express application
const app: Application = express();

// Middleware
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  })
);

// Morgan HTTP request logging
app.use(morgan("dev"));

// Cookie parser for refresh tokens
app.use(cookieParser());

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Ensure upload directories exist
(async () => {
  try {
    await fileService.ensureDirectory(path.join(env.UPLOAD_DIR, "temp"));
    logger.info(`Upload directory ensured: ${env.UPLOAD_DIR}`);
  } catch (error) {
    logger.error("Failed to create upload directories:", error);
  }
})();

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/recordings", recordingsRoutes);

// 404 handler
app.use((req: Request, res: Response, next: NextFunction) => {
  next(new NotFoundError(`Route ${req.method} ${req.path}`));
});

// Global error handler
app.use(errorHandler);

export default app;
