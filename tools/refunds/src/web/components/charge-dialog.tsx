import { useEffect, useId, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowDownLeft } from 'lucide-react';
import {
  api,
  dateTime,
  Dialog,
  ErrorState,
  LoadingState,
  money,
} from '@internal-tools/ui-kit';
import { Detail, CloseButton, StatusBadge } from './common.js';
import type { User, Charge } from '../types.js';
import { useCharge } from '../hooks.js';
import { can } from '../permissions.js';

export function ChargeDialog({
  chargeId,
  user,
  onClose,
  onRequest,
}: {
  chargeId: string;
  user: User;
  onClose: () => void;
  onRequest: (charge: Charge) => void;
}) {
  const [revealedEmail, setRevealedEmail] = useState<string>();
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealReason, setRevealReason] = useState('');
  const [revealAttempted, setRevealAttempted] = useState(false);
  const revealButtonRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const canRequest = can(user, 'refund.request');
  const titleId = useId();
  const revealFormId = useId();
  const reasonId = useId();
  const reasonError =
    revealReason.trim().length < 10
      ? `Enter a reason of 10 or more characters. The reason has ${revealReason.trim().length}.`
      : '';
  const showReasonError = Boolean(reasonError && revealAttempted);
  useEffect(() => {
    if (revealOpen) reasonRef.current?.focus();
  }, [revealOpen]);
  const { data: charge, isLoading, error, refetch } = useCharge(chargeId);
  const reveal = useMutation({
    mutationFn: (reason: string) =>
      api<{ customerEmail: string }>(`/api/charges/${chargeId}/reveal-email`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: (result) => {
      setRevealedEmail(result.customerEmail);
      setRevealOpen(false);
    },
  });
  const closeReveal = () => {
    setRevealOpen(false);
    setRevealReason('');
    setRevealAttempted(false);
    reveal.reset();
    revealButtonRef.current?.focus();
  };
  if (isLoading || !charge)
    return (
      <Dialog onClose={onClose} label="Payment detail">
        <div className="modal-head">
          <div>
            <p className="eyebrow">PAYMENT DETAIL</p>
            <h2>{chargeId}</h2>
          </div>
          <CloseButton onClose={onClose} />
        </div>
        {error ? (
          <ErrorState
            title="The payment is not available"
            error={error}
            onRetry={() => void refetch()}
          />
        ) : (
          <LoadingState label="Loading payment" />
        )}
      </Dialog>
    );
  return (
    <Dialog onClose={onClose} labelledBy={titleId}>
      <div className="modal-head">
        <div>
          <p className="eyebrow">PAYMENT DETAIL</p>
          <h2 id={titleId}>{charge.id}</h2>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <div className="detail-highlight">
        <div>
          <span>Payment amount</span>
          <b>{money(charge.amount_minor, charge.currency)}</b>
        </div>
        <div>
          <span>Refundable balance</span>
          <b className="green-text">
            {money(charge.refundable_minor ?? '0', charge.currency)}
          </b>
        </div>
      </div>
      <div className="detail-list">
        <Detail label="Customer" value={charge.customer_id} />
        <div className="detail-row">
          <span>Email</span>
          <b>{revealedEmail ?? charge.customer_email}</b>
          {can(user, 'customer.reveal') && (
            <button
              ref={revealButtonRef}
              type="button"
              className="reveal-btn"
              aria-label={revealedEmail ? 'Email revealed' : 'Reveal email'}
              aria-expanded={revealedEmail ? undefined : revealOpen}
              aria-controls={revealOpen ? revealFormId : undefined}
              onClick={() => setRevealOpen(true)}
              disabled={revealOpen || Boolean(revealedEmail)}
            >
              {revealedEmail ? 'Revealed' : 'Reveal'}
            </button>
          )}
        </div>
        {revealOpen && !revealedEmail && (
          <form
            id={revealFormId}
            className="reveal-form"
            aria-label="Reveal email"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setRevealAttempted(true);
              if (reasonError) {
                reasonRef.current?.focus();
                return;
              }
              reveal.mutate(revealReason.trim());
            }}
          >
            <label htmlFor={reasonId}>Reason for reveal</label>
            <textarea
              id={reasonId}
              ref={reasonRef}
              value={revealReason}
              maxLength={500}
              required
              aria-invalid={showReasonError}
              aria-describedby={`${reasonId}-hint${showReasonError ? ` ${reasonId}-error` : ''}`}
              placeholder="For example: customer asked for a receipt by email"
              onChange={(event) => setRevealReason(event.target.value)}
            />
            <p id={`${reasonId}-hint`} className="field-hint">
              The audit log keeps this reason. Enter 10 to 500 characters.
            </p>
            {showReasonError && (
              <p id={`${reasonId}-error`} className="field-error">
                {reasonError}
              </p>
            )}
            {reveal.error && (
              <p className="field-error" role="alert">
                The email was not revealed. {reveal.error.message}
              </p>
            )}
            <div className="reveal-actions">
              <button
                type="button"
                className="secondary-btn small-btn"
                onClick={closeReveal}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary-btn small-btn"
                disabled={reveal.isPending}
              >
                {reveal.isPending ? 'Revealing…' : 'Reveal email'}
              </button>
            </div>
          </form>
        )}
        <Detail
          label="Card"
          value={`${charge.card_brand.toUpperCase()} ending ${charge.card_last4}`}
        />
        <Detail label="Created" value={dateTime(charge.created_at)} />
      </div>
      <h3 className="section-subtitle">Refund history</h3>
      {(charge.refunds ?? []).length ? (
        <ul className="mini-list" aria-label="Refund history">
          {charge.refunds?.map((refund) => (
            <li key={refund.id}>
              <span className="timeline-dot" aria-hidden="true" />
              <div>
                <b>
                  {money(refund.amount_minor, refund.currency)} ·{' '}
                  {refund.reason_code.replaceAll('_', ' ')}
                </b>
                <small>{dateTime(refund.created_at)}</small>
              </div>
              <StatusBadge status={refund.status} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-inline">
          No refunds have been requested for this payment.
        </p>
      )}
      {canRequest && BigInt(charge.refundable_minor ?? '0') <= 0n && (
        <p className="field-hint">
          This payment has no refundable balance. You cannot request a refund.
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="secondary-btn" onClick={onClose}>
          Close
        </button>
        {canRequest && (
          <button
            type="button"
            className="primary-btn"
            onClick={() => onRequest(charge)}
            disabled={BigInt(charge.refundable_minor ?? '0') <= 0n}
          >
            Request refund <ArrowDownLeft size={16} aria-hidden />
          </button>
        )}
      </div>
    </Dialog>
  );
}
