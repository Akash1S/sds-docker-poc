import Docker from 'dockerode';

export interface ImageInfo {
  id: string;
  repoTag: string;
  usesLatestTag: boolean;
  sizeMB: number;
  ageDays: number;
  createdAt: string;
  isOld: boolean;
  usedByContainers: string[];
}

const OLD_IMAGE_THRESHOLD_DAYS = 90;

export async function collectImages(docker: Docker): Promise<ImageInfo[]> {
  const images = await docker.listImages({ all: false });
  const containers = await docker.listContainers({ all: true });

  // map image id → container names
  const imageUsageMap: Record<string, string[]> = {};
  for (const c of containers) {
    const imgId = c.ImageID;
    if (!imageUsageMap[imgId]) imageUsageMap[imgId] = [];
    imageUsageMap[imgId].push(c.Names[0]?.replace('/', '') ?? c.Id.slice(0, 12));
  }

  const now = Date.now();
  const results: ImageInfo[] = [];

  for (const img of images) {
    const tags = img.RepoTags ?? ['<none>:<none>'];
    const repoTag = tags[0] ?? '<none>:<none>';
    const usesLatestTag = repoTag.endsWith(':latest') || repoTag.endsWith(':<none>');

    const createdMs = (img.Created ?? 0) * 1000;
    const ageDays = Math.floor((now - createdMs) / (1000 * 60 * 60 * 24));
    const sizeMB = parseFloat(((img.Size ?? 0) / 1024 / 1024).toFixed(1));

    results.push({
      id: img.Id.replace('sha256:', '').slice(0, 12),
      repoTag,
      usesLatestTag,
      sizeMB,
      ageDays,
      createdAt: new Date(createdMs).toISOString(),
      isOld: ageDays > OLD_IMAGE_THRESHOLD_DAYS,
      usedByContainers: imageUsageMap[img.Id] ?? [],
    });
  }

  return results;
}
