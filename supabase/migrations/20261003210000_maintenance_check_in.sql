-- Check-in before collection: the agent hears tenant feedback first, logs maintenance
-- requests, and hands urgent repairs to a person.

CREATE TABLE IF NOT EXISTS public.maintenance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenancy_id uuid NOT NULL REFERENCES public.tenancies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  description text NOT NULL,
  urgency text NOT NULL DEFAULT 'routine'
    CHECK (urgency IN ('routine', 'urgent')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'scheduled', 'resolved')),
  reported_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  source_call_id uuid REFERENCES public.calls (id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.maintenance_requests IS
  'Repairs a tenant reported, by the agent during a conversation or seeded from the PMS.';
COMMENT ON COLUMN public.maintenance_requests.urgency IS
  'urgent: no heat or water, active leak, mould, gas, electrical hazard, broken lock, or unsafe.';
COMMENT ON COLUMN public.maintenance_requests.source_call_id IS
  'Conversation (calls row) where the agent logged it; null for requests from elsewhere.';

CREATE INDEX IF NOT EXISTS maintenance_requests_tenancy_reported_idx
  ON public.maintenance_requests (tenancy_id, reported_at DESC);

CREATE INDEX IF NOT EXISTS maintenance_requests_source_call_id_idx
  ON public.maintenance_requests (source_call_id)
  WHERE source_call_id IS NOT NULL;

ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Landlords read own maintenance requests"
  ON public.maintenance_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenancies t
      JOIN public.units u ON u.id = t.unit_id
      JOIN public.properties p ON p.id = u.property_id
      WHERE t.id = maintenance_requests.tenancy_id
        AND p.landlord_id = public.scam_lord_current_landlord_id()
    )
  );

REVOKE ALL ON TABLE public.maintenance_requests FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.maintenance_requests TO authenticated;
GRANT ALL ON TABLE public.maintenance_requests TO service_role;

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS tenant_feedback text;

COMMENT ON COLUMN public.calls.tenant_feedback IS
  'What the tenant said at the check-in before collection, or "declined".';

ALTER TABLE public.calls DROP CONSTRAINT IF EXISTS calls_handoff_reason_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_handoff_reason_check CHECK (
  handoff_reason IS NULL
  OR handoff_reason IN ('hardship', 'dispute', 'distressed', 'urgent_maintenance')
);
