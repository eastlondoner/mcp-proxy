/**
 * Timer Manager
 *
 * Manages timers that fire after a specified duration and deliver notifications.
 * When timers expire, they are buffered for delivery via the context info wrapper
 * and also emit events to the EventSystem for await_activity.
 */

import { ulid } from "ulid";
import type { EventSystem } from "./event-system.js";

/**
 * Timer status values
 */
export type TimerStatus = "active" | "expired" | "deleted";

/**
 * A timer that fires after a duration
 */
export interface Timer {
  /** ULID - time-sortable, unique */
  id: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** User-provided message to include in notification */
  message: string;
  /** When the timer was created */
  createdAt: Date;
  /** When the timer will/did expire (or next fire for intervals) */
  expiresAt: Date;
  /** Current status */
  status: TimerStatus;
  /** If true, timer repeats at the specified interval */
  interval: boolean;
  /** Number of times this timer has fired (for interval timers) */
  fireCount: number;
}

/**
 * Internal timer with timeout handle
 */
interface InternalTimer extends Timer {
  /** setTimeout handle for cleanup */
  _timeoutHandle?: NodeJS.Timeout;
  /** setInterval handle for repeating timers */
  _intervalHandle?: NodeJS.Timeout;
}

/**
 * Expired timer info for delivery
 */
export interface ExpiredTimer {
  /** Timer ID */
  id: string;
  /** User-provided message */
  message: string;
  /** When the timer expired */
  expiredAt: string;
}

/**
 * Configuration for the TimerManager
 */
export interface TimerManagerConfig {
  /** Maximum number of active timers per session (default: 100) */
  maxActiveTimers: number;
  /** Maximum duration for a timer in ms (default: 24 hours) */
  maxDurationMs: number;
  /** How long to retain expired/deleted timers in ms (default: 5 minutes) */
  retentionMs: number;
}

const DEFAULT_CONFIG: TimerManagerConfig = {
  maxActiveTimers: 100,
  maxDurationMs: 24 * 60 * 60 * 1000, // 24 hours
  retentionMs: 5 * 60 * 1000, // 5 minutes
};

/**
 * Per-session timer manager.
 *
 * Creates timers that fire after a duration and deliver notifications.
 * Expired timers are buffered for exactly-once delivery via context info.
 */
export class TimerManager {
  private readonly timers = new Map<string, InternalTimer>();
  private readonly expiredBuffer: ExpiredTimer[] = [];
  private readonly eventSystem: EventSystem;
  private readonly config: TimerManagerConfig;

  constructor(eventSystem: EventSystem, config: Partial<TimerManagerConfig> = {}) {
    this.eventSystem = eventSystem;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create a new timer.
   *
   * @param durationMs - How long until the timer fires (in milliseconds)
   * @param message - Message to include in the notification
   * @param interval - If true, timer repeats at the specified interval (default: false)
   * @returns The created timer
   * @throws Error if max timers exceeded or duration invalid
   */
  public createTimer(durationMs: number, message: string, interval = false): Timer {
    // Validate
    const activeCount = this.getActiveTimers().length;
    if (activeCount >= this.config.maxActiveTimers) {
      throw new Error(`Maximum active timers (${String(this.config.maxActiveTimers)}) exceeded`);
    }

    if (durationMs <= 0) {
      throw new Error("Duration must be positive");
    }

    if (durationMs > this.config.maxDurationMs) {
      throw new Error(`Duration exceeds maximum (${String(this.config.maxDurationMs)}ms)`);
    }

    const id = ulid();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationMs);

    const timer: InternalTimer = {
      id,
      durationMs,
      message,
      createdAt: now,
      expiresAt,
      status: "active",
      interval,
      fireCount: 0,
    };

    if (interval) {
      // For interval timers, use setInterval for repeating fires
      timer._intervalHandle = setInterval(() => {
        this.fireIntervalTimer(id);
      }, durationMs);
    } else {
      // For one-shot timers, use setTimeout
      timer._timeoutHandle = setTimeout(() => {
        this.expireTimer(id);
      }, durationMs);
    }

    this.timers.set(id, timer);

    return this.toPublicTimer(timer);
  }

  /**
   * Get a timer by ID.
   *
   * @returns Timer or undefined if not found
   */
  public getTimer(id: string): Timer | undefined {
    const timer = this.timers.get(id);
    if (!timer) return undefined;
    return this.toPublicTimer(timer);
  }

