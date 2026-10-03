-- Follow-up notes: after each conversation a model writes a short summary and the payment dates
-- the tenant promised. The next call reads them to spot repeated missed promises.

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS ai_notes jsonb;

COMMENT ON COLUMN public.calls.ai_notes IS
  'Model-written notes for the next conversation: { summary, promises: [{ date, amount, source }], flags }.';

-- Office task for a tenant who missed two or more promised payment dates.
ALTER TABLE public.office_tasks
  DROP CONSTRAINT IF EXISTS office_tasks_type_check;

ALTER TABLE public.office_tasks
  ADD CONSTRAINT office_tasks_type_check CHECK (type IN (
    'payment_match',
    'disputed_line',
    'assistance_paperwork',
    'tenant_portion',
    'move_out_deposit',
    'confirm_claim',
    'urgent_repair',
    'lease_change',
    'tenancy_at_risk',
    'missed_promises'
  ));
