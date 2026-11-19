/** Same-origin, authenticated Netlify → private hybrid worker proxy.
 * Never takes a destination URL from the browser. No AI provider secrets ship to the browser.
 * Netlify Free synchronous functions have a 60-second limit; all long jobs run on the worker.
 */
const getEnv = (key) => globalThis.Netlify?.env?.get(key) ?? process.env[key] ?? '';
const json = (data, code = 200) => new Response(JSON.stringify(data), { status: code, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async function handler(request) {
  const accessCode = getEnv('VAULT_ACCESS_CODE');
  const workerToken = getEnv('VAULT_WORKER_TOKEN');
  const workerURL = getEnv('VAULT_WORKER_URL');
  if (!workerURL || !workerToken || !accessCode) return json({ error: 'Server configuration incomplete: VAULT_WORKER_URL, VAULT_WORKER_TOKEN and VAULT_ACCESS_CODE are required.' }, 503);
  if (request.headers.get('x-vault-access-code') !== accessCode) return json({ error: 'Invalid studio access code.' }, 401);
  const url = new URL(request.url);
  const match = url.pathname.match(/(?:\/api\/|\/proxy\/)(jobs(?:\/[a-f0-9-]+(?:\/(?:result|identity))?)?|health|capabilities)$/);
  if (!match) return json({ error: 'Unknown endpoint.' }, 404);
  const path = match[1];
  const allowed = (path === 'health' || path === 'capabilities') ? request.method === 'GET'
    : (path === 'jobs' ? request.method === 'POST'
    : (path.endsWith('/identity') ? ['GET','POST'].includes(request.method) : request.method === 'GET'));
  if (!allowed) return json({ error: 'Method not allowed.' }, 405);
  let upstreamURL;
  try {
    const base = new URL(workerURL);
    if (base.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(base.hostname)) throw new Error('HTTPS required');
    upstreamURL = new URL(`v1/${path}`, base.href.endsWith('/') ? base.href : `${base.href}/`);
  } catch { return json({ error: 'Invalid worker URL; use an HTTPS endpoint.' }, 503); }
  const opts = { method: request.method, headers: { authorization: `Bearer ${workerToken}` } };
  if (request.method === 'POST') {
    const size = Number(request.headers.get('content-length') ?? 0);
    if (size > 4_000_000) return json({ error: 'References exceed the Netlify 4 MB request limit. Compress and retry.' }, 413);
    const payload = await request.arrayBuffer();
    if (payload.byteLength > 4_000_000) return json({ error: 'References exceed the Netlify 4 MB request limit.' }, 413);
    opts.body = payload;
    opts.headers['content-type'] = request.headers.get('content-type') ?? 'application/octet-stream';
  }
  try {
    const response = await fetch(upstreamURL, opts);
    const type = response.headers.get('content-type') ?? 'application/octet-stream';
    if (!type.startsWith('application/json') && !type.startsWith('image/png')) return json({ error: 'Worker returned an unexpected response.' }, 502);
    return new Response(response.body, { status: response.status, headers: { 'content-type': type, 'cache-control': 'no-store' } });
  } catch { return json({ error: 'AI worker is currently unreachable. Ensure the worker and tunnel are running.' }, 502); }
}
