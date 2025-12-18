import axios, { AxiosError } from "axios";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { ProcessingError } from "../utils/errors";
import { DOMEvent } from "../models/recording.model";

/**
 * Response from Python AI server
 */
export interface AIProcessingResponse {
  cleanedScript: string;
  voiceoverBase64: string;
}

/**
 * Request payload for Python AI server
 */
export interface AIProcessingRequest {
  transcript: string;
  domEvents: DOMEvent[];
  target_language?: string;
}

/**
 * Python AI service for script processing and voiceover generation
 */
export class PythonAIService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = env.PYTHON_AI_URL;
  }

  /**
   * Send transcript and DOM events to Python AI server for processing
   * Returns cleaned script and voiceover audio as base64
   */
  async processWithAI(
    transcript: string,
    domEvents: DOMEvent[],
    recordingId: string,
    targetLanguage: string = "en"
  ): Promise<AIProcessingResponse> {
    try {
      logger.info(`Sending to Python AI server for processing: ${recordingId}`);
      logger.debug(
        `Transcript length: ${transcript.length}, Events count: ${domEvents.length}`
      );

      const payload: AIProcessingRequest = {
        transcript,
        domEvents,
        target_language: targetLanguage,
      };

      const response = await axios.post<AIProcessingResponse>(
        this.baseUrl,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 300000, // 5 minutes timeout for long processing
        }
      );

      if (!response.data.cleanedScript || !response.data.voiceoverBase64) {
        throw new ProcessingError(
          "Invalid response from Python AI server: missing cleanedScript or voiceoverBase64",
          recordingId,
          "ai-processing"
        );
      }

      logger.info(`AI processing complete for: ${recordingId}`);
      logger.debug(
        `Cleaned script length: ${response.data.cleanedScript.length}`
      );

      return response.data;
    } catch (error) {
      // Extract only serializable error info to avoid circular structure
      const errorInfo = axios.isAxiosError(error)
        ? {
            message: error.message,
            code: error.code,
            status: error.response?.status,
            data: error.response?.data,
          }
        : error instanceof Error
        ? error.message
        : String(error);

      console.log("[AI_PROCESS] ❌ Python AI request failed:", errorInfo);
      logger.error("Python AI processing failed:", errorInfo);

      if (error instanceof ProcessingError) {
        throw error;
      }

      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        if (axiosError.code === "ECONNREFUSED") {
          throw new ProcessingError(
            "Python AI server is not available",
            recordingId,
            "ai-processing"
          );
        }

        if (
          axiosError.code === "ETIMEDOUT" ||
          axiosError.code === "ECONNABORTED"
        ) {
          throw new ProcessingError(
            "Python AI server request timed out",
            recordingId,
            "ai-processing"
          );
        }

        // Handle 400 Bad Request from empty transcript
        if (axiosError.response?.status === 400) {
          const responseData = axiosError.response.data as { detail?: string };
          throw new ProcessingError(
            `Python AI server rejected request: ${
              responseData?.detail || axiosError.message
            }`,
            recordingId,
            "ai-processing"
          );
        }

        throw new ProcessingError(
          `Python AI server error: ${axiosError.message}`,
          recordingId,
          "ai-processing"
        );
      }

      throw new ProcessingError(
        `AI processing failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        recordingId,
        "ai-processing"
      );
    }
  }

  /**
   * Health check for Python AI server
   */
  async healthCheck(): Promise<boolean> {
    try {
      const healthUrl = this.baseUrl.replace("/process", "/health");
      const response = await axios.get(healthUrl, { timeout: 5000 });
      return response.status === 200;
    } catch (error) {
      logger.warn("Python AI server health check failed:", error);
      return false;
    }
  }
}

export const pythonAIService = new PythonAIService();

export default pythonAIService;
