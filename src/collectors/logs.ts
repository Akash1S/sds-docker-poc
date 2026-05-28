import Docker from 'dockerode';

export interface ContainerLogs {
  containerName: string;
  lines: string[];
}

const LOG_TAIL = 50;

export async function collectLogs(docker: Docker, containerNames: string[]): Promise<ContainerLogs[]> {
  const results: ContainerLogs[] = [];

  for (const name of containerNames) {
    try {
      const containers = await docker.listContainers({ all: false, filters: { name: [name] } });
      if (containers.length === 0) continue;

      const container = docker.getContainer(containers[0].Id);
      const logBuffer: Buffer = await new Promise((resolve, reject) => {
        container.logs({ stdout: true, stderr: true, tail: LOG_TAIL }, (err, data) => {
          if (err) reject(err);
          else resolve(data as Buffer);
        });
      });

      const raw = logBuffer.toString('utf8');
      const lines = raw
        .split('\n')
        .map((l) => l.replace(/[\x00-\x08\x0e-\x1f]/g, '').trim())
        .filter(Boolean);

      results.push({ containerName: name, lines });
    } catch {
      results.push({ containerName: name, lines: ['[could not fetch logs]'] });
    }
  }

  return results;
}
