import Docker from 'dockerode';

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  restartCount: number;
  cpu: string;
  memory: string;
  createdAt: string;
  startedAt: string;
  uptimeMinutes: number | null;
  healthStatus: 'healthy' | 'unhealthy' | 'starting' | 'none';
  healthFailingStreak: number;
  lastHealthLog: string | null;
}

export async function collectContainers(docker: Docker): Promise<ContainerInfo[]> {
  const containers = await docker.listContainers({ all: true });
  const results: ContainerInfo[] = [];

  for (const c of containers) {
    const container = docker.getContainer(c.Id);
    const inspect = await container.inspect();

    let cpuPercent = 'N/A';
    let memUsage = 'N/A';

    if (inspect.State.Running) {
      try {
        const stats: any = await new Promise((resolve, reject) => {
          container.stats({ stream: false }, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });

        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
        const cpuCount = stats.cpu_stats.online_cpus || 1;
        cpuPercent = ((cpuDelta / systemDelta) * cpuCount * 100).toFixed(2) + '%';

        const mem = stats.memory_stats;
        memUsage = `${(mem.usage / 1024 / 1024).toFixed(1)}MB / ${(mem.limit / 1024 / 1024).toFixed(1)}MB`;
      } catch {
        // stats not available
      }
    }

    // uptime from last start
    const startedAt = inspect.State.StartedAt ?? '';
    let uptimeMinutes: number | null = null;
    if (startedAt && inspect.State.Running) {
      uptimeMinutes = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000);
    }

    // health check status
    const health = (inspect.State as any).Health;
    const healthStatus: ContainerInfo['healthStatus'] = health
      ? (health.Status as ContainerInfo['healthStatus'])
      : 'none';
    const healthFailingStreak: number = health?.FailingStreak ?? 0;
    const lastHealthLog: string | null =
      health?.Log?.length > 0 ? health.Log[health.Log.length - 1]?.Output?.trim() ?? null : null;

    results.push({
      id: c.Id.slice(0, 12),
      name: c.Names[0]?.replace('/', '') ?? 'unknown',
      image: c.Image,
      status: c.Status,
      state: inspect.State.Status,
      restartCount: inspect.RestartCount,
      cpu: cpuPercent,
      memory: memUsage,
      createdAt: inspect.Created,
      startedAt,
      uptimeMinutes,
      healthStatus,
      healthFailingStreak,
      lastHealthLog,
    });
  }

  return results;
}
