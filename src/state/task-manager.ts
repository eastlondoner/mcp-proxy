/**
 * Task Manager
 *
 * Manages proxy pseudo-tasks created when tool calls timeout.
 * Tasks are NOT MCP Tasks - they're a proxy-level abstraction for tracking
 * in-flight operations on backend servers.
 *
 * See TASKS_AND_ELICITATIONS.md for full design rationale.
 */

import { ulid } from "ulid";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { EventSystem } from "./event-system.js";

/**
 * Task status values
 */
export type ProxyTaskStatus =
  | "working"    // Still executing on backend
  | "completed"  // Finished successfully
  | "failed"     // Finished with error
  | "cancelled"  // Cancelled by client
  | "expired";   // TTL exceeded

/**
 * A proxy task representing an in-flight tool call
 */
export interface ProxyTask {
  /** ULID - time-sortable, unique */
  taskId: string;
  /** Backend server name */
  server: string;
  /** Tool being executed */
  toolName: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Current status */
  status: ProxyTaskStatus;
  /** Result if completed */
  result?: CallToolResult;
  /** Error message if failed */
  error?: string;
  /** When the task was created */
  createdAt: Date;
  /** When the task was last updated */
  lastUpdatedAt: Date;
  /** Time-to-live in ms before task expires */
  ttl: number;
  /** Internal: timeout handle for cleanup (excluded from public API) */
  _cleanupTimeoutHandle?: NodeJS.Timeout;
}

/**
 * Configuration for the TaskManager
 */
export interface TaskManagerConfig {
  /** Default TTL for tasks in ms (default: 10 minutes) */
  defaultTtlMs: number;
  /** How long to retain completed tasks in ms (default: 5 minutes) */
  completedRetentionMs: number;
  /** Cleanup interval in ms (default: 1 minute) */
  cleanupIntervalMs: number;
}

const DEFAULT_CONFIG: TaskManagerConfig = {
  defaultTtlMs: 10 * 60 * 1000,       // 10 minutes
  completedRetentionMs: 5 * 60 * 1000, // 5 minutes
  cleanupIntervalMs: 60 * 1000,        // 1 minute
};

/**
 * Per-session task manager.
 *
 * Creates tasks when tool calls timeout and tracks their lifecycle.
 * Tasks are NOT created for every tool call - only when timeout triggers.
 */
export class TaskManager {
  private readonly tasks = new Map<string, ProxyTask>();
  private readonly eventSystem: EventSystem;
  private readonly config: TaskManagerConfig;
  private cleanupIntervalHandle: NodeJS.Timeout | null = null;

  constructor(eventSystem: EventSystem, config: Partial<TaskManagerConfig> = {}) {
    this.eventSystem = eventSystem;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanupInterval();
  }

  /**
   * Create a new task for a tool call that timed out.
   *
   * @param server - Backend server name
   * @param toolName - Name of the tool
   * @param args - Tool arguments
   * @param ttlMs - Optional TTL override
   * @returns The created task
   */
  public createTask(
    server: string,
    toolName: string,
    args: Record<string, unknown>,
    ttlMs?: number
  ): ProxyTask {
    const taskId = ulid();
    const now = new Date();

    const task: ProxyTask = {
      taskId,
      server,
      toolName,
      args,
      status: "working",
      createdAt: now,
      lastUpdatedAt: now,
      ttl: ttlMs ?? this.config.defaultTtlMs,
    };

    this.tasks.set(taskId, task);

    this.eventSystem.addEvent("task_created", server, {
      taskId,
      toolName,
      args,
    });

    return task;
  }

  /**
   * Mark a task as completed with its result.
   */
  public completeTask(taskId: string, result: CallToolResult): void {
    const task = this.tasks.get(taskId);
    if (task?.status !== "working") {
      // Task not found or already in terminal state - ignore
      return;
    }

    task.status = "completed";
    task.result = result;
    task.lastUpdatedAt = new Date();

    // Schedule cleanup after retention period
    this.scheduleTaskCleanup(task);

    this.eventSystem.addEvent("task_completed", task.server, {
      taskId,
      toolName: task.toolName,
      result,
    });
  }

  /**
   * Mark a task as failed with an error message.
   */
  public failTask(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (task?.status !== "working") {
      // Task not found or already in terminal state - ignore
      return;
    }

    task.status = "failed";
    task.error = error;
    task.lastUpdatedAt = new Date();

    this.scheduleTaskCleanup(task);

    this.eventSystem.addEvent("task_failed", task.server, {
      taskId,
      toolName: task.toolName,
      error,
    });
  }

