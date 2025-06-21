/**
 * API client for the FastAPI backend.
 */

const BASE = '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

// Recordings
export const getRecordings = () => fetchJson<any[]>('/recordings');
export const createRecording = (data: { channel: string; start_time: number; end_time?: number }) =>
  fetchJson<any>('/recordings', { method: 'POST', body: JSON.stringify(data) });
export const deleteRecording = (id: string) =>
  fetchJson<void>(`/recordings/${id}`, { method: 'DELETE' });

// Highlights
export const getHighlights = (page = 1, category?: string) => {
  const params = new URLSearchParams({ page: String(page) });
  if (category) params.set('category', category);
  return fetchJson<any>(`/highlights?${params}`);
};

// Clips
export const getClips = () => fetchJson<any[]>('/clips');
export const compileClips = (clipIds: string[]) =>
  fetchJson<any>('/clips/compile', { method: 'POST', body: JSON.stringify({ clip_ids: clipIds }) });

// Plugins
export const getPlugins = () => fetchJson<any[]>('/plugins');
export const updatePlugin = (name: string, data: { enabled: boolean; config?: Record<string, unknown> }) =>
  fetchJson<any>(`/plugins/${name}`, { method: 'PUT', body: JSON.stringify(data) });

// Matches
export const getUpcomingMatches = () => fetchJson<any[]>('/matches/upcoming');
export const getLiveMatches = () => fetchJson<any[]>('/matches/live');
export const recordMatch = (matchId: string) =>
  fetchJson<any>(`/matches/${matchId}/record`, { method: 'POST' });

// WebSocket
export function connectWebSocket(onMessage: (data: any) => void): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  return ws;
}
