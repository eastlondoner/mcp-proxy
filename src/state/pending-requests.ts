/**
 * Pending Requests Manager
 *
 * Manages elicitation and sampling requests from backend servers.
 * These are Category 4 (pending-waiting-on-client) per SESSION_STATE_DESIGN.md.
 *
 * Key features:
 * - Timeout handling with proper cleanup
 * - Events emitted on new requests AND expirations
 * - Separate maps for sampling vs elicitation
 */

import { ulid } from "ulid";
import type {
  CreateMessageRequestParams,
  CreateMessageResult,
  ElicitRequestParams,
  ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { EventSystem } from "./event-system.js";

/**
 * A pending sampling request from a backend server
 */
export interface PendingSamplingRequest {
  /** ULID - unique identifier */
  requestId: string;
  /** Backend server this request came from */
  server: string;
  /** When the request was received */
  timestamp: Date;
  /** Original request parameters */
  params: CreateMessageRequestParams;
  /** Promise resolver */
  resolve: (result: CreateMessageResult) => void;
  /** Promise rejecter */
  reject: (error: Error) => void;
  /** Timeout handle - MUST be cleared on response/rejection */
  timeoutHandle: NodeJS.Timeout;
}

/**
 * A pending elicitation request from a backend server
 */
export interface PendingElicitationRequest {
  /** ULID - unique identifier */
  requestId: string;
  /** Backend server this request came from */
  server: string;
  /** When the request was received */
  timestamp: Date;
  /** Original request parameters */
  params: ElicitRequestParams;
  /** Promise resolver */
  resolve: (result: ElicitResult) => void;
  /** Promise rejecter */
  reject: (error: Error) => void;
  /** Timeout handle - MUST be cleared on response/rejection */
  timeoutHandle: NodeJS.Timeout;
}

/**
 * Simplified sampling request info for tool output
 */
export interface SamplingRequestInfo {
  requestId: string;
  server: string;
  timestamp: Date;
  params: CreateMessageRequestParams;
}

/**
 * Simplified elicitation request info for tool output
 */
export interface ElicitationRequestInfo {
  requestId: string;
  server: string;
  timestamp: Date;
  params: ElicitRequestParams;
}

/**
 * Configuration for pending requests
 */
export interface PendingRequestsConfig {
  /** Default timeout in ms (default: 10 minutes - allow time for human interaction) */
  defaultTimeoutMs: number;
}

const DEFAULT_CONFIG: PendingRequestsConfig = {
  defaultTimeoutMs: 10 * 60 * 1000, // 10 minutes
};

/**
 * Per-session pending requests manager.
 *
 * Handles elicitation and sampling requests from backend servers,
 * with proper timeout management and event emission.
 */
export class PendingRequestsManager {
  private readonly samplingRequests = new Map<string, PendingSamplingRequest>();
  private readonly elicitationRequests = new Map<string, PendingElicitationRequest>();
  private readonly eventSystem: EventSystem;
  private readonly config: PendingRequestsConfig;

  constructor(eventSystem: EventSystem, config: Partial<PendingRequestsConfig> = {}) {
    this.eventSystem = eventSystem;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add a sampling request from a backend server.
   * Sets up timeout handling and emits event.
   *
   * @returns The request ID (ULID)
   */
  public addSamplingRequest(
    server: string,
    params: CreateMessageRequestParams,
    resolve: (result: CreateMessageResult) => void,
    reject: (error: Error) => void
  ): string {
    const requestId = ulid();

    // Set up timeout that cleans up and rejects the request
    const timeoutHandle = setTimeout(() => {
      const pending = this.samplingRequests.get(requestId);
      if (pending) {
        this.samplingRequests.delete(requestId);

        this.eventSystem.addEvent("sampling_expired", server, {
          requestId,
          reason: `Timed out after ${String(this.config.defaultTimeoutMs)}ms`,
        });

        pending.reject(new Error(`Sampling request timed out after ${String(this.config.defaultTimeoutMs)}ms`));
      }
    }, this.config.defaultTimeoutMs);

    const request: PendingSamplingRequest = {
      requestId,
      server,
      timestamp: new Date(),
      params,
      resolve,
      reject,
      timeoutHandle,
    };

    this.samplingRequests.set(requestId, request);

    // Emit event for await_activity
    this.eventSystem.addEvent("sampling_request", server, {
      requestId,
      params,
    });

    return requestId;
  }

  /**
   * Add an elicitation request from a backend server.
   * Sets up timeout handling and emits event.
   *
   * @returns The request ID (ULID)
   */
  public addElicitationRequest(
    server: string,
    params: ElicitRequestParams,
    resolve: (result: ElicitResult) => void,
    reject: (error: Error) => void
  ): string {
    const requestId = ulid();

    const timeoutHandle = setTimeout(() => {
      const pending = this.elicitationRequests.get(requestId);
      if (pending) {
        this.elicitationRequests.delete(requestId);

        this.eventSystem.addEvent("elicitation_expired", server, {
          requestId,
          reason: `Timed out after ${String(this.config.defaultTimeoutMs)}ms`,
        });

        pending.reject(new Error(`Elicitation request timed out after ${String(this.config.defaultTimeoutMs)}ms`));
      }
    }, this.config.defaultTimeoutMs);

    const request: PendingElicitationRequest = {
      requestId,
      server,
      timestamp: new Date(),
      params,
      resolve,
      reject,
      timeoutHandle,
    };

    this.elicitationRequests.set(requestId, request);

    this.eventSystem.addEvent("elicitation_request", server, {
      requestId,
      params,
    });

    return requestId;
  }

  /**
   * Respond to a pending sampling request.
   * CRITICAL: Clears timeout handle to prevent memory leak.
   */
  public respondToSampling(requestId: string, result: CreateMessageResult): void {
    const pending = this.samplingRequests.get(requestId);
    if (!pending) {
      throw new Error(`Sampling request '${requestId}' not found or already completed`);
    }

    // CRITICAL: Clear the timeout to prevent leak and duplicate handling
    clearTimeout(pending.timeoutHandle);

    this.samplingRequests.delete(requestId);
    pending.resolve(result);
  }

  /**
   * Cancel a pending sampling request.
   * Rejects the underlying promise with a specific error message.
   */
  public cancelSampling(requestId: string, reason = "User cancelled"): void {
    const pending = this.samplingRequests.get(requestId);
    if (!pending) {
      throw new Error(`Sampling request '${requestId}' not found or already completed`);
    }

    clearTimeout(pending.timeoutHandle);
    this.samplingRequests.delete(requestId);
    
    this.eventSystem.addEvent("sampling_expired", pending.server, {
      requestId,
      reason,
    });

    pending.reject(new Error(reason));
  }

  /**
   * Respond to a pending elicitation request.
   * CRITICAL: Clears timeout handle to prevent memory leak.
   */
  public respondToElicitation(requestId: string, result: ElicitResult): void {
    const pending = this.elicitationRequests.get(requestId);
    if (!pending) {
      throw new Error(`Elicitation request '${requestId}' not found or already completed`);
    }

    // CRITICAL: Clear the timeout to prevent leak and duplicate handling
    clearTimeout(pending.timeoutHandle);

    this.elicitationRequests.delete(requestId);
    pending.resolve(result);
  }

  /**
   * Cancel a pending elicitation request.
   */
  public cancelElicitation(requestId: string, reason = "User cancelled"): void {
    const pending = this.elicitationRequests.get(requestId);
    if (!pending) {
      throw new Error(`Elicitation request '${requestId}' not found or already completed`);
    }

    clearTimeout(pending.timeoutHandle);
    this.elicitationRequests.delete(requestId);

    this.eventSystem.addEvent("elicitation_expired", pending.server, {
      requestId,
      reason,
    });

    pending.reject(new Error(reason));
  }

  /**
   * Get all pending sampling requests (for tool output).
   */
  public getPendingSamplingRequests(): SamplingRequestInfo[] {
    return Array.from(this.samplingRequests.values()).map((req) => ({
      requestId: req.requestId,
      server: req.server,
      timestamp: req.timestamp,
      params: req.params,
    }));
  }

  /**
   * Get all pending elicitation requests (for tool output).
   */
  public getPendingElicitationRequests(): ElicitationRequestInfo[] {
    return Array.from(this.elicitationRequests.values()).map((req) => ({
      requestId: req.requestId,
      server: req.server,
      timestamp: req.timestamp,
      params: req.params,
    }));
  }

  /**
   * Get requests for a specific server.
   */
  public getRequestsForServer(server: string): {
    sampling: SamplingRequestInfo[];
    elicitation: ElicitationRequestInfo[];
  } {
    return {
      sampling: this.getPendingSamplingRequests().filter((r) => r.server === server),
      elicitation: this.getPendingElicitationRequests().filter((r) => r.server === server),
    };
  }

  /**
   * Check if there are any pending requests.
   */
  public hasPendingRequests(): boolean {
    return this.samplingRequests.size > 0 || this.elicitationRequests.size > 0;
  }

  /**
   * Reject all requests for a server (e.g., on disconnect).
   * CRITICAL: Clears timeout handles to prevent memory leaks.
   */
  public rejectRequestsForServer(server: string, reason: string): void {
    // Reject sampling requests
    for (const [id, request] of this.samplingRequests) {
      if (request.server === server) {
        clearTimeout(request.timeoutHandle);
        this.samplingRequests.delete(id);

        this.eventSystem.addEvent("sampling_expired", server, {
          requestId: id,
          reason,
        });

        request.reject(new Error(reason));
      }
    }

    // Reject elicitation requests
    for (const [id, request] of this.elicitationRequests) {
      if (request.server === server) {
        clearTimeout(request.timeoutHandle);
        this.elicitationRequests.delete(id);

        this.eventSystem.addEvent("elicitation_expired", server, {
          requestId: id,
          reason,
        });

        request.reject(new Error(reason));
      }
    }
  }

  /**
   * Shutdown: reject all pending requests.
   */
  public shutdown(): void {
    for (const request of this.samplingRequests.values()) {
      clearTimeout(request.timeoutHandle);
      request.reject(new Error("PendingRequestsManager shutting down"));
    }
    this.samplingRequests.clear();

    for (const request of this.elicitationRequests.values()) {
      clearTimeout(request.timeoutHandle);
      request.reject(new Error("PendingRequestsManager shutting down"));
    }
    this.elicitationRequests.clear();
  }
}
