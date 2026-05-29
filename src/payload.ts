import { ContainerInfo } from './collectors/containers';
import { VolumeInfo } from './collectors/volumes';
import { PortInfo, getSensitivePortLabel } from './collectors/ports';
import { SecurityInfo } from './collectors/security';
import { NetworkInfo } from './collectors/network';
import { ImageInfo } from './collectors/images';
import { DockerEvent } from './collectors/events';
import { SystemInfo } from './collectors/system';
import { DockerPayload } from './transports/ITransport';

export function buildPayload(
  system: SystemInfo,
  containers: ContainerInfo[],
  volumes: VolumeInfo[],
  ports: PortInfo[],
  security: SecurityInfo[],
  networks: NetworkInfo[],
  images: ImageInfo[],
  events: DockerEvent[]
): DockerPayload {
  return {
    system: {
      dockerVersion: system.dockerVersion,
      os: system.os,
      architecture: system.architecture,
      totalMemoryMB: system.totalMemoryMB,
      cpuCount: system.cpuCount,
      totalContainers: system.totalContainers,
      runningContainers: system.runningContainers,
      stoppedContainers: system.stoppedContainers,
      disk: system.disk,
      warnings: system.warnings,
    },

    containers: containers.map((c) => ({
      name: c.name,
      image: c.image,
      state: c.state,
      status: c.status,
      restartCount: c.restartCount,
      cpu: c.cpu,
      memory: c.memory,
      uptimeMinutes: c.uptimeMinutes,
      healthStatus: c.healthStatus,
      healthFailingStreak: c.healthFailingStreak,
      lastHealthLog: c.lastHealthLog,
    })),

    volumes: volumes.map((v) => ({
      name: v.name,
      driver: v.driver,
      mountpoint: v.mountpoint,
      usedByContainers: v.usedByContainers,
    })),

    ports: ports.map((p) => ({
      containerName: p.containerName,
      image: p.image,
      exposedToPublic: p.exposedToPublic,
      usesHostNetwork: p.usesHostNetwork,
      mappings: p.portMappings.map((m) => ({
        containerPort: m.containerPort,
        hostPort: m.hostPort,
        hostIp: m.hostIp,
        isPublic: m.isPublic,
        sensitiveService: getSensitivePortLabel(m.containerPort),
      })),
    })),

    security: security.map((s) => ({
      containerName: s.containerName,
      riskLevel: s.riskLevel,
      riskScore: s.riskScore,
      isPrivileged: s.isPrivileged,
      runningAsRoot: s.runningAsRoot,
      addedCapabilities: s.addedCapabilities,
      sensitiveMounts: s.sensitiveMounts.map((m) => ({
        hostPath: m.hostPath,
        reason: m.reason,
      })),
      exposedSecretKeys: s.exposedSecrets.map((e) => e.envKey),
      hasNoMemoryLimit: s.hasNoMemoryLimit,
      hasNoCpuLimit: s.hasNoCpuLimit,
      hasNoRestartPolicy: s.hasNoRestartPolicy,
    })),

    networks: networks.map((n) => ({
      name: n.name,
      driver: n.driver,
      isInternal: n.isInternal,
      isBridgeWithPublicPorts: n.isBridgeWithPublicPorts,
      subnet: n.subnet,
      containerCount: n.containers.length,
      containers: n.containers.map((c) => c.containerName),
    })),

    images: images.map((i) => ({
      repoTag: i.repoTag,
      usesLatestTag: i.usesLatestTag,
      sizeMB: i.sizeMB,
      ageDays: i.ageDays,
      isOld: i.isOld,
      usedByContainers: i.usedByContainers,
    })),

    events: events.map((e) => ({
      action: e.action,
      actorName: e.actorName,
      timestamp: e.timestamp,
      severity: e.severity,
      message: e.message,
    })),
  };
}
