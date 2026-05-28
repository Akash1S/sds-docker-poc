import { trace, metrics, SpanStatusCode } from '@opentelemetry/api';
import { DockerPayload, AnalysisResult } from './transports/ITransport';

const tracer = trace.getTracer('sds-docker-poc', '1.0.0');
const meter  = metrics.getMeter('sds-docker-poc', '1.0.0');

// Metric instruments — created lazily inside exportToNiriksha() to avoid
// OTel sdk-metrics version conflicts crashing the process at module load time.
const noop = { record: () => {}, add: () => {} };
let _restartHistogram:   { record: (v: number, a?: any) => void } = noop;
let _riskScoreHistogram: { record: (v: number, a?: any) => void } = noop;
let _diskUsageHistogram: { record: (v: number, a?: any) => void } = noop;
let _imageAgeHistogram:  { record: (v: number, a?: any) => void } = noop;
let _runningCounter:     { add:    (v: number, a?: any) => void } = noop;
let _metricsReady = false;

function initMetrics(): void {
  if (_metricsReady) return;
  try {
    _restartHistogram   = meter.createHistogram('docker.container.restart_count', { description: 'Container restart count' });
    _riskScoreHistogram = meter.createHistogram('docker.security.risk_score',     { description: 'Container security risk score 0-100' });
    _diskUsageHistogram = meter.createHistogram('docker.disk.usage_mb',           { description: 'Docker total disk usage MB' });
    _imageAgeHistogram  = meter.createHistogram('docker.image.age_days',          { description: 'Image age in days' });
    _runningCounter     = meter.createUpDownCounter('docker.containers.running',   { description: 'Number of running containers' });
    _metricsReady = true;
  } catch (err: any) {
    console.warn('[Niriksha] Metrics unavailable (OTel version mismatch) — spans and evals will still work:', err.message);
  }
}

