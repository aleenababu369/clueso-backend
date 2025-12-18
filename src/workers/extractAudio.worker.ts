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
  addNextJob,
  ExtractAudioJobData,
} from "../queues/recording.queue";
import { emitProcessingUpdate } from "../sockets/socketServer";

// FILE LOAD CONFIRMATION - if you don't see this, the code isn't being reloaded!
console.log(
  "🔧 [WORKER-FILE] extractAudio.worker.ts loaded at:",
  new Date().toISOString()
);

/**
 * Worker for extracting audio from video files
 */
export const extractAudioWorker = new Worker<ExtractAudioJobData>(
  RECORDING_QUEUE_NAME,
  async (job: Job<ExtractAudioJobData>) => {
    // DIAGNOSTIC: Log every job this worker sees
    console.log(
      `[WORKER-EXTRACT] Received job: name="${job.name}", id="${job.id}", expected="${JobType.EXTRACT_AUDIO}"`
    );

    if (job.name !== JobType.EXTRACT_AUDIO) {
      console.log(`[WORKER-EXTRACT] Skipping - job name doesn't match`);
      return;
    }

    const { recordingId } = job.data;
    console.log("========================================");
    console.log("[EXTRACT_AUDIO] 🎵 Starting audio extraction...");
    console.log("[EXTRACT_AUDIO] Recording ID:", recordingId);
    console.log("[EXTRACT_AUDIO] Job ID:", job.id);
    logger.info(`[ExtractAudio] Starting for recording: ${recordingId}`);

    try {
      // Update recording status
      console.log("[EXTRACT_AUDIO] Updating database status to PROCESSING...");
      await Recording.findByIdAndUpdate(recordingId, {
        status: RecordingStatus.PROCESSING,
        currentStep: ProcessingStep.EXTRACTING_AUDIO,
        processingStartedAt: new Date(),
      });
      console.log("[EXTRACT_AUDIO] ✅ Database updated");

      // Emit WebSocket update
      console.log("[EXTRACT_AUDIO] Emitting WebSocket update...");
      emitProcessingUpdate(recordingId, ProcessingStep.EXTRACTING_AUDIO);

      // Get file paths
      const paths = fileService.getRecordingPaths(recordingId);
      console.log("[EXTRACT_AUDIO] Input video:", paths.rawVideo);
      console.log("[EXTRACT_AUDIO] Output audio:", paths.audio);

      // Extract audio from video
      console.log("[EXTRACT_AUDIO] Running FFmpeg to extract audio...");
      await ffmpegService.extractAudio(paths.rawVideo, paths.audio);
      console.log("[EXTRACT_AUDIO] ✅ Audio extracted successfully");

      // Update recording with audio path
      console.log("[EXTRACT_AUDIO] Updating database with audio path...");
      await Recording.findByIdAndUpdate(recordingId, {
        audioPath: paths.audio,
      });

      logger.info(`[ExtractAudio] Completed for recording: ${recordingId}`);
      console.log("[EXTRACT_AUDIO] 🎉 Audio extraction complete!");

      // Add next job in pipeline
      console.log("[EXTRACT_AUDIO] Queuing next job: TRANSCRIBE...");
      await addNextJob(JobType.EXTRACT_AUDIO, recordingId);
      console.log("[EXTRACT_AUDIO] ✅ Next job queued");
      console.log("========================================");

      return { success: true, audioPath: paths.audio };
    } catch (error) {
      logger.error(
        `[ExtractAudio] Failed for recording: ${recordingId}`,
        error
      );

      // Update recording status to failed
      await Recording.findByIdAndUpdate(recordingId, {
        status: RecordingStatus.FAILED,
        currentStep: ProcessingStep.FAILED,
        errorMessage:
          error instanceof Error ? error.message : "Audio extraction failed",
      });

      // Emit failure
      emitProcessingUpdate(recordingId, ProcessingStep.FAILED);

      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 2,
  }
);

extractAudioWorker.on("completed", (job) => {
  if (job.name === JobType.EXTRACT_AUDIO) {
    logger.info(`[ExtractAudio] Job ${job.id} completed`);
  }
});

extractAudioWorker.on("failed", (job, error) => {
  if (job?.name === JobType.EXTRACT_AUDIO) {
    logger.error(`[ExtractAudio] Job ${job.id} failed:`, error);
  }
});

export default extractAudioWorker;
