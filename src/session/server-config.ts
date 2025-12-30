/**
 * Server Config Registry
 *
 * Shared registry of server configurations (name → URL mapping).
 * All sessions can use these configs to establish backend connections.
 *
 * This is separate from actual connections - connections are per-session,
 * but configs are shared across all sessions.
 */

import type { StructuredLogger } from "../logging.js";

/**
 * Configuration for a backend MCP server
 */
export interface ServerConfig {
  /** Unique name to identify this server */
  name: string;
  /** HTTP URL of the MCP server endpoint */
  url: string;
  /** When this config was added */
  addedAt: Date;
  /** Session ID that added this config (for logging) */
  addedBy?: string;
}

/**
 * Options for creating a ServerConfigRegistry
 */
export interface ServerConfigRegistryOptions {
  /** Logger for structured logging */
  logger?: StructuredLogger;
}

/**
 * Shared registry of server configurations.
 *
 * This is a simple in-memory store of server name → URL mappings.
 * Sessions use this to know which servers to connect to.
 */
export class ServerConfigRegistry {
  private readonly configs = new Map<string, ServerConfig>();
  private readonly logger?: StructuredLogger;

  constructor(options: ServerConfigRegistryOptions = {}) {
    this.logger = options.logger;
  }

  /**
   * Add a server configuration.
   *
   * @param name - Unique name for this server
   * @param url - HTTP URL of the MCP server endpoint
   * @param addedBy - Optional session ID that added this config
   * @returns true if new config, false if updated existing
   */
  public addConfig(name: string, url: string, addedBy?: string): boolean {
    const existing = this.configs.has(name);
    this.configs.set(name, {
      name,
      url,
      addedAt: new Date(),
      addedBy,
    });

    this.logger?.info(existing ? "server_config_updated" : "server_config_added", {
      server: name,
      url,
      addedBy,
    });

    return !existing;
  }

  /**
   * Get a server configuration by name.
   */
  public getConfig(name: string): ServerConfig | undefined {
    return this.configs.get(name);
  }

  /**
   * List all server configurations.
   */
  public listConfigs(): ServerConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * Remove a server configuration.
   *
   * @returns true if the config existed and was removed
   */
  public removeConfig(name: string): boolean {
    const existed = this.configs.delete(name);
    if (existed) {
      this.logger?.info("server_config_removed", { server: name });
    }
    return existed;
  }

  /**
   * Check if a server configuration exists.
   */
  public hasConfig(name: string): boolean {
    return this.configs.has(name);
  }

  /**
   * Get the number of configured servers.
   */
  public get size(): number {
    return this.configs.size;
  }

  /**
   * Clear all configurations.
   */
  public clear(): void {
    this.configs.clear();
    this.logger?.info("server_configs_cleared", {});
  }
}
