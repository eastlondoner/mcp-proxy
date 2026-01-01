# Bug Report: Backend MCP Server Reconnection

## Summary

emceepee does not automatically reconnect to backend MCP servers after they restart. When a backend server restarts, subsequent tool calls fail with connection errors until the server is manually removed and re-added.

## Current Behavior

1. Connect emceepee to a backend MCP server (e.g., minecraft on port 3001)
2. Verify connection works (list_tools, execute_tool, etc.)
3. Restart the backend MCP server
4. Attempt to use the connection - **fails with error**

### Observed Errors

After backend restart, tool calls return errors like:
- `"Failed to execute tool: ...connection refused..."`
- `"Server 'minecraft' not found"` (if connection state was corrupted)

### Current Workaround

Manually remove and re-add the server:

```bash
mcp__emceepee__remove_server name="minecraft"
mcp__emceepee__add_server name="minecraft" url="http://localhost:3001/mcp"
```

## Desired Behavior

emceepee should automatically detect when a backend connection is lost and attempt to reconnect:

1. On connection error, mark the server as "disconnected" or "reconnecting"
2. Attempt reconnection with exponential backoff
3. Re-establish the MCP session (send initialize, etc.)
4. Resume normal operation once reconnected
5. Optionally notify the client that reconnection occurred

## Reproduction Steps

### Using Daisy-Chaining (recommended for testing emceepee changes)

This method lets you test new emceepee code without restarting the emceepee you're connected to:

```bash
# Terminal 1: Start a test emceepee instance
PORT=9999 bun run src/server.ts

# In Claude/MCP client: Connect to the test instance
mcp__emceepee__add_server name="emceepee-test" url="http://localhost:9999/mcp"

# Through the test instance: Add your backend server
mcp__emceepee__execute_tool server="emceepee-test" tool="add_server" \
  args='{"name": "minecraft", "url": "http://localhost:3001/mcp"}'

# Verify it works
mcp__emceepee__execute_tool server="emceepee-test" tool="list_tools" \
  args='{"server": "minecraft"}'

# Terminal 2: Restart the minecraft server
# (kill and restart minecraft MCP on port 3001)

# Try to use the connection again - THIS SHOULD WORK but currently fails
mcp__emceepee__execute_tool server="emceepee-test" tool="list_tools" \
  args='{"server": "minecraft"}'
```

### Direct Testing

```bash
# Start emceepee
bun run dev

# In another terminal, start your backend MCP server
# (e.g., minecraft client with MCP on port 3001)

# Connect to the backend
mcp__emceepee__add_server name="minecraft" url="http://localhost:3001/mcp"

# Verify connection
mcp__emceepee__list_servers
# Should show: status: "connected"

# Restart the backend server (kill and restart)

# Try to use it
mcp__emceepee__execute_tool server="minecraft" tool="screenshot" args='{}'
# FAILS - should auto-reconnect instead
```

## Technical Notes

### Relevant Files

- `src/client.ts` - `HttpMcpClient` class handles backend connections
- `src/session/session-state.ts` - `SessionState` manages per-session connections
- `src/session/session-manager.ts` - `SessionManager` creates/destroys sessions

### Connection State

The `HttpMcpClient` tracks connection status but doesn't implement reconnection:

```typescript
interface BackendConnection {
  client: HttpMcpClient;
  status: "connecting" | "connected" | "disconnected" | "error";
  connectedAt?: Date;
  lastError?: string;
}
```

### Potential Implementation Approach

1. **Detection**: Wrap tool/resource calls in try-catch, detect connection errors
2. **State Update**: Mark connection as "reconnecting"
3. **Reconnection Logic**:
   - Close existing transport
   - Create new transport and client
   - Re-initialize MCP session
   - Retry the failed operation
4. **Backoff**: Use exponential backoff for repeated failures
5. **Notification**: Emit event/notification when reconnection succeeds/fails

### Edge Cases to Consider

- Server restarts with different capabilities
- Server restarts with different tools/resources
- Multiple rapid restarts
- Server permanently down vs temporary restart
- In-flight requests during disconnect
- Session state that depends on server state

## Priority

Medium-High - This significantly impacts usability when developing/testing MCP servers, as servers frequently restart during development.

## Related

- [MCP_TESTING_GUIDE.md](../MCP_TESTING_GUIDE.md) - Documents current workarounds
