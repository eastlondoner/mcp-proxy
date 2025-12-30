/**
 * Structured Logging Interface
 *
 * Provides a consistent logging interface for the proxy components.
 */

/**
 * Log levels in order of severity
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Log context data - any JSON-serializable object
 */
export type LogContext = Record<string, unknown>;

/**
 * Structured logger interface
 */
export interface StructuredLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Create a console logger with structured output.
 *
 * @param minLevel - Minimum log level to output (default: "info")
 */
export function createConsoleLogger(minLevel: LogLevel = "info"): StructuredLogger {
  const minValue = LOG_LEVEL_VALUES[minLevel];

  const log = (level: LogLevel, message: string, context?: LogContext): void => {
    if (LOG_LEVEL_VALUES[level] < minValue) {
      return;
    }

    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : "";

    switch (level) {
      case "debug":
        console.debug(`[${timestamp}] DEBUG ${message}${contextStr}`);
        break;
      case "info":
        console.info(`[${timestamp}] INFO ${message}${contextStr}`);
        break;
      case "warn":
        console.warn(`[${timestamp}] WARN ${message}${contextStr}`);
        break;
      case "error":
        console.error(`[${timestamp}] ERROR ${message}${contextStr}`);
        break;
    }
  };

  return {
    debug: (message, context): void => {
      log("debug", message, context);
    },
    info: (message, context): void => {
      log("info", message, context);
    },
    warn: (message, context): void => {
      log("warn", message, context);
    },
    error: (message, context): void => {
      log("error", message, context);
    },
  };
}

/**
 * Create a no-op logger that discards all output.
 * Useful for testing.
 */
export function createNullLogger(): StructuredLogger {
  const noop = (): void => {
    // Intentionally empty
  };

  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  };
}
