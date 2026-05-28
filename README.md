# SDS-POC: Docker Container Intelligence using Niriksha AI

## Overview

This POC connects Docker with **Niriksha AI** to automatically monitor and predict issues in containerized infrastructure — without manual log reading.

Instead of someone checking logs and stats manually, the POC:
1. Collects all Docker data automatically (containers, logs, volumes, ports, security, networks, images, events)
2. Sanitizes sensitive values so secrets never leave your machine
3. Sends the data to Niriksha AI via **HTTP or gRPC**
4. Returns predictions, risk levels, and recommendations

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        SDS-POC Binary                       │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  Data Collectors                     │   │
│  │  containers │ logs │ volumes │ ports │ security      │   │
│  │  network    │ images │ events │ system info          │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                         │                                   │
│                  ┌──────▼──────┐                            │
│                  │  Sanitizer  │  ← secrets never sent      │
│                  └──────┬──────┘                            │
│                         │                                   │
│          ┌──────────────▼──────────────┐                    │
│          │       Transport Layer        │                    │
│          │  ┌───────────┐ ┌──────────┐ │                    │
│          │  │   HTTP    │ │  gRPC    │ │                    │
│          │  └─────┬─────┘ └────┬─────┘ │                    │
│          └────────┼────────────┼───────┘                    │
└───────────────────┼────────────┼───────────────────────────┘
                    │            │
                    ▼            ▼
              ┌─────────────────────┐
              │     Niriksha AI     │
              │  (your SDK endpoint)│
              └─────────────────────┘
                         │
                         ▼
              Predictions & Recommendations
```

---

## What Data is Collected

| Collector | Data Collected |
|---|---|
| **System** | Host RAM, CPU count, Docker version, OS, total disk usage |
| **Containers** | State, restart count, CPU%, memory, uptime, health check status |
| **Logs** | Last 50 lines + error lines per running container |
| **Volumes** | Volume list, which containers use them |
| **Ports** | Exposed ports, public bindings (0.0.0.0), host network usage |
| **Security** | Privileged mode, root user, sensitive mounts, env secrets, risk score |
| **Networks** | Network topology, internal vs public, container connectivity |
| **Images** | Image age, `:latest` tag usage, size |
| **Events** | OOM kills, crashes, unhealthy events (last 60 min) |

### Security: What is NOT sent to AI

- Actual values of secrets/passwords/tokens in environment variables
- Raw credentials (only key names are sent, e.g. `PASSWORD (value redacted)`)
- Sensitive patterns in log lines are masked before transmission

---

## Project Structure

```
SDS-POC/
├── src/
│   ├── collectors/
│   │   ├── containers.ts     # container stats, health, uptime
│   │   ├── logs.ts           # log collection
│   │   ├── volumes.ts        # volume info
│   │   ├── ports.ts          # port exposure analysis
│   │   ├── security.ts       # security audit + risk scoring
│   │   ├── network.ts        # network topology
│   │   ├── images.ts         # image health
│   │   ├── events.ts         # Docker events
│   │   └── system.ts         # host system info
│   ├── transports/
│   │   ├── ITransport.ts     # common interface
│   │   ├── http.ts           # HTTP transport → plug SDK here
│   │   └── grpc.ts           # gRPC transport → plug SDK here
│   ├── docker.ts             # Docker client (local + remote)
│   ├── payload.ts            # normalize collected data
│   ├── sanitize.ts           # strip secrets before sending
│   ├── ai.ts                 # transport selector (http/grpc)
│   └── index.ts              # entry point
├── release/
│   └── sds-poc-linux         # standalone binary (deploy this)
├── .env                      # configuration (never commit)
├── package.json
└── tsconfig.json
```

---

## Integrating the Niriksha AI SDK

### Step 1 — Install the SDK

```bash
npm install <niriksha-sdk-package-name>
```

### Step 2 — Plug in HTTP transport

Open `src/transports/http.ts` and replace the TODO section:

```ts
// BEFORE (placeholder)
// import { NirikshAI } from 'niriksha-sdk';

// AFTER — replace with your actual SDK import
import { NirikshAI } from 'niriksha-sdk';

export class HttpTransport implements ITransport {
  private client: NirikshAI;

  constructor() {
    this.client = new NirikshAI({
      transport: 'http',
      token: process.env.NIRIKSHA_TOKEN,
      endpoint: process.env.NIRIKSHA_HTTP_ENDPOINT,
    });
  }

  async analyze(payload: DockerPayload): Promise<AnalysisResult> {
    const response = await this.client.analyze(payload);   // ← your SDK call
    return {
      predictions: response.predictions,
      severity: response.severity,
      recommendations: response.recommendations,
    };
  }
}
```

### Step 3 — Plug in gRPC transport

Open `src/transports/grpc.ts` and replace the same TODO section:

```ts
import { NirikshAI } from 'niriksha-sdk';

export class GrpcTransport implements ITransport {
  private client: NirikshAI;

  constructor() {
    this.client = new NirikshAI({
      transport: 'grpc',
      token: process.env.NIRIKSHA_TOKEN,
      endpoint: process.env.NIRIKSHA_GRPC_ENDPOINT,
    });
  }

  async analyze(payload: DockerPayload): Promise<AnalysisResult> {
    const response = await this.client.analyze(payload);   // ← your SDK call
    return {
      predictions: response.predictions,
      severity: response.severity,
      recommendations: response.recommendations,
    };
  }
}
```

> **Note:** Method names (`analyze`, `predict`, `chat`) and response shape depend on your SDK's API.  
> Adjust the method call and response mapping to match exactly what your SDK returns.

### Step 4 — Rebuild the binary

```bash
npm run package:linux
```

---

## Configuration (.env)

```env
# ── AI Transport ──────────────────────────────────────────────
# Choose: http  or  grpc
TRANSPORT=http

