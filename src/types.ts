/**
 * Shared types for MCP Proxy Server
 */

import type {
  Tool,
  Resource,
  Prompt,
  ResourceTemplate,
  JSONRPCNotification,
  LoggingLevel,
  CreateMessageRequestParams,
  CreateMessageResult,
  ElicitRequestParams,
  ElicitResult,
  ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";

// Re-export ServerCapabilities for convenience
export type { ServerCapabilities };

// =============================================================================
// New State Module Types (canonical source for new code)
// =============================================================================

// Event system types
export type {
  ProxyEventType,
  StoredEvent,
  EventSystemConfig,
} from "./state/event-system.js";

// Task manager types
export type {
  ProxyTask,
  ProxyTaskStatus,
  TaskManagerConfig,
} from "./state/task-manager.js";

// =============================================================================
// New Types for Refactored Architecture
// =============================================================================

/**
 * Tool info from tools/list response (used by list_tools)
 */
export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Health status of a backend server
 */
export type HealthStatus = "healthy" | "degraded";

/**
 * Server info for list_servers tool (enhanced version of BackendServerInfo)
 */
export interface ServerInfo {
  name: string;
  url: string;
  connected: boolean;
  status: BackendServerStatus | "not_connected";
  connectedAt?: Date;
  lastError?: string;
  // Reconnection status (only present when status is "reconnecting")
  reconnectAttempt?: number;
  nextRetryMs?: number;
  // Health status (only present when status is "connected")
  healthStatus?: HealthStatus;
  consecutiveHealthFailures?: number;
}

/**
 * Result of server restart reconciliation
 */
export interface ReconciliationResult {
  invalidatedElicitations: string[];
  invalidatedSamplingRequests: string[];
  invalidatedTasks: string[];
  refreshedTools: boolean;
  refreshedResources: boolean;
  refreshedPrompts: boolean;
}

/**
 * Server transport type
 */
export type ServerTransportType = "http" | "stdio";

/**
 * Configuration for an HTTP backend MCP server
 */
export interface HttpServerConfig {
  /** Transport type */
  type: "http";
  /** Unique name to identify this server */
  name: string;
  /** HTTP URL of the MCP server endpoint */
  url: string;
}

/**
 * Configuration for restart behavior of stdio servers
 */
export interface StdioRestartConfig {
  /** Enable auto-restart on crash (default: true) */
  enabled: boolean;
  /** Maximum restart attempts before giving up (default: 5) */
  maxAttempts: number;
  /** Initial delay before first restart in ms (default: 1000) */
  baseDelayMs: number;
  /** Maximum delay cap in ms (default: 60000) */
  maxDelayMs: number;
  /** Exponential backoff multiplier (default: 2) */
  backoffMultiplier: number;
  /** Reset attempt counter after stable period in ms (default: 300000) */
  resetAfterMs: number;
}

/**
 * Configuration for a stdio backend MCP server
 */
export interface StdioServerConfig {
  /** Transport type */
  type: "stdio";
  /** Unique name to identify this server */
  name: string;
  /** Command to execute */
  command: string;
  /** Arguments to pass to the command */
  args?: string[];
  /** Environment variables for the process */
  env?: Record<string, string>;
  /** Working directory for the process */
  cwd?: string;
  /** Restart configuration */
  restartConfig?: Partial<StdioRestartConfig>;
}

/**
 * Configuration for a backend MCP server (union type)
 */
export type BackendServerConfig = HttpServerConfig | StdioServerConfig;

/**
 * Legacy configuration for HTTP-only backend servers
 * @deprecated Use BackendServerConfig with type: "http" instead
 */
export interface LegacyBackendServerConfig {
  /** Unique name to identify this server */
  name: string;
  /** HTTP URL of the MCP server endpoint */
  url: string;
}

/**
 * Configuration file format for initial backend servers
 */
export interface ProxyConfig {
  servers: BackendServerConfig[];
}

/**
 * Status of a backend server connection
 */
export type BackendServerStatus =
  | "connecting"     // Initial connection in progress
  | "connected"      // Successfully connected
  | "disconnected"   // Cleanly disconnected (intentional, e.g., remove_server)
  | "reconnecting"   // Lost connection, attempting to reconnect (HTTP servers)
  | "restarting"     // Process crashed, attempting to restart (stdio servers)
  | "error";         // Connection error (with message)

/**
 * Information about a connected backend server
 */
export interface BackendServerInfo {
  /** Server name */
  name: string;
  /** Server transport type */
  transportType: ServerTransportType;
  /** Server URL (HTTP servers only) */
  url?: string;
  /** Command used to start server (stdio servers only) */
  command?: string;
  /** Arguments passed to command (stdio servers only) */
  args?: string[];
  /** Process ID (stdio servers only, when running) */
  pid?: number;
  /** Current connection status */
  status: BackendServerStatus;
  /** Error message if status is 'error' */
  error?: string;
  /** Server capabilities from initialization */
  capabilities?: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
    resourceTemplates?: boolean;
    /** Whether the server supports resource subscriptions */
    resourceSubscriptions?: boolean;
  };
}

// =============================================================================
// Stdio Server Lifecycle Types
// =============================================================================

/**
 * Lifecycle event types for stdio servers
 */
