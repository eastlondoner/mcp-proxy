/**
 * Codemode API Bindings
 *
 * Creates the mcp.* API that is exposed to user code in the sandbox.
 * Wraps SessionState and SessionManager to provide MCP operations.
 */

import type { SessionState } from "../session/session-state.js";
import type { SessionManager } from "../session/session-manager.js";
import type { IMCPClient } from "../client-interface.js";
import type {
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  SandboxAPI,
  SandboxServerInfo,
  SandboxToolInfo,
  SandboxToolResult,
  SandboxResourceInfo,
  SandboxResourceTemplateInfo,
  SandboxResourceContent,
  SandboxPromptInfo,
  SandboxPromptResult,
} from "./types.js";

// =============================================================================
// Type Converters
// =============================================================================

/**
 * Convert SDK Tool to SandboxToolInfo
 */
function toolToSandbox(server: string, tool: Tool): SandboxToolInfo {
  return {
    server,
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as Record<string, unknown>,
  };
}

/**
 * Convert SDK Resource to SandboxResourceInfo
 */
function resourceToSandbox(server: string, resource: Resource): SandboxResourceInfo {
  return {
    server,
    uri: resource.uri,
    name: resource.name,
    description: resource.description,
    mimeType: resource.mimeType,
  };
}

/**
 * Convert SDK ResourceTemplate to SandboxResourceTemplateInfo
 */
function resourceTemplateToSandbox(
  server: string,
  template: ResourceTemplate
): SandboxResourceTemplateInfo {
  return {
    server,
    uriTemplate: template.uriTemplate,
    name: template.name,
    description: template.description,
    mimeType: template.mimeType,
  };
}

/**
 * Convert SDK Prompt to SandboxPromptInfo
 */
function promptToSandbox(server: string, prompt: Prompt): SandboxPromptInfo {
  return {
    server,
    name: prompt.name,
    description: prompt.description,
    arguments: prompt.arguments?.map((arg) => ({
      name: arg.name,
      description: arg.description,
      required: arg.required,
    })),
  };
}

// =============================================================================
// Server Pattern Matching
// =============================================================================

/**
 * Check if a server name matches a pattern (regex or exact match)
 */
function matchesServerPattern(serverName: string, pattern?: string): boolean {
  if (!pattern) {
    return true; // No pattern means match all
  }

  try {
    const regex = new RegExp(pattern);
    return regex.test(serverName);
  } catch {
    // If invalid regex, fall back to exact match
    return serverName === pattern;
  }
}

/**
 * Get connected clients that match a server pattern
 */
function getMatchingClients(
  session: SessionState,
  serverPattern?: string
): { name: string; client: IMCPClient }[] {
  const results: { name: string; client: IMCPClient }[] = [];

  for (const [name, connection] of session.backendConnections) {
    if (connection.status === "connected" && matchesServerPattern(name, serverPattern)) {
      results.push({ name, client: connection.client });
    }
  }

  return results;
}

/**
 * Get a specific connected client by exact server name
 */
function getClient(session: SessionState, serverName: string): IMCPClient {
  const connection = session.getConnection(serverName);

  if (!connection) {
    throw new Error(`Server '${serverName}' not found`);
  }

  if (connection.status !== "connected") {
    throw new Error(
      `Server '${serverName}' is not connected (status: ${connection.status})`
    );
  }

  return connection.client;
}

// =============================================================================
// API Factory
// =============================================================================

/**
 * Options for creating the sandbox API
 */
export interface CreateSandboxAPIOptions {
  /** The session state */
  session: SessionState;
  /** The session manager */
  sessionManager: SessionManager;
  /** Maximum sleep duration in ms (default: 5000) */
  maxSleepMs?: number;
}

/**
 * Create the mcp.* API for the sandbox
 *
 * This creates an object with all the MCP operations that user code can call.
 * Each method wraps the underlying SessionState/SessionManager calls and
 * converts types to the sandbox-friendly format.
 */
