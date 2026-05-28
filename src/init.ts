// init() MUST be called before any other imports — OTel patches modules at load time
import { init, flush, isInitialized } from '@nirikshaai/sdk';

export function initNiriksha(): void {
  if (isInitialized()) {
    console.log('[Niriksha] SDK already initialized');
    return;
  }

  const apiKey = process.env.NIRIKSHA_API_KEY ?? '';
  if (!apiKey) {
    console.warn('[Niriksha] NIRIKSHA_API_KEY not set — running in local mock mode (no data sent to Niriksha)');
    return;
  }

  // SDK requires otlpEndpoint as "host:port" (no scheme).
  // otlpPort is ignored by the SDK when otlpEndpoint is set, so we compose them here.
  const rawOtlpHost = process.env.NIRIKSHA_OTLP_ENDPOINT ?? 'grpc-ingest.niriksha.ai';
  const otlpPort    = process.env.NIRIKSHA_OTLP_PORT ?? '443';
  // If the env var already contains a port (e.g. "host:4317"), use it as-is.
  const otlpEndpoint = rawOtlpHost.includes(':') ? rawOtlpHost : `${rawOtlpHost}:${otlpPort}`;

  init({
    endpoint:      process.env.NIRIKSHA_ENDPOINT     ?? 'https://app.niriksha.ai',
    otlpEndpoint,
    apiKey,
    serviceName:   process.env.NIRIKSHA_SERVICE_NAME ?? 'sds-docker-poc',
    environment:   process.env.NIRIKSHA_ENV          ?? 'production',
    enableMetrics: true,
    enableLogs:    true,
    insecure:      process.env.NIRIKSHA_INSECURE        === 'true',
    tlsSkipVerify: process.env.NIRIKSHA_TLS_SKIP_VERIFY === 'true',
  });

  console.log('[Niriksha] SDK initialized');
  console.log(`  endpoint:     ${process.env.NIRIKSHA_ENDPOINT ?? 'https://app.niriksha.ai'}`);
  console.log(`  otlpEndpoint: ${otlpEndpoint}`);
  console.log(`  service:      ${process.env.NIRIKSHA_SERVICE_NAME ?? 'sds-docker-poc'}`);
}

// Must be called before process exit to flush buffered spans/metrics to Niriksha
export async function shutdownNiriksha(): Promise<void> {
  if (!isInitialized()) return;
  try {
    await flush();
    console.log('[Niriksha] Telemetry flushed successfully');
  } catch (err: any) {
    console.warn('[Niriksha] flush failed:', err.message);
  }
}
