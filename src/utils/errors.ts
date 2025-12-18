import { Request, Response, NextFunction } from "express";
import { logger } from "./logger";

// Custom error class for application errors
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Validation error class
export class ValidationError extends AppError {
  public readonly errors: Record<string, string>;

  constructor(message: string, errors: Record<string, string> = {}) {
    super(message, 400);
    this.errors = errors;
  }
}

// Processing error class for queue workers
export class ProcessingError extends AppError {
  public readonly recordingId: string;
  public readonly step: string;

  constructor(message: string, recordingId: string, step: string) {
    super(message, 500);
    this.recordingId = recordingId;
    this.step = step;
  }
}

// Not found error
export class NotFoundError extends AppError {
  constructor(resource: string = "Resource") {
    super(`${resource} not found`, 404);
  }
}

// Async error wrapper for controllers
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Global error handler middleware
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  logger.error("Error:", {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      ...(err instanceof ValidationError && { errors: err.errors }),
    });
  }

  // Handle Mongoose validation errors
  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      error: "Validation failed",
      details: err.message,
    });
  }

  // Handle Mongoose cast errors (invalid ObjectId)
  if (err.name === "CastError") {
    return res.status(400).json({
      success: false,
      error: "Invalid ID format",
    });
  }

  // Default error response
  return res.status(500).json({
    success: false,
    error:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
  });
};

export default {
  AppError,
  ValidationError,
  ProcessingError,
  NotFoundError,
  asyncHandler,
  errorHandler,
};
