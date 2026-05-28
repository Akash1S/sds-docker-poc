// Strips actual secret VALUES from the payload before sending to Niriksha.
// redactPii() from the SDK covers PII (emails, phone numbers, SSNs, credit cards) only —
// it does NOT redact API keys, tokens, or passwords. Our own LOG_SECRET_PATTERNS handle those.
// We keep KEY names (e.g. "DATABASE_PASSWORD") so the dashboard shows secrets exist, but never send values.
import { redactPii } from '@nirikshaai/sdk';

const SECRET_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /api[_-]?key/i,
  /access[_-]?token/i,
  /auth[_-]?token/i,
  /private[_-]?key/i,
  /db[_-]?pass/i,
  /aws[_-]?secret/i,
  /aws[_-]?access/i,
  /jwt[_-]?secret/i,
  /client[_-]?secret/i,
  /app[_-]?secret/i,
  /encryption[_-]?key/i,
  /signing[_-]?key/i,
  /certificate/i,
  /token/i,
  /credential/i,
  /private/i,
];

const LOG_SECRET_PATTERNS = [
  // mask values after common assignment patterns in log lines
  /(password|passwd|secret|token|key|credential)[=:]["']?([^\s"',&]+)/gi,
  // Bearer tokens in HTTP logs
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  // Basic auth in URLs
  /:\/\/[^:]+:[^@]+@/g,
];

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((p) => p.test(key));
}


export function sanitizeLogLine(line: string): string {
  // First pass — SDK's built-in PII redaction (emails, IPs, phone numbers, etc.)
  let sanitized: string;
  try {
    sanitized = redactPii(line);
  } catch {
    sanitized = line;
  }

  // Second pass — our own secret pattern redaction (tokens, passwords, keys)
  for (const pattern of LOG_SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match, ...groups) => {
      if (groups.length >= 2 && groups[1]) {
        return match.replace(groups[1], '[REDACTED]');
      }
      return '[REDACTED]';
    });
  }
  return sanitized;
}

export function sanitizePayload(payload: any): any {
  const sanitized = JSON.parse(JSON.stringify(payload));

  // Sanitize security section — replace actual env key list with safe summary
  if (Array.isArray(sanitized.security)) {
    for (const s of sanitized.security) {
      if (Array.isArray(s.exposedSecretKeys)) {
        // keep key NAMES (so AI knows they exist) but add explicit note
        s.exposedSecretKeys = s.exposedSecretKeys.map(
          (k: string) => `${k} (value redacted)`
        );
      }
    }
  }

  // Sanitize log lines
  if (Array.isArray(sanitized.logs)) {
    for (const l of sanitized.logs) {
      if (Array.isArray(l.recentLines)) {
        l.recentLines = l.recentLines.map(sanitizeLogLine);
      }
      if (Array.isArray(l.errorLines)) {
        l.errorLines = l.errorLines.map(sanitizeLogLine);
      }
    }
  }

  return sanitized;
}
