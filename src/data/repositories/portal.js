// Portal repository — the employee self-service portal has its own token (CNIC+PIN)
// and does not use the staff data client. This centralizes its network calls behind
// the platform seam. Behaviour identical to the previous in-file portalApi helper:
// throws on non-2xx with the server message.
import platform from '../../platform';

export async function portalRequest(path, { method = 'GET', body, token } = {}) {
  const res = await platform.net.fetch(`/api/portal${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || 'Request failed');
  return data;
}

export const portalRepo = { request: portalRequest };
export default portalRepo;
