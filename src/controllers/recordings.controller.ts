import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { asyncHandler, ValidationError, NotFoundError } from "../utils/errors";
import { logger } from "../utils/logger";
import {
  Recording,
  RecordingStatus,
  ProcessingStep,
  DOMEvent,
} from "../models/recording.model";
import { fileService } from "../services/file.service";
import {
  addProcessingJob,
  addFinalProcessingJob,
} from "../queues/recording.queue";

// Extend Express Request to include file from Multer
interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

/**
 * Upload a new recording (video + DOM events)
 * POST /api/recordings
 */
export const uploadRecording = asyncHandler(
  async (req: MulterRequest, res: Response) => {
    console.log("========================================");
    console.log("[UPLOAD] 🎬 Starting upload process...");
    console.log("[UPLOAD] Request received at:", new Date().toISOString());
    logger.info("Received upload request");

    // Validate file upload
    if (!req.file) {
      console.log("[UPLOAD] ❌ No video file in request!");
      throw new ValidationError("Video file is required", {
        video: "No video file uploaded",
      });
    }
    console.log("[UPLOAD] ✅ Video file received:", req.file.originalname);
    console.log("[UPLOAD]    Size:", req.file.size, "bytes");
    console.log("[UPLOAD]    Path:", req.file.path);

    // Parse and validate events JSON
    let events: DOMEvent[] = [];
    if (req.body.events) {
      try {
        events = JSON.parse(req.body.events);
        if (!Array.isArray(events)) {
          throw new Error("Events must be an array");
        }
        console.log("[UPLOAD] ✅ DOM events parsed:", events.length, "events");
      } catch (error) {
        console.log("[UPLOAD] ❌ Failed to parse events JSON");
        throw new ValidationError("Invalid events JSON format", {
          events: "Events must be a valid JSON array",
        });
      }
    } else {
      console.log("[UPLOAD] ⚠️ No DOM events in request");
    }

    // Extract optional metadata
    const { title, description } = req.body;
    // Get userId from authenticated user (if available)
    const userId = req.user?.userId;
    console.log("[UPLOAD] Title:", title || "(auto-generated)");

    // Generate recording ID
    const recordingId = uuidv4();
    console.log("[UPLOAD] 🆔 Generated recording ID:", recordingId);

    // Get file paths
    const paths = fileService.getRecordingPaths(recordingId);
    console.log("[UPLOAD] 📁 Recording directory:", paths.directory);

    try {
      // Ensure recording directory exists
      console.log("[UPLOAD] Creating recording directory...");
      await fileService.ensureDirectory(paths.directory);
      console.log("[UPLOAD] ✅ Directory created");

      // Move uploaded file to recording directory
      console.log("[UPLOAD] Moving video file...");
      await fileService.moveFile(req.file.path, paths.rawVideo);
      console.log("[UPLOAD] ✅ Video moved to:", paths.rawVideo);

      // Save DOM events to JSON file
      console.log("[UPLOAD] Saving DOM events JSON...");
      await fileService.saveFile(paths.events, JSON.stringify(events, null, 2));
      console.log("[UPLOAD] ✅ Events saved to:", paths.events);

      // Create recording in database
      console.log("[UPLOAD] Creating database record...");
      const recording = new Recording({
        _id: recordingId,
        filePath: paths.rawVideo,
        eventsPath: paths.events,
        status: RecordingStatus.UPLOADED,
        title: title || `Recording ${recordingId.substring(0, 8)}`,
        description,
        userId,
      });

      await recording.save();
      console.log("[UPLOAD] ✅ Database record created");

      // Add processing job to queue
      console.log("[UPLOAD] Adding to processing queue...");
      await addProcessingJob(recordingId);
      console.log("[UPLOAD] ✅ Processing job queued");

      logger.info(`Recording created: ${recordingId}`);
      console.log("[UPLOAD] 🎉 Upload complete! Recording ID:", recordingId);
      console.log("========================================");

      res.status(201).json({
        success: true,
        recordingId,
        status: "queued",
        message: "Recording uploaded and queued for processing",
      });
    } catch (error) {
      // Clean up on failure
      try {
        await fileService.deleteDirectory(paths.directory);
      } catch (cleanupError) {
        logger.error("Failed to clean up after upload error:", cleanupError);
      }
      throw error;
    }
  }
);

/**
 * Get recording by ID
 * GET /api/recordings/:id
 */
export const getRecording = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const recording = await Recording.findById(id);

    if (!recording) {
      throw new NotFoundError("Recording");
    }

    res.json({
      success: true,
      recording: {
        id: recording._id,
        status: recording.status,
        currentStep: recording.currentStep,
        title: recording.title,
        description: recording.description,
        finalVideoPath: recording.finalVideoPath,
        cleanedScript: recording.cleanedScript,
        transcript: recording.transcript,
        targetLanguage: recording.targetLanguage,
        createdAt: recording.createdAt,
        updatedAt: recording.updatedAt,
        processingStartedAt: recording.processingStartedAt,
        processingCompletedAt: recording.processingCompletedAt,
        errorMessage: recording.errorMessage,
      },
    });
  }
);

