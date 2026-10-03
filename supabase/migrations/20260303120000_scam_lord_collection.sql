-- ScamLord portfolio, policy, calls, and plans (docs/SPEC.md, docs/pms.md).
-- Landlord dashboard rows are scoped by auth.users via landlords.user_id.

-- ---------------------------------------------------------------------------
-- landlords
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.landlords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON UPDATE CASCADE ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  stripe_customer_id text,
  stripe_connected_account_id text,
  external_pms_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.landlords IS
  'Property manager account: auth user, Stripe billing + Connect ids, PMS external id.';
COMMENT ON COLUMN public.landlords.stripe_customer_id IS
  'Stripe Customer for ScamLord outcome usage billing.';
COMMENT ON COLUMN public.landlords.stripe_connected_account_id IS
  'Stripe Connect account that receives rent payouts.';

CREATE INDEX IF NOT EXISTS landlords_external_pms_id_idx
  ON public.landlords (external_pms_id)
  WHERE external_pms_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- properties
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id uuid NOT NULL REFERENCES public.landlords (id) ON UPDATE CASCADE ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL,
  external_pms_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.properties IS 'Synced or seeded property; belongs to one landlord.';

CREATE INDEX IF NOT EXISTS properties_landlord_id_idx
  ON public.properties (landlord_id);

CREATE UNIQUE INDEX IF NOT EXISTS properties_landlord_external_pms_id_key
  ON public.properties (landlord_id, external_pms_id)
  WHERE external_pms_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- units
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties (id) ON UPDATE CASCADE ON DELETE CASCADE,
  label text NOT NULL,
  external_pms_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.units IS 'Unit within a property (e.g. Apt 2B).';

CREATE INDEX IF NOT EXISTS units_property_id_idx
  ON public.units (property_id);

CREATE UNIQUE INDEX IF NOT EXISTS units_property_external_pms_id_key
  ON public.units (property_id, external_pms_id)
  WHERE external_pms_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- tenancies
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tenancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.units (id) ON UPDATE CASCADE ON DELETE CASCADE,
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  language text NOT NULL DEFAULT 'en',
  stripe_customer_id text,
  external_pms_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tenancies IS
  'Tenant contact row mapped to a unit; Stripe customer id links invoices.';

CREATE INDEX IF NOT EXISTS tenancies_unit_id_idx
  ON public.tenancies (unit_id);

CREATE INDEX IF NOT EXISTS tenancies_stripe_customer_id_idx
  ON public.tenancies (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenancies_external_pms_id_key
  ON public.tenancies (external_pms_id)
  WHERE external_pms_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- policies (one row per landlord)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id uuid NOT NULL UNIQUE REFERENCES public.landlords (id) ON UPDATE CASCADE ON DELETE CASCADE,
  max_installments integer NOT NULL CHECK (max_installments >= 1),
  grace_days integer NOT NULL CHECK (grace_days >= 0),
  fee_waiver_cap numeric(12, 2) NOT NULL CHECK (fee_waiver_cap >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.policies IS
  'Landlord-set collection limits enforced in policy code before offers.';

-- ---------------------------------------------------------------------------
-- perks
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.perks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id uuid NOT NULL REFERENCES public.landlords (id) ON UPDATE CASCADE ON DELETE CASCADE,
  body text NOT NULL,
  condition_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.perks IS
  'Landlord-written sweetener plus when it may be offered (condition_text).';
COMMENT ON COLUMN public.perks.body IS 'Spoken perk line, e.g. mow the lawn this weekend.';
COMMENT ON COLUMN public.perks.condition_text IS
  'When the perk applies, e.g. pay the open balance today.';

CREATE INDEX IF NOT EXISTS perks_landlord_id_idx
  ON public.perks (landlord_id);

-- ---------------------------------------------------------------------------
-- calls
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenancy_id uuid NOT NULL REFERENCES public.tenancies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  stripe_invoice_id text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'waiting_on_person', 'paid')),
  transcript text,
  jev_checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  handoff_reason text
    CHECK (
      handoff_reason IS NULL
      OR handoff_reason IN ('hardship', 'dispute', 'distressed')
    ),
  twilio_message_sid text,
  resend_email_id text,
  photo_path text,
  photo_summary text,
  livekit_room_name text UNIQUE,
  payment_link_sent boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.calls IS
  'Agent call record: invoice, transcript, Jev trace, messaging ids, photo summary.';
COMMENT ON COLUMN public.calls.jev_checks IS
  'Array of check objects: transcript window, criteria, probabilities, outcome.';
COMMENT ON COLUMN public.calls.livekit_room_name IS
  'LiveKit room the voice worker ran in; upsert key for persisting the call at shutdown.';
COMMENT ON COLUMN public.calls.payment_link_sent IS
  'True once send_payment_link ran on the call.';

CREATE INDEX IF NOT EXISTS calls_tenancy_id_idx
  ON public.calls (tenancy_id);

CREATE INDEX IF NOT EXISTS calls_stripe_invoice_id_idx
  ON public.calls (stripe_invoice_id);

