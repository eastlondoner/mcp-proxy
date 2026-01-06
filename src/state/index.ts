/**
 * State Management Module
 *
 * Exports all state management components for per-session state handling.
 */

export { EventSystem } from "./event-system.js";
export type {
  ProxyEventType,
  StoredEvent,
  EventSystemConfig,
} from "./event-system.js";

export { TaskManager } from "./task-manager.js";
export type {
  ProxyTask,
  ProxyTaskStatus,
  TaskManagerConfig,
} from "./task-manager.js";

export { BufferManager } from "./buffer-manager.js";
export type {
  BufferedNotification,
  BufferedLog,
  BufferManagerConfig,
} from "./buffer-manager.js";

export { PendingRequestsManager } from "./pending-requests.js";
export type {
  PendingSamplingRequest,
  PendingElicitationRequest,
  SamplingRequestInfo,
  ElicitationRequestInfo,
  PendingRequestsConfig,
} from "./pending-requests.js";

export { TimerManager } from "./timer-manager.js";
export type {
  Timer,
  TimerStatus,
  ExpiredTimer,
  TimerManagerConfig,
} from "./timer-manager.js";