/**
 * Download final video
 * GET /api/recordings/:id/download
 */
export const downloadRecording = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const recording = await Recording.findById(id);

    if (!recording) {
      throw new NotFoundError("Recording");
    }

    if (recording.status !== RecordingStatus.COMPLETED) {
      throw new ValidationError("Recording is not ready for download", {
        status: `Current status: ${recording.status}`,
      });
    }

    if (!recording.finalVideoPath) {
      throw new NotFoundError("Final video file");
    }

    // Check if file exists
    const exists = await fileService.fileExists(recording.finalVideoPath);
    if (!exists) {
      throw new NotFoundError("Final video file");
    }

    // Get file stats for content length
    const stats = await fileService.getFileStats(recording.finalVideoPath);

    // Set headers
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", stats.size);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${recording.title || id}.mp4"`
    );

    // Stream the file
    const stream = fileService.createReadStream(recording.finalVideoPath);
    stream.pipe(res);
  }
);

/**
 * Stream raw (original) video for preview
 * GET /api/recordings/:id/stream-raw
 */
export const streamRawVideo = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const recording = await Recording.findById(id);

    if (!recording) {
      throw new NotFoundError("Recording");
    }

    if (!recording.filePath) {
      throw new NotFoundError("Raw video file");
    }

    // Check if file exists
    const exists = await fileService.fileExists(recording.filePath);
    if (!exists) {
      throw new NotFoundError("Raw video file");
    }

    // Get file stats for content length
    const stats = await fileService.getFileStats(recording.filePath);

    // Determine content type based on file extension
    const ext = recording.filePath.split(".").pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      webm: "video/webm",
      mp4: "video/mp4",
      avi: "video/avi",
      mov: "video/quicktime",
    };
    const contentType = mimeTypes[ext || ""] || "video/mp4";

    // Set headers for inline playback (not download)
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", stats.size);
    res.setHeader("Accept-Ranges", "bytes");

    // Stream the file
    const stream = fileService.createReadStream(recording.filePath);
    stream.pipe(res);
  }
);

/**
 * List all recordings
 * GET /api/recordings
 */
export const listRecordings = asyncHandler(
  async (req: Request, res: Response) => {
    const { status, page = 1, limit = 20 } = req.query;

    const query: Record<string, any> = {};

    // Filter by authenticated user's ID
    if (req.user?.userId) {
      query.userId = req.user.userId;
    }

    if (status) {
      query.status = status;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [recordings, total] = await Promise.all([
      Recording.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .select("-transcript -cleanedScript"),
      Recording.countDocuments(query),
    ]);

    res.json({
      success: true,
      recordings: recordings.map((recording) => ({
        id: recording._id,
        status: recording.status,
        currentStep: recording.currentStep,
        title: recording.title,
        description: recording.description,
        createdAt: recording.createdAt,
        updatedAt: recording.updatedAt,
      })),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  }
);

/**
 * Delete a recording
 * DELETE /api/recordings/:id
 */
export const deleteRecording = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;

    const recording = await Recording.findById(id);

    if (!recording) {
      throw new NotFoundError("Recording");
    }

    // Delete recording directory and all files
    const paths = fileService.getRecordingPaths(id);
    await fileService.deleteDirectory(paths.directory);

    // Delete from database
    await Recording.findByIdAndDelete(id);

    logger.info(`Recording deleted: ${id}`);

    res.json({
      success: true,
      message: "Recording deleted successfully",
    });
  }
);

/**
 * Process a draft recording (Language Translation -> Voiceover -> Merge)
 * POST /api/recordings/:id/process
 */
export const processRecording = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { language = "en" } = req.body;

    console.log(`[PROCESS] 🔄 Processing request for recording ${id}`);
    console.log(`[PROCESS] Target language: ${language}`);

    const recording = await Recording.findById(id);

    if (!recording) {
      throw new NotFoundError("Recording");
    }

    // Check if recording is in valid state (should be DRAFT_READY or COMPLETED if re-processing)
    // We allow re-processing even if completed, to generate new languages
    if (
      recording.status !== RecordingStatus.DRAFT_READY &&
      recording.status !== RecordingStatus.COMPLETED &&
      recording.status !== RecordingStatus.FAILED // Allow retry
    ) {
      // If it's processing or uploaded, we might want to wait
      // But for now, let's just warn
      console.log(
        `[PROCESS] ⚠️ Recording status is ${recording.status}, expected DRAFT_READY`
      );
    }

    // Update status to PROCESSING
    recording.status = RecordingStatus.PROCESSING;
    recording.currentStep = ProcessingStep.AI_PROCESSING; // Reset step
    recording.targetLanguage = language;
    recording.errorMessage = undefined; // Clear previous errors
    await recording.save();

    // Trigger final processing pipeline
    await addFinalProcessingJob(id, language);

    console.log(`[PROCESS] ✅ Final processing job queued`);

    res.json({
      success: true,
      message: `Processing started for language: ${language}`,
      status: "processing",
    });
  }
);

export default {
  uploadRecording,
  getRecording,
  downloadRecording,
  streamRawVideo,
  listRecordings,
  deleteRecording,
  processRecording,
};
