import { Worker, Job } from "bullmq";
import { redisConnection } from "../config/redis";
import { logger } from "../utils/logger";
import { Recording, ProcessingStep, DOMEvent } from "../models/recording.model";
import { pythonAIService } from "../services/pythonAI.service";
import { fileService } from "../services/file.service";
import {
  RECORDING_QUEUE_NAME,
  JobType,
  addNextJob,
  AIProcessJobData,
} from "../queues/recording.queue";
import { emitProcessingUpdate } from "../sockets/socketServer";

/**
 * Worker for AI processing (sending to Python AI server)
 */
export const aiWorker = new Worker<AIProcessJobData>(
  RECORDING_QUEUE_NAME,
  async (job: Job<AIProcessJobData>) => {
    if (job.name !== JobType.AI_PROCESS) {
      return;
    }

    const { recordingId } = job.data;
    console.log("========================================");
    console.log("[AI_PROCESS] 🤖 Starting AI processing...");
    console.log("[AI_PROCESS] Recording ID:", recordingId);
    console.log("[AI_PROCESS] Job ID:", job.id);
    logger.info(`[AI] Starting for recording: ${recordingId}`);

    try {
      // Update recording step
      console.log("[AI_PROCESS] Updating database status...");
      await Recording.findByIdAndUpdate(recordingId, {
        currentStep: ProcessingStep.AI_PROCESSING,
      });

      // Emit WebSocket update
      console.log("[AI_PROCESS] Emitting WebSocket update...");
      emitProcessingUpdate(recordingId, ProcessingStep.AI_PROCESSING);

      // Get recording data
      console.log("[AI_PROCESS] Fetching recording from database...");
      const recording = await Recording.findById(recordingId);
      if (!recording) {
        throw new Error(`Recording not found: ${recordingId}`);
      }
      console.log("[AI_PROCESS] ✅ Recording found");

      // Get file paths
      const paths = fileService.getRecordingPaths(recordingId);

      // Read transcript and DOM events
      const transcript = recording.transcript || "";
      console.log(
        "[AI_PROCESS] Transcript length:",
        transcript.length,
        "chars"
      );

      console.log("[AI_PROCESS] Reading DOM events file...");
      const domEvents = await fileService.readJsonFile<DOMEvent[]>(
        paths.events
      );
      console.log("[AI_PROCESS] DOM events count:", domEvents.length);

      // Send to Python AI server
      console.log("[AI_PROCESS] Calling Python AI service...");
      console.log(
        "[AI_PROCESS] URL:",
        `${process.env.PYTHON_AI_URL || "http://localhost:8000/process"}`
      );
      const result = await pythonAIService.processWithAI(
        transcript,
        domEvents,
        recordingId
      );
      console.log("[AI_PROCESS] ✅ AI processing complete");
      console.log(
        "[AI_PROCESS] Cleaned script length:",
        result.cleanedScript.length,
        "chars"
      );

      // Save voiceover audio from base64
      console.log("[AI_PROCESS] Saving voiceover audio file...");
      await fileService.saveBase64File(paths.voiceover, result.voiceoverBase64);
      console.log("[AI_PROCESS] ✅ Voiceover saved to:", paths.voiceover);

      // Update recording with cleaned script and voiceover path
      console.log("[AI_PROCESS] Updating database with AI results...");
      await Recording.findByIdAndUpdate(recordingId, {
        cleanedScript: result.cleanedScript,
        voiceoverPath: paths.voiceover,
      });

      logger.info(`[AI] Completed for recording: ${recordingId}`);
      console.log("[AI_PROCESS] 🎉 AI processing complete!");

      // Add next job in pipeline
      console.log("[AI_PROCESS] Queuing next job: APPLY_ZOOM...");
      await addNextJob(JobType.AI_PROCESS, recordingId);
      console.log("[AI_PROCESS] ✅ Next job queued");
      console.log("========================================");

      return { success: true, cleanedScript: result.cleanedScript };
    } catch (error) {
      logger.error(`[AI] Failed for recording: ${recordingId}`, error);

      // Update recording status to failed
      await Recording.findByIdAndUpdate(recordingId, {
        status: "failed",
        currentStep: ProcessingStep.FAILED,
        errorMessage:
          error instanceof Error ? error.message : "AI processing failed",
      });

      // Emit failure
      emitProcessingUpdate(recordingId, ProcessingStep.FAILED);

      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1, // Lower concurrency for AI processing
  }
);

aiWorker.on("completed", (job) => {
  if (job.name === JobType.AI_PROCESS) {
    logger.info(`[AI] Job ${job.id} completed`);
  }
});

aiWorker.on("failed", (job, error) => {
  if (job?.name === JobType.AI_PROCESS) {
    logger.error(`[AI] Job ${job.id} failed:`, error);
  }
});

export default aiWorker;
