/**
 * Buffer Manager
 *
 * Manages notifications and logs with ring buffer semantics.
 * Notifications emit events (wake await_activity), logs do NOT.
 *
 * See SESSION_STATE_DESIGN.md for full design rationale:
 * - Notifications are Category 1 (events - exactly-once delivery)
 * - Logs are Category 2 (on-demand, ring buffer)
 */

import type { JSONRPCNotification, LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import type { EventSystem } from "./event-system.js";

/**
 * A buffered notification from a backend server
 */
export interface BufferedNotification {
  server: string;
  timestamp: Date;
  method: string;
  params?: JSONRPCNotification["params"];
}

/**
 * A buffered log message from a backend server
 */
export interface BufferedLog {
  server: string;
  timestamp: Date;
  level: LoggingLevel;
  logger?: string;
  data?: unknown;
}

/**
 * Per-server buffer state
 */
interface ServerBuffers {
  notifications: BufferedNotification[];
  logs: BufferedLog[];
}

/**
 * Configuration for the BufferManager
 */
export interface BufferManagerConfig {
  /** Maximum notifications per server (default: 100) */
  maxNotificationsPerServer: number;
  /** Maximum logs per server (default: 500) */
  maxLogsPerServer: number;
}

const DEFAULT_CONFIG: BufferManagerConfig = {
  maxNotificationsPerServer: 100,
  maxLogsPerServer: 500,
};

/**
 * Per-session buffer manager for notifications and logs.
 *
 * Notifications:
 * - Emit events to EventSystem (wake await_activity)
 * - Ring buffer with eviction
 * - Cleared on read via getAndClearNotifications()
 *
 * Logs:
 * - Do NOT emit events (Category 2: on-demand only)
 * - Ring buffer with eviction
 * - Retrieved on-demand via getAndClearLogs()
 */
export class BufferManager {
  private readonly buffers = new Map<string, ServerBuffers>();
  private readonly eventSystem: EventSystem;
  private readonly config: BufferManagerConfig;

  constructor(eventSystem: EventSystem, config: Partial<BufferManagerConfig> = {}) {
    this.eventSystem = eventSystem;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add a notification from a backend server.
   * Emits event to wake await_activity waiters.
   */
  public addNotification(notification: BufferedNotification): void {
    const buffers = this.getOrCreateBuffers(notification.server);

    // Enforce max buffer size (ring buffer behavior)
    if (buffers.notifications.length >= this.config.maxNotificationsPerServer) {
      buffers.notifications.shift(); // Remove oldest
    }

    buffers.notifications.push(notification);

    // Emit event via EventSystem (per-session, no streamId needed)
    this.eventSystem.addEvent("notification", notification.server, {
      method: notification.method,
      params: notification.params,
      timestamp: notification.timestamp.toISOString(),
    });
  }

  /**
   * Add a log message from a backend server.
   *
   * NOTE: Logs do NOT emit events to EventSystem. Per SESSION_STATE_DESIGN.md,
   * logs are Category 2 (on-demand only) - only delivered when explicitly
   * requested via get_logs tool, NOT included in await_activity responses.
   */
  public addLog(log: BufferedLog): void {
    const buffers = this.getOrCreateBuffers(log.server);

    // Enforce max buffer size (ring buffer behavior)
    if (buffers.logs.length >= this.config.maxLogsPerServer) {
      buffers.logs.shift(); // Remove oldest
    }

    buffers.logs.push(log);

    // No event emitted - logs are on-demand only (Category 2)
  }

  /**
   * Get and clear all notifications.
   * Returns copy, clears originals.
   */
  public getAndClearNotifications(): BufferedNotification[] {
    const all: BufferedNotification[] = [];
    for (const buffers of this.buffers.values()) {
      all.push(...buffers.notifications);
      buffers.notifications = [];
    }
    return all;
  }

  /**
   * Get and clear all logs.
   * Returns copy, clears originals.
   */
  public getAndClearLogs(): BufferedLog[] {
    const all: BufferedLog[] = [];
    for (const buffers of this.buffers.values()) {
      all.push(...buffers.logs);
      buffers.logs = [];
    }
    return all;
  }

  /**
   * Get notifications for a specific server (without clearing).
   */
  public getNotificationsForServer(server: string): BufferedNotification[] {
    const buffers = this.buffers.get(server);
    return buffers ? [...buffers.notifications] : [];
  }

  /**
   * Get logs for a specific server (without clearing).
   */
  public getLogsForServer(server: string): BufferedLog[] {
    const buffers = this.buffers.get(server);
    return buffers ? [...buffers.logs] : [];
  }

  /**
   * Get the count of buffered notifications.
   */
  public getNotificationCount(): number {
    let count = 0;
    for (const buffers of this.buffers.values()) {
      count += buffers.notifications.length;
    }
    return count;
  }

  /**
   * Get the count of buffered logs.
   */
  public getLogCount(): number {
    let count = 0;
    for (const buffers of this.buffers.values()) {
      count += buffers.logs.length;
    }
    return count;
  }

  /**
   * Clear all buffers for a server (e.g., on disconnect).
   */
  public clearServer(server: string): void {
    this.buffers.delete(server);
  }

  /**
   * Get or create buffers for a server.
   */
  private getOrCreateBuffers(server: string): ServerBuffers {
    let buffers = this.buffers.get(server);
    if (!buffers) {
      buffers = {
        notifications: [],
        logs: [],
      };
      this.buffers.set(server, buffers);
    }
    return buffers;
  }
}
