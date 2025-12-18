import dotenv from "dotenv";
import path from "path";

// Load environment variables from .env file
dotenv.config();

export const env = {
  // Server
  PORT: parseInt(process.env.PORT || "3000", 10),
  NODE_ENV: process.env.NODE_ENV || "development",

  // Redis
  REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",

  // MongoDB
  MONGODB_URI: process.env.MONGODB_URI || "mongodb://localhost:27017/clueso",

  // Deepgram
  DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY || "",

  // Python AI Server
  PYTHON_AI_URL: process.env.PYTHON_AI_URL || "http://localhost:8000/process",

  // File Storage
  UPLOAD_DIR: process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads"),

  // FFmpeg
  FFMPEG_PATH: process.env.FFMPEG_PATH || "ffmpeg",

  // CORS
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:5173",

  // JWT Authentication
  JWT_ACCESS_SECRET:
    process.env.JWT_ACCESS_SECRET || "dev-access-secret-change-in-production",
  JWT_REFRESH_SECRET:
    process.env.JWT_REFRESH_SECRET || "dev-refresh-secret-change-in-production",
  ACCESS_TOKEN_EXPIRY: process.env.ACCESS_TOKEN_EXPIRY || "15m",
  JWT_REFRESH_EXPIRY: process.env.JWT_REFRESH_EXPIRY || "7d",

  // Cookie settings
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN || "localhost",
  COOKIE_SECURE: process.env.NODE_ENV === "production",
};

// Validate required environment variables
export function validateEnv(): void {
  const required = ["DEEPGRAM_API_KEY"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0 && env.NODE_ENV === "production") {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  if (missing.length > 0) {
    console.warn(
      `Warning: Missing environment variables: ${missing.join(", ")}`
    );
  }
}

export default env;