export function createSandboxAPI(options: CreateSandboxAPIOptions): SandboxAPI {
  const { session, sessionManager, maxSleepMs = 5000 } = options;
  const logs: string[] = [];

  return {
    // =========================================================================
    // Server Discovery
    // =========================================================================

    listServers: (): Promise<SandboxServerInfo[]> => {
      const servers = sessionManager.listServers(session.sessionId);

      const result = servers.map((server): SandboxServerInfo => {
        const connection = session.getConnection(server.name);
        const client = connection?.client;
        const capabilities = client?.getInfo().capabilities;

        return {
          name: server.name,
          status: server.status as SandboxServerInfo["status"],
          capabilities: {
            tools: capabilities?.tools ?? false,
            resources: capabilities?.resources ?? false,
            prompts: capabilities?.prompts ?? false,
          },
        };
      });

      return Promise.resolve(result);
    },

    // =========================================================================
    // Tool Operations
    // =========================================================================

    listTools: async (serverPattern?: string): Promise<SandboxToolInfo[]> => {
      const clients = getMatchingClients(session, serverPattern);
      const results: SandboxToolInfo[] = [];

      for (const { name, client } of clients) {
        try {
          const tools = await client.listTools();
          for (const tool of tools) {
            results.push(toolToSandbox(name, tool));
          }
        } catch (err) {
          // Skip servers that fail to list tools
          // This allows partial results when some servers are unavailable
          const message = err instanceof Error ? err.message : String(err);
          logs.push(`Warning: Failed to list tools from '${name}': ${message}`);
        }
      }

      return results;
    },

    callTool: async (
      server: string,
      tool: string,
      args?: Record<string, unknown>
    ): Promise<SandboxToolResult> => {
      const client = getClient(session, server);
      const result = await client.callTool(tool, args);

      return {
        content: result.content.map((item) => ({
          type: item.type,
          text: item.type === "text" ? (item as { text: string }).text : undefined,
          data: item.type === "image" ? (item as { data: string }).data : undefined,
          mimeType: item.type === "image" ? (item as { mimeType: string }).mimeType : undefined,
        })),
        isError: result.isError,
      };
    },

    // =========================================================================
    // Resource Operations
    // =========================================================================

    listResources: async (serverPattern?: string): Promise<SandboxResourceInfo[]> => {
      const clients = getMatchingClients(session, serverPattern);
      const results: SandboxResourceInfo[] = [];

      for (const { name, client } of clients) {
        try {
          const resources = await client.listResources();
          for (const resource of resources) {
            results.push(resourceToSandbox(name, resource));
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logs.push(`Warning: Failed to list resources from '${name}': ${message}`);
        }
      }

      return results;
    },

    listResourceTemplates: async (
      serverPattern?: string
    ): Promise<SandboxResourceTemplateInfo[]> => {
      const clients = getMatchingClients(session, serverPattern);
      const results: SandboxResourceTemplateInfo[] = [];

      for (const { name, client } of clients) {
        try {
          const templates = await client.listResourceTemplates();
          for (const template of templates) {
            results.push(resourceTemplateToSandbox(name, template));
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logs.push(`Warning: Failed to list resource templates from '${name}': ${message}`);
        }
      }

      return results;
    },

    readResource: async (
      server: string,
      uri: string
    ): Promise<SandboxResourceContent> => {
      const client = getClient(session, server);
      const result = await client.readResource(uri);

      return {
        contents: result.contents.map((content) => ({
          uri: content.uri,
          mimeType: content.mimeType,
          text: "text" in content ? content.text : undefined,
          blob: "blob" in content ? content.blob : undefined,
        })),
      };
    },

    // =========================================================================
    // Prompt Operations
    // =========================================================================

    listPrompts: async (serverPattern?: string): Promise<SandboxPromptInfo[]> => {
      const clients = getMatchingClients(session, serverPattern);
      const results: SandboxPromptInfo[] = [];

      for (const { name, client } of clients) {
        try {
          const prompts = await client.listPrompts();
          for (const prompt of prompts) {
            results.push(promptToSandbox(name, prompt));
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logs.push(`Warning: Failed to list prompts from '${name}': ${message}`);
        }
      }

      return results;
    },

    getPrompt: async (
      server: string,
      name: string,
      args?: Record<string, string>
    ): Promise<SandboxPromptResult> => {
      const client = getClient(session, server);
      const result = await client.getPrompt(name, args);

      return {
        description: result.description,
        messages: result.messages.map((msg) => ({
          role: msg.role,
          content: {
            type: msg.content.type,
            text: msg.content.type === "text" ? (msg.content as { text: string }).text : undefined,
            resource:
              msg.content.type === "resource"
                ? (msg.content as { resource: unknown }).resource
                : undefined,
          },
        })),
      };
    },

    // =========================================================================
    // Utilities
    // =========================================================================

    sleep: async (ms: number): Promise<void> => {
      // Clamp sleep duration to prevent abuse
      const clampedMs = Math.min(Math.max(0, ms), maxSleepMs);
      return new Promise((resolve) => setTimeout(resolve, clampedMs));
    },

    log: (...args: unknown[]): void => {
      // Format and store log message
      const formatted = args
        .map((arg) => {
          if (typeof arg === "string") return arg;
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        })
        .join(" ");
      logs.push(formatted);
    },
  };
}

// =============================================================================
// Utility Exports
// =============================================================================

/**
 * Get collected logs from the API (for debugging)
 * Note: The sandbox.ts already handles log collection via createTrackedAPI,
 * but this is available for direct API usage if needed.
 */
export { matchesServerPattern, getMatchingClients, getClient };
