import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, DecodedToken } from "../utils/jwt.util";
import { logger } from "../utils/logger";

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: DecodedToken;
    }
  }
}

/**
 * Authentication middleware
 * Validates access token and attaches user to request
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    let token: string | undefined;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if (req.query.token && typeof req.query.token === "string") {
      // Allow token in query param for downloads/images
      token = req.query.token;
    }

    if (!token) {
      res.status(401).json({
        success: false,
        error: "Access token required",
        code: "NO_TOKEN",
      });
      return;
    }

    const decoded = verifyAccessToken(token);

    if (!decoded) {
      res.status(401).json({
        success: false,
        error: "Invalid or expired access token",
        code: "INVALID_TOKEN",
      });
      return;
    }

    // Attach user to request
    req.user = decoded;
    next();
  } catch (error) {
    logger.error("Auth middleware error:", error);
    res.status(500).json({
      success: false,
      error: "Authentication failed",
    });
  }
}

/**
 * Optional auth middleware
 * Attaches user if token is valid, but doesn't require it
 */
export function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      const decoded = verifyAccessToken(token);
      if (decoded) {
        req.user = decoded;
      }
    }

    next();
  } catch (error) {
    // Continue without auth on error
    next();
  }
}

export default authMiddleware;
