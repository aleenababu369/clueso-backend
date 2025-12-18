import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export interface TokenPayload {
  userId: string;
  email: string;
}

export interface DecodedToken extends JwtPayload {
  userId: string;
  email: string;
}

/**
 * Generate access token (short-lived)
 */
export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_EXPIRY as jwt.Secret,
  } as SignOptions);
}

/**
 * Generate refresh token (long-lived)
 */
export function generateRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRY as jwt.Secret,
  } as SignOptions);
}

/**
 * Verify access token
 */
export function verifyAccessToken(token: string): DecodedToken | null {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as DecodedToken;
  } catch (error) {
    return null;
  }
}

/**
 * Verify refresh token
 */
export function verifyRefreshToken(token: string): DecodedToken | null {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET) as DecodedToken;
  } catch (error) {
    return null;
  }
}

/**
 * Parse expiry string to milliseconds
 */
export function parseExpiryToMs(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) {
    return 7 * 24 * 60 * 60 * 1000; // Default 7 days
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      return 7 * 24 * 60 * 60 * 1000;
  }
}
