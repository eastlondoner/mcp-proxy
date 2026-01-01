# Backend Server Reconnection Design

This document outlines the design for gracefully handling destination MCP server restarts in emceepee.

**Related Documents:**
- `BUG-backend-reconnection.md` - Bug report describing current behavior
- `SESSION_STATE_DESIGN.md` - Session and state management architecture
- `TASKS_AND_ELICITATIONS.md` - Task and elicitation handling

## Problem Statement

When a backend MCP server restarts, emceepee currently:
1. Marks the connection as "disconnected" or "error"
2. Fails all in-flight tasks for that server
3. Rejects all pending elicitations/sampling requests for that server
4. Emits a `server_disconnected` event

Subsequent tool calls fail with connection errors until the server is manually removed and re-added.

**Desired behavior**: Automatic reconnection with proper state management and client notification.

## Design Goals

1. **Automatic reconnection**: Detect disconnect and attempt to reconnect with exponential backoff
2. **Clear state semantics**: Define what happens to pending operations during reconnection
3. **Client notification**: Inform clients about disconnection and reconnection events
4. **Graceful degradation**: Allow manual intervention if auto-reconnect fails repeatedly
5. **No silent state corruption**: Be explicit about what state is lost vs preserved

## Key Design Decisions

### 1. Reconnection Strategy

**Approach**: Lazy reconnection with proactive background attempts

When a backend disconnects:
1. Mark connection status as `reconnecting`
2. Start background reconnection attempts with exponential backoff
3. If a tool call arrives before reconnection succeeds, attempt immediate reconnection
4. After max retries, mark as `failed` and stop automatic attempts

**Rationale**:
- Lazy reconnection (on next use) is simple but delays error discovery
- Proactive background reconnection provides faster recovery
- Combining both gives the best user experience

### 2. State Handling During Reconnection

#### What Gets Failed/Rejected Immediately

When disconnect is detected:
- **Working tasks**: Fail with "Server disconnected" (current behavior, keep it)
- **Pending elicitations**: Reject with "Server disconnected" (current behavior, keep it)
- **Pending sampling requests**: Reject with "Server disconnected" (current behavior, keep it)

**Rationale**: The backend's MCP session is lost. Any state on the backend side is gone. We cannot resume these operations.

#### What Gets Preserved

- **Server configuration**: Preserved in `ServerConfigRegistry`
- **Connection metadata**: URL, name (needed for reconnection)
- **Session association**: The session still "owns" the intent to use this server

#### What Gets Refreshed After Reconnection

After successful reconnection:
- **Capabilities**: Re-fetched from server (may have changed)
- **Tool list**: May have changed (emit `tools_list_changed` if server has that capability)
- **Resources/Prompts**: May have changed (emit respective notifications)

### 3. New Connection States

Current states: `connecting`, `connected`, `disconnected`, `error`

Add new state:
- `reconnecting` - Lost connection, attempting to reconnect (indefinitely)

```typescript
export type BackendConnectionStatus =
  | "connecting"      // Initial connection in progress
  | "connected"       // Successfully connected
  | "disconnected"    // Cleanly disconnected (intentional, e.g., remove_server)
  | "reconnecting"    // Lost connection, attempting to reconnect
  | "error";          // Connection error (with message)
```

Note: No `failed` state since we retry forever. The `reconnecting` state persists until success or manual removal.

### 4. Events for Clients

New/updated event types:

| Event | When | Data |
|-------|------|------|
| `server_disconnected` | Connection lost | `{ name, wasIntentional: boolean }` |
| `server_reconnecting` | Reconnection attempt starting | `{ name, attempt: number, nextRetryMs: number }` |
| `server_reconnected` | Successfully reconnected | `{ name, capabilities, attemptsTaken: number }` |
| `server_health_degraded` | 3+ consecutive health checks failed | `{ name, consecutiveFailures: number, lastError: string }` |
| `server_health_restored` | Health check succeeded after degraded | `{ name }` |

### 5. Reconnection Parameters

Reconnection uses fixed parameters (not configurable per-server):

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Initial delay | 1 second | Quick first retry |
| Max delay | 180 seconds (3 min) | Balance between responsiveness and not hammering |
| Backoff multiplier | 2 | Standard exponential backoff |
| Max attempts | **Unlimited** | Keep trying forever (handles hibernation/wake) |
| Jitter factor | 0.1 (10%) | Prevent thundering herd |

