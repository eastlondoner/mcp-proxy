/**
 * Common interface for MCP clients (HTTP and Stdio)
 *
 * This interface defines the contract that all MCP client implementations
 * must follow, enabling uniform handling of different transport types.
 */

import type {
  Tool,
  Resource,
  Prompt,
  ResourceTemplate,
  CallToolResult,
  GetPromptResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  BackendServerStatus,
  BackendServerInfo,
  BufferedNotification,
  BufferedLog,
  PendingSamplingRequest,
  PendingElicitationRequest,
  ServerTransportType,
  StdioLifecycleEventData,
} from "./types.js";

/**
 * Health status of the connection
 */
export type HealthStatus = "healthy" | "degraded";

/**
 * Common interface for MCP clients
 */
export interface IMCPClient {
  // ---------------------------------------------------------------------------
  // Connection Management
  // ---------------------------------------------------------------------------

  /**
   * Connect to the backend MCP server
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the backend MCP server (intentional disconnect)
   */
  disconnect(): Promise<void>;

  /**
   * Force reconnection to the backend server.
   * For HTTP: reconnects the transport
   * For Stdio: restarts the process
   */
  forceReconnect(): Promise<void>;

  /**
   * Cancel any pending reconnection/restart attempt
   */
  cancelReconnection(): void;

  // ---------------------------------------------------------------------------
  // Status & Information
  // ---------------------------------------------------------------------------

  /**
   * Get the server name
   */
  getName(): string;

  /**
   * Get the transport type
   */
  getTransportType(): ServerTransportType;

  /**
   * Get the current connection status
   */
  getStatus(): BackendServerStatus;

  /**
   * Check if the client is connected
   */
  isConnected(): boolean;

  /**
   * Get detailed server info
   */
  getInfo(): BackendServerInfo;

  /**
   * Get health status
   */
  getHealthStatus(): HealthStatus;

  /**
   * Get consecutive health check failures count
   */
  getConsecutiveHealthFailures(): number;

  /**
   * Get reconnection/restart state if currently in progress
   */
  getReconnectionState(): { attempt: number; nextRetryMs: number } | null;

  // ---------------------------------------------------------------------------
  // MCP Operations
  // ---------------------------------------------------------------------------

  /**
   * List all tools available on the backend server
   */
  listTools(): Promise<Tool[]>;

  /**
   * Call a tool on the backend server
   */
  callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;

  /**
   * List all resources available on the backend server
   */
  listResources(): Promise<Resource[]>;

  /**
   * List all resource templates available on the backend server
   */
  listResourceTemplates(): Promise<ResourceTemplate[]>;

  /**
   * Read a resource from the backend server
   */
  readResource(uri: string): Promise<ReadResourceResult>;

  /**
   * Subscribe to updates for a specific resource
   */
  subscribeResource(uri: string): Promise<void>;

  /**
   * Unsubscribe from updates for a specific resource
   */
  unsubscribeResource(uri: string): Promise<void>;

  /**
   * Check if the server supports resource subscriptions
   */
  supportsResourceSubscriptions(): boolean;

  /**
   * List all prompts available on the backend server
   */
  listPrompts(): Promise<Prompt[]>;

  /**
   * Get a prompt from the backend server
   */
  getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult>;
}

/**
 * Options common to all MCP client implementations
 */
export interface MCPClientOptionsBase {
  /** Unique name for this backend server */
  name: string;
  /** Callback when the connection status changes */
  onStatusChange?: (status: BackendServerStatus, error?: string) => void;
  /** Callback when a notification is received from the server */
  onNotification?: (notification: BufferedNotification) => void;
  /** Callback when a log message is received from the server */
  onLog?: (log: BufferedLog) => void;
  /** Callback when a sampling request is received from the server */
  onSamplingRequest?: (request: PendingSamplingRequest) => void;
  /** Callback when an elicitation request is received from the server */
  onElicitationRequest?: (request: PendingElicitationRequest) => void;
  /** Callback when a reconnection/restart attempt starts */
  onReconnecting?: (attempt: number, nextRetryMs: number) => void;
  /** Callback when successfully reconnected/restarted */
  onReconnected?: (attemptsTaken: number) => void;
  /** Callback when health degrades (3+ consecutive failures) */
  onHealthDegraded?: (failures: number, lastError: string) => void;
  /** Callback when health is restored after being degraded */
  onHealthRestored?: () => void;
}

/**
 * Additional options for stdio clients
 */
export interface MCPStdioClientOptionsExtension {
  /** Callback when restart fails permanently */
  onRestartFailed?: (attempts: number, lastError: string) => void;
  /** Callback for any lifecycle event */
  onLifecycleEvent?: (event: StdioLifecycleEventData) => void;
}

/**
 * Type guard to check if a client is an stdio client
 */
export function isStdioClient(client: IMCPClient): boolean {
  return client.getTransportType() === "stdio";
}

/**
 * Type guard to check if a client is an HTTP client
 */
export function isHttpClient(client: IMCPClient): boolean {
  return client.getTransportType() === "http";
}
