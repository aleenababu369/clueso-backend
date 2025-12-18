import fs from "fs";
import { Worker, Job } from "bullmq";
import { redisConnection } from "../config/redis";
import { logger } from "../utils/logger";
import { connectDatabase } from "../config/db";
import {
  Recording,
  RecordingStatus,
  ProcessingStep,
  DOMEvent,
} from "../models/recording.model";
import { ffmpegService } from "../services/ffmpeg.service";
import { fileService } from "../services/file.service";
import { deepgramService } from "../services/deepgram.service";
import { pythonAIService } from "../services/pythonAI.service";
import {
  RECORDING_QUEUE_NAME,
  JobType,
  addNextJob,
  RecordingJobData,
} from "../queues/recording.queue";
import { emitProcessingUpdate, emitError } from "../sockets/socketServer";

console.log(
  "🔧 [WORKER] Recording processor loaded at:",
  new Date().toISOString()
);

/**
 * Single unified worker that routes jobs based on job.name
 */
const recordingWorker = new Worker<RecordingJobData>(
  RECORDING_QUEUE_NAME,
  async (job: Job<RecordingJobData>) => {
    console.log("========================================");
    console.log(`[WORKER] 📥 Received job: name="${job.name}", id="${job.id}"`);

    const { recordingId } = job.data;

    try {
      switch (job.name) {
        case JobType.EXTRACT_AUDIO:
          return await processExtractAudio(recordingId);
        case JobType.TRANSCRIBE:
          return await processTranscribe(recordingId);
        case JobType.AI_PROCESS:
          return await processAI(recordingId, (job.data as any).targetLanguage);
        case JobType.APPLY_ZOOM:
          return await processZoom(recordingId);
        case JobType.MERGE:
          return await processMerge(recordingId);
        default:
          console.log(`[WORKER] ⚠️ Unknown job type: ${job.name}`);
          return { success: false, error: `Unknown job type: ${job.name}` };
      }
    } catch (error) {
      console.log(`[WORKER] ❌ Job failed:`, error);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 2,
  }
);

// Extract Audio processor
async function processExtractAudio(recordingId: string) {
  console.log("[EXTRACT_AUDIO] 🎵 Starting audio extraction...");
  console.log("[EXTRACT_AUDIO] Recording ID:", recordingId);

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

  console.log("[EXTRACT_AUDIO] 🎉 Audio extraction complete!");

  // Add next job in pipeline
  console.log("[EXTRACT_AUDIO] Queuing next job: TRANSCRIBE...");
  await addNextJob(JobType.EXTRACT_AUDIO, recordingId);
  console.log("[EXTRACT_AUDIO] ✅ Next job queued");
  console.log("========================================");

  return { success: true, audioPath: paths.audio };
}

// Transcription processor
async function processTranscribe(recordingId: string) {
  console.log("[TRANSCRIBE] 📝 Starting transcription...");
  console.log("[TRANSCRIBE] Recording ID:", recordingId);

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
  console.log("[TRANSCRIBE] Transcript length:", transcript.length, "chars");

  // Save transcript to file
  console.log("[TRANSCRIBE] Saving transcript file...");
  await fileService.saveFile(paths.transcript, transcript);

  // Update recording with transcript
  console.log("[TRANSCRIBE] Updating database with transcript...");
  await Recording.findByIdAndUpdate(recordingId, {
    transcript,
    transcriptPath: paths.transcript,
  });

  // No next job automatically - wait for user to trigger AI processing
  console.log("[TRANSCRIBE] 🎉 Draft processing complete!");

  // Update status to DRAFT_READY
  await Recording.findByIdAndUpdate(recordingId, {
    status: RecordingStatus.DRAFT_READY,
    currentStep: ProcessingStep.COMPLETED, // Mark this step as done, but overall it's DRAFT
  });

  emitProcessingUpdate(recordingId, ProcessingStep.COMPLETED); // Or custom event for draft ready

  console.log("[TRANSCRIBE] ✅ Recording is now in DRAFT_READY state");
  console.log("========================================");

  return { success: true, transcript };
}

// AI Processing
async function processAI(recordingId: string, targetLanguage: string = "en") {
  console.log(
    `[AI_PROCESS] 🤖 Starting AI processing (Language: ${targetLanguage})...`
  );
  console.log("[AI_PROCESS] Recording ID:", recordingId);

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
  console.log("[AI_PROCESS] Transcript length:", transcript.length, "chars");

  console.log("[AI_PROCESS] Reading DOM events file...");
  const domEvents = await fileService.readJsonFile<DOMEvent[]>(paths.events);
  console.log("[AI_PROCESS] DOM events count:", domEvents.length);

  // Check if transcript is empty - skip AI processing
  if (!transcript || transcript.trim().length === 0) {
    console.log(
      "[AI_PROCESS] ⚠️ Empty transcript - skipping AI voiceover generation"
    );
    console.log("[AI_PROCESS] Proceeding with original audio...");

    // Copy original audio as voiceover (fallback)
    if (fs.existsSync(paths.audio)) {
      fs.copyFileSync(paths.audio, paths.voiceover);
      console.log("[AI_PROCESS] ✅ Copied original audio as voiceover");
    } else {
      // Create empty audio file placeholder
      fs.writeFileSync(paths.voiceover, "");
      console.log(
        "[AI_PROCESS] ⚠️ No audio available, created empty voiceover"
      );
    }

    await Recording.findByIdAndUpdate(recordingId, {
      cleanedScript: "[No transcript available]",
      voiceoverPath: paths.voiceover,
    });

    console.log("[AI_PROCESS] 🎉 AI processing skipped (no transcript)!");
    await addNextJob(JobType.AI_PROCESS, recordingId);
    console.log("[AI_PROCESS] ✅ Next job queued: APPLY_ZOOM");
    console.log("========================================");

    return { success: true, cleanedScript: "[No transcript available]" };
  }

  // Send to Python AI server
  console.log("[AI_PROCESS] Calling Python AI service...");
  const result = await pythonAIService.processWithAI(
    transcript,
    domEvents,
    recordingId,
    targetLanguage
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

  console.log("[AI_PROCESS] 🎉 AI processing complete!");

  // Add next job in pipeline
  console.log("[AI_PROCESS] Queuing next job: APPLY_ZOOM...");
  await addNextJob(JobType.AI_PROCESS, recordingId);
  console.log("[AI_PROCESS] ✅ Next job queued");
  console.log("========================================");

  return { success: true, cleanedScript: result.cleanedScript };
}

// Zoom effects processor
async function processZoom(recordingId: string) {
  console.log("[ZOOM] 🔍 Starting zoom effects...");
  console.log("[ZOOM] Recording ID:", recordingId);

  // Update recording step
  await Recording.findByIdAndUpdate(recordingId, {
    currentStep: ProcessingStep.APPLYING_ZOOM_EFFECTS,
  });

  emitProcessingUpdate(recordingId, ProcessingStep.APPLYING_ZOOM_EFFECTS);

  const paths = fileService.getRecordingPaths(recordingId);

  // Read DOM events for zoom processing
  console.log("[ZOOM] Reading DOM events...");
  let domEvents: DOMEvent[] = [];
  try {
    domEvents = await fileService.readJsonFile<DOMEvent[]>(paths.events);
    console.log("[ZOOM] DOM events count:", domEvents.length);
  } catch (err) {
    console.log("[ZOOM] ⚠️ Could not read DOM events, skipping zoom");
    domEvents = [];
  }

  // Filter click events
  const clickEvents = domEvents.filter(
    (e) => e.type === "click" && e.coordinates
  );
  console.log("[ZOOM] Click events with coordinates:", clickEvents.length);

  try {
    if (clickEvents.length > 0) {
      // Apply zoom effects using the new position-aware approach
      console.log("[ZOOM] Applying position-aware zoom effects...");
      await ffmpegService.applyZoomEffects(
        paths.rawVideo,
        paths.zoomedVideo,
        domEvents,
        recordingId
      );

      await Recording.findByIdAndUpdate(recordingId, {
        zoomedVideoPath: paths.zoomedVideo,
      });
      console.log("[ZOOM] ✅ Zoom effects applied successfully");
    } else {
      // No click events, use raw video
      console.log("[ZOOM] No click events, using raw video");
      await Recording.findByIdAndUpdate(recordingId, {
        zoomedVideoPath: paths.rawVideo,
      });
    }
  } catch (error) {
    // Fallback: If zoom fails, use raw video
    console.log("[ZOOM] ⚠️ Zoom failed, falling back to raw video:", error);
    await Recording.findByIdAndUpdate(recordingId, {
      zoomedVideoPath: paths.rawVideo,
    });
  }

  console.log("[ZOOM] 🎉 Zoom processing complete!");

  await addNextJob(JobType.APPLY_ZOOM, recordingId);
  console.log("[ZOOM] ✅ Next job queued: MERGE");
  console.log("========================================");

  return {
    success: true,
    zoomedVideoPath: paths.zoomedVideo || paths.rawVideo,
  };
}

// Merge processor
async function processMerge(recordingId: string) {
  console.log("[MERGE] 🎬 Starting final merge...");
  console.log("[MERGE] Recording ID:", recordingId);

  await Recording.findByIdAndUpdate(recordingId, {
    currentStep: ProcessingStep.MERGING,
  });

  emitProcessingUpdate(recordingId, ProcessingStep.MERGING);

  // Get recording to get the actual zoomedVideoPath (might be raw.webm if zoom was skipped)
  const recording = await Recording.findById(recordingId);
  if (!recording) {
    throw new Error(`Recording not found: ${recordingId}`);
  }

  const paths = fileService.getRecordingPaths(recordingId);

  // Use the actual zoomed video path from database (could be raw.webm if zoom was skipped)
  const videoPath = recording.zoomedVideoPath || paths.rawVideo;
  console.log("[MERGE] Using video:", videoPath);
  console.log("[MERGE] Using audio:", paths.voiceover);

  console.log("[MERGE] Merging video and audio...");
  await ffmpegService.mergeAudioVideo(
    videoPath,
    paths.voiceover,
    paths.finalVideo,
    recordingId
  );
  console.log("[MERGE] ✅ Merge complete");

  await Recording.findByIdAndUpdate(recordingId, {
    status: RecordingStatus.COMPLETED,
    currentStep: ProcessingStep.COMPLETED,
    finalVideoPath: paths.finalVideo,
    processingCompletedAt: new Date(),
  });

  emitProcessingUpdate(recordingId, ProcessingStep.COMPLETED);

  console.log("[MERGE] 🎉 PIPELINE COMPLETE!");
  console.log("[MERGE] Final video:", paths.finalVideo);
  console.log("========================================");

  return { success: true, finalVideoPath: paths.finalVideo };
}

// Worker event handlers
recordingWorker.on("completed", (job) => {
  logger.info(`[Worker] Job ${job.id} (${job.name}) completed`);
});

recordingWorker.on("failed", (job, error) => {
  logger.error(`[Worker] Job ${job?.id} (${job?.name}) failed:`, error);

  // Update recording status on failure
  if (job?.data.recordingId) {
    const errorMessage =
      error.message || "Unknown error occurred during processing";

    Recording.findByIdAndUpdate(job.data.recordingId, {
      status: RecordingStatus.FAILED,
      currentStep: ProcessingStep.FAILED,
      errorMessage: errorMessage,
    }).catch(console.error);

    // Emit both processing update and error with detailed message
    emitProcessingUpdate(job.data.recordingId, ProcessingStep.FAILED);
    emitError(job.data.recordingId, errorMessage);

    logger.error(
      `[Worker] Emitted error to frontend for recording ${job.data.recordingId}: ${errorMessage}`
    );
  }
});

/**
 * Worker entry point
 */
async function startWorker(): Promise<void> {
  logger.info("Starting unified recording worker...");

  try {
    await connectDatabase();
    logger.info("Database connected for worker");
    logger.info("✅ Worker started successfully - listening for jobs...");
  } catch (error) {
    logger.error("Failed to start worker:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down worker...");
  await recordingWorker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down worker...");
  await recordingWorker.close();
  process.exit(0);
});

// Start worker
startWorker();

export default recordingWorker;
