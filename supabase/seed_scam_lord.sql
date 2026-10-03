-- Demo ScamLord portfolio (docs/SPEC.md). Runs after seed.sql on db reset.
-- Binds the demo landlord to auth user test@localhost.dev when that user exists
-- (created by ./start-local-supabase.sh). Safe to re-run via ON CONFLICT.

DO $seed$
DECLARE
  v_user_id uuid;
  v_landlord_id uuid := 'a1111111-1111-4111-8111-111111111101';
  v_property_1_id uuid := 'a2222222-2222-4222-8222-222222222201';
  v_property_2_id uuid := 'a2222222-2222-4222-8222-222222222202';
  v_unit_1_id uuid := 'a3333333-3333-4333-8333-333333333301';
  v_unit_2_id uuid := 'a3333333-3333-4333-8333-333333333302';
  v_tenancy_1_id uuid := 'a4444444-4444-4444-8444-444444444401';
  v_tenancy_2_id uuid := 'a4444444-4444-4444-8444-444444444402';
  v_policy_id uuid := 'a5555555-5555-4555-8555-555555555501';
  v_perk_id uuid := 'a6666666-6666-4666-8666-666666666601';
  v_call_id uuid := 'a7777777-7777-4777-8777-777777777701';
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'test@localhost.dev'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'ScamLord seed skipped: auth user test@localhost.dev not found yet.';
    RETURN;
  END IF;

  INSERT INTO public.landlords (
    id,
    user_id,
    name,
    phone,
    stripe_customer_id,
    stripe_connected_account_id,
    external_pms_id
  )
  VALUES (
    v_landlord_id,
    v_user_id,
    'Demo Property Management',
    '+15555550100',
    'cus_scamlord_demo_billing',
    'acct_scamlord_demo_connect',
    'appfolio_demo_pm_001'
  )
  ON CONFLICT (user_id) DO UPDATE SET
    name = EXCLUDED.name,
    phone = EXCLUDED.phone,
    stripe_customer_id = EXCLUDED.stripe_customer_id,
    stripe_connected_account_id = EXCLUDED.stripe_connected_account_id,
    external_pms_id = EXCLUDED.external_pms_id,
    updated_at = now();

  INSERT INTO public.properties (id, landlord_id, name, address, external_pms_id)
  VALUES
    (
      v_property_1_id,
      v_landlord_id,
      'Maple Court',
      '1200 Maple St, Austin, TX 78701',
      'appfolio_prop_maple'
    ),
    (
      v_property_2_id,
      v_landlord_id,
      'River View Apartments',
      '88 River Rd, Austin, TX 78704',
      'appfolio_prop_river'
    )
  ON CONFLICT (id) DO UPDATE SET
    landlord_id = EXCLUDED.landlord_id,
    name = EXCLUDED.name,
    address = EXCLUDED.address,
    external_pms_id = EXCLUDED.external_pms_id,
    updated_at = now();

  INSERT INTO public.units (id, property_id, label, external_pms_id)
  VALUES
    (v_unit_1_id, v_property_1_id, 'Unit 2B', 'appfolio_unit_maple_2b'),
    (v_unit_2_id, v_property_2_id, 'Unit 14', 'appfolio_unit_river_14')
  ON CONFLICT (id) DO UPDATE SET
    property_id = EXCLUDED.property_id,
    label = EXCLUDED.label,
    external_pms_id = EXCLUDED.external_pms_id,
    updated_at = now();

  INSERT INTO public.tenancies (
    id,
    unit_id,
    name,
    phone,
    email,
    language,
    stripe_customer_id,
    external_pms_id
  )
  VALUES
    (
      v_tenancy_1_id,
      v_unit_1_id,
      'Jordan Lee',
      '+15555550201',
      'jordan.lee@example.com',
      'en',
      'cus_scamlord_tenant_jordan',
      'appfolio_tenancy_jordan'
    ),
    (
      v_tenancy_2_id,
      v_unit_2_id,
      'Sam Rivera',
      '+15555550202',
      'sam.rivera@example.com',
      'en',
      'cus_scamlord_tenant_sam',
      'appfolio_tenancy_sam'
    )
  ON CONFLICT (id) DO UPDATE SET
    unit_id = EXCLUDED.unit_id,
    name = EXCLUDED.name,
    phone = EXCLUDED.phone,
    email = EXCLUDED.email,
    language = EXCLUDED.language,
    stripe_customer_id = EXCLUDED.stripe_customer_id,
    external_pms_id = EXCLUDED.external_pms_id,
    updated_at = now();

  INSERT INTO public.policies (
    id,
    landlord_id,
    max_installments,
    grace_days,
    fee_waiver_cap
  )
  VALUES (
    v_policy_id,
    v_landlord_id,
    2,
    14,
    25.00
  )
  ON CONFLICT (landlord_id) DO UPDATE SET
    max_installments = EXCLUDED.max_installments,
    grace_days = EXCLUDED.grace_days,
    fee_waiver_cap = EXCLUDED.fee_waiver_cap,
    updated_at = now();

  INSERT INTO public.perks (id, landlord_id, body, condition_text)
  VALUES (
    v_perk_id,
    v_landlord_id,
    'We''ll mow the lawn this weekend.',
    'Pay the open balance today.'
  )
  ON CONFLICT (id) DO UPDATE SET
    landlord_id = EXCLUDED.landlord_id,
    body = EXCLUDED.body,
    condition_text = EXCLUDED.condition_text,
    updated_at = now();

  INSERT INTO public.calls (
    id,
    tenancy_id,
    stripe_invoice_id,
    status,
    transcript
  )
  VALUES (
    v_call_id,
    v_tenancy_1_id,
    'in_demo_overdue_jordan_001',
    'in_progress',
    'Agent: Hi Jordan, this is an AI assistant for Maple Court calling about your balance.'
  )
  ON CONFLICT (id) DO UPDATE SET
    tenancy_id = EXCLUDED.tenancy_id,
    stripe_invoice_id = EXCLUDED.stripe_invoice_id,
    status = EXCLUDED.status,
    transcript = EXCLUDED.transcript,
    updated_at = now();

  INSERT INTO public.maintenance_requests (id, tenancy_id, description, urgency, status, reported_at, resolved_at)
  VALUES
    (
      'a9999999-9999-4999-8999-999999999901',
      v_tenancy_1_id,
      'Kitchen tap dripping',
      'routine',
      'open',
      now() - interval '12 days',
      NULL
    ),
    (
      'a9999999-9999-4999-8999-999999999902',
      v_tenancy_1_id,
      'Smoke alarm battery chirping',
      'routine',
      'resolved',
      now() - interval '35 days',
      now() - interval '33 days'
    )
  ON CONFLICT (id) DO UPDATE SET
    description = EXCLUDED.description,
    urgency = EXCLUDED.urgency,
    status = EXCLUDED.status,
    reported_at = EXCLUDED.reported_at,
    resolved_at = EXCLUDED.resolved_at,
    updated_at = now();
END
$seed$;
