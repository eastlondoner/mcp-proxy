# emceepee Architecture

This document provides a comprehensive overview of emceepee's architecture, design patterns, and internal workings.

## Overview

**emceepee** is an MCP (Model Context Protocol) proxy server that exposes the full MCP protocol through a static set of tools. It enables any tool-capable client to dynamically connect to and interact with multiple backend MCP servers, even if the client doesn't natively support MCP features like resources, prompts, sampling, or elicitations.

```
┌────────────┐     ┌───────────┐     ┌──────────────┐
│ MCP Client │────▶│ emceepee  │────▶│ MCP Server 1 │
│            │     │           │     └──────────────┘
│ (tools     │◀────│  (proxy)  │────▶┌──────────────┐
│   only)    │     │           │     │ MCP Server 2 │
└────────────┘     └───────────┘     └──────────────┘
```

## Project Structure

```
emceepee/
├── src/
│   ├── server.ts              # HTTP MCP server with Session Manager
│   ├── server-stdio.ts        # Stdio MCP server (single-session)
│   ├── client.ts              # HTTP MCP client wrapper (MCPHttpClient)
│   ├── stdio-client.ts        # Stdio MCP client wrapper (MCPStdioClient)
│   ├── client-interface.ts    # Common IMCPClient interface
│   ├── types.ts               # Shared type definitions
│   ├── logging.ts             # Structured logging interface
│   ├── request-tracker.ts     # Request tracking for diagnostics
│   ├── waterfall-ui.ts        # Waterfall HTML/JSON generation
│   ├── session/               # Session management
│   │   ├── index.ts
│   │   ├── session-manager.ts # Central session manager
│   │   ├── session-state.ts   # Per-session state container
│   │   ├── server-config.ts   # Shared server configuration registry
│   │   └── sse-event-store.ts # Transport-level SSE event store
│   └── state/                 # Per-session state modules
│       ├── index.ts
│       ├── event-system.ts    # Event storage & delivery
│       ├── task-manager.ts    # Timeout-promoted task tracking
│       ├── pending-requests.ts # Sampling/elicitation management
│       ├── buffer-manager.ts  # Notification/log buffering
│       └── timer-manager.ts   # Timer scheduling
├── test/
├── docs/
├── package.json
└── tsconfig.json
```

## Core Components

### 1. Entry Points

emceepee provides two server variants:

#### HTTP Server (`server.ts`)
- **Transport:** HTTP with Server-Sent Events (SSE)
- **Architecture:** Multi-session with per-session isolation
- **Endpoints:**
  - `POST /mcp` → Initialize session (creates mcp-session-id)
  - `GET /mcp` → SSE stream for events/notifications
- **Use Case:** Web clients, custom integrations

#### Stdio Server (`server-stdio.ts`)
- **Transport:** stdin/stdout JSON-RPC
- **Architecture:** Single session per process
- **Use Case:** Claude Code, Claude Desktop, CLI tools

Both expose the same static set of 30+ tools.

### 2. Session Manager

**File:** `src/session/session-manager.ts`

The SessionManager is the central orchestrator for client session lifecycle:

```typescript
class SessionManager {
  createSession(): string           // Creates new session with ULID
  getSession(id: string): SessionState
  addServer(sessionId, name, url)   // Adds config globally, connects session
  removeServer(name)                // Removes config globally
  destroySession(id)                // Cleanup and destroy
}
```

**Key Responsibilities:**
- Session creation with unique ULID identifiers
- Auto-connecting new sessions to configured servers
- Broadcasting events to all sessions when needed
- Session timeout and cleanup

### 3. Session State

**File:** `src/session/session-state.ts`

Each client session has its own isolated state container:

```typescript
interface SessionState {
  backendConnections: Map<string, IMCPClient>  // Per-session connections
  eventSystem: EventSystem                      // Per-session events
  taskManager: TaskManager                      // Timeout-promoted tasks
  pendingRequests: PendingRequestsManager       // Elicitations/sampling
  bufferManager: BufferManager                  // Notifications/logs
  timerManager: TimerManager                    // User timers
}
```

