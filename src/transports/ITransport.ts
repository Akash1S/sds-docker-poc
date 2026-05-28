export interface DockerPayload {
  system: any;
  containers: any[];
  logs: any[];
  volumes: any[];
  ports: any[];
  security: any[];
  networks: any[];
  images: any[];
  events: any[];
}

export interface AnalysisResult {
  predictions: string[];
  severity: 'ok' | 'warning' | 'critical';
  recommendations: string[];
  traceId?: string;   // OTel traceId from root span — used to link submitEvalsBatch
}

export interface ITransport {
  analyze(payload: DockerPayload): Promise<AnalysisResult>;
}
