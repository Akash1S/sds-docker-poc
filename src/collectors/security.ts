import Docker from 'dockerode';

export interface SecurityInfo {
  containerName: string;
  image: string;
  isPrivileged: boolean;
  runningAsRoot: boolean;
  addedCapabilities: string[];
  sensitiveMounts: SensitiveMount[];
  exposedSecrets: ExposedSecret[];
  hasNoMemoryLimit: boolean;
  hasNoCpuLimit: boolean;
  hasNoRestartPolicy: boolean;
  readOnlyRootFs: boolean;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface SensitiveMount {
  hostPath: string;
  containerPath: string;
  reason: string;
}

export interface ExposedSecret {
  envKey: string;
  reason: string;
}

const SENSITIVE_HOST_PATHS = [
  { path: '/var/run/docker.sock', reason: 'Docker socket — full host Docker access' },
  { path: '/etc', reason: 'Host /etc — access to system config & credentials' },
  { path: '/proc', reason: 'Host /proc — kernel & process info exposure' },
  { path: '/sys', reason: 'Host /sys — kernel tuning access' },
  { path: '/root', reason: 'Host root home directory' },
  { path: '/', reason: 'Entire host filesystem mounted' },
];

const SECRET_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /api[_-]?key/i,
  /access[_-]?token/i,
  /auth[_-]?token/i,
  /private[_-]?key/i,
  /db[_-]?pass/i,
  /aws[_-]?secret/i,
  /jwt[_-]?secret/i,
];

export async function collectSecurity(docker: Docker): Promise<SecurityInfo[]> {
  const containers = await docker.listContainers({ all: true });
  const results: SecurityInfo[] = [];

  for (const c of containers) {
    const container = docker.getContainer(c.Id);
    const inspect = await container.inspect();
    const hc = inspect.HostConfig;

    const isPrivileged = hc.Privileged ?? false;
    const addedCapabilities = hc.CapAdd ?? [];
    const readOnlyRootFs = hc.ReadonlyRootfs ?? false;
    const hasNoMemoryLimit = !hc.Memory || hc.Memory === 0;
    const hasNoCpuLimit = !hc.CpuQuota || hc.CpuQuota === 0;
    const restartPolicy = hc.RestartPolicy?.Name ?? 'no';
    const hasNoRestartPolicy = restartPolicy === 'no' || restartPolicy === '';

    // detect root user
    const user = inspect.Config.User ?? '';
    const runningAsRoot = user === '' || user === 'root' || user === '0';

    // detect sensitive mounts
    const mounts = inspect.Mounts ?? [];
    const sensitiveMounts: SensitiveMount[] = [];
    for (const mount of mounts) {
      if (mount.Type !== 'bind') continue;
      const src = mount.Source ?? '';
      for (const s of SENSITIVE_HOST_PATHS) {
        if (src === s.path || src.startsWith(s.path + '/')) {
          sensitiveMounts.push({ hostPath: src, containerPath: mount.Destination ?? '', reason: s.reason });
        }
      }
    }

    // detect exposed secrets in env vars
    const envVars = inspect.Config.Env ?? [];
    const exposedSecrets: ExposedSecret[] = [];
    for (const env of envVars) {
      const [key] = env.split('=');
      if (SECRET_KEY_PATTERNS.some((p) => p.test(key))) {
        exposedSecrets.push({ envKey: key, reason: 'Sensitive key name detected in container env vars' });
      }
    }

    // risk scoring
    let riskScore = 0;
    if (isPrivileged) riskScore += 40;
    if (runningAsRoot) riskScore += 15;
    if (sensitiveMounts.some((m) => m.hostPath === '/var/run/docker.sock')) riskScore += 30;
    if (sensitiveMounts.length > 0) riskScore += sensitiveMounts.length * 10;
    if (addedCapabilities.length > 0) riskScore += addedCapabilities.length * 5;
    if (exposedSecrets.length > 0) riskScore += exposedSecrets.length * 5;
    if (hasNoMemoryLimit) riskScore += 10;

    riskScore = Math.min(riskScore, 100);
    const riskLevel =
      riskScore >= 70 ? 'critical' :
      riskScore >= 40 ? 'high' :
      riskScore >= 20 ? 'medium' : 'low';

    results.push({
      containerName: c.Names[0]?.replace('/', '') ?? c.Id.slice(0, 12),
      image: c.Image,
      isPrivileged,
      runningAsRoot,
      addedCapabilities,
      sensitiveMounts,
      exposedSecrets,
      hasNoMemoryLimit,
      hasNoCpuLimit,
      hasNoRestartPolicy,
      readOnlyRootFs,
      riskScore,
      riskLevel,
    });
  }

  return results;
}
