import Docker from 'dockerode';

export interface NetworkInfo {
  networkId: string;
  name: string;
  driver: string;
  scope: string;
  isInternal: boolean;
  subnet: string;
  containers: NetworkContainerEntry[];
  isBridgeWithPublicPorts: boolean;
}

export interface NetworkContainerEntry {
  containerName: string;
  ipAddress: string;
}

export async function collectNetworks(docker: Docker): Promise<NetworkInfo[]> {
  const networks = await docker.listNetworks();
  const results: NetworkInfo[] = [];

  for (const net of networks) {
    const network = docker.getNetwork(net.Id);
    const inspect = await network.inspect();

    const containers: NetworkContainerEntry[] = Object.entries(inspect.Containers ?? {}).map(
      ([, v]: [string, any]) => ({
        containerName: v.Name ?? 'unknown',
        ipAddress: v.IPv4Address?.split('/')[0] ?? '',
      })
    );

    const ipamConfig = inspect.IPAM?.Config ?? [];
    const subnet = ipamConfig[0]?.Subnet ?? 'N/A';

    results.push({
      networkId: net.Id.slice(0, 12),
      name: net.Name,
      driver: net.Driver,
      scope: net.Scope,
      isInternal: inspect.Internal ?? false,
      subnet,
      containers,
      isBridgeWithPublicPorts: net.Driver === 'bridge' && !inspect.Internal,
    });
  }

  return results;
}
