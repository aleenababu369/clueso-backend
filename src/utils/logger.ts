import winston from "winston";
import path from "path";
import { env } from "../config/env";

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    if (stack) {
      log += `\n${stack}`;
    }
    return log;
  })
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(winston.format.colorize(), logFormat),
  }),
];

// Add file transport in production
if (env.NODE_ENV === "production") {
  transports.push(
    new winston.transports.File({
      filename: path.join(process.cwd(), "logs", "error.log"),
      level: "error",
      format: logFormat,
    }),
    new winston.transports.File({
      filename: path.join(process.cwd(), "logs", "combined.log"),
      format: logFormat,
    })
  );
}

export const logger = winston.createLogger({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  format: logFormat,
  transports,
  exitOnError: false,
});

// Create a stream object for Morgan HTTP logging (if needed)
export const loggerStream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};

export default logger;
