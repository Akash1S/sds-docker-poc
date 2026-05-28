import Docker from 'dockerode';

export interface DockerEvent {
  type: string;
  action: string;
  actorName: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

const CRITICAL_ACTIONS = new Set(['oom', 'kill', 'die', 'destroy']);
const WARNING_ACTIONS = new Set(['stop', 'pause', 'disconnect', 'health_status: unhealthy']);

const EVENT_WINDOW_MINUTES = 60;

export async function collectEvents(docker: Docker): Promise<DockerEvent[]> {
  const since = Math.floor(Date.now() / 1000) - EVENT_WINDOW_MINUTES * 60;

  const eventStream: NodeJS.ReadableStream = await new Promise((resolve, reject) => {
    docker.getEvents({ since }, (err, stream) => {
      if (err) reject(err);
      else resolve(stream as NodeJS.ReadableStream);
    });
  });

  const raw = await readStreamWithTimeout(eventStream, 3000);
  const lines = raw.split('\n').filter(Boolean);
  const results: DockerEvent[] = [];

  for (const line of lines) {
    try {
      const evt = JSON.parse(line);
      const action: string = evt.Action ?? '';
      const actorName: string = evt.Actor?.Attributes?.name ?? evt.Actor?.ID?.slice(0, 12) ?? 'unknown';
      const ts = new Date((evt.time ?? 0) * 1000).toISOString();

      let severity: DockerEvent['severity'] = 'info';
      let message = `${action} on ${actorName}`;

      if (action === 'oom') {
        severity = 'critical';
        message = `OOM kill — container '${actorName}' ran out of memory`;
      } else if (action === 'die') {
        const exitCode = evt.Actor?.Attributes?.exitCode ?? '?';
        severity = exitCode !== '0' ? 'critical' : 'warning';
        message = `Container '${actorName}' died with exit code ${exitCode}`;
      } else if (action === 'kill') {
        severity = 'critical';
        message = `Container '${actorName}' was killed (signal: ${evt.Actor?.Attributes?.signal ?? '?'})`;
      } else if (action === 'destroy') {
        severity = 'warning';
        message = `Container '${actorName}' was removed`;
      } else if (action === 'health_status: unhealthy') {
        severity = 'warning';
        message = `Container '${actorName}' health check failed`;
      } else if (WARNING_ACTIONS.has(action)) {
        severity = 'warning';
        message = `Container '${actorName}' — ${action}`;
      }

      if (CRITICAL_ACTIONS.has(action) || WARNING_ACTIONS.has(action)) {
        results.push({ type: evt.Type ?? 'container', action, actorName, timestamp: ts, severity, message });
      }
    } catch {
      // skip unparseable lines
    }
  }

  return results;
}

function readStreamWithTimeout(stream: NodeJS.ReadableStream, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve(data), timeoutMs);

    stream.on('data', (chunk) => { data += chunk.toString(); });
    stream.on('end', () => { clearTimeout(timer); resolve(data); });
    stream.on('error', () => { clearTimeout(timer); resolve(data); });
  });
}
