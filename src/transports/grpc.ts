import { ITransport, DockerPayload, AnalysisResult } from './ITransport';
import { exportToNiriksha } from '../telemetry';

// gRPC transport:
// Focuses entirely on OTel spans + metrics exported via gRPC OTLP
// (configured by init() via NIRIKSHA_OTLP_ENDPOINT)
// No REST submitEval — all data flows through OpenTelemetry pipeline

export class GrpcTransport implements ITransport {
  async analyze(payload: DockerPayload): Promise<AnalysisResult> {
    console.log('[gRPC] Exporting Docker telemetry via OTLP gRPC to Niriksha AI...');
    const result = exportToNiriksha(payload);
    console.log(`[gRPC] Exported ${payload.containers?.length ?? 0} container(s), ${payload.events?.length ?? 0} event(s) as OTel spans`);
    return result;
  }
}