-- ---------------------------------------------------------------------------
-- plans
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.calls (id) ON UPDATE CASCADE ON DELETE CASCADE,
  installment_count integer NOT NULL CHECK (installment_count >= 1),
  installment_dates date[] NOT NULL,
  installment_amounts numeric(12, 2)[] NOT NULL,
  fee_waiver_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (fee_waiver_amount >= 0),
  perk_id uuid REFERENCES public.perks (id) ON UPDATE CASCADE ON DELETE SET NULL,
  stripe_subscription_schedule_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plans_installment_arrays_match CHECK (
    array_length(installment_dates, 1) = installment_count
    AND array_length(installment_amounts, 1) = installment_count
  )
);

COMMENT ON TABLE public.plans IS
  'Accepted payment plan from a call; mirrors Stripe Subscription Schedule.';

CREATE INDEX IF NOT EXISTS plans_call_id_idx
  ON public.plans (call_id);

CREATE INDEX IF NOT EXISTS plans_perk_id_idx
  ON public.plans (perk_id)
  WHERE perk_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Helpers (after landlords exists: SQL function bodies are validated on create)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.scam_lord_current_landlord_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT l.id
  FROM public.landlords l
  WHERE l.user_id = auth.uid()
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.scam_lord_current_landlord_id() IS
  'Landlord row id for the signed-in Supabase Auth user, for RLS policies.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.landlords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

-- landlords
CREATE POLICY "Landlords read own row"
  ON public.landlords
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Landlords update own row"
  ON public.landlords
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- properties
CREATE POLICY "Landlords read own properties"
  ON public.properties
  FOR SELECT
  TO authenticated
  USING (landlord_id = public.scam_lord_current_landlord_id());

-- units
CREATE POLICY "Landlords read own units"
  ON public.units
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.properties p
      WHERE p.id = units.property_id
        AND p.landlord_id = public.scam_lord_current_landlord_id()
    )
  );

-- tenancies
CREATE POLICY "Landlords read own tenancies"
  ON public.tenancies
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.units u
      JOIN public.properties p ON p.id = u.property_id
      WHERE u.id = tenancies.unit_id
        AND p.landlord_id = public.scam_lord_current_landlord_id()
    )
  );

-- policies
CREATE POLICY "Landlords read own policy"
  ON public.policies
  FOR SELECT
  TO authenticated
  USING (landlord_id = public.scam_lord_current_landlord_id());

CREATE POLICY "Landlords insert own policy"
  ON public.policies
  FOR INSERT
  TO authenticated
  WITH CHECK (landlord_id = public.scam_lord_current_landlord_id());

CREATE POLICY "Landlords update own policy"
  ON public.policies
  FOR UPDATE
  TO authenticated
  USING (landlord_id = public.scam_lord_current_landlord_id())
  WITH CHECK (landlord_id = public.scam_lord_current_landlord_id());

-- perks
CREATE POLICY "Landlords read own perks"
  ON public.perks
  FOR SELECT
  TO authenticated
  USING (landlord_id = public.scam_lord_current_landlord_id());

CREATE POLICY "Landlords insert own perks"
  ON public.perks
  FOR INSERT
  TO authenticated
  WITH CHECK (landlord_id = public.scam_lord_current_landlord_id());

CREATE POLICY "Landlords update own perks"
  ON public.perks
  FOR UPDATE
  TO authenticated
  USING (landlord_id = public.scam_lord_current_landlord_id())
  WITH CHECK (landlord_id = public.scam_lord_current_landlord_id());

CREATE POLICY "Landlords delete own perks"
  ON public.perks
  FOR DELETE
  TO authenticated
  USING (landlord_id = public.scam_lord_current_landlord_id());

-- calls
CREATE POLICY "Landlords read own calls"
  ON public.calls
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenancies t
      JOIN public.units u ON u.id = t.unit_id
      JOIN public.properties p ON p.id = u.property_id
      WHERE t.id = calls.tenancy_id
        AND p.landlord_id = public.scam_lord_current_landlord_id()
    )
  );

-- plans
CREATE POLICY "Landlords read own plans"
  ON public.plans
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.calls c
      JOIN public.tenancies t ON t.id = c.tenancy_id
      JOIN public.units u ON u.id = t.unit_id
      JOIN public.properties p ON p.id = u.property_id
      WHERE c.id = plans.call_id
        AND p.landlord_id = public.scam_lord_current_landlord_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Grants (service_role bypasses RLS for agents)
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.landlords FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.properties FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.units FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.tenancies FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.policies FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.perks FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.calls FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.plans FROM PUBLIC, anon;

GRANT SELECT, UPDATE ON TABLE public.landlords TO authenticated;
GRANT SELECT ON TABLE public.properties TO authenticated;
GRANT SELECT ON TABLE public.units TO authenticated;
GRANT SELECT ON TABLE public.tenancies TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.policies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.perks TO authenticated;
GRANT SELECT ON TABLE public.calls TO authenticated;
GRANT SELECT ON TABLE public.plans TO authenticated;

GRANT ALL ON TABLE public.landlords TO service_role;
GRANT ALL ON TABLE public.properties TO service_role;
GRANT ALL ON TABLE public.units TO service_role;
GRANT ALL ON TABLE public.tenancies TO service_role;
GRANT ALL ON TABLE public.policies TO service_role;
GRANT ALL ON TABLE public.perks TO service_role;
GRANT ALL ON TABLE public.calls TO service_role;
GRANT ALL ON TABLE public.plans TO service_role;

REVOKE ALL ON FUNCTION public.scam_lord_current_landlord_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scam_lord_current_landlord_id() TO authenticated, service_role;
