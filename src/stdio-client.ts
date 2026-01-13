/**
 * Stdio MCP Client Wrapper
 *
 * Provides a wrapper around the MCP SDK Client with StdioClientTransport
 * for spawning and managing MCP servers as child processes.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  Tool,
  Resource,
  Prompt,
  ResourceTemplate,
  CallToolResult,
  GetPromptResult,
  ReadResourceResult,
  JSONRPCNotification,
  CreateMessageResult,
  ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ToolListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  PromptListChangedNotificationSchema,
  LoggingMessageNotificationSchema,
  CreateMessageRequestSchema,
  ElicitRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  BackendServerStatus,
  BackendServerInfo,
  BufferedNotification,
  BufferedLog,
  PendingSamplingRequest,
  PendingElicitationRequest,
} from "./types.js";
import type { IStdioClient, HealthStatus } from "./client-interface.js";

/**
 * Log source types for stdio client
 */
export type LogSource = "protocol" | "stderr" | "stdout";

/**
 * Restart configuration for stdio clients
 */
export interface StdioRestartConfig {
  /** Whether to automatically restart on crash (default: true) */
  enabled?: boolean;
  /** Maximum restart attempts before giving up (default: 5) */
  maxAttempts?: number;
  /** Base delay in ms before first restart (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay in ms between restarts (default: 60000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
}

/**
 * Process lifecycle event types
 */
export type LifecycleEventType =
  | "process_started"
  | "process_crashed"
  | "restarting"
  | "restarted"
  | "restart_failed"
  | "process_stopped";

/**
 * Process lifecycle event
 */
export interface LifecycleEvent {
  event: LifecycleEventType;
  timestamp: Date;
  exitCode?: number;
  signal?: string;
  attempt?: number;
  nextRetryMs?: number;
  error?: string;
}

/**
 * Options for creating an MCPStdioClient
 */
export interface MCPStdioClientOptions {
  /** Unique name for this backend server */
  name: string;
  /** Command to spawn */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Environment variables (merged with process.env) */
  env?: Record<string, string>;
  /** Working directory for the spawned process */
  cwd?: string;
  /** Restart configuration */
  restartConfig?: StdioRestartConfig;
  /** Callback when the connection status changes */
  onStatusChange?: (status: BackendServerStatus, error?: string) => void;
  /** Callback when a notification is received from the server */
  onNotification?: (notification: BufferedNotification) => void;
  /** Callback when a log message is received (includes stderr capture) */
  onLog?: (log: BufferedLog & { source: LogSource }) => void;
  /** Callback when a sampling request is received from the server */
  onSamplingRequest?: (request: PendingSamplingRequest) => void;
  /** Callback when an elicitation request is received from the server */
  onElicitationRequest?: (request: PendingElicitationRequest) => void;
  /** Callback for lifecycle events */
  onLifecycleEvent?: (event: LifecycleEvent) => void;
}

// Default restart configuration
const DEFAULT_RESTART_CONFIG: Required<StdioRestartConfig> = {
  enabled: true,
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
};

/**
 * Stdio MCP Client wrapper for spawning and managing MCP server processes.
 *
 * Features:
 * - Spawns MCP servers as child processes
 * - Automatic crash recovery with exponential backoff
 * - Stderr capture for debugging
 * - Process lifecycle events
 */
export class MCPStdioClient implements IStdioClient {
  private readonly name: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly env?: Record<string, string>;
  private readonly cwd?: string;
  private readonly restartConfig: Required<StdioRestartConfig>;
  private readonly onStatusChange:
    | ((status: BackendServerStatus, error?: string) => void)
    | undefined;
  private readonly onNotification:
    | ((notification: BufferedNotification) => void)
    | undefined;
  private readonly onLog:
    | ((log: BufferedLog & { source: LogSource }) => void)
    | undefined;
  private readonly onSamplingRequest:
    | ((request: PendingSamplingRequest) => void)
    | undefined;
  private readonly onElicitationRequest:
    | ((request: PendingElicitationRequest) => void)
    | undefined;
  private readonly onLifecycleEvent:
    | ((event: LifecycleEvent) => void)
    | undefined;

  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private status: BackendServerStatus = "disconnected";
  private errorMessage: string | undefined;
  private capabilities: BackendServerInfo["capabilities"] | undefined;
  private isClosing = false;

