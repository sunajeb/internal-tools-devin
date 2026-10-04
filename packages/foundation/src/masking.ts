export type FieldClass = 'public' | 'internal' | 'confidential' | 'restricted';

export function maskValue(
  value: string | null,
  dataClass: FieldClass,
  canReveal: boolean,
): string | null {
  if (
    value === null ||
    dataClass === 'public' ||
    dataClass === 'internal' ||
    canReveal
  )
    return value;
  if (dataClass === 'confidential') return '••••••••';
  return '[REDACTED]';
}
