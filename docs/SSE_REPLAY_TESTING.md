# SSE Replay Testing Guide

Testing emceepee's SSE replay handling as both client and server using daisy-chained instances.

## Background

MCP uses SSE (Server-Sent Events) for server→client streaming. When an SSE connection drops and reconnects, the client sends a `Last-Event-ID` header to request replay of missed events. emceepee needs to:

1. **As server**: Track event IDs and replay missed events to reconnecting clients
2. **As client**: Send `Last-Event-ID` on reconnection to receive missed events

## Test Architecture

```
Claude Code ←SSE→ outer(8080) ←SSE→ inner(8081) ←SSE→ minecraft(3001)
```

This lets us test:
- **inner→outer**: emceepee as SSE server (outer receives from inner)
- **inner→minecraft**: emceepee as SSE client (inner receives from minecraft)

## Setup

```bash
# Terminal 1: Inner emceepee
PORT=8081 bun run dist/emceepee.js --log-level=debug > /tmp/inner.log 2>&1

# Terminal 2: Outer emceepee
PORT=8080 bun run dist/emceepee.js --log-level=debug > /tmp/outer.log 2>&1

# Terminal 3: Minecraft client
bun src/minecraft-client.ts --host=localhost --port=25565 --username=test --mcp-port=3001

# Connect the chain
mcp__emceepee__add_server(name="inner", url="http://localhost:8081/mcp")
mcp__emceepee__execute_tool(server="inner", tool="add_server", args={name:"minecraft", url:"http://localhost:3001/mcp"})
```

## Test 1: emceepee as SSE Server (Event Replay to Clients)

**Goal**: Verify outer emceepee replays events to Claude Code after SSE reconnection.

### Steps

1. **Generate events while connected**
   ```
   # Trigger events through the chain
   mcp__emceepee__execute_tool(server="inner", tool="execute_tool",
     args={server:"minecraft", tool:"send_chat", args:{message:"hello"}})
   ```

2. **Check event IDs**
   ```
   mcp__emceepee__await_activity(timeout_ms=1000)
   # Note the event IDs returned
   ```

3. **Simulate SSE disconnect/reconnect**
   - This happens automatically when Claude Code's connection drops
   - To force it: restart Claude Code session or wait for HTTP timeout

4. **Verify replay**
   - After reconnect, call `await_activity` with `last_event_id` from before disconnect
   - Should receive any events that occurred during disconnect

### What to Check
- Events have sequential IDs (ULIDs)
- `await_activity` with `last_event_id` returns only newer events
- No duplicate events after reconnection

## Test 2: emceepee as SSE Client (Receiving Replays)

**Goal**: Verify inner emceepee requests replay when reconnecting to minecraft.

### Steps

1. **Generate events on minecraft side**
   ```
   # Move player, take damage, etc. to generate notifications
   mcp__emceepee__execute_tool(server="inner", tool="execute_tool",
     args={server:"minecraft", tool:"move", args:{forward:true, duration_ms:1000}})
   ```

2. **Kill minecraft's SSE connection without killing the server**
   - This is tricky - need to interrupt network or kill just the SSE stream
   - Alternative: Use `tcpkill` or firewall rules temporarily

3. **Check inner emceepee logs**
   ```bash
   grep -i "last-event-id\|replay\|sse" /tmp/inner.log
   ```

4. **Verify reconnection requests replay**
   - Inner should send `Last-Event-ID` header
   - Should receive missed notifications

### What to Check
- `Last-Event-ID` header sent on reconnection
- Notifications received after reconnect include any missed during disconnect

## Test 3: End-to-End Event Propagation

**Goal**: Verify events flow correctly through the entire chain with replays.

### Steps

1. **Subscribe to events at outer level**
   ```
   mcp__emceepee__await_activity(timeout_ms=60000)  # Long wait
   ```

2. **In another session, generate minecraft events**
   - Player takes damage
   - Chat messages
   - Inventory changes

3. **Verify events arrive at outer**
   - Should see `notification` events from minecraft
   - Event chain: minecraft → inner (notification) → inner EventSystem → outer (via execute_tool response or await_activity)

## Test 4: Reconnection During Event Storm

**Goal**: Stress test replay under load.

### Steps

1. **Generate rapid events**
   ```bash
   # Script to rapidly send chat messages
   for i in {1..50}; do
     mcp__emceepee__execute_tool server=inner tool=execute_tool \
       args='{"server":"minecraft","tool":"send_chat","args":{"message":"test'$i'"}}'
     sleep 0.1
   done
   ```

2. **Kill and restart minecraft mid-stream**
   ```bash
   # After ~25 messages
   kill $(lsof -ti:3001)
   sleep 2
   # Restart minecraft
   ```

3. **Verify no events lost**
   - Check inner logs for reconnection
   - Verify all 50 events eventually received

## Key Files to Inspect

| File | What to Check |
|------|---------------|
| `/tmp/inner.log` | `server_reconnecting`, `server_reconnected`, notification events |
| `/tmp/outer.log` | Event IDs, `await_activity` responses |
| `src/client.ts` | SSE reconnection logic, `Last-Event-ID` handling |
| `src/server.ts` | Event storage, replay logic in transport |

## Current Limitations

1. **MCP SDK handles SSE internally** - emceepee uses `StreamableHTTPClientTransport` which may or may not implement `Last-Event-ID`
2. **Event storage** - EventSystem stores events but unclear if SDK uses them for replay
3. **Testing SSE specifically** - Hard to isolate SSE layer from HTTP layer

## Investigation Needed

Before testing, verify:

1. Does `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` send `Last-Event-ID`?
   ```bash
   grep -r "Last-Event-ID\|lastEventId" node_modules/@modelcontextprotocol/
   ```

2. Does `StreamableHTTPServerTransport` support event replay?
   ```bash
   grep -r "replay\|Last-Event-ID" node_modules/@modelcontextprotocol/
   ```

3. What events does minecraft MCP emit via SSE?
   - Notifications (resource changes, logs)
   - Check if it tracks event IDs

## Quick Verification Commands

```bash
# Check if SSE is being used
curl -N -H "Accept: text/event-stream" http://localhost:8081/mcp

# Check event system state
mcp__emceepee__execute_tool(server="inner", tool="await_activity", args={timeout_ms:100})

# Monitor logs in real-time
tail -f /tmp/inner.log | grep -E "(event|sse|reconnect)"
```
