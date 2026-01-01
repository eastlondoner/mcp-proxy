# MCP Testing Guide

This guide covers how to use emceepee for testing MCP servers, including handling restarts and daisy-chaining for testing emceepee itself.

## Basic Setup

Start emceepee on the default port:

```bash
bun run dev
# or
PORT=8080 bun run dev
```

## Adding Backend Servers

Connect to MCP servers you want to test:

```bash
# Via the MCP tool
mcp__emceepee__add_server name="myserver" url="http://localhost:3001/mcp"
```

Or use a config file:

```json
// servers.json
{
  "servers": [
    { "name": "minecraft", "url": "http://localhost:3001/mcp" },
    { "name": "other", "url": "http://localhost:4000/mcp" }
  ]
}
```

```bash
bun run dev -- --config ./servers.json
```

## Testing Tools, Resources, and Prompts

```bash
# List available tools
mcp__emceepee__list_tools

# Filter by server or tool name (regex)
mcp__emceepee__list_tools server="minecraft" tool="screenshot"

# Execute a tool
mcp__emceepee__execute_tool server="minecraft" tool="look" args='{"yaw": 90}'

# List resources
mcp__emceepee__list_resources server="minecraft"

# List resource templates (parameterized resources)
mcp__emceepee__list_resource_templates server="minecraft"

# Read a resource (works with both static and templated URIs)
mcp__emceepee__read_resource server="minecraft" uri="minecraft://state"
mcp__emceepee__read_resource server="minecraft" uri="minecraft://block/0/64/0"

# List and get prompts
mcp__emceepee__list_prompts
mcp__emceepee__get_prompt server="minecraft" name="play_minecraft"
```

## Handling Server Restarts

When your backend MCP server restarts, the connection is lost. Reconnect by removing and re-adding:

```bash
mcp__emceepee__remove_server name="minecraft"
mcp__emceepee__add_server name="minecraft" url="http://localhost:3001/mcp"
```

Check connection status:

```bash
mcp__emceepee__list_servers
```

## Daisy-Chaining emceepee

Since you can't restart emceepee while connected to it, test new emceepee code by daisy-chaining:

```
[Claude] -> [emceepee:8080 (old)] -> [emceepee:8888 (new)] -> [your MCP server]
```

### Step 1: Start a new emceepee instance

```bash
PORT=8888 bun run src/server.ts &
```

### Step 2: Connect to the new instance

```bash
mcp__emceepee__add_server name="emceepee-new" url="http://localhost:8888/mcp"
```

### Step 3: Add your test server through the new instance

```bash
mcp__emceepee__execute_tool server="emceepee-new" tool="add_server" \
  args='{"name": "minecraft", "url": "http://localhost:3001/mcp"}'
```

### Step 4: Test the new emceepee's tools

```bash
# Test a new tool you added to emceepee
mcp__emceepee__execute_tool server="emceepee-new" tool="list_resource_templates" \
  args='{"server": "minecraft"}'

# Execute tools on the backend through the chain
mcp__emceepee__execute_tool server="emceepee-new" tool="execute_tool" \
  args='{"server": "minecraft", "tool": "screenshot", "args": {}}'
```

### Step 5: Clean up

Kill the test instance when done:

```bash
pkill -f "PORT=8888"
# or
mcp__emceepee__remove_server name="emceepee-new"
```

## Testing Sampling and Elicitation

Backend servers can request LLM completions (sampling) or user input (elicitation):

```bash
# Check for pending requests
mcp__emceepee__get_sampling_requests
mcp__emceepee__get_elicitations

# Respond to sampling
mcp__emceepee__respond_to_sampling \
  request_id="abc123" \
  role="assistant" \
  content="Here's my response" \
  model="claude-3"

# Respond to elicitation
mcp__emceepee__respond_to_elicitation \
  request_id="def456" \
  action="accept" \
  content='{"field1": "value1"}'
```

## Monitoring Activity

Wait for events instead of polling:

```bash
# Block until activity or timeout
mcp__emceepee__await_activity timeout_ms=30000

# Get notifications and logs from backends
mcp__emceepee__get_notifications
mcp__emceepee__get_logs
```

## Debugging

### Waterfall UI

View request timings at `http://localhost:8080/waterfall`

### Log Levels

```bash
bun run dev -- --log-level=debug
```

### stdio Mode

For testing with stdio transport:

```bash
bun run dev:stdio -- --config ./servers.json --log-file=/tmp/emceepee.log
```

## Quick Reference

| Task | Command |
|------|---------|
| Add server | `add_server name="x" url="http://..."` |
| Remove server | `remove_server name="x"` |
| List servers | `list_servers` |
| List tools | `list_tools` |
| Execute tool | `execute_tool server="x" tool="y" args={...}` |
| List resources | `list_resources` |
| List templates | `list_resource_templates` |
| Read resource | `read_resource server="x" uri="..."` |
| Wait for activity | `await_activity timeout_ms=30000` |
