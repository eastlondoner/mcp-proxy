# emceepee

An MCP (Model Context Protocol) proxy server that provides a static tool interface for dynamically managing and interacting with multiple backend MCP servers.

## Problem

Claude's tool schema is injected at conversation start and doesn't update mid-conversation, even when MCP servers send `notifications/tools/list_changed`. This prevents Claude from discovering dynamically-added tools.

## Solution

emceepee provides a **static set of meta-tools** that allow Claude to:

- Dynamically add/remove backend MCP servers at runtime
- Discover tools, resources, and prompts from any connected backend
- Execute tools on backends by name
- Fetch resources and prompts from backends

## Installation

```bash
npm install emceepee
# or
bun add emceepee
```

## Usage

### Starting the Server

```bash
# Default port 8080
npx emceepee

# Custom port
PORT=9000 npx emceepee

# With initial backend servers
npx emceepee --config ./servers.json
```

### Configuration File

```json
{
  "servers": [
    { "name": "minecraft", "url": "http://localhost:3001/mcp" },
    { "name": "other", "url": "http://localhost:4000/mcp" }
  ]
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `add_server` | Connect to a backend MCP server (name, url) |
| `remove_server` | Disconnect from a backend server |
| `list_servers` | List all connected backend servers with status |
| `list_tools` | List tools from one or all backends |
| `execute_tool` | Call a tool on a specific backend server |
| `list_resources` | List resources from one or all backends |
| `get_resource` | Fetch a specific resource from a backend |
| `list_prompts` | List prompts from one or all backends |
| `get_prompt` | Get a specific prompt from a backend |
| `get_notifications` | Get buffered notifications from backends |

## Example

```typescript
// 1. Add a backend server
execute_tool("add_server", { name: "minecraft", url: "http://localhost:3001/mcp" })

// 2. Discover what tools it has
execute_tool("list_tools", { server: "minecraft" })

// 3. Execute a tool on the backend
execute_tool("execute_tool", {
  server: "minecraft",
  tool: "screenshot",
  args: {}
})
```

## Architecture

```
┌─────────┐     ┌───────────┐     ┌─────────────────┐
│  Claude │────▶│ emceepee  │────▶│ Backend MCP     │
│         │     │           │     │ Server 1        │
│         │     │ Static    │     └─────────────────┘
│         │◀────│ Tools     │────▶┌─────────────────┐
│         │     │           │     │ Backend MCP     │
└─────────┘     └───────────┘     │ Server 2        │
                                  └─────────────────┘
```

## Development

```bash
# Install dependencies
bun install

# Run in development
bun run dev

# Type check
bun run typecheck

# Lint
bun run lint

# Run all checks
bun run check

# Build for production
bun run build
```

## License

MIT
