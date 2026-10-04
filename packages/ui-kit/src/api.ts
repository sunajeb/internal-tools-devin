export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method ?? 'GET')) {
    const csrf = document.cookie
      .split('; ')
      .find((part) => part.startsWith('csrf='))
      ?.split('=')[1];
    if (csrf) headers.set('x-csrf-token', decodeURIComponent(csrf));
  }
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }
  return data as T;
}

export const money = (minor: string | number | bigint, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(
    Number(minor) / 100,
  );

export const dateTime = (value: string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