This per-session isolation ensures:
- Clean elicitation routing (elicitations go to the right session)
- No state leakage between clients
- Independent lifecycles

### 4. Server Configuration Registry

**File:** `src/session/server-config.ts`

Server configurations are shared globally while connections are per-session:

```typescript
class ServerConfigRegistry {
  addConfig(name, config)     // Register server config (HTTP or stdio)
  getConfig(name): ServerConfig
  listConfigs(): ServerConfig[]
  removeConfig(name)          // Remove globally
}
```

This separation allows:
- Multiple clients to connect to the same backend independently
- Global configuration management via any session
- Per-session connection lifecycle

## State Management System

emceepee categorizes state into four categories with different delivery semantics:

### Category 1: Events (Exactly-Once Delivery)

**File:** `src/state/event-system.ts`

Events represent things that happened and need exactly-once delivery:

| Event Type | Description |
|------------|-------------|
| `task_created` | Tool call promoted to task due to timeout |
| `task_completed` | Background task finished successfully |
| `task_failed` | Background task failed |
| `elicitation_request` | New elicitation arrived from backend |
| `sampling_request` | New sampling request arrived |
| `notification` | MCP notification from backend |
| `timer_expired` | User-created timer fired |
| `server_connected` | Backend connection established |
| `server_disconnected` | Backend connection lost |

**Delivery Mechanism:**
- Events tracked via `lastDeliveredId` cursor
- `getNewEvents()` returns undelivered events and marks as delivered
- Events included in `await_activity` responses and any tool response

### Category 2: Logs (On-Demand Only)

**File:** `src/state/buffer-manager.ts`

Logs are verbose and retrieved only when explicitly requested:

- Ring buffer per server (500 entries max)
- Retrieved via `get_logs` tool
- Sources: `protocol`, `stderr`, `stdout`
- Not included in regular tool responses

### Category 3: Pending-Waiting-On-Server

**File:** `src/state/task-manager.ts`

Tasks that are running on backend servers:

- Created when tool calls exceed timeout (2 min default)
- States: `working` → `completed` | `failed` | `cancelled` | `expired`
- Included in `await_activity` and `execute_tool` timeout responses

### Category 4: Pending-Waiting-On-Client

**File:** `src/state/pending-requests.ts`

Requests from backends waiting for client response:

- **Elicitations:** User input requests
- **Sampling:** LLM completion requests
- Included in ALL tool responses (constant visibility)
- 10 minute timeout per request

## Client Wrappers

### MCPHttpClient

**File:** `src/client.ts`

Wraps MCP SDK client for HTTP connections:

```typescript
class MCPHttpClient implements IMCPClient {
  connect(): Promise<void>
  disconnect(): Promise<void>
  callTool(name, args): Promise<CallToolResult>
  listTools(): Promise<Tool[]>
  // ... other MCP operations
}
```

**Features:**
- Automatic reconnection with exponential backoff (1s → 180s)
- Health checks (every 2 min, degrade after 3 failures)
- Notification/log/sampling/elicitation callbacks

### MCPStdioClient

**File:** `src/stdio-client.ts`

Manages MCP servers as child processes:

```typescript
class MCPStdioClient implements IStdioClient {
  connect(): Promise<void>    // Spawns process
  disconnect(): Promise<void> // Terminates process
  // ... same MCP operations
}
```

**Features:**
- Automatic crash recovery with exponential backoff
- Stderr capture for debugging
- Lifecycle events: `process_started`, `process_crashed`, `restarting`, etc.
- Configurable restart behavior

## Data Flow

### Tool Execution Flow

```
Client Request
    ↓
Tool Handler (identified by name)
    ↓
Session Resolution (mcp-session-id)
    ↓
Operation (e.g., execute_tool calls backend)
    ↓
Timeout Handling:
  • Start timeout (default 2 minutes)
  • If completes: return result immediately
  • If timeout: promote to Task, return task info
    ↓
Response + Context Info
```

### Event Delivery Flow

