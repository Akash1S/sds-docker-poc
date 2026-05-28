import { ITransport, DockerPayload, AnalysisResult } from './transports/ITransport';
import { HttpTransport } from './transports/http';
import { GrpcTransport } from './transports/grpc';
import { sanitizePayload } from './sanitize';

function getTransport(): ITransport {
  const mode = (process.env.TRANSPORT ?? 'http').toLowerCase();
  if (mode === 'grpc') {
    console.log('[AI] Transport: gRPC OTLP → Niriksha AI');
    return new GrpcTransport();
  }
  console.log('[AI] Transport: HTTP REST + gRPC OTLP → Niriksha AI');
  return new HttpTransport();
}

export async function analyzeWithAI(payload: DockerPayload): Promise<AnalysisResult> {
  // Strip secret values before anything leaves this process
  const safePayload = sanitizePayload(payload);
  const transport = getTransport();
  return transport.analyze(safePayload);
}
