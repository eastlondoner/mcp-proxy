/**
 * Common interface for MCP clients.
 * Both HTTP and stdio clients implement this interface.
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
import type { BackendServerInfo, BackendServerStatus } from "./types.js";

/**
 * Health status of the connection
 */
export type HealthStatus = "healthy" | "degraded";

/**
 * Transport type for the client
 */
export type TransportType = "http" | "stdio";

/**
 * Common interface for MCP clients (HTTP and stdio)
 */
export interface IMCPClient {
  /** Get the transport type */
  getTransportType(): TransportType;

  /** Get client info including status and capabilities */
  getInfo(): BackendServerInfo;

  /** Get the server name */
  getName(): string;

  /** Get current connection status */
  getStatus(): BackendServerStatus;

  /** Check if connected */
  isConnected(): boolean;

  /** Get reconnection state if reconnecting */
  getReconnectionState(): { attempt: number; nextRetryMs: number } | null;

  /** Get health status */
  getHealthStatus(): HealthStatus;

  /** Get consecutive health check failures */
  getConsecutiveHealthFailures(): number;

  /** Connect to the server */
  connect(): Promise<void>;

  /** Disconnect from the server */
  disconnect(): Promise<void>;

  /** Force reconnection */
  forceReconnect(): Promise<void>;

  /** Cancel pending reconnection */
  cancelReconnection(): void;

  /** List available tools */
  listTools(): Promise<Tool[]>;

  /** Call a tool */
  callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;

  /** List available resources */
  listResources(): Promise<Resource[]>;

  /** List resource templates */
  listResourceTemplates(): Promise<ResourceTemplate[]>;

  /** Read a resource */
  readResource(uri: string): Promise<ReadResourceResult>;

  /** Subscribe to resource updates */
  subscribeResource(uri: string): Promise<void>;

  /** Unsubscribe from resource updates */
  unsubscribeResource(uri: string): Promise<void>;

  /** Check if resource subscriptions are supported */
  supportsResourceSubscriptions(): boolean;

  /** List available prompts */
  listPrompts(): Promise<Prompt[]>;

  /** Get a prompt */
  getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult>;
}

/**
 * Extended interface for stdio clients with process management
 */
export interface IStdioClient extends IMCPClient {
  getTransportType(): "stdio";

  /** Get command used to spawn the process */
  getCommand(): string;

  /** Get arguments passed to the command */
  getArgs(): string[];

  /** Get buffered stderr output */
  getStderrBuffer(): string[];
}

/**
 * Extended interface for HTTP clients
 */
export interface IHttpClient extends IMCPClient {
  getTransportType(): "http";

  /** Get the server URL */
  getUrl(): string;
}

/**
 * Type guard for stdio clients
 */
export function isStdioClient(client: IMCPClient): client is IStdioClient {
  return client.getTransportType() === "stdio";
}

/**
 * Type guard for HTTP clients
 */
export function isHttpClient(client: IMCPClient): client is IHttpClient {
  return client.getTransportType() === "http";
}
