import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import type { Language } from "../types";

interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface RAGResponse {
  response: string;
  sources: Array<{
    title: string;
    chunk_index: number;
    snippet: string;
  }>;
  error: string | null;
}

interface PythonResponse {
  status: "success" | "error";
  message?: string;
  data?: RAGResponse;
}

interface PendingRequest {
  resolve: (value: PythonResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class RAGChatService {
  private provider: string;
  private careersJsonPath: string;
  private chromaPersistDir: string;
  private pythonProcess: ChildProcess | null = null;
  private isInitialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  private pendingRequests: PendingRequest[] = [];
  private outputBuffer: string = "";

  constructor(provider: string = "google") {
    this.provider = provider;

    // Set paths relative to backend directory
    const backendDir = path.resolve(__dirname, "../..");
    this.careersJsonPath = path.join(backendDir, "careers_cleaned.json");
    this.chromaPersistDir = path.join(backendDir, "chroma_data_multilingual");
  }

  /**
   * Get the Python executable path
   */
  private getPythonExecutable(): string {
    // Check if virtual environment exists and use its Python
    const backendDir = path.resolve(__dirname, "../..");
    const venvPython = path.join(backendDir, "venv", "bin", "python");
    if (fs.existsSync(venvPython)) {
      return venvPython;
    }

    // Also check for venv/bin/python3 (some systems)
    const venvPython3 = path.join(backendDir, "venv", "bin", "python3");
    if (fs.existsSync(venvPython3)) {
      return venvPython3;
    }

    // Fallback to python3 (macOS/Linux) or python (Windows)
    return process.platform === "win32" ? "python" : "python3";
  }

  /**
   * Process a complete JSON response line
   */
  private processResponseLine(line: string): void {
    try {
      const response: PythonResponse = JSON.parse(line);

      // Get the next pending request (FIFO)
      const pending = this.pendingRequests.shift();

      if (pending) {
        clearTimeout(pending.timeout);

        if (response.status === "error") {
          pending.reject(new Error(response.message || "Unknown error"));
        } else {
          pending.resolve(response);
        }
      } else {
        console.warn("[RAG] Received response with no pending request");
      }
    } catch (error) {
      console.error("[RAG] Failed to parse response:", line, error);
    }
  }

  /**
   * Initialize the Python process (only once)
   * Can be called externally to preload the service
   */
  async initialize(): Promise<void> {
    // If already initialized, return immediately
    if (this.isInitialized && this.pythonProcess) {
      return;
    }

    // If initialization is in progress, wait for it
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Start new initialization
    this.initializationPromise = new Promise(async (resolve, reject) => {
      try {
        const pythonScriptPath = path.join(__dirname, "rag_service.py");
        const backendDir = path.resolve(__dirname, "../..");
        const pythonExecutable = this.getPythonExecutable();

        console.log(
          `[RAG] Starting persistent Python process: ${pythonExecutable}`
        );

        // CRITICAL: Set UTF-8 encoding in environment variables
        this.pythonProcess = spawn(pythonExecutable, [pythonScriptPath], {
          stdio: ["pipe", "pipe", "pipe"],
          cwd: backendDir,
          env: {
            ...process.env,
            PYTHONIOENCODING: "utf-8", // Force UTF-8 for Python I/O
            PYTHONUTF8: "1", // Enable UTF-8 mode for Python 3.7+
            LANG: "en_US.UTF-8", // Set locale to UTF-8
            LC_ALL: "en_US.UTF-8", // Override all locale settings
          },
        });

        // Handle stdout - parse JSON responses line by line
        // CRITICAL: Explicitly set encoding to utf-8
        this.pythonProcess.stdout?.setEncoding("utf-8");
        this.pythonProcess.stdout?.on("data", (data: string) => {
          console.log(`[RAG DEBUG] Received stdout (${data.length} chars):`, data.substring(0, 200));
          this.outputBuffer += data;

          // Process complete lines
          const lines = this.outputBuffer.split("\n");
          this.outputBuffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
              console.log(`[RAG DEBUG] Processing line:`, trimmed.substring(0, 100));
              this.processResponseLine(trimmed);
            }
          }
        });

        // Handle stderr - log errors
        // CRITICAL: Explicitly set encoding to utf-8
        this.pythonProcess.stderr?.setEncoding("utf-8");
        this.pythonProcess.stderr?.on("data", (data: string) => {
          const msg = data.trim();
          // Log ALL stderr for debugging
          console.error(`[RAG STDERR]: ${msg}`);
        });

        // Handle process exit
        this.pythonProcess.on("close", (code: number | null) => {
          console.log(`[RAG] Python process exited with code: ${code}`);
          this.isInitialized = false;
          this.pythonProcess = null;
          this.initializationPromise = null;

          // Reject all pending requests
          while (this.pendingRequests.length > 0) {
            const pending = this.pendingRequests.shift()!;
            clearTimeout(pending.timeout);
            pending.reject(new Error("Python process terminated unexpectedly"));
          }
        });

        this.pythonProcess.on("error", (error: Error) => {
          console.error("[RAG] Python process error:", error);
          this.isInitialized = false;
          this.initializationPromise = null;
          reject(error);
        });

        // Send initialization command
        const initCommand = {
          command: "initialize",
          careers_json_path: this.careersJsonPath,
          chroma_persist_dir: this.chromaPersistDir,
          provider: this.provider,
        };

        const initPromise = new Promise<void>((resolveInit, rejectInit) => {
          const timeout = setTimeout(() => {
            rejectInit(new Error("Initialization timeout (60s)"));
          }, 60000);

          this.pendingRequests.push({
            resolve: (response: PythonResponse) => {
              clearTimeout(timeout);
              if (response.status === "success") {
                this.isInitialized = true;
                console.log("[RAG] Service initialized successfully");
                resolveInit();
              } else {
                rejectInit(
                  new Error(response.message || "Initialization failed")
                );
              }
            },
            reject: (error: Error) => {
              clearTimeout(timeout);
              rejectInit(error);
            },
            timeout,
          });
        });

        // CRITICAL: Write with explicit UTF-8 encoding
        this.pythonProcess.stdin?.write(
          JSON.stringify(initCommand) + "\n",
          "utf-8"
        );

        // Wait for initialization to complete
        await initPromise;
        resolve();
      } catch (error: any) {
        this.initializationPromise = null;
        reject(new Error(`Failed to initialize RAG service: ${error.message}`));
      }
    });

    return this.initializationPromise;
  }

