import mongoose from "mongoose";
import { env } from "./env";
import { logger } from "../utils/logger";

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URI);
    logger.info("MongoDB connected successfully");
  } catch (error) {
    logger.error("MongoDB connection error:", error);
    process.exit(1);
  }
}

mongoose.connection.on("disconnected", () => {
  logger.warn("MongoDB disconnected");
});

mongoose.connection.on("error", (error) => {
  logger.error("MongoDB error:", error);
});

export default mongoose;