**Hibernation support**: The reconnection loop should handle the computer going to sleep and waking up. When the system wakes, the next scheduled reconnection attempt will fire and (hopefully) succeed.

### 6. Health Checks

Periodic health checks detect silent connection failures before tool calls fail.

**Parameters:**
- Interval: 120 seconds (with 10% jitter)
- Request timeout: 60 seconds
- Method: `tools/list` request (lightweight, always available)

**Health Check Behavior:**

Health checks are **early warning only**, not reconnection triggers:

```
Health check fails
    │
    ├─→ Increment consecutiveFailures counter
    │
    ├─→ If consecutiveFailures >= 3:
    │       Emit "server_health_degraded" event (informational)
    │
    └─→ Do NOT trigger reconnection
        (Keep SSE stream open - network might recover)

Next tool call arrives
    │
    ├─→ Attempt the call anyway
    │
    ├─→ If succeeds:
    │       Reset consecutiveFailures to 0
    │       If was degraded: emit "server_health_restored"
    │
    └─→ If fails with connection error:
            NOW trigger reconnection
```

**Rationale:**

| Scenario | Health Check Behavior | Why |
|----------|----------------------|-----|
| Temporary network blip | Keep connection, warn via event | Network may recover, SSE can resume |
| Server overloaded/slow | Keep connection, warn via event | Server is alive, just slow |
| Server actually dead | Tool call will fail, triggering reconnect | Reconnection is appropriate |
| Computer hibernated | Check fails, then succeeds on wake | No unnecessary reconnect cycle |

This approach:
- Provides early warning (events) without being trigger-happy
- Lets the SSE transport handle network-level recovery
- Only reconnects when we have definitive evidence the session is dead (tool call fails)

### 7. Force Reconnect Tool

New tool for manual intervention:

```typescript
{
  name: "reconnect_server",
  description: "Force reconnection to a backend server. Works on connected, disconnected, or reconnecting servers.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name of the server to reconnect"
      }
    },
    required: ["name"]
  }
}
```

**Behavior:**
- If `connected`: Close existing connection, create new one
- If `disconnected`: Start new connection attempt
- If `reconnecting`: Cancel scheduled retry, attempt immediately
- If server not configured: Error

**Use cases:**
- User knows server restarted and wants immediate reconnection
- Clearing stale connection state
- Testing reconnection logic

## Implementation Plan

### Phase 1: Reconnection State in MCPHttpClient

**File: `src/client.ts`**

Add reconnection state and methods:

```typescript
class MCPHttpClient {
  // New state
  private reconnectAttempt = 0;
  private reconnectTimeoutHandle: NodeJS.Timeout | null = null;
  private nextRetryMs = 0;

  // New callbacks
  onReconnecting?: (attempt: number, nextRetryMs: number) => void;
  onReconnected?: (attemptsTaken: number) => void;

  // New public methods
  public async forceReconnect(): Promise<void>;
  public cancelReconnection(): void;
  public getReconnectionState(): { attempt: number; nextRetryMs: number } | null;

  // New private methods
  private scheduleReconnection(): void;
  private async attemptReconnection(): Promise<boolean>;
  private calculateBackoff(attempt: number): number;

  // Modified: Handle transport close/error
  // Instead of just setting status, start reconnection
}
```

**Backoff calculation:**
```typescript
private calculateBackoff(attempt: number): number {
  const baseDelay = 1000; // 1 second
  const maxDelay = 180000; // 180 seconds
  const multiplier = 2;
  const jitter = 0.1;

  const delay = Math.min(baseDelay * Math.pow(multiplier, attempt), maxDelay);
  const jitterAmount = delay * jitter * (Math.random() * 2 - 1);
  return Math.round(delay + jitterAmount);
}
```

### Phase 2: Health Check System

**File: `src/client.ts` (or new `src/health-check.ts`)**

Add periodic health checking:

```typescript
class MCPHttpClient {
  // Health check state
  private healthCheckIntervalHandle: NodeJS.Timeout | null = null;
  private consecutiveHealthFailures = 0;
  private healthStatus: "healthy" | "degraded" = "healthy";

  // New callbacks
  onHealthDegraded?: (failures: number, lastError: string) => void;
  onHealthRestored?: () => void;

  // Start health checks after connection
  private startHealthChecks(): void;
  private stopHealthChecks(): void;
  private async performHealthCheck(): Promise<void>;
}
```

