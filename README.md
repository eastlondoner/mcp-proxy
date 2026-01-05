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
| `get_logs` | Get buffered log messages |

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
bun run build            # Production build
```

## License

MIT © Andrew Jefferson