  /**
   * Cancel a working task.
   *
   * @returns true if task was cancelled, false if not found or not cancellable
   */
  public cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (task?.status !== "working") {
      return false;
    }

    task.status = "cancelled";
    task.lastUpdatedAt = new Date();

    this.scheduleTaskCleanup(task);

    this.eventSystem.addEvent("task_cancelled", task.server, {
      taskId,
      toolName: task.toolName,
    });

    return true;
  }

  /**
   * Get a task by ID.
   *
   * @returns Task without internal fields, or undefined if not found
   */
  public getTask(taskId: string): Omit<ProxyTask, "_cleanupTimeoutHandle"> | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _cleanupTimeoutHandle, ...publicTask } = task;
    return publicTask;
  }

  /**
   * Get all tasks for a server.
   */
  public getTasksForServer(server: string): Omit<ProxyTask, "_cleanupTimeoutHandle">[] {
    return Array.from(this.tasks.values())
      .filter((t) => t.server === server)
      .map((t) => ({
        taskId: t.taskId,
        server: t.server,
        toolName: t.toolName,
        args: t.args,
        status: t.status,
        result: t.result,
        error: t.error,
        createdAt: t.createdAt,
        lastUpdatedAt: t.lastUpdatedAt,
        ttl: t.ttl,
      }));
  }

  /**
   * Get all tasks, optionally including terminal states.
   */
  public getAllTasks(includeTerminal = false): Omit<ProxyTask, "_cleanupTimeoutHandle">[] {
    const terminalStates: ProxyTaskStatus[] = ["completed", "failed", "cancelled", "expired"];
    return Array.from(this.tasks.values())
      .filter((t) => includeTerminal || !terminalStates.includes(t.status))
      .map((t) => ({
        taskId: t.taskId,
        server: t.server,
        toolName: t.toolName,
        args: t.args,
        status: t.status,
        result: t.result,
        error: t.error,
        createdAt: t.createdAt,
        lastUpdatedAt: t.lastUpdatedAt,
        ttl: t.ttl,
      }));
  }

  /**
   * Get working tasks for a server.
   */
  public getWorkingTasksForServer(
    server: string
  ): { taskId: string; toolName: string; status: string }[] {
    return Array.from(this.tasks.values())
      .filter((t) => t.server === server && t.status === "working")
      .map((t) => ({ taskId: t.taskId, toolName: t.toolName, status: t.status }));
  }

  /**
   * Schedule cleanup for a completed/failed/cancelled task.
   */
  private scheduleTaskCleanup(task: ProxyTask): void {
    // Clear any existing cleanup timer
    if (task._cleanupTimeoutHandle) {
      clearTimeout(task._cleanupTimeoutHandle);
    }

    task._cleanupTimeoutHandle = setTimeout(() => {
      this.tasks.delete(task.taskId);
    }, this.config.completedRetentionMs);
  }

  /**
   * Start the background cleanup interval for expired tasks.
   */
  private startCleanupInterval(): void {
    this.cleanupIntervalHandle = setInterval(() => {
      this.runCleanup();
    }, this.config.cleanupIntervalMs);
  }

  /**
   * Check for and expire tasks that have exceeded their TTL.
   */
  private runCleanup(): void {
    const now = Date.now();

    for (const task of this.tasks.values()) {
      if (task.status !== "working") continue;

      const elapsed = now - task.createdAt.getTime();
      if (elapsed >= task.ttl) {
        task.status = "expired";
        task.error = `Task expired after ${String(task.ttl)}ms TTL`;
        task.lastUpdatedAt = new Date();

        this.eventSystem.addEvent("task_expired", task.server, {
          taskId: task.taskId,
          toolName: task.toolName,
          ttl: task.ttl,
        });

        this.scheduleTaskCleanup(task);
      }
    }
  }

  /**
   * Shutdown the task manager, clearing all timers.
   */
  public shutdown(): void {
    if (this.cleanupIntervalHandle) {
      clearInterval(this.cleanupIntervalHandle);
      this.cleanupIntervalHandle = null;
    }

    // Clear all task cleanup timers
    for (const task of this.tasks.values()) {
      if (task._cleanupTimeoutHandle) {
        clearTimeout(task._cleanupTimeoutHandle);
      }
    }
  }
}
