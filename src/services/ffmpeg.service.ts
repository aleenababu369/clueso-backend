import ffmpeg from "fluent-ffmpeg";
import path from "path";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { DOMEvent } from "../models/recording.model";
import { ProcessingError } from "../utils/errors";

// Set FFmpeg path - smart detection for Windows/Linux
function initFFmpegPath() {
  // If explicit path is set and not the Linux default, use it
  if (env.FFMPEG_PATH && env.FFMPEG_PATH !== "/usr/bin/ffmpeg") {
    console.log("[FFmpeg] Using configured path:", env.FFMPEG_PATH);
    ffmpeg.setFfmpegPath(env.FFMPEG_PATH);
    return;
  }

  // On Windows, try common installation paths
  if (process.platform === "win32") {
    const commonPaths = [
      "C:\\ffmpeg\\bin\\ffmpeg.exe",
      "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
      "C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe",
    ];

    // Try to use the first existing path (or fall back to PATH)
    for (const ffmpegPath of commonPaths) {
      try {
        require("fs").accessSync(ffmpegPath);
        console.log("[FFmpeg] Found at:", ffmpegPath);
        ffmpeg.setFfmpegPath(ffmpegPath);
        return;
      } catch {
        // Path doesn't exist, try next
      }
    }
  }

  // Fall back to system PATH (will use 'ffmpeg' command)
  console.log("[FFmpeg] Using system PATH (no explicit path set)");
}

initFFmpegPath();

/**
 * FFmpeg service for video processing operations
 */
