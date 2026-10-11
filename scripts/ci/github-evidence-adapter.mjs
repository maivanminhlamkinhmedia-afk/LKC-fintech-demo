import {EvidenceInputError, requireEvidence, parseJsonBytes, collectJsonBytes, JSON_LIMITS} from './trusted-evidence-json.mjs';

// G02-N2: these capabilities are installed by trusted code, never PR JSON.
// OFFLINE ONLY: no default HTTP client, token issuer, refresh or credential loader.
// A future broker must actually verify App/installation/repository grants. The
// synthetic broker contract exercised here is not evidence of that deployment.
const PERMISSIONS = Object.freeze({metadata: 'read', actions: 'read', pull_requests: 'read', contents: 'read'});
const positive = (n) => Number.isSafeInteger(n) && n > 0;
export function readBootstrap(bytes) {
  const b = parseJsonBytes(bytes, {maxBytes: JSON_LIMITS.document});
  requireEvidence(b && Object.keys(b).sort().join(',') === 'accountId,appId,installationId,repository' &&
    positive(b.appId) && positive(b.installationId) && positive(b.accountId) &&
    b.repository && Object.keys(b.repository).sort().join(',') === 'fullName,id' && positive(b.repository.id) &&
    typeof b.repository.fullName === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(b.repository.fullName) &&
    !['.', '..'].includes(b.repository.fullName.split('/')[1]), 'BOOTSTRAP_INVALID');
  return Object.freeze({...b, repository: Object.freeze(b.repository)});
}

function endpointAllowed(path, prefix) {
  if (typeof path !== 'string' || !path.startsWith(prefix) || /[%#\\\x00-\x20\x7f]/.test(path)) return false;
  const rest = path.slice(prefix.length), n = '[1-9][0-9]{0,14}';
  return rest === '' || [
    `^/pulls/${n}$`, `^/pulls/${n}/reviews\\?per_page=100&page=(?:[1-9]|10)$`,
    `^/actions/runs/${n}$`, `^/actions/runs/${n}/attempts/${n}$`,
    `^/actions/runs/${n}/attempts/${n}/jobs\\?per_page=100&page=[12]$`,
    `^/actions/workflows/${n}/runs\\?head_sha=[a-f0-9]{40}&event=pull_request&per_page=100&page=(?:[1-9]|10)$`,
    '^/git/commits/[a-f0-9]{40}$',
  ].some((expression) => new RegExp(expression).test(rest));
}

export async function openGitHubEvidenceAdapter({executionMode, bootstrapJson, broker, transport,
  now = Date.now, signal: evaluationSignal} = {}) {
  try {
    requireEvidence(executionMode === 'OFFLINE_SYNTHETIC' && typeof broker === 'function' &&
      typeof transport === 'function' && typeof now === 'function', 'TRUSTED_CAPABILITY_MISSING');
    const bootstrap = readBootstrap(bootstrapJson), prefix = `/repos/${bootstrap.repository.fullName}`;
    // Broker response is raw bytes too. It never becomes part of a report.
    const credential = parseJsonBytes(await bounded((signal) => broker(Object.freeze({bootstrap, signal}))), {maxBytes: JSON_LIMITS.document});
    requireEvidence(credential?.schemaVersion === 1 && credential.scopeVerified === true &&
      credential.appId === bootstrap.appId && credential.installationId === bootstrap.installationId &&
      credential.accountId === bootstrap.accountId && credential.repository?.id === bootstrap.repository.id &&
      credential.repository?.fullName === bootstrap.repository.fullName, 'BROKER_IDENTITY_MISMATCH');
    requireEvidence(credential.permissions && Object.keys(credential.permissions).sort().join(',') === Object.keys(PERMISSIONS).sort().join(',') &&
      Object.entries(PERMISSIONS).every(([key, val]) => credential.permissions[key] === val), 'BROKER_PERMISSION_MISMATCH');
    requireEvidence(typeof credential.token === 'string' && /^[A-Za-z0-9_-]{8,2048}$/.test(credential.token) &&
      Number.isSafeInteger(credential.issuedAt) && Number.isSafeInteger(credential.expiresAt) &&
      credential.expiresAt > credential.issuedAt && credential.expiresAt - credential.issuedAt <= 3600000, 'BROKER_CREDENTIAL_INVALID');
    function current() {
      const time = now();
      requireEvidence(Number.isSafeInteger(time) && time >= credential.issuedAt && time < credential.expiresAt, 'BROKER_CREDENTIAL_EXPIRED');
    }
    async function bounded(operation, callerSignal) {
      const controller = new AbortController();
      const signals = [controller.signal, evaluationSignal, callerSignal].filter(Boolean);
      const signal = AbortSignal.any(signals);
      requireEvidence(!signal.aborted, 'ADAPTER_ABORTED');
      let timer, onAbort;
      try {
        const timeout = new Promise((_, reject) => {
          onAbort = () => reject(new EvidenceInputError('ADAPTER_ABORTED'));
          signal.addEventListener('abort', onAbort, {once: true});
          timer = setTimeout(() => { controller.abort(); }, 5000);
        });
        return await Promise.race([Promise.resolve().then(() => operation(signal)), timeout]);
      } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
    }
    async function readGitHub(request = {}) {
      try {
        const {method, path, signal} = request;
        requireEvidence(method === 'GET' && endpointAllowed(path, prefix), 'ENDPOINT_FORBIDDEN');
        current();
        const text = await bounded(async (requestSignal) => {
          const response = await transport(Object.freeze({method: 'GET', url: `https://api.github.com${path}`,
            headers: Object.freeze({Authorization: `Bearer ${credential.token}`, Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28', 'Accept-Encoding': 'identity'}), signal: requestSignal}));
          requireEvidence(response?.status === 200, response?.status === 429 ? 'API_RATE_LIMITED' : 'API_HTTP_DENIED');
          requireEvidence(response.headers && Object.keys(response.headers).every((h) => h === h.toLowerCase()) &&
            /^application\/(?:json|vnd\.github\+json)(?:;\s*charset=utf-8)?$/i.test(response.headers['content-type'] ?? '') &&
            [undefined, 'identity'].includes(response.headers['content-encoding']), 'API_ENCODING_INVALID');
          // Compressed responses are denied, not inflated; no expansion bomb.
          const bytes = await collectJsonBytes(response.body, {signal: requestSignal});
          requireEvidence(!requestSignal.aborted, 'ADAPTER_ABORTED');
          const parsed = parseJsonBytes(bytes);
          if (path === prefix) requireEvidence(parsed?.id === bootstrap.repository.id &&
            parsed.full_name === bootstrap.repository.fullName, 'REPOSITORY_IDENTITY_MISMATCH');
          return bytes.toString('utf8');
        }, signal);
        current(); return text;
      } catch (error) {
        if (error instanceof EvidenceInputError) throw error;
        throw new EvidenceInputError('API_UNAVAILABLE');
      }
    }
    await readGitHub({method: 'GET', path: prefix}); // Authenticate repository binding before handing out the port.
    return Object.freeze({readGitHub, repository: bootstrap.repository});
  } catch (error) {
    if (error instanceof EvidenceInputError) throw error;
    throw new EvidenceInputError('BROKER_UNAVAILABLE');
  }
}
