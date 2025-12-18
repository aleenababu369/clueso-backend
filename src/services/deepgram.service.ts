import { createClient, DeepgramClient } from "@deepgram/sdk";
import fs from "fs";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { ProcessingError } from "../utils/errors";

/**
 * Deepgram service for audio transcription
 */
export class DeepgramService {
  private client: DeepgramClient;

  constructor() {
    this.client = createClient(env.DEEPGRAM_API_KEY);
  }

  /**
   * Transcribe an audio file using Deepgram
   */
  async transcribeAudio(
    audioPath: string,
    recordingId: string
  ): Promise<string> {
    try {
      logger.info(`Transcribing audio file: ${audioPath}`);

      // Read the audio file
      const audioBuffer = fs.readFileSync(audioPath);

      // Send to Deepgram for transcription
      const { result, error } =
        await this.client.listen.prerecorded.transcribeFile(audioBuffer, {
          model: "nova-2",
          smart_format: true,
          punctuate: true,
          paragraphs: true,
          utterances: true,
          diarize: true,
        });

      if (error) {
        throw new ProcessingError(
          `Deepgram transcription error: ${error.message}`,
          recordingId,
          "transcribing"
        );
      }

      // Extract transcript from response
      const transcript =
        result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";

      if (!transcript) {
        logger.warn(`Empty transcript received for recording: ${recordingId}`);
      }

      logger.info(`Transcription complete for: ${audioPath}`);
      return transcript;
    } catch (error) {
      logger.error("Deepgram transcription failed:", error);

      if (error instanceof ProcessingError) {
        throw error;
      }

      throw new ProcessingError(
        `Transcription failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        recordingId,
        "transcribing"
      );
    }
  }

  /**
   * Transcribe audio from a URL
   */
  async transcribeUrl(audioUrl: string, recordingId: string): Promise<string> {
    try {
      logger.info(`Transcribing audio from URL: ${audioUrl}`);

      const { result, error } =
        await this.client.listen.prerecorded.transcribeUrl(
          { url: audioUrl },
          {
            model: "nova-2",
            smart_format: true,
            punctuate: true,
            paragraphs: true,
          }
        );

      if (error) {
        throw new ProcessingError(
          `Deepgram transcription error: ${error.message}`,
          recordingId,
          "transcribing"
        );
      }

      const transcript =
        result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";

      logger.info(`Transcription complete for URL: ${audioUrl}`);
      return transcript;
    } catch (error) {
      logger.error("Deepgram URL transcription failed:", error);

      if (error instanceof ProcessingError) {
        throw error;
      }

      throw new ProcessingError(
        `Transcription failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        recordingId,
        "transcribing"
      );
    }
  }
}

export const deepgramService = new DeepgramService();

export default deepgramService;
