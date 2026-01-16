/**
 * Request Tracker
 *
 * Tracks all requests (tool calls, resource reads, etc.) for debugging
 * and waterfall visualization. Each request has a lifecycle:
 * started -> completed/failed/timeout
 */

import { ulid } from "ulid";
import type { StructuredLogger } from "./logging.js";

/**
 * Request status
 */
export type RequestStatus = "pending" | "completed" | "failed" | "timeout";

/**
 * Request type - what kind of operation
 */
export type RequestType =
  | "tool_call"
  | "resource_read"
  | "prompt_get"
  | "backend_tool"
  | "backend_resource"
  | "backend_prompt"
  | "codemode_search"
  | "codemode_execute";

/**
 * A tracked request
 */
export interface TrackedRequest {
  /** Unique request ID */
  requestId: string;
  /** Session this request belongs to */
  sessionId: string;
  /** Type of request */
  type: RequestType;
  /** Name of the operation (tool name, resource URI, etc.) */
  name: string;
  /** Target server (for backend operations) */
  server?: string;
  /** Request arguments/parameters */
  args?: unknown;
  /** When the request started */
  startedAt: Date;
  /** When the request completed/failed */
  endedAt?: Date;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Current status */
  status: RequestStatus;
  /** Error message if failed */
  error?: string;
  /** Result summary (truncated for large results) */
  resultSummary?: string;
}

/**
 * Configuration for RequestTracker
 */
export interface RequestTrackerConfig {
  /** Maximum requests to keep per session (default: 100) */
  maxRequestsPerSession: number;
  /** Maximum total requests across all sessions (default: 1000) */
  maxTotalRequests: number;
  /** Logger for debug output */
  logger?: StructuredLogger;
}

const DEFAULT_CONFIG: RequestTrackerConfig = {
  maxRequestsPerSession: 100,
  maxTotalRequests: 1000,
};

/**
 * Tracks requests for debugging and waterfall visualization.
 */
export class RequestTracker {
  private readonly requests = new Map<string, TrackedRequest>();
  private readonly sessionRequests = new Map<string, string[]>();
  private readonly config: RequestTrackerConfig;
  private readonly logger?: StructuredLogger;

  constructor(config: Partial<RequestTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = config.logger;
  }

  /**
   * Start tracking a new request.
   */
  public startRequest(
    sessionId: string,
    type: RequestType,
    name: string,
    options: {
      server?: string;
      args?: unknown;
    } = {}
  ): string {
    const requestId = ulid();
    const request: TrackedRequest = {
      requestId,
      sessionId,
      type,
      name,
      server: options.server,
      args: options.args,
      startedAt: new Date(),
      status: "pending",
    };

    this.requests.set(requestId, request);

    // Track by session
    const sessionList = this.sessionRequests.get(sessionId) ?? [];
    sessionList.push(requestId);
    this.sessionRequests.set(sessionId, sessionList);

    // Log at debug level
    this.logger?.debug("request_started", {
      requestId,
      sessionId,
      type,
      name,
      server: options.server,
    });

    // Enforce limits
    this.enforceSessionLimit(sessionId);
    this.enforceTotalLimit();

    return requestId;
  }

  /**
   * Mark a request as completed.
   */
  public completeRequest(requestId: string, resultSummary?: string): void {
    const request = this.requests.get(requestId);
    if (!request) return;

    request.status = "completed";
    request.endedAt = new Date();
    request.durationMs = request.endedAt.getTime() - request.startedAt.getTime();
    request.resultSummary = resultSummary;

    this.logger?.debug("request_completed", {
      requestId,
      sessionId: request.sessionId,
      type: request.type,
      name: request.name,
      server: request.server,
      durationMs: request.durationMs,
    });
  }

