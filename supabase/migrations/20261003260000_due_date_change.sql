-- Office task for a tenant who asked to move their rent due date (e.g. the day after payday)
-- after a payment was confirmed. It does not pause collection.

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
    'missed_promises',
    'due_date_change'
  ));