```
Backend Event (notification, sampling request, etc.)
    ↓
Client Callback (onNotification, onSamplingRequest, etc.)
    ↓
EventSystem.addEvent() or PendingRequestsManager.add*Request()
    ↓
Wake await_activity waiters
    ↓
get_notifications() or await_activity() tool call
    ↓
getNewEvents() returns undelivered events (marks as delivered)
    ↓
Response with Context Info
```

### Session Lifecycle

```
1. Client Connects
   └─ POST /mcp (initialize)
      ├─ SessionManager.createSession()
      ├─ Create SessionState (EventSystem, TaskManager, etc.)
      ├─ Auto-connect to all configured servers
      └─ Return session ID (mcp-session-id header)

2. Client Uses Session
   ├─ Tool calls include mcp-session-id
   ├─ SSE stream for events
   └─ State accumulates in SessionState

3. Session Timeout
   └─ Cleanup timer fires
      ├─ Disconnect all backends
      ├─ Reject pending requests
      └─ Remove session
```

## Tool API

### Server Management
| Tool | Description |
|------|-------------|
| `add_server` | Connect to HTTP or spawn stdio backend |
| `remove_server` | Disconnect from server |
| `list_servers` | List connected servers with status |

### Tool Operations
| Tool | Description |
|------|-------------|
| `list_tools` | List tools with regex filtering |
| `execute_tool` | Run tool on backend (with timeout) |

### Resources
| Tool | Description |
|------|-------------|
| `list_resources` | List available resources |
| `list_resource_templates` | List resource templates |
| `read_resource` | Fetch resource by URI |

### Prompts
| Tool | Description |
|------|-------------|
| `list_prompts` | List available prompts |
| `get_prompt` | Get prompt with arguments |

### Async State
| Tool | Description |
|------|-------------|
| `get_notifications` | Get buffered notifications |
| `get_logs` | Get logs with source filtering |
| `await_activity` | Wait for any event (efficient polling) |

### Sampling & Elicitations
| Tool | Description |
|------|-------------|
| `get_sampling_requests` | Pending LLM completion requests |
| `respond_to_sampling` | Send LLM response |
| `get_elicitations` | Pending user input requests |
| `respond_to_elicitation` | Send user input |

### Tasks
| Tool | Description |
|------|-------------|
| `list_tasks` | List timeout-promoted tasks |
| `get_task` | Get task details |
| `cancel_task` | Cancel running task |

### Timers
| Tool | Description |
|------|-------------|
| `set_timer` | Create timer with duration |
| `list_timers` | List all timers |
| `get_timer` | Get timer details |
| `delete_timer` | Delete timer |

## Design Patterns

### 1. Per-Session Isolation

Each session gets dedicated backend connections and state:

```
┌─────────────────────────────────────────────────────────┐
│                    Shared Infrastructure                 │
│  ┌─────────────────────┐                                │
│  │ ServerConfigRegistry│  (global configs)              │
│  └─────────────────────┘                                │
└─────────────────────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   ┌────────────┐  ┌────────────┐  ┌────────────┐
   │ Session A  │  │ Session B  │  │ Session C  │
   │ ├─ Clients │  │ ├─ Clients │  │ ├─ Clients │
   │ ├─ Events  │  │ ├─ Events  │  │ ├─ Events  │
   │ ├─ Tasks   │  │ ├─ Tasks   │  │ ├─ Tasks   │
   │ └─ Buffers │  │ └─ Buffers │  │ └─ Buffers │
   └────────────┘  └────────────┘  └────────────┘
```

### 2. Timeout-Based Task Promotion

Tool calls wait for completion up to a timeout:

```
execute_tool(timeout_ms=120000)
         │
         ▼
   ┌───────────┐
   │ In-Flight │
   └─────┬─────┘
         │
    ┌────┴────┐
    ▼         ▼
Completes   Timeout
 within      expires
 timeout        │
    │           ▼
    │    ┌──────────┐
    │    │  Task    │
    │    │ Created  │
    │    └────┬─────┘
    │         │
    ▼         ▼
Direct    Task info
result    + context
```