**Health check logic:**
```typescript
private async performHealthCheck(): Promise<void> {
  if (this.status !== "connected") return;

  try {
    // Use tools/list with timeout
    await Promise.race([
      this.listTools(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Health check timeout")), 60000)
      )
    ]);

    // Success - reset failure count
    if (this.consecutiveHealthFailures > 0) {
      const wasDegraded = this.healthStatus === "degraded";
      this.consecutiveHealthFailures = 0;
      this.healthStatus = "healthy";
      if (wasDegraded) {
        this.onHealthRestored?.();
      }
    }
  } catch (error) {
    this.consecutiveHealthFailures++;
    if (this.consecutiveHealthFailures >= 3 && this.healthStatus !== "degraded") {
      this.healthStatus = "degraded";
      this.onHealthDegraded?.(this.consecutiveHealthFailures, error.message);
    }
    // Note: Do NOT trigger reconnection - let tool calls do that
  }
}
```

### Phase 3: Session Manager Integration

**File: `src/session/session-manager.ts`**

Update connection handling:

```typescript
private async connectSessionToServer(session, serverConfig): Promise<BackendConnection> {
  const client = new MCPHttpClient({
    // ... existing options ...

    // New callbacks for reconnection
    onReconnecting: (attempt, nextRetryMs) => {
      session.setConnectionStatus(serverConfig.name, "reconnecting");
      session.eventSystem.addEvent("server_reconnecting", serverConfig.name, {
        name: serverConfig.name,
        attempt,
        nextRetryMs,
      });
    },
    onReconnected: (attemptsTaken) => {
      session.setConnectionStatus(serverConfig.name, "connected");
      session.eventSystem.addEvent("server_reconnected", serverConfig.name, {
        name: serverConfig.name,
        capabilities: client.getInfo().capabilities,
        attemptsTaken,
      });
    },

    // New callbacks for health checks
    onHealthDegraded: (failures, lastError) => {
      session.eventSystem.addEvent("server_health_degraded", serverConfig.name, {
        name: serverConfig.name,
        consecutiveFailures: failures,
        lastError,
      });
    },
    onHealthRestored: () => {
      session.eventSystem.addEvent("server_health_restored", serverConfig.name, {
        name: serverConfig.name,
      });
    },
  });

  // ... rest of connection logic ...
}

private handleBackendDisconnect(session, serverName): void {
  // Existing: fail tasks, reject pending requests

  // Check if server is still configured
  const serverConfig = this.serverConfigs.getConfig(serverName);
  if (serverConfig) {
    // Server still configured - MCPHttpClient will handle reconnection
    // Just emit the disconnect event
    session.eventSystem.addEvent("server_disconnected", serverName, {
      name: serverName,
      wasIntentional: false,
    });
  } else {
    // Server was removed - emit intentional disconnect
    session.eventSystem.addEvent("server_disconnected", serverName, {
      name: serverName,
      wasIntentional: true,
    });
  }
}
```

### Phase 4: Event System Updates

**File: `src/state/event-system.ts` or `src/types.ts`**

Add new event types:

```typescript
export type ProxyEventType =
  // Existing
  | "server_connected"
  | "server_disconnected"
  | "server_added"
  | "server_removed"
  // New reconnection events
  | "server_reconnecting"
  | "server_reconnected"
  // New health check events
  | "server_health_degraded"
  | "server_health_restored"
  // ... rest unchanged
```

### Phase 5: New reconnect_server Tool

**File: `src/server.ts`**

Add new tool:

```typescript
{
  name: "reconnect_server",
  description: "Force reconnection to a backend server. Works on connected, disconnected, or reconnecting servers.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Server name" }
    },
    required: ["name"]
  }
}

// Handler
case "reconnect_server": {
  const name = args.name as string;
  const connection = session.getConnection(name);

  if (!connection) {
    // Check if server is configured but not connected
    const config = this.serverConfigs.getConfig(name);
    if (!config) {
      throw new Error(`Server '${name}' not found`);
    }
    // Connect from scratch
    await this.sessionManager.getOrCreateConnection(sessionId, name);
  } else {
    // Force reconnect on existing connection
    await connection.client.forceReconnect();
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ success: true, status: "connected" }) }]
  };
}
```

### Phase 6: Update list_servers Response

**File: `src/server.ts`**

Enhance the response:

