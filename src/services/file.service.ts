import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { env } from "../config/env";
import { logger } from "../utils/logger";

/**
 * File service for handling file system operations
 */
export class FileService {
  /**
   * Ensure a directory exists, creating it if necessary
   */
  async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      logger.error(`Failed to create directory: ${dirPath}`, error);
      throw error;
    }
  }

  /**
   * Get the directory path for a recording
   */
  getRecordingDirectory(recordingId: string): string {
    return path.join(env.UPLOAD_DIR, recordingId);
  }

  /**
   * Get file paths for a recording
   */
  getRecordingPaths(recordingId: string) {
    const dir = this.getRecordingDirectory(recordingId);
    return {
      directory: dir,
      rawVideo: path.join(dir, "raw.webm"),
      events: path.join(dir, "events.json"),
      audio: path.join(dir, "audio.wav"),
      transcript: path.join(dir, "transcript.txt"),
      voiceover: path.join(dir, "voiceover.wav"),
      zoomedVideo: path.join(dir, "zoomed.mp4"),
      finalVideo: path.join(dir, "final.mp4"),
    };
  }

  /**
   * Save a file buffer to disk
   */
  async saveFile(filePath: string, data: Buffer | string): Promise<void> {
    try {
      const dir = path.dirname(filePath);
      await this.ensureDirectory(dir);
      await fs.writeFile(filePath, data);
      logger.info(`File saved: ${filePath}`);
    } catch (error) {
      logger.error(`Failed to save file: ${filePath}`, error);
      throw error;
    }
  }

  /**
   * Read a file from disk
   */
  async readFile(filePath: string): Promise<Buffer> {
    try {
      return await fs.readFile(filePath);
    } catch (error) {
      logger.error(`Failed to read file: ${filePath}`, error);
      throw error;
    }
  }

  /**
   * Read a JSON file from disk
   */
  async readJsonFile<T>(filePath: string): Promise<T> {
    try {
      const data = await fs.readFile(filePath, "utf-8");
      return JSON.parse(data) as T;
    } catch (error) {
      logger.error(`Failed to read JSON file: ${filePath}`, error);
      throw error;
    }
  }

  /**
   * Check if a file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
      logger.info(`File deleted: ${filePath}`);
    } catch (error) {
      logger.error(`Failed to delete file: ${filePath}`, error);
      throw error;
    }
  }

  /**
   * Delete a directory and all its contents
   */
  async deleteDirectory(dirPath: string): Promise<void> {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
      logger.info(`Directory deleted: ${dirPath}`);
    } catch (error) {
      logger.error(`Failed to delete directory: ${dirPath}`, error);
      throw error;
    }
  }

  /**
   * Create a readable stream for a file
   */
  createReadStream(filePath: string): fsSync.ReadStream {
    return fsSync.createReadStream(filePath);
  }

  /**
   * Get file stats
   */
  async getFileStats(filePath: string): Promise<fsSync.Stats> {
    return await fs.stat(filePath);
  }

  /**
   * Move/rename a file
   */
  async moveFile(sourcePath: string, destPath: string): Promise<void> {
    try {
      const destDir = path.dirname(destPath);
      await this.ensureDirectory(destDir);
      await fs.rename(sourcePath, destPath);
      logger.info(`File moved: ${sourcePath} -> ${destPath}`);
    } catch (error) {
      logger.error(`Failed to move file: ${sourcePath} -> ${destPath}`, error);
      throw error;
    }
  }

  /**
   * Save base64 encoded data to a file
   */
  async saveBase64File(filePath: string, base64Data: string): Promise<void> {
    const buffer = Buffer.from(base64Data, "base64");
    await this.saveFile(filePath, buffer);
  }
}

export const fileService = new FileService();

export default fileService;
