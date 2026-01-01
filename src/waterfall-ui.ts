/**
 * Waterfall UI
 *
 * Serves a simple HTML page showing request waterfall diagrams per session.
 * Auto-refreshes to show live data.
 */

import type { RequestTracker, TrackedRequest } from "./request-tracker.js";

/**
 * Generate the waterfall HTML page.
 */
export function generateWaterfallHTML(tracker: RequestTracker): string {
  const requestsBySession = tracker.getRequestsBySession();
  const stats = tracker.getStats();

  // Find the time range for scaling
  let minTime = Infinity;
  let maxTime = 0;
  for (const requests of requestsBySession.values()) {
    for (const req of requests) {
      minTime = Math.min(minTime, req.startedAt.getTime());
      const endTime = req.endedAt?.getTime() ?? Date.now();
      maxTime = Math.max(maxTime, endTime);
    }
  }

  // If no requests, set reasonable defaults
  if (minTime === Infinity) {
    minTime = Date.now() - 60000;
    maxTime = Date.now();
  }

  const timeRange = Math.max(maxTime - minTime, 1000); // At least 1 second

  return `<!DOCTYPE html>
<html>
<head>
  <title>MCP Proxy - Request Waterfall</title>
  <meta http-equiv="refresh" content="2">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #1a1a2e;
      color: #eee;
      padding: 20px;
    }
    h1 { margin-bottom: 10px; color: #00d4ff; }
    .stats {
      display: flex;
      gap: 20px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .stat {
      background: #16213e;
      padding: 10px 15px;
      border-radius: 8px;
      border: 1px solid #0f3460;
    }
    .stat-label { font-size: 12px; color: #888; }
    .stat-value { font-size: 24px; font-weight: bold; color: #00d4ff; }
    .session {
      background: #16213e;
      border-radius: 8px;
      margin-bottom: 15px;
      border: 1px solid #0f3460;
      overflow: hidden;
    }
    .session-header {
      background: #0f3460;
      padding: 10px 15px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .session-id {
      font-family: monospace;
      font-size: 12px;
      color: #00d4ff;
    }
    .session-count {
      font-size: 12px;
      color: #888;
    }
    .waterfall {
      padding: 10px;
      position: relative;
      min-height: 50px;
    }
    .timeline {
      position: absolute;
      top: 0;
      left: 150px;
      right: 10px;
      height: 100%;
      border-left: 1px dashed #333;
    }
    .timeline-markers {
      position: absolute;
      top: 0;
      left: 150px;
      right: 10px;
      height: 20px;
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: #666;
      padding: 0 5px;
    }
    .request-row {
      display: flex;
      align-items: center;
      height: 28px;
      margin-bottom: 2px;
    }
    .request-name {
      width: 140px;
      font-size: 11px;
      padding-right: 10px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex-shrink: 0;
    }
    .request-bar-container {
      flex: 1;
      position: relative;
      height: 20px;
    }
    .request-bar {
      position: absolute;
      height: 16px;
      top: 2px;
      border-radius: 3px;
      min-width: 2px;
      display: flex;
      align-items: center;
      padding: 0 4px;
      font-size: 10px;
      color: #fff;
      text-shadow: 0 0 2px rgba(0,0,0,0.5);
    }
    .request-bar.pending { background: #f39c12; animation: pulse 1s infinite; }
    .request-bar.completed { background: #27ae60; }
    .request-bar.failed { background: #e74c3c; }
    .request-bar.timeout { background: #9b59b6; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
    .request-duration {
      position: absolute;
      right: -45px;
      font-size: 10px;
      color: #888;
      width: 40px;
    }
    .type-badge {
      font-size: 9px;
      padding: 1px 4px;
      border-radius: 3px;
      background: rgba(0,0,0,0.3);
      margin-right: 4px;
    }
    .no-requests {
      color: #666;
      font-style: italic;
      padding: 20px;
      text-align: center;
    }
    .legend {
      display: flex;
      gap: 15px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
    }
    .legend-color {
      width: 12px;
      height: 12px;
      border-radius: 2px;
    }
    .legend-color.pending { background: #f39c12; }
    .legend-color.completed { background: #27ae60; }
    .legend-color.failed { background: #e74c3c; }
    .legend-color.timeout { background: #9b59b6; }
  </style>
</head>
<body>
  <h1>🔀 MCP Proxy - Request Waterfall</h1>

  <div class="stats">
    <div class="stat">
      <div class="stat-label">Total Requests</div>
      <div class="stat-value">${String(stats.totalRequests)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Sessions</div>
      <div class="stat-value">${String(stats.sessionCount)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Pending</div>
      <div class="stat-value">${String(stats.byStatus.pending)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Completed</div>
      <div class="stat-value">${String(stats.byStatus.completed)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Failed</div>
      <div class="stat-value">${String(stats.byStatus.failed)}</div>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item"><div class="legend-color pending"></div> Pending</div>
    <div class="legend-item"><div class="legend-color completed"></div> Completed</div>
    <div class="legend-item"><div class="legend-color failed"></div> Failed</div>
    <div class="legend-item"><div class="legend-color timeout"></div> Timeout</div>
  </div>

  ${generateSessionsHTML(requestsBySession, minTime, timeRange)}
</body>
</html>`;
}

