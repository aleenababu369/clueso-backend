import { Queue, QueueEvents } from "bullmq";
import { redisConnection } from "../config/redis";
import { logger } from "../utils/logger";

// Queue names
export const RECORDING_QUEUE_NAME = "recording-processing";

// Job types
export enum JobType {
  START_PROCESSING = "startProcessing",
  EXTRACT_AUDIO = "extractAudio",
  TRANSCRIBE = "transcribe",
  AI_PROCESS = "aiProcess",
  APPLY_ZOOM = "applyZoom",
  MERGE = "merge",
}

// Job data interfaces
export interface StartProcessingJobData {
  recordingId: string;
}

export interface ExtractAudioJobData {
  recordingId: string;
}

export interface TranscribeJobData {
  recordingId: string;
}

export interface AIProcessJobData {
  recordingId: string;
  targetLanguage?: string;
}

export interface ApplyZoomJobData {
  recordingId: string;
}

export interface MergeJobData {
  recordingId: string;
}

export type RecordingJobData =
  | StartProcessingJobData
  | ExtractAudioJobData
  | TranscribeJobData
  | AIProcessJobData
  | ApplyZoomJobData
  | MergeJobData;

// Create the recording queue
export const recordingQueue = new Queue<RecordingJobData>(
  RECORDING_QUEUE_NAME,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 2, // Reduced from 3 - AI has its own retry logic
      backoff: {
        type: "exponential",
        delay: 30000, // 30 seconds - gives rate limits time to reset
      },
      removeOnComplete: {
        count: 100,
        age: 24 * 60 * 60, // 24 hours
      },
      removeOnFail: {
        count: 50,
        age: 7 * 24 * 60 * 60, // 7 days
      },
    },
  }
);

// Queue events for monitoring
export const recordingQueueEvents = new QueueEvents(RECORDING_QUEUE_NAME, {
  connection: redisConnection,
});

recordingQueueEvents.on("completed", ({ jobId }) => {
  logger.info(`Job ${jobId} completed`);
});

recordingQueueEvents.on("failed", ({ jobId, failedReason }) => {
  logger.error(`Job ${jobId} failed: ${failedReason}`);
});

recordingQueueEvents.on("progress", ({ jobId, data }) => {
  logger.debug(`Job ${jobId} progress:`, data);
});

/**
 * Add a job to start processing a recording
 */
export async function addProcessingJob(recordingId: string): Promise<void> {
  await recordingQueue.add(
    JobType.EXTRACT_AUDIO,
    { recordingId },
    {
      jobId: `extract-audio-${recordingId}`,
    }
  );
  logger.info(`Processing job added for recording: ${recordingId}`);
}

/**
 * Add next job in the pipeline
 */
export async function addNextJob(
  currentJobType: JobType,
  recordingId: string
): Promise<void> {
  const nextJobMap: Record<JobType, JobType | null> = {
    [JobType.START_PROCESSING]: JobType.EXTRACT_AUDIO,
    [JobType.EXTRACT_AUDIO]: JobType.TRANSCRIBE,
    [JobType.TRANSCRIBE]: null, // Stop at draft stage
    [JobType.AI_PROCESS]: JobType.APPLY_ZOOM,
    [JobType.APPLY_ZOOM]: JobType.MERGE,
    [JobType.MERGE]: null,
  };

  const nextJob = nextJobMap[currentJobType];

  if (nextJob) {
    await recordingQueue.add(
      nextJob,
      { recordingId },
      {
        jobId: `${nextJob}-${recordingId}`,
      }
    );
    logger.info(`Next job ${nextJob} added for recording: ${recordingId}`);
  }
}

/**
 * Add a job to start final processing (AI -> Merge)
 */
export async function addFinalProcessingJob(
  recordingId: string,
  targetLanguage: string = "en"
): Promise<void> {
  await recordingQueue.add(
    JobType.AI_PROCESS,
    { recordingId, targetLanguage },
    {
      jobId: `ai-process-${recordingId}-${Date.now()}`, // Allow retries/re-runs
    }
  );
  logger.info(
    `Final processing job added for recording: ${recordingId} (Language: ${targetLanguage})`
  );
}

export default recordingQueue;