  /**
   * Mark a request as failed.
   */
  public failRequest(requestId: string, error: string): void {
    const request = this.requests.get(requestId);
    if (!request) return;

    request.status = "failed";
    request.endedAt = new Date();
    request.durationMs = request.endedAt.getTime() - request.startedAt.getTime();
    request.error = error;

    this.logger?.debug("request_failed", {
      requestId,
      sessionId: request.sessionId,
      type: request.type,
      name: request.name,
      server: request.server,
      durationMs: request.durationMs,
      error,
    });
  }

  /**
   * Mark a request as timed out.
   */
  public timeoutRequest(requestId: string): void {
    const request = this.requests.get(requestId);
    if (!request) return;

    request.status = "timeout";
    request.endedAt = new Date();
    request.durationMs = request.endedAt.getTime() - request.startedAt.getTime();

    this.logger?.debug("request_timeout", {
      requestId,
      sessionId: request.sessionId,
      type: request.type,
      name: request.name,
      server: request.server,
      durationMs: request.durationMs,
    });
  }

  /**
   * Get all requests for a session.
   */
  public getSessionRequests(sessionId: string): TrackedRequest[] {
    const requestIds = this.sessionRequests.get(sessionId) ?? [];
    return requestIds
      .map((id) => this.requests.get(id))
      .filter((r): r is TrackedRequest => r !== undefined);
  }

  /**
   * Get all requests across all sessions.
   */
  public getAllRequests(): TrackedRequest[] {
    return Array.from(this.requests.values());
  }

  /**
   * Get requests grouped by session for waterfall view.
   */
  public getRequestsBySession(): Map<string, TrackedRequest[]> {
    const result = new Map<string, TrackedRequest[]>();
    for (const [sessionId] of this.sessionRequests) {
      result.set(sessionId, this.getSessionRequests(sessionId));
    }
    return result;
  }

  /**
   * Clear all requests for a session (e.g., when session is destroyed).
   */
  public clearSession(sessionId: string): void {
    const requestIds = this.sessionRequests.get(sessionId) ?? [];
    for (const id of requestIds) {
      this.requests.delete(id);
    }
    this.sessionRequests.delete(sessionId);
  }

  /**
   * Get summary statistics.
   */
  public getStats(): {
    totalRequests: number;
    sessionCount: number;
    byStatus: Record<RequestStatus, number>;
    byType: Record<RequestType, number>;
  } {
    const byStatus: Record<RequestStatus, number> = {
      pending: 0,
      completed: 0,
      failed: 0,
      timeout: 0,
    };
    const byType: Partial<Record<RequestType, number>> = {};

    for (const request of this.requests.values()) {
      byStatus[request.status]++;
      byType[request.type] = (byType[request.type] ?? 0) + 1;
    }

    return {
      totalRequests: this.requests.size,
      sessionCount: this.sessionRequests.size,
      byStatus,
      byType: byType as Record<RequestType, number>,
    };
  }

  private enforceSessionLimit(sessionId: string): void {
    const requestIds = this.sessionRequests.get(sessionId);
    if (!requestIds || requestIds.length <= this.config.maxRequestsPerSession) {
      return;
    }

    // Remove oldest requests
    const toRemove = requestIds.length - this.config.maxRequestsPerSession;
    const removed = requestIds.splice(0, toRemove);
    for (const id of removed) {
      this.requests.delete(id);
    }
  }

  private enforceTotalLimit(): void {
    if (this.requests.size <= this.config.maxTotalRequests) {
      return;
    }

    // Remove oldest requests globally
    const allRequests = Array.from(this.requests.values()).sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime()
    );

    const toRemove = this.requests.size - this.config.maxTotalRequests;
    for (let i = 0; i < toRemove; i++) {
      const request = allRequests[i];
      if (request) {
        this.requests.delete(request.requestId);
        const sessionList = this.sessionRequests.get(request.sessionId);
        if (sessionList) {
          const idx = sessionList.indexOf(request.requestId);
          if (idx >= 0) sessionList.splice(idx, 1);
        }
      }
    }
  }
}
