import Docker from 'dockerode';

export interface PortInfo {
  containerName: string;
  image: string;
  portMappings: PortMapping[];
  exposedToPublic: boolean;
  usesHostNetwork: boolean;
}

export interface PortMapping {
  containerPort: string;
  hostPort: string;
  hostIp: string;
  protocol: string;
  isPublic: boolean;
}

const SENSITIVE_PORTS: Record<number, string> = {
  22: 'SSH',
  3306: 'MySQL',
  5432: 'PostgreSQL',
  27017: 'MongoDB',
  6379: 'Redis',
  9200: 'Elasticsearch',
  5672: 'RabbitMQ',
  2181: 'Zookeeper',
  9092: 'Kafka',
  2375: 'Docker daemon (unencrypted)',
  2376: 'Docker daemon (TLS)',
};

export async function collectPorts(docker: Docker): Promise<PortInfo[]> {
  const containers = await docker.listContainers({ all: true });
  const results: PortInfo[] = [];

  for (const c of containers) {
    const container = docker.getContainer(c.Id);
    const inspect = await container.inspect();

    const networkMode = inspect.HostConfig.NetworkMode ?? '';
    const usesHostNetwork = networkMode === 'host';

    const portMappings: PortMapping[] = [];

    const bindings = inspect.HostConfig.PortBindings ?? {};
    for (const [containerPort, hostBindings] of Object.entries(bindings)) {
      if (!hostBindings) continue;
      for (const binding of hostBindings as any[]) {
        const hostIp = binding.HostIp || '0.0.0.0';
        const hostPort = binding.HostPort || '';
        const isPublic = hostIp === '0.0.0.0' || hostIp === '';
        portMappings.push({
          containerPort,
          hostPort,
          hostIp,
          protocol: containerPort.includes('udp') ? 'udp' : 'tcp',
          isPublic,
        });
      }
    }

    const exposedToPublic = usesHostNetwork || portMappings.some((p) => p.isPublic);

    results.push({
      containerName: c.Names[0]?.replace('/', '') ?? c.Id.slice(0, 12),
      image: c.Image,
      portMappings,
      exposedToPublic,
      usesHostNetwork,
    });
  }

  return results;
}

export function getSensitivePortLabel(port: string): string | null {
  const num = parseInt(port.split('/')[0]);
  return SENSITIVE_PORTS[num] ?? null;
}
