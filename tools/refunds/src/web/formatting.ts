import { money } from '@internal-tools/ui-kit';
import type { TimelineEvent, Approval } from './types.js';

export function currencySymbol(currency: string) {
  return (
    new Intl.NumberFormat('en-US', { style: 'currency', currency })
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value ?? currency
  );
}

export function timelineLabel(event: TimelineEvent) {
  if (
    event.action === 'approval.approved' ||
    event.action === 'approval.rejected'
  ) {
    const step =
      typeof event.after?.stepIndex === 'number'
        ? ` step ${event.after.stepIndex + 1}`
        : '';
    return `Approval${step} ${event.action === 'approval.approved' ? 'approved' : 'declined'}`;
  }
  return event.action.replaceAll(/[._]/g, ' ');
}

export function approvalTitle(item: Approval) {
  return item.amount_minor
    ? `${money(item.amount_minor, item.currency || 'USD')} refund request`
    : 'Refund request';
}

export function humanizeKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase();
}

export function formatDetail(
  key: string,
  value: unknown,
  details: Record<string, unknown>,
) {
  if (value === null || value === undefined || value === '') return '—';
  if (/minor$/i.test(key) && /^-?\d+$/.test(String(value))) {
    return typeof details.currency === 'string'
      ? money(String(value), details.currency)
      : `${String(value)} minor units`;
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
