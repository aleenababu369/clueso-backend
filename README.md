# Clueso Backend

Node.js backend service for video processing, job management, and real-time updates.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Clueso Backend                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐    │
│  │   Express   │     │   BullMQ    │     │  Socket.io  │    │
│  │   Server    │     │   Worker    │     │   Server    │    │
│  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘    │
│         │                   │                   │           │
│         ▼                   ▼                   ▼           │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                     Redis                            │    │
│  │              (Job Queue + Pub/Sub)                   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                    MongoDB                           │    │
│  │              (Recording Metadata)                    │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
src/
├── app.ts               # Express app configuration
├── server.ts            # Server entry point
├── config/
│   ├── env.ts           # Environment variables
│   ├── database.ts      # MongoDB connection
│   └── redis.ts         # Redis connections (BullMQ + Pub/Sub)
├── controllers/
│   └── recordings.controller.ts  # API handlers
├── models/
│   └── recording.model.ts        # MongoDB schema
├── routes/
│   └── recording.routes.ts       # API routes
├── services/
│   ├── ffmpeg.service.ts         # Video processing
│   ├── deepgram.service.ts       # Speech-to-text
│   ├── ai.service.ts             # Python AI integration
│   └── file.service.ts           # File management
├── workers/
│   └── index.ts                  # BullMQ job processor
├── queues/
│   └── processing.queue.ts       # Job queue setup
├── sockets/
│   └── socketServer.ts           # WebSocket + Redis pub/sub
└── utils/
    ├── errors.ts                 # Custom error classes
    └── logger.ts                 # Winston logger
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Redis
- MongoDB
- FFmpeg

### Installation

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env
```

### Environment Variables

```env
# Server
PORT=3000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/clueso

# Redis
REDIS_URL=redis://localhost:6379

# External Services
DEEPGRAM_API_KEY=your_deepgram_api_key
AI_SERVICE_URL=http://localhost:8000

# FFmpeg (Windows)
FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe

# CORS
CORS_ORIGIN=http://localhost:5173
```

### Running

```bash
# Development - API Server
npm run dev

# Development - Worker (separate terminal)
npm run worker

# Production
npm run build
npm start
npm run start:worker
```

## 📡 API Endpoints

### Recordings

| Method   | Endpoint                       | Description           |
| -------- | ------------------------------ | --------------------- |
| `POST`   | `/api/recordings`              | Upload a recording    |
| `GET`    | `/api/recordings`              | List all recordings   |
| `GET`    | `/api/recordings/:id`          | Get recording details |
| `GET`    | `/api/recordings/:id/download` | Download final video  |
| `DELETE` | `/api/recordings/:id`          | Delete a recording    |

### Upload Recording

```bash
curl -X POST http://localhost:3000/api/recordings \
  -F "video=@recording.webm" \
  -F "events=[{\"type\":\"click\",\"timestamp\":1000}]" \
  -F "title=My Tutorial"
```

### Response

```json
{
  "success": true,
  "recordingId": "abc123-def456",
  "status": "processing",
  "message": "Recording uploaded and processing started"
}
```

## ⚙️ Processing Pipeline

The worker processes recordings through these steps:

```
1. EXTRACT_AUDIO   → FFmpeg extracts audio.wav from video
2. TRANSCRIBE      → Deepgram converts speech to text
3. AI_PROCESS      → Python service cleans transcript + generates voiceover
4. APPLY_ZOOM      → FFmpeg applies zoom effects (currently skipped on Windows)
5. MERGE           → FFmpeg combines video with AI voiceover
6. COMPLETED       → Recording is ready for download
```

### Job Types

```typescript
enum JobType {
  EXTRACT_AUDIO = "extractAudio",
  TRANSCRIBE = "transcribe",
  AI_PROCESS = "aiProcess",
  APPLY_ZOOM = "applyZoom",
  MERGE = "merge",
}
```

## 🔌 WebSocket Events

### Real-time Updates via Redis Pub/Sub

The worker runs in a separate process and can't directly emit WebSocket events. Updates are sent via Redis pub/sub:

```
Worker → Redis Pub/Sub → Server → Socket.io → Dashboard
```

### Events

| Event               | Description                           |
| ------------------- | ------------------------------------- |
| `processing-update` | Step progress update                  |
| `processing-error`  | Processing failure with error message |

### Client Usage

```typescript
// Join room for a specific recording
socket.emit("join-recording", recordingId);

// Listen for updates
socket.on("processing-update", (data) => {
  console.log(data.step); // "transcribing", "ai-processing", etc.
});

socket.on("processing-error", (data) => {
  console.error(data.error);
});
```

## 🎬 FFmpeg Operations

### Extract Audio

```bash
ffmpeg -i input.webm -vn -acodec pcm_s16le -ac 1 -ar 16000 output.wav
```

### Apply Zoom Effects

```bash
ffmpeg -i input.webm -vf "zoompan=z='...' -c:v libx264 output.mp4
```

### Merge Video + Audio

```bash
ffmpeg -i video.webm -i voiceover.wav \
  -c:v libx264 -c:a aac -shortest output.mp4
```

## 📊 Database Schema

### Recording Model

```typescript
interface IRecording {
  _id: string; // UUID from client
  title: string;
  description?: string;
  status: "uploaded" | "processing" | "completed" | "failed";
  currentStep: ProcessingStep;

  // File paths
  filePath: string; // uploads/{id}/raw.webm
  audioPath?: string; // uploads/{id}/audio.wav
  zoomedVideoPath?: string; // uploads/{id}/zoomed.mp4
  finalVideoPath?: string; // uploads/{id}/final.mp4

  // Processing results
  transcript?: string;
  cleanedScript?: string;
  errorMessage?: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  processingCompletedAt?: Date;
}
```

## 🐛 Debugging

### Enable Debug Logs

```bash
DEBUG=* npm run dev
```

### Check Worker Status

Look for these log patterns:

```
[WORKER] 📥 Received job: name="extractAudio"
[EXTRACT_AUDIO] 🎵 Starting audio extraction...
📤 [Redis] Published processing-update for {id}: step=extracting-audio
```

### Common Issues

| Issue                       | Solution                              |
| --------------------------- | ------------------------------------- |
| Worker can't emit WebSocket | Uses Redis pub/sub bridge (automatic) |
| FFmpeg not found            | Set `FFMPEG_PATH` in `.env`           |
| MongoDB connection failed   | Check `MONGODB_URI`                   |
| Deepgram timeout            | Check API key and network             |

## 📦 Scripts

```bash
npm run dev        # Start API server with hot reload
npm run worker     # Start worker process
npm run build      # Compile TypeScript
npm start          # Run production server
npm run start:worker  # Run production worker
```

## 🔧 Configuration

### BullMQ Options

```typescript
// Job retries on failure
attempts: 2,
backoff: { type: "exponential", delay: 1000 }

// Concurrency
concurrency: 1  // Process one job at a time
```

### File Storage

Recordings are stored in:

```
uploads/
└── {recording-id}/
    ├── raw.webm       # Original video
    ├── events.json    # DOM events
    ├── audio.wav      # Extracted audio
    ├── transcript.txt # Deepgram output
    ├── voiceover.wav  # AI-generated audio
    ├── zoomed.mp4     # With zoom effects
    └── final.mp4      # Final output
```

## 📄 License

MIT
