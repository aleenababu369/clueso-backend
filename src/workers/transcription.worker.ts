import { Worker, Job } from "bullmq";
import { redisConnection } from "../config/redis";
import { logger } from "../utils/logger";
import { Recording, ProcessingStep } from "../models/recording.model";
import { deepgramService } from "../services/deepgram.service";
import { fileService } from "../services/file.service";
import {
  RECORDING_QUEUE_NAME,
  JobType,
  addNextJob,
  TranscribeJobData,
} from "../queues/recording.queue";
import { emitProcessingUpdate } from "../sockets/socketServer";

/**
 * Worker for transcribing audio using Deepgram
 */
export const transcriptionWorker = new Worker<TranscribeJobData>(
  RECORDING_QUEUE_NAME,
  async (job: Job<TranscribeJobData>) => {
    if (job.name !== JobType.TRANSCRIBE) {
      return;
    }

    const { recordingId } = job.data;
    console.log("========================================");
    console.log("[TRANSCRIBE] 📝 Starting transcription...");
    console.log("[TRANSCRIBE] Recording ID:", recordingId);
    console.log("[TRANSCRIBE] Job ID:", job.id);
    logger.info(`[Transcription] Starting for recording: ${recordingId}`);

    try {
      // Update recording step
      console.log("[TRANSCRIBE] Updating database status...");
      await Recording.findByIdAndUpdate(recordingId, {
        currentStep: ProcessingStep.TRANSCRIBING,
      });

      // Emit WebSocket update
      console.log("[TRANSCRIBE] Emitting WebSocket update...");
      emitProcessingUpdate(recordingId, ProcessingStep.TRANSCRIBING);

      // Get file paths
      const paths = fileService.getRecordingPaths(recordingId);
      console.log("[TRANSCRIBE] Audio file:", paths.audio);

      // Transcribe audio using Deepgram
      console.log("[TRANSCRIBE] Calling Deepgram API...");
      const transcript = await deepgramService.transcribeAudio(
        paths.audio,
        recordingId
      );
      console.log("[TRANSCRIBE] ✅ Transcription received");
      console.log(
        "[TRANSCRIBE] Transcript length:",
        transcript.length,
        "chars"
      );

      // Save transcript to file
      console.log("[TRANSCRIBE] Saving transcript file...");
      await fileService.saveFile(paths.transcript, transcript);

      // Update recording with transcript
      console.log("[TRANSCRIBE] Updating database with transcript...");
      await Recording.findByIdAndUpdate(recordingId, {
        transcript,
        transcriptPath: paths.transcript,
      });

      logger.info(`[Transcription] Completed for recording: ${recordingId}`);
      console.log("[TRANSCRIBE] 🎉 Transcription complete!");

      // Add next job in pipeline
      console.log("[TRANSCRIBE] Queuing next job: AI_PROCESS...");
      await addNextJob(JobType.TRANSCRIBE, recordingId);
      console.log("[TRANSCRIBE] ✅ Next job queued");
      console.log("========================================");

      return { success: true, transcript };
    } catch (error) {
      logger.error(
        `[Transcription] Failed for recording: ${recordingId}`,
        error
      );

      // Update recording status to failed
      await Recording.findByIdAndUpdate(recordingId, {
        status: "failed",
        currentStep: ProcessingStep.FAILED,
        errorMessage:
          error instanceof Error ? error.message : "Transcription failed",
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

transcriptionWorker.on("completed", (job) => {
  if (job.name === JobType.TRANSCRIBE) {
    logger.info(`[Transcription] Job ${job.id} completed`);
  }
});

transcriptionWorker.on("failed", (job, error) => {
  if (job?.name === JobType.TRANSCRIBE) {
    logger.error(`[Transcription] Job ${job.id} failed:`, error);
  }
});

export default transcriptionWorker;