export type StdioLifecycleEvent =
  | "process_started"   // Initial process spawn successful
  | "process_crashed"   // Process exited unexpectedly
  | "restarting"        // Starting restart attempt
  | "restarted"         // Successfully restarted
  | "restart_failed"    // All restart attempts exhausted
  | "process_stopped";  // Intentional shutdown

/**
 * Data for stdio lifecycle events
 */
export interface StdioLifecycleEventData {
  /** Server name */
  server: string;
  /** Event type */
  event: StdioLifecycleEvent;
  /** Timestamp of the event */
  timestamp: Date;
  /** Process ID (for started/stopped events) */
  pid?: number;
  /** Command used to start the process (for started events) */
  command?: string;
  /** Arguments passed to the command (for started events) */
  args?: string[];
  /** Exit code (for crashed events) */
  exitCode?: number;
  /** Signal that killed the process (for crashed events) */
  signal?: string;
  /** Current restart attempt number (for restarting events) */
  attempt?: number;
  /** Maximum restart attempts (for restarting events) */
  maxAttempts?: number;
  /** Delay until next retry in ms (for restarting events) */
  nextRetryMs?: number;
  /** Total attempts taken (for restarted events) */
  attemptsTaken?: number;
  /** New process ID after restart (for restarted events) */
  newPid?: number;
  /** Last error message */
  lastError?: string;
  /** Process uptime in ms (for stopped events) */
  uptimeMs?: number;
}

/**
 * A tool from a specific backend server
 */
export interface BackendTool extends Tool {
  /** The backend server this tool is from */
  server: string;
}

/**
 * A resource from a specific backend server
 */
export interface BackendResource extends Resource {
  /** The backend server this resource is from */
  server: string;
}

/**
 * A prompt from a specific backend server
 */
export interface BackendPrompt extends Prompt {
  /** The backend server this prompt is from */
  server: string;
}

/**
 * A resource template from a specific backend server
 */
export interface BackendResourceTemplate extends ResourceTemplate {
  /** The backend server this resource template is from */
  server: string;
}

/**
 * A buffered notification from a backend server
 */
export interface BufferedNotification {
  /** The backend server this notification came from */
  server: string;
  /** Timestamp when the notification was received */
  timestamp: Date;
  /** The notification method */
  method: string;
  /** The notification params */
  params?: JSONRPCNotification["params"];
}

/**
 * Result of a tool execution on a backend
 */
export interface ToolExecutionResult {
  /** Whether the tool execution resulted in an error */
  isError?: boolean;
  /** The content returned by the tool */
  content: {
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
    [key: string]: unknown;
  }[];
}

// =============================================================================
// Logging Types
// =============================================================================

/**
 * Source of a log entry - indicates where the log originated
 */
export type LogSource = "protocol" | "stderr" | "stdout";

/**
 * A buffered log message from a backend server
 */
export interface BufferedLog {
  /** The backend server this log came from */
  server: string;
  /** Timestamp when the log was received */
  timestamp: Date;
  /** Log level */
  level: LoggingLevel;
  /** Logger name (optional) */
  logger?: string;
  /** Log data (can be any JSON-serializable type) */
  data: unknown;
  /** Source of the log entry (protocol=MCP notifications/message, stderr/stdout=process output) */
  source: LogSource;
}

// =============================================================================
// Sampling Types
// =============================================================================

/**
 * A pending sampling request from a backend server awaiting response.
 * The promise resolve/reject functions are used to complete the original request.
 */
export interface PendingSamplingRequest {
  /** Unique ID for this request */
  id: string;
  /** The backend server this request came from */
  server: string;
  /** Timestamp when the request was received */
  timestamp: Date;
  /** The original request parameters */
  params: CreateMessageRequestParams;
  /** Promise resolver to complete the request */
  resolve: (result: CreateMessageResult) => void;
  /** Promise rejecter to fail the request */
  reject: (error: Error) => void;
}

/**
 * Simplified sampling request info for tool output (excludes internal resolver/rejecter)
 */
export interface SamplingRequestInfo {
  /** Unique ID for this request */
  id: string;
  /** The backend server this request came from */
  server: string;
  /** Timestamp when the request was received */
  timestamp: Date;
  /** The request parameters */
  params: CreateMessageRequestParams;
}

// =============================================================================
// Elicitation Types
// =============================================================================

/**
 * A pending elicitation request from a backend server awaiting response.
 * The promise resolve/reject functions are used to complete the original request.
 */
export interface PendingElicitationRequest {
  /** Unique ID for this request */
  id: string;
  /** The backend server this request came from */
  server: string;
  /** Timestamp when the request was received */
  timestamp: Date;
  /** The original request parameters */
  params: ElicitRequestParams;
  /** Promise resolver to complete the request */
  resolve: (result: ElicitResult) => void;
  /** Promise rejecter to fail the request */
  reject: (error: Error) => void;
}

/**
 * Simplified elicitation request info for tool output (excludes internal resolver/rejecter)
 */
export interface ElicitationRequestInfo {
  /** Unique ID for this request */
  id: string;
  /** The backend server this request came from */
  server: string;
  /** Timestamp when the request was received */
  timestamp: Date;
  /** The request parameters */
  params: ElicitRequestParams;
}