export class FFmpegService {
  /**
   * Extract audio from video file
   * Command: ffmpeg -i input.webm -vn -acodec pcm_s16le output.wav
   */
  async extractAudio(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info(`Extracting audio from: ${inputPath}`);

      ffmpeg(inputPath)
        .noVideo()
        .audioCodec("pcm_s16le")
        .audioChannels(1)
        .audioFrequency(16000)
        .output(outputPath)
        .on("start", (command) => {
          logger.debug(`FFmpeg command: ${command}`);
        })
        .on("progress", (progress) => {
          if (progress.percent) {
            logger.debug(
              `Audio extraction progress: ${progress.percent.toFixed(2)}%`
            );
          }
        })
        .on("end", () => {
          logger.info(`Audio extracted to: ${outputPath}`);
          resolve();
        })
        .on("error", (err) => {
          logger.error("Audio extraction failed:", err);
          reject(
            new ProcessingError(
              `Audio extraction failed: ${err.message}`,
              "",
              "extracting-audio"
            )
          );
        })
        .run();
    });
  }

  /**
   * Build zoom filter for a specific segment
   * Zooms to the click position by scaling up and cropping around click coordinates
   */
  buildPositionAwareZoomFilter(
    clickX: number,
    clickY: number,
    viewportWidth: number,
    viewportHeight: number,
    videoWidth: number,
    videoHeight: number,
    zoomFactor: number = 1.5
  ): string {
    // Calculate scaled dimensions
    const scaledWidth = Math.round(videoWidth * zoomFactor);
    const scaledHeight = Math.round(videoHeight * zoomFactor);

    // Calculate normalized click position (0-1)
    const normX = clickX / viewportWidth;
    const normY = clickY / viewportHeight;

    // Calculate crop position to center on click
    // Clamp to ensure we don't crop outside bounds
    let cropX = Math.round(normX * scaledWidth - videoWidth / 2);
    let cropY = Math.round(normY * scaledHeight - videoHeight / 2);

    // Clamp crop position to valid range
    cropX = Math.max(0, Math.min(cropX, scaledWidth - videoWidth));
    cropY = Math.max(0, Math.min(cropY, scaledHeight - videoHeight));

    return `scale=${scaledWidth}:${scaledHeight},crop=${videoWidth}:${videoHeight}:${cropX}:${cropY}`;
  }

  /**
   * Apply zoom effects to video based on DOM events
   * Uses a segment-based approach for reliability
   */
  async applyZoomEffects(
    inputPath: string,
    outputPath: string,
    domEvents: DOMEvent[],
    recordingId: string
  ): Promise<void> {
    logger.info(`Applying zoom effects to: ${inputPath}`);

    // Get video metadata
    const metadata = await this.getVideoMetadata(inputPath);
    const videoStream = metadata.streams.find((s) => s.codec_type === "video");
    const rawDuration = metadata.format.duration;
    // Ensure duration is a valid number, fallback to large value if undefined
    const duration =
      typeof rawDuration === "number" && !isNaN(rawDuration)
        ? rawDuration
        : 999;
    const width = videoStream?.width || 1920;
    const height = videoStream?.height || 1080;
    const fps = 30;

    logger.info(`Video metadata: ${width}x${height}, duration=${duration}s`);

    // Filter click events that have coordinates
    const clickEvents = domEvents.filter(
      (event) => event.type === "click" && event.coordinates && event.viewport
    );

    // If no clicks, just re-encode the video
    if (clickEvents.length === 0) {
      logger.info("No click events, copying video with re-encode");
      return this.reencodeVideo(inputPath, outputPath, recordingId);
    }

    // Limit to first 5 clicks for performance
    const limitedClicks = clickEvents
      .slice(0, 5)
      .sort((a, b) => a.timestamp - b.timestamp);

    logger.info(`Processing ${limitedClicks.length} zoom effects`);

    // Build a complex filter that handles all zooms using overlay with enable
    // This is simpler than segment-based and works well with ffmpeg
    const zoomDuration = 1.2; // seconds to hold zoom
    const zoomFactor = 1.4;

    // Build filter parts for each click
    const filterParts: string[] = [];
    let lastOutput = "0:v"; // Start with input video

    limitedClicks.forEach((click, index) => {
      if (!click.coordinates || !click.viewport) return;

      const clickTime = click.timestamp / 1000; // Convert to seconds
      const startTime = Math.max(0, clickTime - 0.2);
      const endTime = Math.min(duration, startTime + zoomDuration);

      // Get crop parameters for this click
      const scaledWidth = Math.round(width * zoomFactor);
      const scaledHeight = Math.round(height * zoomFactor);

      const normX = click.coordinates.x / click.viewport.width;
      const normY = click.coordinates.y / click.viewport.height;

      let cropX = Math.round(normX * scaledWidth - width / 2);
      let cropY = Math.round(normY * scaledHeight - height / 2);
      cropX = Math.max(0, Math.min(cropX, scaledWidth - width));
      cropY = Math.max(0, Math.min(cropY, scaledHeight - height));

      // Create a zoomed overlay for this click
      const zoomLabel = `zoom${index}`;
      const outLabel = `out${index}`;

      // Scale and crop for zoom effect
      filterParts.push(`[${lastOutput}]split[base${index}][forscale${index}]`);
      filterParts.push(
        `[forscale${index}]scale=${scaledWidth}:${scaledHeight},crop=${width}:${height}:${cropX}:${cropY}[${zoomLabel}]`
      );
      filterParts.push(
        `[base${index}][${zoomLabel}]overlay=enable='between(t,${startTime.toFixed(
          2
        )},${endTime.toFixed(2)})'[${outLabel}]`
      );

      lastOutput = outLabel;
    });

    // Handle the filter command
    if (filterParts.length === 0) {
      return this.reencodeVideo(inputPath, outputPath, recordingId);
    }

    const filterComplex = filterParts.join(";");
    logger.debug(`Zoom filter: ${filterComplex}`);

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .complexFilter(filterComplex, lastOutput)
        .videoCodec("libx264")
        .outputOptions(["-preset fast", "-crf 23", "-pix_fmt yuv420p"])
        .output(outputPath)
        .on("start", (command) => {
          logger.debug(`FFmpeg command: ${command}`);
        })
        .on("progress", (progress) => {
          if (progress.percent) {
            logger.debug(
              `Zoom effects progress: ${progress.percent.toFixed(2)}%`
            );
          }
        })
        .on("end", () => {
          logger.info(`Zoom effects applied, output: ${outputPath}`);
          resolve();
        })
        .on("error", (err) => {
          logger.error("Zoom effects failed:", err);
          reject(
            new ProcessingError(
              `Zoom effects failed: ${err.message}`,
              recordingId,
              "applying-zoom-effects"
            )
          );
        })
        .run();
    });
  }

  /**
   * Simple video re-encode (used when no zoom needed)
   */
  async reencodeVideo(
    inputPath: string,
    outputPath: string,
    recordingId: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoCodec("libx264")
        .outputOptions(["-preset fast", "-crf 23", "-pix_fmt yuv420p"])
        .output(outputPath)
        .on("end", () => {
          logger.info(`Video re-encoded to: ${outputPath}`);
          resolve();
        })
        .on("error", (err) => {
          reject(
            new ProcessingError(
              `Re-encode failed: ${err.message}`,
              recordingId,
              "applying-zoom-effects"
            )
          );
        })
        .run();
    });
  }

  /**
   * Merge audio and video files
   * Re-encodes video to H.264 for MP4 compatibility (required when input is WebM)
   */
  async mergeAudioVideo(
    videoPath: string,
    audioPath: string,
    outputPath: string,
    recordingId: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info(`Merging video: ${videoPath} with audio: ${audioPath}`);

      // Check if input is WebM (needs re-encoding for MP4 output)
      const isWebM = videoPath.toLowerCase().endsWith(".webm");

      const command = ffmpeg()
        .input(videoPath)
        .input(audioPath)
        .outputOptions([
          "-map 0:v",
          "-map 1:a",
          // Re-encode video to H.264 for MP4 compatibility
          // WebM uses VP8/VP9 which can't be copied directly to MP4
          "-c:v libx264",
          "-preset fast",
          "-crf 23",
          "-pix_fmt yuv420p",
          "-c:a aac",
          "-b:a 192k",
          "-shortest",
        ])
        .output(outputPath)
        .on("start", (cmd) => {
          logger.debug(`FFmpeg command: ${cmd}`);
        })
        .on("progress", (progress) => {
          if (progress.percent) {
            logger.debug(`Merge progress: ${progress.percent.toFixed(2)}%`);
          }
        })
        .on("end", () => {
          logger.info(`Merge complete, output: ${outputPath}`);
          resolve();
        })
        .on("error", (err) => {
          logger.error("Merge failed:", err);
          reject(
            new ProcessingError(
              `Merge failed: ${err.message}`,
              recordingId,
              "merging"
            )
          );
        });

      command.run();
    });
  }

  /**
   * Get video duration in seconds
   */
  async getVideoDuration(videoPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(metadata.format.duration || 0);
      });
    });
  }

  /**
   * Get video metadata
   */
  async getVideoMetadata(videoPath: string): Promise<ffmpeg.FfprobeData> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(metadata);
      });
    });
  }
}

export const ffmpegService = new FFmpegService();

export default ffmpegService;
