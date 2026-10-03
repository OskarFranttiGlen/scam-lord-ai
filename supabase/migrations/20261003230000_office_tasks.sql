-- Office tasks: follow-ups the agent opens on a call (match a payment, review a disputed line,
-- send assistance paperwork, ...). A pausing task stops new collection calls on its invoice
-- until collection_paused_until.

CREATE TABLE IF NOT EXISTS public.office_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenancy_id uuid NOT NULL REFERENCES public.tenancies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  source_call_id uuid REFERENCES public.calls (id) ON UPDATE CASCADE ON DELETE SET NULL,
  stripe_invoice_id text,
  type text NOT NULL CHECK (type IN (
    'payment_match',
    'disputed_line',
    'assistance_paperwork',
    'tenant_portion',
    'move_out_deposit',
    'confirm_claim',
    'urgent_repair',
    'lease_change',
    'tenancy_at_risk'
  )),
  details text NOT NULL,
  due_date date NOT NULL,
  collection_paused_until date,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'done', 'canceled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.office_tasks IS
  'Follow-ups the agent opened for the property office during a conversation.';
COMMENT ON COLUMN public.office_tasks.collection_paused_until IS
  'No new collection call on stripe_invoice_id before this date while the task is open; null means no pause.';

CREATE INDEX IF NOT EXISTS office_tasks_tenancy_due_idx
  ON public.office_tasks (tenancy_id, due_date);

CREATE INDEX IF NOT EXISTS office_tasks_open_invoice_idx
  ON public.office_tasks (stripe_invoice_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS office_tasks_source_call_id_idx
  ON public.office_tasks (source_call_id)
  WHERE source_call_id IS NOT NULL;

ALTER TABLE public.office_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Landlords read own office tasks"
  ON public.office_tasks
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenancies t
      JOIN public.units u ON u.id = t.unit_id
      JOIN public.properties p ON p.id = u.property_id
      WHERE t.id = office_tasks.tenancy_id
        AND p.landlord_id = public.scam_lord_current_landlord_id()
    )
  );

REVOKE ALL ON TABLE public.office_tasks FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.office_tasks TO authenticated;
GRANT ALL ON TABLE public.office_tasks TO service_role;