function generateSessionsHTML(
  requestsBySession: Map<string, TrackedRequest[]>,
  minTime: number,
  timeRange: number
): string {
  if (requestsBySession.size === 0) {
    return '<div class="no-requests">No requests yet. Make some MCP tool calls to see them here.</div>';
  }

  const sessions: string[] = [];

  // Sort sessions by most recent activity
  const sortedSessions = Array.from(requestsBySession.entries()).sort((a, b) => {
    const aMax = Math.max(...a[1].map((r) => r.startedAt.getTime()));
    const bMax = Math.max(...b[1].map((r) => r.startedAt.getTime()));
    return bMax - aMax;
  });

  for (const [sessionId, requests] of sortedSessions) {
    const sortedRequests = [...requests].sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime()
    );

    sessions.push(`
      <div class="session">
        <div class="session-header">
          <span class="session-id">${sessionId}</span>
          <span class="session-count">${String(requests.length)} request${requests.length !== 1 ? "s" : ""}</span>
        </div>
        <div class="waterfall">
          <div class="timeline-markers">
            <span>0ms</span>
            <span>${String(Math.round(timeRange / 2))}ms</span>
            <span>${String(Math.round(timeRange))}ms</span>
          </div>
          ${sortedRequests.map((req) => generateRequestRow(req, minTime, timeRange)).join("")}
        </div>
      </div>
    `);
  }

  return sessions.join("");
}

function generateRequestRow(
  request: TrackedRequest,
  minTime: number,
  timeRange: number
): string {
  const startOffset = request.startedAt.getTime() - minTime;
  const duration = request.durationMs ?? Date.now() - request.startedAt.getTime();

  const leftPercent = (startOffset / timeRange) * 100;
  const widthPercent = Math.max((duration / timeRange) * 100, 0.5); // Min 0.5% width

  const displayName = request.server
    ? `${request.server}:${request.name}`
    : request.name;

  const typeShort = getTypeShort(request.type);
  const durationStr = request.status === "pending" ? "..." : `${String(duration)}ms`;

  return `
    <div class="request-row" title="${escapeHtml(JSON.stringify(request.args ?? {}))}">
      <div class="request-name">${escapeHtml(displayName)}</div>
      <div class="request-bar-container">
        <div class="request-bar ${request.status}" style="left: ${String(leftPercent)}%; width: ${String(widthPercent)}%;">
          <span class="type-badge">${typeShort}</span>
          ${request.error ? "⚠️" : ""}
        </div>
        <span class="request-duration">${durationStr}</span>
      </div>
    </div>
  `;
}

function getTypeShort(type: string): string {
  switch (type) {
    case "tool_call":
      return "TOOL";
    case "resource_read":
      return "RES";
    case "prompt_get":
      return "PROMPT";
    case "backend_tool":
      return "B:TOOL";
    case "backend_resource":
      return "B:RES";
    case "backend_prompt":
      return "B:PROMPT";
    default:
      return type.toUpperCase();
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generate JSON data for the waterfall (for custom UIs or APIs).
 */
export function generateWaterfallJSON(tracker: RequestTracker): object {
  const requestsBySession = tracker.getRequestsBySession();
  const stats = tracker.getStats();

  const sessions: Record<string, TrackedRequest[]> = {};
  for (const [sessionId, requests] of requestsBySession) {
    sessions[sessionId] = requests;
  }

  return {
    stats,
    sessions,
    generatedAt: new Date().toISOString(),
  };
}