  // Restart state
  private restartAttempt = 0;
  private restartTimeoutHandle: NodeJS.Timeout | null = null;
  private nextRetryMs = 0;
  private isRestarting = false;

  // Stderr buffer
  private stderrBuffer: string[] = [];
  private readonly maxStderrLines = 1000;

  constructor(options: MCPStdioClientOptions) {
    this.name = options.name;
    this.command = options.command;
    this.args = options.args ?? [];
    this.env = options.env;
    this.cwd = options.cwd;
    this.restartConfig = { ...DEFAULT_RESTART_CONFIG, ...options.restartConfig };
    this.onStatusChange = options.onStatusChange;
    this.onNotification = options.onNotification;
    this.onLog = options.onLog;
    this.onSamplingRequest = options.onSamplingRequest;
    this.onElicitationRequest = options.onElicitationRequest;
    this.onLifecycleEvent = options.onLifecycleEvent;
  }

  // =============================================================================
  // IMCPClient Implementation
  // =============================================================================

  public getTransportType(): "stdio" {
    return "stdio";
  }

  public getInfo(): BackendServerInfo {
    const info: BackendServerInfo = {
      name: this.name,
      url: `stdio://${this.command}`,
      status: this.status,
    };

    if (this.errorMessage !== undefined) {
      info.error = this.errorMessage;
    }

    if (this.capabilities !== undefined) {
      info.capabilities = this.capabilities;
    }

    return info;
  }

  public getName(): string {
    return this.name;
  }

  public getStatus(): BackendServerStatus {
    return this.status;
  }

  public isConnected(): boolean {
    return this.status === "connected";
  }

  public getReconnectionState(): { attempt: number; nextRetryMs: number } | null {
    if (this.status !== "reconnecting") {
      return null;
    }
    return {
      attempt: this.restartAttempt,
      nextRetryMs: this.nextRetryMs,
    };
  }

  public getHealthStatus(): HealthStatus {
    // For stdio, health is based on process state
    return this.isConnected() ? "healthy" : "degraded";
  }

  public getConsecutiveHealthFailures(): number {
    return this.isConnected() ? 0 : this.restartAttempt;
  }

  // =============================================================================
  // IStdioClient Implementation
  // =============================================================================

  public getCommand(): string {
    return this.command;
  }

  public getArgs(): string[] {
    return [...this.args];
  }

  public getStderrBuffer(): string[] {
    return [...this.stderrBuffer];
  }

  // =============================================================================
  // Connection Management
  // =============================================================================

  public async connect(): Promise<void> {
    if (this.status === "connected" || this.status === "connecting") {
      return;
    }

    this.setStatus("connecting");

    try {
      await this.createTransport();
      this.emitLifecycleEvent({ event: "process_started", timestamp: new Date() });
      this.setStatus("connected");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus("error", message);
      throw err;
    }
  }

  public async disconnect(): Promise<void> {
    this.isClosing = true;

    // Cancel any pending restart
    this.cancelReconnection();

    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        // Ignore close errors
      }
    }

