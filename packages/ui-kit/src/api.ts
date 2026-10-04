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

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string) {
  const code = currency.toUpperCase();
  let formatter = currencyFormatters.get(code);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
    });
    currencyFormatters.set(code, formatter);
  }
  return formatter;
}

export function minorUnitDigits(currency = 'USD'): number {
  return (
    currencyFormatter(currency).resolvedOptions().maximumFractionDigits ?? 2
  );
}

function toMinorBigInt(minor: string | number | bigint): bigint | undefined {
  try {
    if (typeof minor === 'number') {
      return Number.isFinite(minor) ? BigInt(Math.round(minor)) : undefined;
    }
    return BigInt(minor);
  } catch {
    return undefined;
  }
}

export function minorToDecimal(
  minor: string | number | bigint,
  currency = 'USD',
): string {
  const value = toMinorBigInt(minor);
  if (value === undefined) return '';
  const digits = minorUnitDigits(currency);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(digits);
  const whole = (absolute / scale).toString();
  const fraction = (absolute % scale).toString().padStart(digits, '0');
  return `${negative ? '-' : ''}${whole}${digits ? `.${fraction}` : ''}`;
}

export function decimalToMinor(
  text: string,
  currency = 'USD',
): string | undefined {
  const digits = minorUnitDigits(currency);
  const value = text.trim().replaceAll(',', '');
  const pattern =
    digits > 0 ? new RegExp(`^\\d+(\\.\\d{0,${digits}})?$`) : /^\d+$/;
  if (!pattern.test(value)) return undefined;
  const [whole = '0', fraction = ''] = value.split('.');
  const scale = 10n ** BigInt(digits);
  return (
    BigInt(whole || '0') * scale +
    BigInt((fraction + '0'.repeat(digits)).slice(0, digits) || '0')
  ).toString();
}

export const money = (minor: string | number | bigint, currency = 'USD') => {
  const decimal = minorToDecimal(minor, currency);
  if (!decimal) return '—';
  return currencyFormatter(currency).format(
    decimal as Intl.StringNumericLiteral,
  );
};

export const dateTime = (value: string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