### 3. Exactly-Once Event Delivery

EventSystem tracks delivery via cursor:

```typescript
class EventSystem {
  private events: StoredEvent[] = [];
  private lastDeliveredId: string | null = null;

  addEvent(type, server, data): string {
    const id = ulid();
    this.events.push({ id, type, server, data, createdAt: new Date() });
    this.wakeWaiters(); // Wake await_activity
    return id;
  }

  getNewEvents(): StoredEvent[] {
    // Filter events after lastDeliveredId
    // Update lastDeliveredId to newest
    // Return new events
  }
}
```

### 4. Context Info Metadata

Every tool response may include a second JSON block with context:

```json
{
  "content": [
    { "type": "text", "text": "{\"servers\": [...]}" },
    { "type": "text", "text": "{\"pending_client\":{\"sampling\":1},\"expired_timers\":[...],\"notifications\":[...]}" }
  ]
}
```

This provides real-time status without explicit polling.

### 5. Ring Buffers for Bounded Memory

Notifications and logs use fixed-size buffers:

- 100 notifications per server
- 500 logs per server
- Oldest entries evicted when limit reached

### 6. Exponential Backoff with Jitter

Reconnection and restart use exponential backoff:

```typescript
{
  baseDelayMs: 1000,      // Start at 1s
  maxDelayMs: 60000,      // Cap at 60s
  backoffMultiplier: 2,   // Double each time
  jitter: 0.1             // 10% random variation
}
```

## Configuration

### File-Based Configuration

```json
{
  "servers": [
    {
      "name": "remote",
      "url": "http://localhost:3001/mcp"
    },
    {
      "name": "local",
      "type": "stdio",
      "command": "node",
      "args": ["server.js"],
      "env": { "DEBUG": "true" },
      "restartConfig": {
        "maxAttempts": 5,
        "baseDelayMs": 1000
      }
    }
  ]
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP server port (default: 8080) |

### Configurable Limits

| Component | Setting | Default |
|-----------|---------|---------|
| EventSystem | Max events | 1000 |
| EventSystem | Event retention | 30 min |
| TaskManager | Task TTL | 10 min |
| TaskManager | Completed retention | 5 min |
| PendingRequests | Request timeout | 10 min |
| BufferManager | Max notifications | 100/server |
| BufferManager | Max logs | 500/server |
| TimerManager | Max active timers | 100 |
| TimerManager | Max timer duration | 24 hours |

## Dependencies

**Production:**
- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `ulid` - Time-sortable unique IDs
- `zod` - TypeScript-first schema validation

**Development:**
- `typescript` - TypeScript compiler
- `eslint` + `typescript-eslint` - Linting
- `bun` - Build tool and runtime

## Key Design Insights

1. **Session Isolation is Key** - Each client session has its own EventSystem and backend connections, preventing state leakage.

2. **Timeout-Based Task Promotion** - Avoids blocking clients while allowing async tracking of long-running operations.

3. **Context Info Metadata** - Appended to every tool response to provide real-time status without requiring explicit polling.

4. **Exactly-Once Delivery** - EventSystem tracks delivery cursor to ensure events are delivered once and only once via tool responses.

5. **Shared Configs, Per-Session Connections** - Allows multiple clients to connect to same backend independently with global configuration management.

6. **Decoupled Elicitations** - We don't try to correlate elicitations to specific tool calls (unreliable without MCP Tasks). Instead, all pending elicitations are surfaced alongside task info.

7. **Transport vs Application Events** - SSEEventStore handles JSON-RPC message replay (transport concern); EventSystem handles domain events (application concern).

## Related Documents

- `SESSION_STATE_DESIGN.md` - Detailed session state management design
- `TASKS_AND_ELICITATIONS.md` - Task promotion and elicitation handling
- `IMPROVING_FACTORING_PLAN.md` - Implementation architecture notes
- `docs/BACKEND_RECONNECTION_DESIGN.md` - Reconnection strategy
- `MCP_TESTING_GUIDE.md` - Testing through emceepee
