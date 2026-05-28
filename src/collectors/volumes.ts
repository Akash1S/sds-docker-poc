import Docker from 'dockerode';

export interface VolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
  usedByContainers: string[];
}

export async function collectVolumes(docker: Docker): Promise<VolumeInfo[]> {
  const { Volumes } = await docker.listVolumes();
  const containers = await docker.listContainers({ all: true });

  const volumeUsageMap: Record<string, string[]> = {};

  for (const c of containers) {
    const container = docker.getContainer(c.Id);
    const inspect = await container.inspect();
    const mounts = inspect.Mounts ?? [];

    for (const mount of mounts) {
      if (mount.Type === 'volume' && mount.Name) {
        if (!volumeUsageMap[mount.Name]) volumeUsageMap[mount.Name] = [];
        volumeUsageMap[mount.Name].push(c.Names[0]?.replace('/', '') ?? c.Id.slice(0, 12));
      }
    }
  }

  return (Volumes ?? []).map((v) => ({
    name: v.Name,
    driver: v.Driver,
    mountpoint: v.Mountpoint,
    usedByContainers: volumeUsageMap[v.Name] ?? [],
  }));
}
