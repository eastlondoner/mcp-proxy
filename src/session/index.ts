/**
 * Session Management Module
 *
 * Provides per-session state management for the MCP proxy.
 *
 * Key exports:
 * - SessionManager: Central manager for all sessions
 * - SessionState: Per-session state container
 * - ServerConfigRegistry: Shared server configuration store
 */

// Server configuration
export {
  ServerConfigRegistry,
  type ServerConfig,
  type ServerConfigRegistryOptions,
} from "./server-config.js";

// Session state
export {
  SessionState,
  type SessionStateConfig,
  type BackendConnection,
  type BackendConnectionStatus,
} from "./session-state.js";

// Session manager
export {
  SessionManager,
  type SessionManagerConfig,
} from "./session-manager.js";
