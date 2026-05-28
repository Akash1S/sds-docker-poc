import Docker from 'dockerode';

export function createDockerClient(): Docker {
  const dockerHost = process.env.DOCKER_HOST ?? '';

  // TCP connection: DOCKER_HOST=tcp://192.168.1.10:2375
  if (dockerHost.startsWith('tcp://') || dockerHost.startsWith('http://')) {
    const url = new URL(dockerHost.replace('tcp://', 'http://'));
    const host = url.hostname;
    const port = parseInt(url.port) || 2375;
    console.log(`[Docker] Connecting via TCP → ${host}:${port}`);
    return new Docker({ host, port, protocol: 'http' });
  }

  // TLS connection: DOCKER_HOST=https://192.168.1.10:2376
  if (dockerHost.startsWith('https://')) {
    const url = new URL(dockerHost);
    const host = url.hostname;
    const port = parseInt(url.port) || 2376;
    const certPath = process.env.DOCKER_CERT_PATH ?? '';
    const fs = require('fs');
    console.log(`[Docker] Connecting via HTTPS/TLS → ${host}:${port}`);
    return new Docker({
      host,
      port,
      protocol: 'https',
      ca: certPath ? fs.readFileSync(`${certPath}/ca.pem`) : undefined,
      cert: certPath ? fs.readFileSync(`${certPath}/cert.pem`) : undefined,
      key: certPath ? fs.readFileSync(`${certPath}/key.pem`) : undefined,
    });
  }

  // Unix socket: DOCKER_HOST=unix:///var/run/docker.sock
  if (dockerHost.startsWith('unix://')) {
    const socketPath = dockerHost.replace('unix://', '');
    console.log(`[Docker] Connecting via Unix socket → ${socketPath}`);
    return new Docker({ socketPath });
  }

  // SSH tunnel (user forwards socket to localhost port before running POC):
  // DOCKER_HOST=tcp://localhost:2375  (after: ssh -nNT -L 2375:/var/run/docker.sock user@jumphost)

  // Default: local Docker socket
  const localSocket = process.platform === 'win32'
    ? '//./pipe/docker_engine'
    : '/var/run/docker.sock';

  console.log(`[Docker] Connecting via local socket → ${localSocket}`);
  return new Docker({ socketPath: localSocket });
}
