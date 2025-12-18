import mongoose, { Schema, Model } from "mongoose";

// Recording status enum
export enum RecordingStatus {
  UPLOADED = "uploaded",
  PROCESSING = "processing",
  DRAFT_READY = "draft_ready",
  COMPLETED = "completed",
  FAILED = "failed",
}

// Processing step enum for tracking progress
export enum ProcessingStep {
  EXTRACTING_AUDIO = "extracting-audio",
  TRANSCRIBING = "transcribing",
  AI_PROCESSING = "ai-processing",
  APPLYING_ZOOM_EFFECTS = "applying-zoom-effects",
  MERGING = "merging",
  COMPLETED = "completed",
  FAILED = "failed",
}

// DOM Event interface
export interface DOMEvent {
  type: string;
  timestamp: number;
  target?: {
    selector?: string;
    tagName?: string;
    id?: string;
    className?: string;
    text?: string;
  };
  coordinates?: {
    x: number;
    y: number;
  };
  scrollPosition?: {
    x: number;
    y: number;
  };
  viewport?: {
    width: number;
    height: number;
  };
  data?: Record<string, any>;
}

// Recording document interface
export interface IRecording {
  _id: string;
  filePath: string;
  eventsPath: string;
  audioPath?: string;
  transcriptPath?: string;
  zoomedVideoPath?: string;
  voiceoverPath?: string;
  finalVideoPath?: string;
  cleanedScript?: string;
  transcript?: string;
  status: RecordingStatus;
  currentStep?: ProcessingStep;
  title?: string;
  description?: string;
  targetLanguage?: string;
  userId?: string;
  errorMessage?: string;
  processingStartedAt?: Date;
  processingCompletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Recording schema
const recordingSchema = new Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    filePath: {
      type: String,
      required: true,
    },
    eventsPath: {
      type: String,
      required: true,
    },
    audioPath: {
      type: String,
    },
    transcriptPath: {
      type: String,
    },
    zoomedVideoPath: {
      type: String,
    },
    voiceoverPath: {
      type: String,
    },
    finalVideoPath: {
      type: String,
    },
    cleanedScript: {
      type: String,
    },
    transcript: {
      type: String,
    },
    status: {
      type: String,
      enum: Object.values(RecordingStatus),
      default: RecordingStatus.UPLOADED,
    },
    currentStep: {
      type: String,
      enum: Object.values(ProcessingStep),
    },
    title: {
      type: String,
    },
    description: {
      type: String,
    },
    targetLanguage: {
      type: String,
      default: "en",
    },
    userId: {
      type: String,
    },
    errorMessage: {
      type: String,
    },
    processingStartedAt: {
      type: Date,
    },
    processingCompletedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    _id: false, // We're providing our own _id
  }
);

// Indexes for common queries
recordingSchema.index({ status: 1 });
recordingSchema.index({ userId: 1 });
recordingSchema.index({ createdAt: -1 });

export const Recording: Model<IRecording> = mongoose.model<IRecording>(
  "Recording",
  recordingSchema
);

export default Recording;