# Your Niriksha AI project token
NIRIKSHA_TOKEN=your_token_here

# HTTP endpoint (used when TRANSPORT=http)
NIRIKSHA_HTTP_ENDPOINT=https://your-niriksha-endpoint/api/analyze

# gRPC endpoint (used when TRANSPORT=grpc)
NIRIKSHA_GRPC_ENDPOINT=your-niriksha-grpc-host:50051

# ── Docker Connection ─────────────────────────────────────────
# Leave blank if running on the same VM as Docker
DOCKER_HOST=

# For SSH tunnel:   DOCKER_HOST=tcp://localhost:2375
# For remote TCP:   DOCKER_HOST=tcp://192.168.1.10:2375
# For TLS remote:   DOCKER_HOST=https://192.168.1.10:2376
# For TLS certs:    DOCKER_CERT_PATH=/path/to/certs
```

---

## Deployment Options

### Option A — Run on the same VM as Docker (Simplest)

```bash
# 1. Copy files to the VM
scp release/sds-poc-linux  user@your-vm:/opt/sds-poc/
scp .env                   user@your-vm:/opt/sds-poc/

# 2. On the VM — give execute permission
chmod +x /opt/sds-poc/sds-poc-linux

# 3. Make sure your user can access Docker
sudo usermod -aG docker $USER
newgrp docker

# 4. Run
cd /opt/sds-poc && ./sds-poc-linux
```

`.env` on the VM:
```env
TRANSPORT=http
NIRIKSHA_TOKEN=your_token_here
DOCKER_HOST=          # blank = local Docker socket
```

---

### Option B — Run on your local machine via SSH Tunnel

```bash
# Terminal 1 — open SSH tunnel (keep open)
ssh -nNT -L 2375:/var/run/docker.sock user@jumphost-ip

# Terminal 2 — run POC locally
cd C:/Users/DELL/SDS-POC
npm run dev
```

`.env` on your local machine:
```env
TRANSPORT=http
NIRIKSHA_TOKEN=your_token_here
DOCKER_HOST=tcp://localhost:2375
```

---

### Option C — Run on your local machine via Direct TCP

Only use this if Docker daemon is already configured to expose TCP on the jumphost.

`.env`:
```env
TRANSPORT=http
NIRIKSHA_TOKEN=your_token_here
DOCKER_HOST=tcp://jumphost-ip:2375
```

```bash
npm run dev
```

---

### Option D — Run on Jumphost with gRPC transport

```bash
# On jumphost
cd /opt/sds-poc
```

`.env`:
```env
TRANSPORT=grpc
NIRIKSHA_TOKEN=your_token_here
NIRIKSHA_GRPC_ENDPOINT=your-niriksha-grpc-host:50051
DOCKER_HOST=
```

```bash
./sds-poc-linux
```

---

## Build Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run directly with ts-node (development) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm run bundle` | Bundle all deps → `bundle/index.js` (1 file) |
| `npm run package:linux` | Build standalone Linux binary → `release/sds-poc-linux` |
| `npm run package:win` | Build standalone Windows binary → `release/sds-poc-win.exe` |
| `npm run package:all` | Build both Linux + Windows binaries |

---

## Sample Output

```
========================================
  SDS-POC: Docker Intelligence via Niriksha AI
  Transport: http
========================================

[1/9] Collecting Docker host & system info...
      Host: Ubuntu 22.04 (5.15.0) | CPUs: 4 | RAM: 8192MB
      Disk used by Docker: 4210MB
[2/9] Collecting container info...
      Found 6 container(s) (5 running)
      ⚠  1 container(s) UNHEALTHY
[3/9] Collecting container logs...
[4/9] Collecting volume info...
      Found 3 volume(s)
[5/9] Collecting port & network exposure...
      ⚠  2 container(s) with publicly exposed ports
[6/9] Running security audit...
      ⚠  1 container(s) with CRITICAL security risk
[7/9] Collecting network topology...
[8/9] Collecting image health...
      ⚠  2 image(s) older than 90 days
[9/9] Collecting recent Docker events (last 60 min)...
      Found 3 notable event(s)

[AI]  Sending data to Niriksha AI for analysis...

========================================
  ANALYSIS RESULT  |  Severity: CRITICAL
========================================

Predictions:
  1. Container 'api' health check is FAILING (streak: 5)
  2. CRITICAL RISK: 'worker' — Docker socket mounted, full host access possible
  3. SECURITY: 'postgres' exposes PostgreSQL port 5432 to 0.0.0.0
  4. Image 'nginx:latest' is 120 days old — likely has unpatched CVEs
  5. Event: Container 'api' was OOM-killed at 2026-05-28T09:14:22Z

Recommendations:
  1. Investigate health check for 'api'
  2. Remove /var/run/docker.sock mount from 'worker'
  3. Bind port to 127.0.0.1: -p 127.0.0.1:5432:5432
  4. Rebuild or pull latest version of 'nginx:latest'
========================================
```

---

## Switching Between HTTP and gRPC

Only one line changes in `.env`:

```env
# Use HTTP
TRANSPORT=http

# Use gRPC
TRANSPORT=grpc
```

No code change, no rebuild needed.

---

## Requirements

| On build machine | On deployment VM |
|---|---|
| Node.js 18+ | Nothing (binary is self-contained) |
| npm | Docker running |
| — | `.env` file in same folder as binary |
| — | User in `docker` group |
