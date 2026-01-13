# emceepee

**Connect to any MCP server, anytime. Access the full MCP protocol through tools.**

[![npm version](https://img.shields.io/npm/v/emceepee.svg)](https://www.npmjs.com/package/emceepee)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

```bash
npx emceepee
```

## Why?

**Problem 1: Static connections.** Most MCP clients only connect to servers at startup. Want to connect to a new server mid-session? Restart everything.

**Problem 2: Incomplete protocol support.** MCP has rich features—resources, prompts, notifications, sampling, elicitations—but many clients only implement tools. Those features? Inaccessible.

**emceepee solves both.** It's a proxy that exposes the entire MCP protocol as tools. Any client that supports tool calling can now:

- Connect to new MCP servers dynamically
- Access resources and resource templates
- Use prompts
- Receive notifications and logs
- Handle sampling requests (bidirectional LLM calls)
- Handle elicitations (user input requests)

## Quick Start

### 1. Add to your MCP client

**Claude Code / Claude Desktop** (`.mcp.json`):
```json
{
  "mcpServers": {
    "emceepee": {
      "command": "npx",
      "args": ["emceepee"]
    }
  }
}
```

**Other clients** — point to the HTTP server:
```bash
npx emceepee-http  # runs on http://localhost:8080/mcp
```

### 2. Connect to servers mid-session

Ask your LLM:

> "Connect to http://localhost:3001/mcp and show me what it can do"

The LLM will use emceepee's tools to connect, explore, and interact with the server.

---

## How It Works

```
┌────────────┐     ┌───────────┐     ┌──────────────┐
│ MCP Client │────▶│ emceepee  │────▶│ MCP Server 1 │
│            │     │           │     └──────────────┘
│ (tools     │◀────│  (proxy)  │────▶┌──────────────┐
│   only)    │     │           │     │ MCP Server 2 │
└────────────┘     └───────────┘     └──────────────┘
```

emceepee exposes a **static set of tools** that never change. These tools provide access to the full MCP protocol, letting any tool-capable client use features it doesn't natively support.

## Tools

### Server Management
| Tool | Description |
|------|-------------|
| `add_server` | Connect to a backend MCP server |
| `remove_server` | Disconnect from a server |
| `list_servers` | List connected servers with status |

### Tools
| Tool | Description |
|------|-------------|
| `list_tools` | List tools from connected servers (with regex filtering) |
| `execute_tool` | Run a tool on a backend server |

### Resources
| Tool | Description |
|------|-------------|
| `list_resources` | List available resources |
| `list_resource_templates` | List resource templates |
| `read_resource` | Fetch a resource by URI |
| `subscribe_resource` | Subscribe to resource change notifications |
| `unsubscribe_resource` | Unsubscribe from resource change notifications |

### Prompts
| Tool | Description |
|------|-------------|
| `list_prompts` | List available prompts |
| `get_prompt` | Get a prompt with arguments |

### Notifications & Logs
| Tool | Description |
|------|-------------|
| `get_notifications` | Get buffered server notifications |
| `get_logs` | Get buffered log messages with source filtering |

The `get_logs` tool supports filtering by log source:
- `protocol`: MCP protocol messages and notifications
- `stderr`: Process stderr output (for stdio servers)
- `stdout`: Process stdout capture (for local HTTP servers)

Example: Get only protocol logs by excluding stderr/stdout:
```json
{ "exclude_sources": ["stderr", "stdout"] }
```

### Sampling (bidirectional LLM requests)
| Tool | Description |
|------|-------------|
| `get_sampling_requests` | Get pending requests from servers wanting LLM completions |
| `respond_to_sampling` | Send an LLM response back to the server |

### Elicitations (user input requests)
| Tool | Description |
|------|-------------|
| `get_elicitations` | Get pending requests for user input |
| `respond_to_elicitation` | Send user input back to the server |

### Tasks & Activity
| Tool | Description |
|------|-------------|
| `list_tasks` | List background tasks |
| `get_task` | Get task status |
| `cancel_task` | Cancel a running task |
| `await_activity` | Wait for server events (polling) |

### Timers
| Tool | Description |
|------|-------------|
| `set_timer` | Create a timer that fires after a duration |
| `list_timers` | List all timers |
| `get_timer` | Get timer details |
| `delete_timer` | Delete a timer (returns timer body) |

## Context Info

Every tool response may include additional context information as a second JSON text block. This provides real-time status without requiring explicit polling:

```json
{
  "content": [
    { "type": "text", "text": "Tool result here" },
    { "type": "text", "text": "{\"pending_client\":{\"sampling\":1,\"elicitation\":0},\"expired_timers\":[{\"id\":\"...\",\"message\":\"Check status\",\"expiredAt\":\"...\"}],\"notifications\":[...]}" }
  ]
}
```

**Context info fields:**

| Field | Description |
|-------|-------------|
| `pending_client.sampling` | Number of pending sampling requests (urgent - servers are blocked) |
| `pending_client.elicitation` | Number of pending elicitation requests (urgent - servers are blocked) |
| `expired_timers` | Timers that have fired since the last tool call (cleared after delivery) |
| `notifications` | Buffered notifications from backend servers (cleared after delivery) |

Context info is only included when there's something to report.

## Installation

```bash
# Run directly
npx emceepee

# Or install globally
npm install -g emceepee
```

## Usage

### stdio transport (Claude Code, Claude Desktop)

```bash
npx emceepee
```

### HTTP transport (web clients, custom integrations)

```bash
# Default port 8080
npx emceepee-http

# Custom port
PORT=9000 npx emceepee-http

# With pre-configured servers
npx emceepee-http --config servers.json
```

### Configuration File

Pre-configure backend servers:

```json
{
  "servers": [
    { "name": "myserver", "url": "http://localhost:3001/mcp" }
  ]
}
```

## Example Session

```
User: Connect to http://localhost:3001/mcp as "gameserver"

LLM: [uses add_server]
Connected to gameserver successfully.

User: What can it do?

LLM: [uses list_tools, list_resources, list_prompts]
gameserver has:
- 3 tools: screenshot, send_chat, move
- 2 resources: player_state, world_info
- 1 prompt: describe_scene

User: Get the player state

LLM: [uses read_resource with uri="minecraft://state"]
Player is at position (100, 64, -200), health: 18/20
```

## Development

```bash
bun install              # Install dependencies
bun run dev              # stdio server (development)
bun run dev:http         # HTTP server (development)
bun run check            # TypeScript + ESLint
bun run test             # Run tests
bun run build            # Production build
```

### Testing

The test suite includes integration tests for the stdio client:

```bash
bun run test             # Run all tests
bun run test:stdio       # Run stdio client tests specifically
```

Tests cover:
- Connection lifecycle (connect, disconnect)
- Tool listing and invocation
- Stderr capture with source indication
- Crash handling and automatic restart with exponential backoff
- Lifecycle events (process_started, crashed, restarting, restarted, stopped)

## License

MIT © Andrew Jefferson