  /**
   * Send a command to the Python process
   */
  private async sendCommand(command: any): Promise<PythonResponse> {
    // Ensure initialized
    await this.initialize();

    if (!this.pythonProcess || !this.isInitialized) {
      throw new Error("RAG service not initialized");
    }

    console.log(`[RAG DEBUG] Sending command: ${command.command}`);

    return new Promise((resolve, reject) => {
      // Set timeout for this request (increased to handle rate limits and retries)
      const timeout = setTimeout(() => {
        console.error(`[RAG DEBUG] Request timeout after 90s for command: ${command.command}`);
        // Remove from pending requests
        const index = this.pendingRequests.findIndex(
          (req) => req.timeout === timeout
        );
        if (index !== -1) {
          this.pendingRequests.splice(index, 1);
        }
        reject(new Error("Request timeout (90s)"));
      }, 90000); // Increased from 30s to 90s to handle API rate limits

      this.pendingRequests.push({
        resolve,
        reject,
        timeout,
      });

      // Send command with explicit UTF-8 encoding
      try {
        // Serialize with proper Unicode handling (no ASCII escaping)
        const jsonString = JSON.stringify(command);
        this.pythonProcess!.stdin?.write(jsonString + "\n", "utf-8");
      } catch (error: any) {
        clearTimeout(timeout);
        const index = this.pendingRequests.findIndex(
          (req) => req.timeout === timeout
        );
        if (index !== -1) {
          this.pendingRequests.splice(index, 1);
        }
        reject(new Error(`Failed to send command: ${error.message}`));
      }
    });
  }

  /**
   * Send a chat message and get a response
   * Handles full UTF-8 flow: Hindi input → processing → Hindi output
   */
  async chat(
    message: string,
    chatHistory: ChatHistoryMessage[] = [],
    language: Language = "en"
  ): Promise<string> {
    // Verify message is properly encoded (defensive check)
    if (typeof message !== "string") {
      throw new Error("Message must be a string");
    }

    // Ensure chat history entries are properly formatted
    const sanitizedHistory = chatHistory.map((msg) => ({
      role: msg.role,
      content: String(msg.content), // Ensure content is string
    }));

    const response = await this.sendCommand({
      command: "chat",
      message: message,
      chat_history: sanitizedHistory,
      language: language,
    });

    // Debug: log the full response from Python
    console.log("[RAG] Full response from Python:", JSON.stringify(response, null, 2));

    // Check for error status first
    if (response.status === "error") {
      throw new Error(response.message || "RAG service returned an error");
    }

    if (response.data && response.data.response) {
      // Response should already be in the specified language
      return response.data.response;
    }

    // Log what we actually received for debugging
    console.error("[RAG] Invalid response structure:", {
      hasData: !!response.data,
      dataResponse: response.data?.response,
      fullResponse: response
    });
    throw new Error("Invalid chat response from RAG service: missing response field");
  }

  /**
   * Generate an initial greeting based on assessment results
   */
  async generateInitialGreeting(
    assessmentSummary: string,
    language: Language = "en"
  ): Promise<{ reply: string; timestamp: Date }> {
    const response = await this.sendCommand({
      command: "greeting",
      assessment_summary: assessmentSummary,
      language: language,
    });

    if (response.data && response.data.response) {
      return {
        reply: response.data.response,
        timestamp: new Date(),
      };
    }

    throw new Error("Invalid greeting response from RAG service");
  }

  /**
   * Gracefully shutdown the Python process
   */
  async shutdown(): Promise<void> {
    if (this.pythonProcess) {
      console.log("[RAG] Shutting down Python process...");
      this.pythonProcess.kill("SIGTERM");
      this.pythonProcess = null;
      this.isInitialized = false;
      this.initializationPromise = null;

      // Clear all pending requests
      while (this.pendingRequests.length > 0) {
        const pending = this.pendingRequests.shift()!;
        clearTimeout(pending.timeout);
        pending.reject(new Error("Service shutting down"));
      }
    }
  }
}

// Create a singleton instance that persists across requests
let ragServiceInstance: RAGChatService | null = null;

/**
 * Get or create the singleton RAG service instance
 */
export function getRAGChatService(provider: string = "google"): RAGChatService {
  if (!ragServiceInstance) {
    ragServiceInstance = new RAGChatService(provider);

    // Cleanup on process exit
    process.on("SIGINT", async () => {
      if (ragServiceInstance) {
        await ragServiceInstance.shutdown();
      }
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      if (ragServiceInstance) {
        await ragServiceInstance.shutdown();
      }
      process.exit(0);
    });
  }

  return ragServiceInstance;
}