    this.client = null;
    this.transport = null;
    this.isClosing = false;
    this.setStatus("disconnected");
    this.emitLifecycleEvent({ event: "process_stopped", timestamp: new Date() });
  }

  public async forceReconnect(): Promise<void> {
    // Cancel any pending restart
    this.cancelReconnection();

    // Close existing connection
    if (this.transport) {
      this.isClosing = true;
      try {
        await this.transport.close();
      } catch {
        // Ignore close errors
      }
      this.isClosing = false;
    }

    this.client = null;
    this.transport = null;

    // Reset restart state
    this.restartAttempt = 0;
    this.nextRetryMs = 0;

    // Connect
    await this.connect();
  }

  public cancelReconnection(): void {
    if (this.restartTimeoutHandle) {
      clearTimeout(this.restartTimeoutHandle);
      this.restartTimeoutHandle = null;
    }
    this.isRestarting = false;
  }

  // =============================================================================
  // MCP Operations
  // =============================================================================

  public async listTools(): Promise<Tool[]> {
    const client = this.getConnectedClient();
    if (!this.capabilities?.tools) {
      return [];
    }

    const result = await client.listTools();
    return result.tools;
  }

  public async callTool(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<CallToolResult> {
    const client = this.getConnectedClient();

    const result = await client.callTool({
      name,
      arguments: args,
    });

    return result as CallToolResult;
  }

  public async listResources(): Promise<Resource[]> {
    const client = this.getConnectedClient();
    if (!this.capabilities?.resources) {
      return [];
    }

    const result = await client.listResources();
    return result.resources;
  }

  public async listResourceTemplates(): Promise<ResourceTemplate[]> {
    const client = this.getConnectedClient();
    if (!this.capabilities?.resourceTemplates) {
      return [];
    }

    const result = await client.listResourceTemplates();
    return result.resourceTemplates;
  }

  public async readResource(uri: string): Promise<ReadResourceResult> {
    const client = this.getConnectedClient();
    const result = await client.readResource({ uri });
    return result;
  }

  public async subscribeResource(uri: string): Promise<void> {
    const client = this.getConnectedClient();

    if (!this.capabilities?.resourceSubscriptions) {
      throw new Error(
        `Server '${this.name}' does not support resource subscriptions`
      );
    }

    await client.subscribeResource({ uri });
  }

  public async unsubscribeResource(uri: string): Promise<void> {
    const client = this.getConnectedClient();

    if (!this.capabilities?.resourceSubscriptions) {
      throw new Error(
        `Server '${this.name}' does not support resource subscriptions`
      );
    }

    await client.unsubscribeResource({ uri });
  }

  public supportsResourceSubscriptions(): boolean {
    return this.capabilities?.resourceSubscriptions === true;
  }

  public async listPrompts(): Promise<Prompt[]> {
    const client = this.getConnectedClient();
    if (!this.capabilities?.prompts) {
      return [];
    }

    const result = await client.listPrompts();
    return result.prompts;
  }

  public async getPrompt(
    name: string,
    args: Record<string, string> = {}
  ): Promise<GetPromptResult> {
    const client = this.getConnectedClient();

    const result = await client.getPrompt({
      name,
      arguments: args,
    });

    return result;
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  /**
   * Create transport and connect to the spawned process
   */
  private async createTransport(): Promise<void> {
    // Merge environment variables, filtering out undefined values from process.env
    let mergedEnv: Record<string, string> | undefined;
    if (this.env) {
      mergedEnv = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          mergedEnv[key] = value;
        }
      }
      Object.assign(mergedEnv, this.env);
    }

    // Create the transport
    this.transport = new StdioClientTransport({
      command: this.command,
      args: this.args,
      env: mergedEnv,
      cwd: this.cwd,
      stderr: "pipe", // Capture stderr
    });

    // Create the client with capabilities for receiving server requests
    this.client = new Client(
      {
        name: "emceepee",
        version: "0.1.0",
      },
      {
        capabilities: {
          sampling: {},
          elicitation: {
            form: {},
          },
        },
      }
    );

    // Set up notification handler before connecting
    this.setupNotificationHandler();

    // Set up transport event handlers
    this.transport.onclose = (): void => {
      if (!this.isClosing) {
        this.handleProcessExit();
      }
    };

    this.transport.onerror = (error): void => {
      if (this.isClosing || this.status === "disconnected") {
        return;
      }
      this.errorMessage = error.message;
      this.handleProcessExit();
    };

    // Connect (this starts the process)
    await this.client.connect(this.transport);

    // Set up stderr capture after connection
    this.setupStderrCapture();

    // Get server capabilities
    const serverCapabilities = this.client.getServerCapabilities();
    this.capabilities = {
      tools: serverCapabilities?.tools !== undefined,
      resources: serverCapabilities?.resources !== undefined,
      prompts: serverCapabilities?.prompts !== undefined,
      resourceTemplates: serverCapabilities?.resources !== undefined,
      resourceSubscriptions: serverCapabilities?.resources?.subscribe === true,
    };
  }

  /**
   * Set up stderr capture from the spawned process
   */
  private setupStderrCapture(): void {
    if (!this.transport) return;

    // Access the underlying process stderr
    const proc = (this.transport as unknown as { _process?: { stderr?: NodeJS.ReadableStream } })._process;
    if (proc?.stderr) {
      proc.stderr.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter((line) => line.length > 0);
        for (const line of lines) {
          // Add to buffer
          this.stderrBuffer.push(line);
          if (this.stderrBuffer.length > this.maxStderrLines) {
            this.stderrBuffer.shift();
          }

          // Emit as log
          if (this.onLog) {
            this.onLog({
              server: this.name,
              timestamp: new Date(),
              level: "warning",
              source: "stderr",
              data: line,
            });
          }
        }
      });
    }
  }

  /**
   * Handle process exit (crash or termination)
   */
  private handleProcessExit(exitCode?: number, signal?: string): void {
    if (this.isRestarting || this.isClosing) {
      return;
    }

    // Emit crash event
    this.emitLifecycleEvent({
      event: "process_crashed",
      timestamp: new Date(),
      exitCode,
      signal,
    });

    // Clean up
    this.client = null;
    this.transport = null;

    // Start restart process if enabled
    if (this.restartConfig.enabled) {
      this.isRestarting = true;
      this.restartAttempt = 0;
      this.setStatus("reconnecting", this.errorMessage);
      this.scheduleRestart();
    } else {
      this.setStatus("error", `Process exited with code ${exitCode !== undefined ? String(exitCode) : "unknown"}`);
    }
  }

  /**
   * Schedule the next restart attempt with exponential backoff
   */
  private scheduleRestart(): void {
    if (this.isClosing) {
      return;
    }

    this.restartAttempt++;

    if (this.restartAttempt > this.restartConfig.maxAttempts) {
      // Max attempts exceeded
      this.isRestarting = false;
      this.setStatus("error", "Max restart attempts exceeded");
      this.emitLifecycleEvent({
        event: "restart_failed",
        timestamp: new Date(),
        attempt: this.restartAttempt - 1,
        error: "Max restart attempts exceeded",
      });
      return;
    }

    const delay = this.calculateBackoff(this.restartAttempt);
    this.nextRetryMs = delay;

    this.emitLifecycleEvent({
      event: "restarting",
      timestamp: new Date(),
      attempt: this.restartAttempt,
      nextRetryMs: delay,
    });

    this.restartTimeoutHandle = setTimeout(() => {
      void this.attemptRestart();
    }, delay);
  }

  /**
   * Attempt to restart the process
   */
  private async attemptRestart(): Promise<void> {
    if (this.isClosing) {
      return;
    }

    try {
      await this.createTransport();

      // Success!
      const attemptsTaken = this.restartAttempt;
      this.restartAttempt = 0;
      this.nextRetryMs = 0;
      this.isRestarting = false;

      this.setStatus("connected");
      this.emitLifecycleEvent({
        event: "restarted",
        timestamp: new Date(),
        attempt: attemptsTaken,
      });
    } catch (err) {
      // Clean up failed attempt
      this.client = null;
      this.transport = null;
      this.errorMessage = err instanceof Error ? err.message : String(err);

      // Schedule next attempt
      this.scheduleRestart();
    }
  }

  /**
   * Calculate restart delay with exponential backoff
   */
  private calculateBackoff(attempt: number): number {
    const delay =
      this.restartConfig.baseDelayMs *
      Math.pow(this.restartConfig.backoffMultiplier, attempt - 1);
    return Math.min(delay, this.restartConfig.maxDelayMs);
  }

  /**
   * Set up notification and request handlers for the client
   */
  private setupNotificationHandler(): void {
    if (!this.client) return;

    // Handle tools/list_changed
    this.client.setNotificationHandler(
      ToolListChangedNotificationSchema,
      () => {
        this.emitNotification("notifications/tools/list_changed");
      }
    );

    // Handle resources/list_changed
    this.client.setNotificationHandler(
      ResourceListChangedNotificationSchema,
      () => {
        this.emitNotification("notifications/resources/list_changed");
      }
    );

    // Handle resources/updated
    this.client.setNotificationHandler(
      ResourceUpdatedNotificationSchema,
      (notification) => {
        this.emitNotification("notifications/resources/updated", notification.params);
      }
    );

    // Handle prompts/list_changed
    this.client.setNotificationHandler(
      PromptListChangedNotificationSchema,
      () => {
        this.emitNotification("notifications/prompts/list_changed");
      }
    );

    // Handle logging/message notifications
    this.client.setNotificationHandler(
      LoggingMessageNotificationSchema,
      (notification) => {
        if (this.onLog) {
          this.onLog({
            server: this.name,
            timestamp: new Date(),
            level: notification.params.level,
            logger: notification.params.logger,
            data: notification.params.data,
            source: "protocol",
          });
        }
      }
    );

    // Handle sampling/createMessage requests
    this.client.setRequestHandler(
      CreateMessageRequestSchema,
      (request): Promise<CreateMessageResult> => {
        return new Promise((resolve, reject) => {
          if (this.onSamplingRequest) {
            this.onSamplingRequest({
              id: crypto.randomUUID(),
              server: this.name,
              timestamp: new Date(),
              params: request.params,
              resolve,
              reject,
            });
          } else {
            reject(new Error("Sampling not supported: no handler registered"));
          }
        });
      }
    );

    // Handle elicitation/create requests
    this.client.setRequestHandler(
      ElicitRequestSchema,
      (request): Promise<ElicitResult> => {
        return new Promise((resolve, reject) => {
          if (this.onElicitationRequest) {
            this.onElicitationRequest({
              id: crypto.randomUUID(),
              server: this.name,
              timestamp: new Date(),
              params: request.params,
              resolve,
              reject,
            });
          } else {
            reject(new Error("Elicitation not supported: no handler registered"));
          }
        });
      }
    );
  }

  /**
   * Emit a notification to the callback
   */
  private emitNotification(
    method: string,
    params?: JSONRPCNotification["params"]
  ): void {
    if (this.onNotification !== undefined) {
      this.onNotification({
        server: this.name,
        timestamp: new Date(),
        method,
        params,
      });
    }
  }

  /**
   * Emit a lifecycle event
   */
  private emitLifecycleEvent(event: LifecycleEvent): void {
    if (this.onLifecycleEvent) {
      this.onLifecycleEvent(event);
    }
  }

  /**
   * Update the connection status and notify the callback
   */
  private setStatus(status: BackendServerStatus, error?: string): void {
    this.status = status;

    if (status === "error" && error !== undefined) {
      this.errorMessage = error;
    } else {
      this.errorMessage = undefined;
    }

    if (this.onStatusChange !== undefined) {
      this.onStatusChange(status, error);
    }
  }

  /**
   * Get the connected client, throwing if not connected
   */
  private getConnectedClient(): Client {
    if (!this.isConnected() || !this.client) {
      throw new Error(`Client '${this.name}' is not connected`);
    }
    return this.client;
  }
}