export function exportToNiriksha(payload: DockerPayload): AnalysisResult {
  initMetrics();

  const predictions: string[] = [];
  const recommendations: string[] = [];
  let severity: 'ok' | 'warning' | 'critical' = 'ok';
  let traceId: string | undefined;

  // ── Root span for this analysis run ────────────────────────
  const rootSpan = tracer.startSpan('docker.analysis.run');
  traceId = rootSpan.spanContext().traceId;

  rootSpan.setAttributes({
    'docker.host.os':                 payload.system?.os ?? 'unknown',
    'docker.host.cpu_count':          payload.system?.cpuCount ?? 0,
    'docker.host.memory_mb':          payload.system?.totalMemoryMB ?? 0,
    'docker.host.total_containers':   payload.system?.totalContainers ?? 0,
    'docker.host.running_containers': payload.system?.runningContainers ?? 0,
    'docker.disk.total_mb':           payload.system?.disk?.totalSizeMB ?? 0,
    'docker.version':                 payload.system?.dockerVersion ?? 'unknown',
  });

  _diskUsageHistogram.record(payload.system?.disk?.totalSizeMB ?? 0);
  _runningCounter.add(payload.system?.runningContainers ?? 0);

  // ── Container spans ─────────────────────────────────────────
  for (const c of payload.containers ?? []) {
    const span = tracer.startSpan('docker.container');
    span.setAttributes({
      'container.name':                  c.name,
      'container.image':                 c.image,
      'container.state':                 c.state,
      'container.status':                c.status,
      'container.restart_count':         c.restartCount,
      'container.health_status':         c.healthStatus,
      'container.health_failing_streak': c.healthFailingStreak ?? 0,
      'container.uptime_minutes':        c.uptimeMinutes ?? -1,
      'container.cpu':                   c.cpu,
      'container.memory':                c.memory,
    });

    _restartHistogram.record(c.restartCount, { 'container.name': c.name });

    if (c.restartCount >= 5) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Crash loop' });
      predictions.push(`Container '${c.name}' crash loop — ${c.restartCount} restarts`);
      recommendations.push(`docker logs ${c.name} --tail 50`);
      severity = 'critical';
    } else if (c.healthStatus === 'unhealthy') {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Health check failing' });
      predictions.push(`Container '${c.name}' health check FAILING (streak: ${c.healthFailingStreak})`);
      if (c.lastHealthLog) predictions.push(`  └ Last output: ${c.lastHealthLog}`);
      severity = 'critical';
    } else if (c.state !== 'running' && c.state !== 'created') {
      span.setStatus({ code: SpanStatusCode.ERROR, message: `Container is ${c.state}` });
      predictions.push(`Container '${c.name}' is ${c.state}`);
      severity = severity === 'critical' ? 'critical' : 'warning';
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
  }

  // ── Security spans ──────────────────────────────────────────
  for (const sec of payload.security ?? []) {
    const span = tracer.startSpan('docker.security.audit');
    span.setAttributes({
      'security.container':         sec.containerName,
      'security.risk_level':        sec.riskLevel,
      'security.risk_score':        sec.riskScore,
      'security.privileged':        sec.isPrivileged,
      'security.running_as_root':   sec.runningAsRoot,
      'security.no_memory_limit':   sec.hasNoMemoryLimit,
      'security.no_cpu_limit':      sec.hasNoCpuLimit,
      'security.no_restart_policy': sec.hasNoRestartPolicy,
      'security.sensitive_mounts':  sec.sensitiveMounts?.length ?? 0,
      'security.exposed_secrets':   sec.exposedSecretKeys?.length ?? 0,
    });

    _riskScoreHistogram.record(sec.riskScore, { 'container.name': sec.containerName });

    if (sec.riskLevel === 'critical') {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Critical security risk' });
      predictions.push(`CRITICAL RISK: '${sec.containerName}' (score: ${sec.riskScore}/100)`);
      if (sec.isPrivileged) predictions.push(`  └ Running privileged — full host access`);
      if (sec.sensitiveMounts?.some((m: any) => m.hostPath === '/var/run/docker.sock'))
        predictions.push(`  └ Docker socket mounted — can control host Docker`);
      severity = 'critical';
    } else if (sec.riskLevel === 'high') {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'High security risk' });
      predictions.push(`HIGH RISK: '${sec.containerName}' (score: ${sec.riskScore}/100)`);
      severity = severity === 'critical' ? 'critical' : 'warning';
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    if (sec.hasNoMemoryLimit) {
      predictions.push(`'${sec.containerName}' has no memory limit — can OOM the host`);
      recommendations.push(`docker update --memory 512m ${sec.containerName}`);
    }
    span.end();
  }

  // ── Port spans ──────────────────────────────────────────────
  for (const p of payload.ports ?? []) {
    for (const m of p.mappings ?? []) {
      if (m.isPublic && m.sensitiveService) {
        const span = tracer.startSpan('docker.port.exposure');
        span.setAttributes({
          'port.container':          p.containerName,
          'port.container_port':     m.containerPort,
          'port.host_port':          m.hostPort,
          'port.host_ip':            m.hostIp,
          'port.sensitive_service':  m.sensitiveService,
          'port.is_public':          true,
        });
        span.setStatus({ code: SpanStatusCode.ERROR, message: `${m.sensitiveService} exposed publicly` });
        predictions.push(`SECURITY: '${p.containerName}' exposes ${m.sensitiveService} (${m.containerPort}) to 0.0.0.0`);
        recommendations.push(`Bind to 127.0.0.1: -p 127.0.0.1:${m.hostPort}:${m.containerPort}`);
        severity = 'critical';
        span.end();
      }
    }
  }

  // ── Image spans ─────────────────────────────────────────────
  for (const img of payload.images ?? []) {
    if ((img.isOld || img.usesLatestTag) && img.usedByContainers?.length > 0) {
      const span = tracer.startSpan('docker.image.health');
      span.setAttributes({
        'image.tag':           img.repoTag,
        'image.age_days':      img.ageDays,
        'image.uses_latest':   img.usesLatestTag,
        'image.size_mb':       img.sizeMB,
        'image.used_by_count': img.usedByContainers.length,
      });
      _imageAgeHistogram.record(img.ageDays, { 'image.tag': img.repoTag });
      if (img.isOld) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'Image too old' });
        predictions.push(`Image '${img.repoTag}' is ${img.ageDays} days old — likely unpatched CVEs`);
        recommendations.push(`Pull latest: docker pull ${img.repoTag}`);
        severity = severity === 'critical' ? 'critical' : 'warning';
      }
      if (img.usesLatestTag) {
        predictions.push(`Image '${img.repoTag}' uses :latest — not deterministic in production`);
      }
      span.end();
    }
  }

  // ── Event spans ─────────────────────────────────────────────
  // Count occurrences per (actor, action) so crash-loops don't flood predictions
  const eventCounts = new Map<string, { e: typeof payload.events[0]; count: number }>();
  for (const e of payload.events ?? []) {
    const key = `${e.actorName}:${e.action}`;
    const existing = eventCounts.get(key);
    if (existing) existing.count++;
    else eventCounts.set(key, { e, count: 1 });
  }

  for (const { e, count } of eventCounts.values()) {
    const span = tracer.startSpan('docker.event');
    span.setAttributes({
      'event.action':    e.action,
      'event.actor':     e.actorName,
      'event.severity':  e.severity,
      'event.timestamp': e.timestamp,
      'event.count':     count,
    });
    if (e.severity === 'critical') {
      span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
      const suffix = count > 1 ? ` (×${count})` : '';
      predictions.push(`Event: ${e.message}${suffix}`);
      severity = 'critical';
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
  }

  // ── Close root span ─────────────────────────────────────────
  if (predictions.length === 0) {
    predictions.push('All containers, images and volumes look healthy');
    rootSpan.setStatus({ code: SpanStatusCode.OK });
  } else {
    rootSpan.setStatus({ code: SpanStatusCode.ERROR, message: `${predictions.length} issue(s) found` });
  }
  rootSpan.setAttribute('analysis.severity', severity);
  rootSpan.setAttribute('analysis.issue_count', predictions.length);
  rootSpan.end();

  return { predictions, severity, recommendations, traceId };
}
