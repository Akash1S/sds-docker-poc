import { submitEvalsBatch, isInitialized } from '@nirikshaai/sdk';
import { ITransport, DockerPayload, AnalysisResult } from './ITransport';
import { exportToNiriksha } from '../telemetry';

// HTTP transport:
// 1. Exports Docker telemetry as OTel spans (via init() — always on)
// 2. Submits structured health/security findings as evaluations via HTTP REST

export class HttpTransport implements ITransport {
  async analyze(payload: DockerPayload): Promise<AnalysisResult> {
    console.log('[HTTP] Exporting Docker telemetry to Niriksha AI...');

    // Export all Docker data as OTel spans + metrics (gRPC OTLP via init())
    const result = exportToNiriksha(payload);

    // Submit structured findings as evaluations via HTTP REST
    await submitDockerEvals(payload, result);

    return result;
  }
}

async function submitDockerEvals(payload: DockerPayload, result: AnalysisResult): Promise<void> {
  if (!isInitialized()) {
    console.log('[HTTP] SDK not initialized (mock mode) — skipping eval submission');
    return;
  }

  // Use the real OTel traceId from the root span so evals link to traces on the dashboard.
  const traceId = result.traceId ?? Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  const evals: any[] = [];

  // Container health evals
  for (const c of payload.containers ?? []) {
    let score = 1.0;
    if (c.healthStatus === 'unhealthy')  score = 0.0;
    else if (c.restartCount >= 5)        score = 0.1;
    else if (c.restartCount >= 2)        score = 0.5;
    else if (c.state !== 'running')      score = 0.3;

    evals.push({
      traceId,
      metricName: 'container_health',
      score,
      label: score >= 0.7 ? 'pass' : 'fail',
      evalType: 'rule_based',
      explanation: `Container '${c.name}': state=${c.state}, restarts=${c.restartCount}, health=${c.healthStatus}`,
    });
  }

  // Security risk evals
  for (const sec of payload.security ?? []) {
    const score = parseFloat((1 - sec.riskScore / 100).toFixed(2));
    evals.push({
      traceId,
      metricName: 'security_risk',
      score,
      label: sec.riskLevel === 'low' || sec.riskLevel === 'medium' ? 'pass' : 'fail',
      evalType: 'rule_based',
      explanation: `Container '${sec.containerName}': riskLevel=${sec.riskLevel}, score=${sec.riskScore}/100, privileged=${sec.isPrivileged}`,
    });
  }

  // Image freshness evals
  for (const img of payload.images ?? []) {
    if (img.usedByContainers?.length === 0) continue;
    const score = img.isOld ? 0.2 : img.usesLatestTag ? 0.6 : 1.0;
    evals.push({
      traceId,
      metricName: 'image_freshness',
      score,
      label: score >= 0.6 ? 'pass' : 'fail',
      evalType: 'rule_based',
      explanation: `Image '${img.repoTag}': ageDays=${img.ageDays}, usesLatest=${img.usesLatestTag}`,
    });
  }

  // Overall health eval
  evals.push({
    traceId,
    metricName: 'docker_overall_health',
    score: result.severity === 'ok' ? 1.0 : result.severity === 'warning' ? 0.5 : 0.1,
    label: result.severity === 'ok' ? 'pass' : 'fail',
    evalType: 'rule_based',
    explanation: `Overall severity: ${result.severity}, issues found: ${result.predictions.length}`,
  });

  try {
    const response = await submitEvalsBatch(evals);
    if (response?.error) {
      console.warn(`[HTTP] submitEvalsBatch reported error: ${response.error}`);
    } else {
      console.log(`[HTTP] Submitted ${evals.length} evaluation(s) — inserted: ${response?.inserted ?? evals.length}`);
    }
  } catch (err: any) {
    console.warn(`[HTTP] submitEvalsBatch failed: ${err.message}`);
  }
}
