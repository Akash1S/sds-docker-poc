import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const args = process.argv.slice(2);

if (args.includes('--readme')) {
  const readmePath = path.join(__dirname, 'README.md');
  if (fs.existsSync(readmePath)) {
    console.log(fs.readFileSync(readmePath, 'utf8'));
  } else {
    console.log('README not found in bundle.');
  }
  process.exit(0);
}

if (args.includes('--help')) {
  console.log(`
SDS-POC — Docker Container Intelligence via Niriksha AI

Usage:
  ./sds-poc-linux              Run the full analysis
  ./sds-poc-linux --help       Show this help
  ./sds-poc-linux --readme     Show full documentation

Configuration (.env):
  TRANSPORT=http                    http (spans + evals) or grpc (spans only)
  NIRIKSHA_API_KEY=nai_...          Your Niriksha project API key
  NIRIKSHA_ENDPOINT=...             REST API base URL
  NIRIKSHA_OTLP_ENDPOINT=...        gRPC OTLP endpoint host
  NIRIKSHA_OTLP_PORT=443            gRPC OTLP port (default 443)
  NIRIKSHA_SERVICE_NAME=...         Service name shown on dashboard
  DOCKER_HOST=                      Leave blank for local Docker
`);
  process.exit(0);
}

// Load .env from same folder as binary (or cwd when running as script)
const envPath = path.join(
  (process as any).pkg ? path.dirname(process.execPath) : process.cwd(),
  '.env'
);
dotenv.config({ path: envPath });

// IMPORTANT: init() must run before any other imports that touch instrumented libs
import { initNiriksha, shutdownNiriksha } from './init';
initNiriksha();

import { collectContainers } from './collectors/containers';
import { collectLogs } from './collectors/logs';
import { collectVolumes } from './collectors/volumes';
import { collectPorts } from './collectors/ports';
import { collectSecurity } from './collectors/security';
import { collectNetworks } from './collectors/network';
import { collectImages } from './collectors/images';
import { collectEvents } from './collectors/events';
import { collectSystemInfo } from './collectors/system';
import { buildPayload } from './payload';
import { analyzeWithAI } from './ai';
import { createDockerClient } from './docker';

async function main() {
  console.log('\n========================================');
  console.log('  SDS-POC: Docker Intelligence via Niriksha AI');
  console.log(`  Transport: ${process.env.TRANSPORT ?? 'http'}`);
  console.log(`  Service:   ${process.env.NIRIKSHA_SERVICE_NAME ?? 'sds-docker-poc'}`);
  console.log('========================================\n');

  const docker = createDockerClient();

  console.log('[1/9] Collecting Docker host & system info...');
  const system = await collectSystemInfo(docker);
  console.log(`      Host: ${system.os} | CPUs: ${system.cpuCount} | RAM: ${system.totalMemoryMB}MB`);
  console.log(`      Disk used by Docker: ${system.disk.totalSizeMB}MB`);

  console.log('[2/9] Collecting container info...');
  const containers = await collectContainers(docker);
  console.log(`      Found ${containers.length} container(s) (${system.runningContainers} running)`);
  const unhealthy = containers.filter((c) => c.healthStatus === 'unhealthy');
  if (unhealthy.length > 0) console.log(`      ⚠  ${unhealthy.length} UNHEALTHY`);

  console.log('[3/9] Collecting container logs...');
  const runningNames = containers.filter((c) => c.state === 'running').map((c) => c.name);
  const logs = await collectLogs(docker, runningNames);

  console.log('[4/9] Collecting volume info...');
  const volumes = await collectVolumes(docker);
  console.log(`      Found ${volumes.length} volume(s)`);

  console.log('[5/9] Collecting port & network exposure...');
  const ports = await collectPorts(docker);
  const publicPorts = ports.filter((p) => p.exposedToPublic).length;
  if (publicPorts > 0) console.log(`      ⚠  ${publicPorts} container(s) with publicly exposed ports`);

  console.log('[6/9] Running security audit...');
  const security = await collectSecurity(docker);
  const criticalCount = security.filter((s) => s.riskLevel === 'critical').length;
  if (criticalCount > 0) console.log(`      ⚠  ${criticalCount} container(s) with CRITICAL risk`);

  console.log('[7/9] Collecting network topology...');
  const networks = await collectNetworks(docker);

  console.log('[8/9] Collecting image health...');
  const images = await collectImages(docker);
  const oldImages = images.filter((i) => i.isOld).length;
  if (oldImages > 0) console.log(`      ⚠  ${oldImages} image(s) older than 90 days`);

  console.log('[9/9] Collecting recent Docker events (last 60 min)...');
  const events = await collectEvents(docker);
  console.log(`      Found ${events.length} notable event(s)\n`);

  console.log('[AI]  Sending to Niriksha AI...\n');
  const payload = buildPayload(system, containers, logs, volumes, ports, security, networks, images, events);
  const result = await analyzeWithAI(payload);

  console.log('========================================');
  console.log(`  ANALYSIS RESULT  |  Severity: ${result.severity.toUpperCase()}`);
  console.log('========================================\n');

  console.log('Predictions:');
  result.predictions.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));

  if (result.recommendations.length > 0) {
    console.log('\nRecommendations:');
    result.recommendations.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
  }

  console.log('\n  View full traces & metrics on your Niriksha AI dashboard');
  console.log(`  → ${process.env.NIRIKSHA_ENDPOINT ?? 'https://app.niriksha.ai'}`);
  console.log('\n========================================\n');
}

main()
  .catch((err) => {
    console.error('[ERROR]', err.message);
  })
  .finally(async () => {
    // Flush all buffered spans/metrics to Niriksha before process exits
    await shutdownNiriksha();
    process.exit(0);
  });