```typescript
case "list_servers": {
  const servers = this.sessionManager.listServers(sessionId);
  return {
    content: [{
      type: "text",
      text: JSON.stringify(servers.map(s => ({
        ...s,
        // Add reconnection info if reconnecting
        ...(s.status === "reconnecting" && {
          reconnectAttempt: connection?.client.getReconnectionState()?.attempt,
          nextRetryMs: connection?.client.getReconnectionState()?.nextRetryMs,
        }),
        // Add health info if connected
        ...(s.status === "connected" && {
          healthStatus: connection?.client.getHealthStatus(),
          consecutiveHealthFailures: connection?.client.getConsecutiveHealthFailures(),
        }),
      })))
    }]
  };
}
```

### Phase 7: Update execute_tool for Reconnecting Servers

**File: `src/server.ts`**

Handle reconnecting state:

```typescript
case "execute_tool": {
  const serverName = args.server as string;
  let client: MCPHttpClient;

  try {
    client = await this.sessionManager.getOrCreateConnection(sessionId, serverName);
  } catch (error) {
    const connection = session.getConnection(serverName);
    if (connection?.status === "reconnecting") {
      // Attempt immediate reconnection
      try {
        await connection.client.forceReconnect();
        client = connection.client;
      } catch (reconnectError) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: `Server '${serverName}' is reconnecting`,
              status: "reconnecting",
              lastAttempt: connection.client.getReconnectionState()?.attempt,
              nextRetryMs: connection.client.getReconnectionState()?.nextRetryMs,
              lastError: reconnectError.message,
            })
          }],
          isError: true,
        };
      }
    } else {
      throw error;
    }
  }

  // ... execute tool ...
}
```

## Detailed State Machine

```
                                    ┌─────────────┐
                                    │   (start)   │
                                    └──────┬──────┘
                                           │ add_server
                                           ▼
                                    ┌─────────────┐
                              ┌─────│ connecting  │─────┐
                              │     └─────────────┘     │
                         success                    error/timeout
                              │                         │
                              ▼                         │
                       ┌─────────────┐                  │
          ┌───────────▶│  connected  │◀─────────────────┤
          │            └──────┬──────┘                  │
          │                   │                         │
          │      transport disconnect                   │
          │      (unexpected)                           │
          │                   │                         │
     reconnect                ▼                         │
     success           ┌─────────────┐                  │
          │            │reconnecting │──────────────────┘
          └────────────│             │  retry (with backoff)
                       └──────┬──────┘
                              │
                        remove_server
                        (any state)
                              │
                              ▼
                       ┌─────────────┐
                       │disconnected │
                       │(terminated) │
                       └─────────────┘
```

**Key transitions:**
- `connecting` → `connected`: Initial connection succeeds
- `connecting` → `reconnecting`: Initial connection fails, start retry loop
- `connected` → `reconnecting`: Transport disconnect detected
- `reconnecting` → `connected`: Reconnection attempt succeeds
- `reconnecting` → `reconnecting`: Reconnection attempt fails, schedule retry
- Any state → `disconnected`: `remove_server` called (intentional disconnect)

## Edge Cases

### 1. Server Restarts with Different Capabilities

After reconnection:
1. Fetch new capabilities from `initialize` response
2. Include capabilities in `server_reconnected` event
3. Client can compare with previous capabilities if they care

Note: The backend's tool/resource/prompt lists may have changed. If the server supports `listChanged` notifications, it will send those after we reconnect. We don't need to diff these ourselves.

### 2. Multiple Rapid Restarts

Reconnection logic should:
- Cancel any pending reconnection timeout before starting a new one
- Only one reconnection attempt in flight at a time
- Reset backoff counter on success

### 3. Server Permanently Down

Since we retry forever:
1. Status stays `reconnecting`
2. Backoff maxes out at 180 seconds
3. Events continue to be emitted periodically (`server_reconnecting`)
4. User can `remove_server` to stop attempts
5. Or `reconnect_server` to reset backoff and try immediately

### 4. Session Ends During Reconnection

When session cleanup happens:
1. Cancel any pending reconnection timeouts
2. Don't emit events (session is ending anyway)
3. Clean up resources normally
4. Stop health check timer

### 5. Server Removed During Reconnection

When `remove_server` is called for a reconnecting server:
1. Cancel reconnection attempts
2. Cancel health check timer
3. Status becomes `disconnected` (intentional)
4. Remove connection from session
5. Emit `server_disconnected` with `wasIntentional: true`

### 6. Tool Call During Reconnection

When `execute_tool` is called for a reconnecting server:

