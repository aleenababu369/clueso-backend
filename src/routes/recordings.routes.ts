import { Router } from "express";
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { env } from "../config/env";
import {
  uploadRecording,
  getRecording,
  downloadRecording,
  streamRawVideo,
  listRecordings,
  deleteRecording,
  processRecording,
} from "../controllers/recordings.controller";
import {
  authMiddleware,
  optionalAuthMiddleware,
} from "../middleware/auth.middleware";

const router = Router();

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Save to temp directory first, will be moved to proper location in controller
    const tempDir = path.join(env.UPLOAD_DIR, "temp");
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

// File filter to only accept video files
const fileFilter = (
  req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedMimeTypes = [
    "video/webm",
    "video/mp4",
    "video/avi",
    "video/mov",
    "video/quicktime",
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type: ${file.mimetype}. Only video files are allowed.`
      )
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max file size
  },
});

/**
 * @route   POST /api/recordings
 * @desc    Upload a new recording (video + DOM events)
 * @access  Public/Private (optional auth - extension may not have token initially)
 */
router.post(
  "/",
  optionalAuthMiddleware,
  upload.single("video"),
  uploadRecording
);

/**
 * @route   GET /api/recordings
 * @desc    List all recordings for authenticated user
 * @access  Private
 */
router.get("/", authMiddleware, listRecordings);

/**
 * @route   GET /api/recordings/:id
 * @desc    Get recording by ID
 * @access  Private
 */
router.get("/:id", authMiddleware, getRecording);

/**
 * @route   GET /api/recordings/:id/download
 * @desc    Download final processed video
 * @access  Private
 */
router.get("/:id/download", authMiddleware, downloadRecording);

/**
 * @route   GET /api/recordings/:id/stream-raw
 * @desc    Stream raw (original) video for preview
 * @access  Private
 */
router.get("/:id/stream-raw", authMiddleware, streamRawVideo);

/**
 * @route   DELETE /api/recordings/:id
 * @desc    Delete a recording
 * @access  Private
 */
router.delete("/:id", authMiddleware, deleteRecording);

/**
 * @route   POST /api/recordings/:id/process
 * @desc    Process a draft recording (Translate -> AI Voice -> Merge)
 * @access  Private
 */
router.post("/:id/process", authMiddleware, processRecording);

export default router;
