import { useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, ShieldCheck, XCircle } from 'lucide-react';
import {
  api,
  decimalToMinor,
  Dialog,
  minorToDecimal,
  money,
} from '@internal-tools/ui-kit';
import { CloseButton } from './common.js';
import { currencySymbol } from '../formatting.js';
import type { Charge, Refund } from '../types.js';

export function RefundDialog({
  charge,
  onClose,
}: {
  charge: Charge;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const currency = charge.currency.toUpperCase();
  const refundableMinor =
    charge.refundable_minor ??
    String(BigInt(charge.amount_minor) - BigInt(charge.refunded_minor));
  const [amountText, setAmountText] = useState(() =>
    minorToDecimal(refundableMinor, currency),
  );
  const [reason, setReason] = useState('service_issue');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const titleId = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const parsedMinor = decimalToMinor(amountText, currency);
  const amountMinor = parsedMinor === undefined ? 0n : BigInt(parsedMinor);
  const amountError =
    parsedMinor === undefined
      ? `Enter an amount in ${currency}, for example ${minorToDecimal(2500, currency)}.`
      : amountMinor <= 0n
        ? 'Enter an amount that is more than zero.'
        : amountMinor > BigInt(refundableMinor)
          ? `The amount is more than the available balance of ${money(refundableMinor, currency)}.`
          : '';
  const noteError =
    note.trim().length < 10
      ? `Enter a note of 10 or more characters. The note has ${note.trim().length}.`
      : '';
  const showAmountError = Boolean(
    amountError && (submitAttempted || amountText !== ''),
  );
  const showNoteError = Boolean(noteError && submitAttempted);
  const cumulativeMinor = BigInt(charge.refunded_minor) + amountMinor;
  const tier =
    cumulativeMinor <= 25_000n
      ? 'Instant refund'
      : cumulativeMinor <= 500_000n
        ? 'Supervisor approval'
        : 'Supervisor + Finance approval';
  const mutation = useMutation({
    mutationFn: () =>
      api<Refund>('/api/refunds', {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify({
          chargeId: charge.id,
          amountMinor: amountMinor.toString(),
          reasonCode: reason,
          note,
        }),
      }),
    onSuccess: () => {
      client.invalidateQueries();
      onClose();
    },
    onError: (caught: Error) => setError(caught.message),
  });
  return (
    <Dialog onClose={onClose} labelledBy={titleId}>
      <div className="modal-head">
        <div>
          <p className="eyebrow">NEW REFUND REQUEST</p>
          <h2 id={titleId}>Refund payment</h2>
          <p className="modal-subtitle">
            {charge.id} · {money(charge.amount_minor, charge.currency)} original
            payment
          </p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitAttempted(true);
          if (amountError) {
            amountRef.current?.focus();
            return;
          }
          if (noteError) {
            noteRef.current?.focus();
            return;
          }
          mutation.mutate();
        }}
      >
        <label className="field-label" htmlFor="refund-amount">
          Refund amount <span>{currency}</span>
        </label>
        <div className="money-input">
          <span aria-hidden="true">{currencySymbol(currency)}</span>
          <input
            ref={amountRef}
            id="refund-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            data-autofocus
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            aria-invalid={showAmountError}
            aria-describedby={
              showAmountError
                ? 'refund-amount-error refund-amount-balance'
                : 'refund-amount-balance'
            }
            required
          />
        </div>
        {showAmountError && (
          <p className="field-error" id="refund-amount-error">
            {amountError}
          </p>
        )}
        <div className="balance-hint" id="refund-amount-balance">
          Available to refund: <b>{money(refundableMinor, charge.currency)}</b>
          <button
            type="button"
            onClick={() =>
              setAmountText(minorToDecimal(refundableMinor, currency))
            }
          >
            Use full balance
          </button>
        </div>
        <label className="field-label" htmlFor="reason">
          Reason code
        </label>
        <select
          id="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        >
          <option value="service_issue">Service issue</option>
          <option value="duplicate">Duplicate payment</option>
          <option value="fraud_review">Fraud review</option>
          <option value="goodwill">Goodwill</option>
          <option value="other">Other</option>
        </select>
        <label className="field-label" htmlFor="note">
          Internal note <span aria-hidden="true">{note.length}/1,000</span>
        </label>
        <textarea
          ref={noteRef}
          id="note"
          minLength={10}
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add context for reviewers (10–1,000 characters)"
          aria-invalid={showNoteError}
          aria-describedby="note-hint"
          required
        />
        <p
          className={showNoteError ? 'field-error' : 'field-hint'}
          id="note-hint"
        >
          {showNoteError
            ? noteError
            : 'Enter 10 to 1,000 characters. Reviewers see this note.'}
        </p>
        <div className="tier-preview" aria-live="polite">
          <div className="tier-shield" aria-hidden="true">
            <ShieldCheck size={18} />
          </div>
          <div>
            <span>APPROVAL PREVIEW</span>
            <b>{tier}</b>
            <small>
              {tier === 'Instant refund'
                ? 'This request can execute after submission.'
                : 'This request will appear in the eligible approver inbox.'}
            </small>
          </div>
          <span className="tier-policy">POLICY V3</span>
        </div>
        {error && (
          <div className="form-error" role="alert">
            <XCircle size={15} aria-hidden />
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-btn"
            type="submit"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Submitting…' : 'Submit request'}{' '}
            <ArrowUpRight size={16} aria-hidden />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
