import { useQuery } from '@tanstack/react-query';
import { api } from '@internal-tools/ui-kit';
import type {
  Approval,
  AuditEntry,
  Charge,
  ChargeSort,
  DashboardSummary,
  ReconciliationException,
  Refund,
} from './types.js';

type ChargeFilters = {
  query: string;
  from: string;
  to: string;
  minMinor: string;
  maxMinor: string;
  sort: ChargeSort;
  cursor?: string;
};

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardSummary>('/api/dashboard'),
  });
}

export function useCharges({
  query,
  from,
  to,
  minMinor,
  maxMinor,
  sort,
  cursor,
}: ChargeFilters) {
  return useQuery({
    queryKey: ['charges', query, from, to, minMinor, maxMinor, sort, cursor],
    queryFn: () => {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (minMinor) params.set('minMinor', minMinor);
      if (maxMinor) params.set('maxMinor', maxMinor);
      params.set('sort', sort);
      if (cursor) params.set('cursor', cursor);
      return api<{ items: Charge[]; nextCursor: string | null }>(
        `/api/charges?${params}`,
      );
    },
  });
}

export function useCharge(chargeId: string) {
  return useQuery({
    queryKey: ['charge', chargeId],
    queryFn: () => api<Charge>(`/api/charges/${chargeId}`),
  });
}

export function useRefunds(filter: string) {
  return useQuery({
    queryKey: ['refunds', filter],
    queryFn: () =>
      api<{ items: Refund[] }>(
        filter === 'all' ? '/api/refunds' : `/api/refunds?status=${filter}`,
      ),
    refetchInterval: 2_000,
  });
}

export function useRefund(id: string) {
  return useQuery({
    queryKey: ['refund', id],
    queryFn: () => api<Refund>(`/api/refunds/${encodeURIComponent(id)}`),
  });
}

export function useRefundApprovals() {
  return useQuery({
    queryKey: ['approvals'],
    queryFn: () => api<{ items: Approval[] }>('/api/approvals?tool=refunds'),
  });
}

export function useExceptions(poll = false) {
  return useQuery({
    queryKey: ['exceptions'],
    queryFn: () => api<{ items: ReconciliationException[] }>('/api/exceptions'),
    refetchInterval: poll ? 2_000 : false,
  });
}

export function useAuditEvents() {
  return useQuery({
    queryKey: ['audit'],
    queryFn: () => api<{ items: AuditEntry[] }>('/api/audit'),
  });
}
