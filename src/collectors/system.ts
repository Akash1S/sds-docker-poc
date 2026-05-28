import Docker from 'dockerode';

export interface SystemInfo {
  dockerVersion: string;
  apiVersion: string;
  os: string;
  architecture: string;
  totalMemoryMB: number;
  cpuCount: number;
  totalContainers: number;
  runningContainers: number;
  stoppedContainers: number;
  pausedContainers: number;
  totalImages: number;
  disk: DiskUsage;
  warnings: string[];
}

export interface DiskUsage {
  imagesSizeMB: number;
  containersSizeMB: number;
  volumesSizeMB: number;
  buildCacheSizeMB: number;
  totalSizeMB: number;
}

export async function collectSystemInfo(docker: Docker): Promise<SystemInfo> {
  const [info, version, df] = await Promise.all([
    docker.info(),
    docker.version(),
    docker.df(),
  ]);

  // disk usage
  const imageSize = (df.Images ?? []).reduce((sum: number, img: any) => sum + (img.Size ?? 0), 0);
  const containerSize = (df.Containers ?? []).reduce((sum: number, c: any) => sum + (c.SizeRw ?? 0), 0);
  const volumeSize = (df.Volumes ?? []).reduce((sum: number, v: any) => sum + (v.UsageData?.Size ?? 0), 0);
  const buildCacheSize = (df.BuildCache ?? []).reduce((sum: number, b: any) => sum + (b.Size ?? 0), 0);

  const toMB = (bytes: number) => parseFloat((bytes / 1024 / 1024).toFixed(1));

  const disk: DiskUsage = {
    imagesSizeMB: toMB(imageSize),
    containersSizeMB: toMB(containerSize),
    volumesSizeMB: toMB(volumeSize),
    buildCacheSizeMB: toMB(buildCacheSize),
    totalSizeMB: toMB(imageSize + containerSize + volumeSize + buildCacheSize),
  };

  return {
    dockerVersion: version.Version ?? 'unknown',
    apiVersion: version.ApiVersion ?? 'unknown',
    os: `${info.OperatingSystem ?? ''} (${info.KernelVersion ?? ''})`.trim(),
    architecture: info.Architecture ?? 'unknown',
    totalMemoryMB: toMB(info.MemTotal ?? 0),
    cpuCount: info.NCPU ?? 0,
    totalContainers: info.Containers ?? 0,
    runningContainers: info.ContainersRunning ?? 0,
    stoppedContainers: info.ContainersStopped ?? 0,
    pausedContainers: info.ContainersPaused ?? 0,
    totalImages: info.Images ?? 0,
    disk,
    warnings: info.Warnings ?? [],
  };
}