  /**
   * Delete a timer.
   *
   * @returns The deleted timer, or undefined if not found
   */
  public deleteTimer(id: string): Timer | undefined {
    const timer = this.timers.get(id);
    if (!timer) return undefined;

    // Clear timeout if still active
    if (timer._timeoutHandle) {
      clearTimeout(timer._timeoutHandle);
      timer._timeoutHandle = undefined;
    }

    // Clear interval if active
    if (timer._intervalHandle) {
      clearInterval(timer._intervalHandle);
      timer._intervalHandle = undefined;
    }

    timer.status = "deleted";

    // Schedule cleanup
    this.scheduleCleanup(timer);

    return this.toPublicTimer(timer);
  }

  /**
   * Get all timers.
   *
   * @param includeInactive - Include expired and deleted timers (default: false)
   */
  public getAllTimers(includeInactive = false): Timer[] {
    const timers = Array.from(this.timers.values());
    const filtered = includeInactive
      ? timers
      : timers.filter((t) => t.status === "active");
    return filtered.map((t) => this.toPublicTimer(t));
  }

  /**
   * Get active timers only.
   */
  public getActiveTimers(): Timer[] {
    return Array.from(this.timers.values())
      .filter((t) => t.status === "active")
      .map((t) => this.toPublicTimer(t));
  }

  /**
   * Get and clear expired timers buffer.
   * This is for exactly-once delivery via context info.
   *
   * @returns Expired timers since last call
   */
  public getAndClearExpired(): ExpiredTimer[] {
    const expired = [...this.expiredBuffer];
    this.expiredBuffer.length = 0;
    return expired;
  }

  /**
   * Check if there are any expired timers waiting for delivery.
   */
  public hasExpired(): boolean {
    return this.expiredBuffer.length > 0;
  }

  /**
   * Shutdown the timer manager, clearing all timeouts and intervals.
   */
  public shutdown(): void {
    for (const timer of this.timers.values()) {
      if (timer._timeoutHandle) {
        clearTimeout(timer._timeoutHandle);
      }
      if (timer._intervalHandle) {
        clearInterval(timer._intervalHandle);
      }
    }
    this.timers.clear();
    this.expiredBuffer.length = 0;
  }

  /**
   * Handle timer expiration (one-shot timers).
   */
  private expireTimer(id: string): void {
    const timer = this.timers.get(id);
    if (!timer?.status || timer.status !== "active") return;

    timer.status = "expired";
    timer._timeoutHandle = undefined;
    timer.fireCount++;

    // Add to expired buffer for context info delivery
    this.expiredBuffer.push({
      id: timer.id,
      message: timer.message,
      expiredAt: new Date().toISOString(),
    });

    // Emit event for await_activity
    this.eventSystem.addEvent("timer_expired", "emceepee", {
      timerId: timer.id,
      message: timer.message,
    });

    // Schedule cleanup
    this.scheduleCleanup(timer);
  }

  /**
   * Handle interval timer fire (repeating timers).
   * Unlike expireTimer, this doesn't change status or schedule cleanup.
   */
  private fireIntervalTimer(id: string): void {
    const timer = this.timers.get(id);
    if (!timer?.status || timer.status !== "active") return;

    timer.fireCount++;
    // Update expiresAt to the next fire time
    timer.expiresAt = new Date(Date.now() + timer.durationMs);

    // Add to expired buffer for context info delivery
    this.expiredBuffer.push({
      id: timer.id,
      message: timer.message,
      expiredAt: new Date().toISOString(),
    });

    // Emit event for await_activity
    this.eventSystem.addEvent("timer_expired", "emceepee", {
      timerId: timer.id,
      message: timer.message,
      fireCount: timer.fireCount,
      interval: true,
    });
  }

  /**
   * Schedule cleanup for an expired/deleted timer.
   */
  private scheduleCleanup(timer: InternalTimer): void {
    setTimeout(() => {
      this.timers.delete(timer.id);
    }, this.config.retentionMs);
  }

  /**
   * Convert internal timer to public timer (strip internal fields).
   */
  private toPublicTimer(timer: InternalTimer): Timer {
    return {
      id: timer.id,
      durationMs: timer.durationMs,
      message: timer.message,
      createdAt: timer.createdAt,
      expiresAt: timer.expiresAt,
      status: timer.status,
      interval: timer.interval,
      fireCount: timer.fireCount,
    };
  }
}
