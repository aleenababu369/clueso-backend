import { Worker, Job } from "bullmq";
import { redisConnection } from "../config/redis";
import { logger } from "../utils/logger";
import {
  Recording,
  RecordingStatus,
  ProcessingStep,
} from "../models/recording.model";
import { ffmpegService } from "../services/ffmpeg.service";
import { fileService } from "../services/file.service";
import {
  RECORDING_QUEUE_NAME,
  JobType,
  MergeJobData,
} from "../queues/recording.queue";
import { emitProcessingUpdate } from "../sockets/socketServer";

/**
 * Worker for merging zoomed video with voiceover audio
 */
export const mergeWorker = new Worker<MergeJobData>(
  RECORDING_QUEUE_NAME,
  async (job: Job<MergeJobData>) => {
    if (job.name !== JobType.MERGE) {
      return;
    }

    const { recordingId } = job.data;
    logger.info(`[Merge] Starting for recording: ${recordingId}`);

    try {
      // Update recording step
      await Recording.findByIdAndUpdate(recordingId, {
        currentStep: ProcessingStep.MERGING,
      });

      // Emit WebSocket update (using 'applying-zoom-effects' as there's no 'merging' step defined)
      emitProcessingUpdate(recordingId, ProcessingStep.APPLYING_ZOOM_EFFECTS);

      // Get file paths
      const paths = fileService.getRecordingPaths(recordingId);

      // Merge zoomed video with voiceover audio
      await ffmpegService.mergeAudioVideo(
        paths.zoomedVideo,
        paths.voiceover,
        paths.finalVideo,
        recordingId
      );

      // Update recording as completed
      await Recording.findByIdAndUpdate(recordingId, {
        status: RecordingStatus.COMPLETED,
        currentStep: ProcessingStep.COMPLETED,
        finalVideoPath: paths.finalVideo,
        processingCompletedAt: new Date(),
      });

      // Emit completion
      emitProcessingUpdate(recordingId, ProcessingStep.COMPLETED);

      logger.info(`[Merge] Completed for recording: ${recordingId}`);

      return { success: true, finalVideoPath: paths.finalVideo };
    } catch (error) {
      logger.error(`[Merge] Failed for recording: ${recordingId}`, error);

      // Update recording status to failed
      await Recording.findByIdAndUpdate(recordingId, {
        status: RecordingStatus.FAILED,
        currentStep: ProcessingStep.FAILED,
        errorMessage: error instanceof Error ? error.message : "Merge failed",
      });

      // Emit failure
      emitProcessingUpdate(recordingId, ProcessingStep.FAILED);

      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1,
  }
);

mergeWorker.on("completed", (job) => {
  if (job.name === JobType.MERGE) {
    logger.info(`[Merge] Job ${job.id} completed`);
  }
});

mergeWorker.on("failed", (job, error) => {
  if (job?.name === JobType.MERGE) {
    logger.error(`[Merge] Job ${job.id} failed:`, error);
  }
});

export default mergeWorker;
