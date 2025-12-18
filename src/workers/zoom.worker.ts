import { Worker, Job } from "bullmq";
import { redisConnection } from "../config/redis";
import { logger } from "../utils/logger";
import { Recording, ProcessingStep, DOMEvent } from "../models/recording.model";
import { ffmpegService } from "../services/ffmpeg.service";
import { fileService } from "../services/file.service";
import {
  RECORDING_QUEUE_NAME,
  JobType,
  addNextJob,
  ApplyZoomJobData,
} from "../queues/recording.queue";
import { emitProcessingUpdate } from "../sockets/socketServer";

/**
 * Worker for applying zoom effects based on DOM events
 */
export const zoomWorker = new Worker<ApplyZoomJobData>(
  RECORDING_QUEUE_NAME,
  async (job: Job<ApplyZoomJobData>) => {
    if (job.name !== JobType.APPLY_ZOOM) {
      return;
    }

    const { recordingId } = job.data;
    logger.info(`[Zoom] Starting for recording: ${recordingId}`);

    try {
      // Update recording step
      await Recording.findByIdAndUpdate(recordingId, {
        currentStep: ProcessingStep.APPLYING_ZOOM_EFFECTS,
      });

      // Emit WebSocket update
      emitProcessingUpdate(recordingId, ProcessingStep.APPLYING_ZOOM_EFFECTS);

      // Get file paths
      const paths = fileService.getRecordingPaths(recordingId);

      // Read DOM events
      const domEvents = await fileService.readJsonFile<DOMEvent[]>(
        paths.events
      );

      // Apply zoom effects using FFmpeg
      await ffmpegService.applyZoomEffects(
        paths.rawVideo,
        paths.zoomedVideo,
        domEvents,
        recordingId
      );

      // Update recording with zoomed video path
      await Recording.findByIdAndUpdate(recordingId, {
        zoomedVideoPath: paths.zoomedVideo,
      });

      logger.info(`[Zoom] Completed for recording: ${recordingId}`);

      // Add next job in pipeline
      await addNextJob(JobType.APPLY_ZOOM, recordingId);

      return { success: true, zoomedVideoPath: paths.zoomedVideo };
    } catch (error) {
      logger.error(`[Zoom] Failed for recording: ${recordingId}`, error);

      // Update recording status to failed
      await Recording.findByIdAndUpdate(recordingId, {
        status: "failed",
        currentStep: ProcessingStep.FAILED,
        errorMessage:
          error instanceof Error ? error.message : "Zoom effects failed",
      });

      // Emit failure
      emitProcessingUpdate(recordingId, ProcessingStep.FAILED);

      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1, // Lower concurrency for video processing
  }
);

zoomWorker.on("completed", (job) => {
  if (job.name === JobType.APPLY_ZOOM) {
    logger.info(`[Zoom] Job ${job.id} completed`);
  }
});

zoomWorker.on("failed", (job, error) => {
  if (job?.name === JobType.APPLY_ZOOM) {
    logger.error(`[Zoom] Job ${job.id} failed:`, error);
  }
});

export default zoomWorker;