**Behavior**:
1. Cancel scheduled background reconnection
2. Attempt immediate reconnection
3. If successful: execute the tool, return result
4. If failed: return error with reconnection status

```json
{
  "error": "Server 'minecraft' is reconnecting",
  "status": "reconnecting",
  "lastAttempt": 5,
  "nextRetryMs": 16000,
  "lastError": "Connection refused"
}
```

### 7. Health Check During Reconnection

Health checks are paused while in `reconnecting` state:
- No point checking health if we know connection is down
- Reconnection attempts serve as implicit health checks
- Health checks resume after successful reconnection

### 8. Computer Hibernation

When computer hibernates and wakes:
1. Scheduled reconnection timeout may fire immediately on wake
2. Existing SSE connections may be stale (transport will error)
3. Health checks may fail due to stale connections

The reconnection and health check systems handle this naturally:
- Transport errors trigger reconnection
- Health checks detect stale connections
- Exponential backoff prevents hammering during network recovery

### 9. Force Reconnect on Connected Server

When `reconnect_server` is called on a connected server:
1. Stop health check timer
2. Close existing transport gracefully
3. Create new transport and client
4. Re-initialize MCP session
5. Emit `server_disconnected` (wasIntentional: true) then `server_reconnected`
6. Resume health checks

This is useful for clearing stale state or testing.

## API Changes Summary

### New/Modified Types

```typescript
// Connection status (removed 'failed', unchanged otherwise)
type BackendConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "error";

// New event types
type ProxyEventType =
  | ... existing ...
  | "server_reconnecting"
  | "server_reconnected"
  | "server_health_degraded"
  | "server_health_restored";

// Extended server info in list_servers response
interface ServerInfo {
  name: string;
  url: string;
  status: BackendConnectionStatus;
  connected: boolean;
  connectedAt?: Date;
  lastError?: string;
  // New fields for reconnection status
  reconnectAttempt?: number;      // Current attempt number (if reconnecting)
  nextRetryMs?: number;           // Ms until next retry (if reconnecting)
  // New fields for health status
  healthStatus?: "healthy" | "degraded";
  consecutiveHealthFailures?: number;
}
```

### New Tool

```typescript
{
  name: "reconnect_server",
  description: "Force reconnection to a backend server",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" }
    },
    required: ["name"]
  }
}
```

## Testing Strategy

1. **Unit tests for reconnection logic**
   - Backoff calculation
   - Max retry behavior
   - State transitions

2. **Integration tests**
   - Start server, connect, kill server, verify events
   - Kill server, restart, verify reconnection
   - Kill server, exceed retries, verify failed state

3. **Daisy-chain testing** (per MCP_TESTING_GUIDE.md)
   - Test changes to emceepee via second emceepee instance
   - Restart backend through the chain
   - Verify reconnection works through the proxy

## Migration Notes

This is a non-breaking change:
- Existing tools continue to work
- New status values are additive
- New events are additional information
- Clients unaware of reconnection will see the same behavior as before (errors on tool calls, eventual success after reconnection)

Clients that want to leverage reconnection can:
- Subscribe to new events via `await_activity`
- Check `status` field in `list_servers` response
- React to `server_reconnected` event to refresh state

## Resolved Design Questions

1. **Should reconnection be configurable per-server?**
   → **No.** All servers get the same treatment: exponential backoff from 1s to 180s max, retry forever.

2. **Should we expose a "force reconnect now" tool?**
   → **Yes.** `reconnect_server` tool works on connected, disconnected, or reconnecting servers.

3. **Health check during connected state?**
   → **Yes.** Periodic `tools/list` every 120s (with jitter), 60s timeout. Health checks are **early warning only** - they emit events but don't trigger reconnection. Only actual tool call failures or transport disconnects trigger reconnection.

4. **Reconnection across proxy restart?**
   → **Already handled.** Auto-connect on session creation uses `ServerConfigRegistry` which is populated from config file.

## Open Questions

1. **Health check request type**: We proposed `tools/list`. Should we use `ping` if available, or a custom lightweight method? `tools/list` is universally available but could be heavy for servers with many tools.

2. **Event throttling for `server_reconnecting`**: With 180s max backoff, we'll emit ~480 events per day for a permanently down server. Is this too noisy? Should we reduce frequency after N attempts?

3. **Concurrent reconnection across sessions**: If multiple sessions are reconnecting to the same server, should they coordinate? Currently each session independently reconnects, which could mean multiple simultaneous connection attempts to the same URL.
