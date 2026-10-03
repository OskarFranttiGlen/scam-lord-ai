-- Shipworthy keep-set baseline (ADR 0036).
-- Profile, agent chat, monthly metering, Chat artifact persistence, and
-- generic vault helpers. Ranking objects are the next migration.

-- ---------------------------------------------------------------------------
-- Local stripe stand-in
-- ---------------------------------------------------------------------------
-- get_my_feature_limits is LANGUAGE sql, so Postgres checks stripe when this
-- migration creates the function. Ranking views read stripe.subscriptions._raw_data.
-- Remote shipworthy already has Sync Engine, so this block does nothing there.
-- It runs only when stripe.subscriptions is missing, and it creates only the
-- columns those objects read. CREATE TABLE IF NOT EXISTS keeps a real table
-- that is already present.
-- A fresh project that runs this baseline before Sync Engine keeps these
-- narrow tables. Sync Engine cannot install its catalog over them afterward.
-- Install Sync Engine first on any project that should have the real catalog.
-- anon and authenticated receive no grants on this schema.

DO $standin$
BEGIN
  IF to_regclass('stripe.subscriptions') IS NOT NULL THEN
    RETURN;
  END IF;

  CREATE SCHEMA IF NOT EXISTS stripe;

  CREATE TABLE IF NOT EXISTS stripe.customers (
    id text PRIMARY KEY,
    metadata jsonb
  );

  CREATE TABLE IF NOT EXISTS stripe.subscriptions (
    id text PRIMARY KEY,
    customer text,
    status text,
    created timestamptz,
    _raw_data jsonb
  );

  CREATE TABLE IF NOT EXISTS stripe.subscription_items (
    subscription text,
    price jsonb
  );

  CREATE TABLE IF NOT EXISTS stripe.prices (
    id text PRIMARY KEY,
    product text
  );

  CREATE TABLE IF NOT EXISTS stripe.products (
    id text PRIMARY KEY,
    name text
  );

  REVOKE ALL ON SCHEMA stripe FROM PUBLIC;
  REVOKE ALL ON TABLE stripe.customers FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON TABLE stripe.subscriptions FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON TABLE stripe.subscription_items FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON TABLE stripe.prices FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON TABLE stripe.products FROM PUBLIC, anon, authenticated;

  ALTER TABLE stripe.customers ENABLE ROW LEVEL SECURITY;
  ALTER TABLE stripe.subscriptions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE stripe.subscription_items ENABLE ROW LEVEL SECURITY;
  ALTER TABLE stripe.prices ENABLE ROW LEVEL SECURITY;
  ALTER TABLE stripe.products ENABLE ROW LEVEL SECURITY;
END
$standin$;

-- ---------------------------------------------------------------------------
-- public.users
-- ---------------------------------------------------------------------------

CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  email text,
  first_name text,
  last_name text,
  textsearchable_index_col tsvector,
  username text,
  bio text,
  created_at timestamptz NOT NULL DEFAULT now(),
  timezone text DEFAULT 'UTC',
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_username_key UNIQUE (username)
);

COMMENT ON TABLE public.users IS 'Profile data for each user.';

CREATE INDEX idx_users_timezone ON public.users USING btree (timezone);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable insert for authenticated users only"
  ON public.users
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Enable read access for all users"
  ON public.users
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Enable update for users based on email"
  ON public.users
  FOR UPDATE
  USING (((SELECT auth.jwt()) ->> 'email') = email)
  WITH CHECK (((SELECT auth.jwt()) ->> 'email') = email);

GRANT SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, UPDATE
  ON TABLE public.users TO anon;
GRANT SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, UPDATE
  ON TABLE public.users TO authenticated;
GRANT SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, UPDATE
  ON TABLE public.users TO service_role;

CREATE FUNCTION public.users_tsvector_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.textsearchable_index_col :=
    to_tsvector(
      'english',
      coalesce(NEW.first_name, '') || ' ' ||
      coalesce(NEW.last_name, '') || ' ' ||
      coalesce(NEW.username, '')
    );
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.users_tsvector_update() OWNER TO postgres;

GRANT ALL ON FUNCTION public.users_tsvector_update() TO anon;
GRANT ALL ON FUNCTION public.users_tsvector_update() TO authenticated;
GRANT ALL ON FUNCTION public.users_tsvector_update() TO service_role;

CREATE TRIGGER tsvectorupdate
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.users_tsvector_update();

-- Copied from the Proxima baseline. There is no trigger on auth.users.
-- start-local-supabase.sh inserts the test profile itself.

CREATE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_first_name text;
  v_last_name text;
  v_base_username text;
  v_final_username text;
  v_counter integer := 1;
BEGIN
  v_first_name := COALESCE(
    NEW.raw_user_meta_data ->> 'first_name',
    NEW.raw_user_meta_data ->> 'given_name',
    NEW.raw_user_meta_data ->> 'givenName',
    split_part(NEW.raw_user_meta_data ->> 'full_name', ' ', 1),
    split_part(NEW.raw_user_meta_data ->> 'name', ' ', 1)
  );

  v_last_name := COALESCE(
    NEW.raw_user_meta_data ->> 'last_name',
    NEW.raw_user_meta_data ->> 'family_name',
    NEW.raw_user_meta_data ->> 'familyName',
    NULLIF(substring(NEW.raw_user_meta_data ->> 'full_name' from ' (.*)'), ''),
    NULLIF(substring(NEW.raw_user_meta_data ->> 'name' from ' (.*)'), '')
  );

  v_base_username := COALESCE(
    NEW.raw_user_meta_data ->> 'username',
    CASE
      WHEN v_first_name IS NOT NULL AND v_last_name IS NOT NULL
      THEN lower(v_first_name || '.' || v_last_name)
      ELSE split_part(NEW.email, '@', 1)
    END
  );

  v_base_username := lower(regexp_replace(v_base_username, '[^a-z0-9._]', '', 'g'));
  v_final_username := v_base_username;

  WHILE EXISTS (
    SELECT 1
    FROM public.users
    WHERE username = v_final_username
      AND id != NEW.id
  ) LOOP
    v_final_username := v_base_username || v_counter::text;
    v_counter := v_counter + 1;
  END LOOP;

  INSERT INTO public.users (id, email, first_name, last_name, username)
  VALUES (
    NEW.id,
    NEW.email,
    v_first_name,
    v_last_name,
    v_final_username
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    username = EXCLUDED.username;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;

CREATE FUNCTION public.handle_delete_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.users WHERE id = OLD.id;
  RETURN OLD;
END;
$$;

ALTER FUNCTION public.handle_delete_user() OWNER TO postgres;

GRANT ALL ON FUNCTION public.handle_delete_user() TO anon;
GRANT ALL ON FUNCTION public.handle_delete_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_delete_user() TO service_role;

-- ---------------------------------------------------------------------------
-- public.chat_history
-- ---------------------------------------------------------------------------
-- program_id stays a nullable integer. The app still reads it.
-- The foreign key to programs is gone with programs.

CREATE TABLE public.chat_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON UPDATE CASCADE ON DELETE CASCADE,
  title text NOT NULL,
  program_id integer,
  conversation jsonb[],
  pinned boolean,
  CONSTRAINT chat_history_title_check CHECK (length(title) <= 200)
);

COMMENT ON COLUMN public.chat_history.title IS 'An AI-generated title for the chat';
COMMENT ON COLUMN public.chat_history.program_id IS 'Nullable integer kept for existing rows. No foreign key.';
COMMENT ON COLUMN public.chat_history.conversation IS 'Messages from the AI SDK agent, as an array of objects';
COMMENT ON COLUMN public.chat_history.pinned IS 'Is this a pinned chat?';

CREATE INDEX chat_history_user_id_idx ON public.chat_history USING btree (user_id);

ALTER TABLE public.chat_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable delete for users based on user_id"
  ON public.chat_history
  FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Enable insert for users based on user_id"
  ON public.chat_history
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Enable users to view their own data only"
  ON public.chat_history
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "chat_history_update_own"
  ON public.chat_history
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

GRANT SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, UPDATE
  ON TABLE public.chat_history TO anon;
GRANT SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, UPDATE
  ON TABLE public.chat_history TO authenticated;
GRANT SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, UPDATE
  ON TABLE public.chat_history TO service_role;

-- ---------------------------------------------------------------------------
-- public.product_usage_limits
-- ---------------------------------------------------------------------------

CREATE TABLE public.product_usage_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  max_monthly_exports smallint,
  max_monthly_llm_requests smallint,
  product_title text,
  max_premium_llm_requests smallint,
  CONSTRAINT product_usage_limits_product_title_key UNIQUE (product_title)
);

COMMENT ON TABLE public.product_usage_limits IS 'Monthly usage limits for each Stripe product title.';
COMMENT ON COLUMN public.product_usage_limits.max_monthly_exports IS 'The maximum number of exports this product is allowed';
COMMENT ON COLUMN public.product_usage_limits.max_premium_llm_requests IS 'The max number of higher powered model requests before we drop you to a cheaper model';

ALTER TABLE public.product_usage_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users"
  ON public.product_usage_limits
  FOR SELECT
  USING (true);

GRANT SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, UPDATE
  ON TABLE public.product_usage_limits TO anon;
GRANT SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, UPDATE
  ON TABLE public.product_usage_limits TO authenticated;
GRANT SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, UPDATE
  ON TABLE public.product_usage_limits TO service_role;

-- ---------------------------------------------------------------------------
-- public.feature_usage
-- One row per user per Usage period (calendar month, UTC).
-- Written as the post-period shape. No snapshot table and no truncate.
-- ---------------------------------------------------------------------------

CREATE TABLE public.feature_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON UPDATE CASCADE ON DELETE CASCADE,
  monthly_exports_used smallint NOT NULL DEFAULT 0,
  monthly_llm_requests integer NOT NULL DEFAULT 0,
  period_start date NOT NULL DEFAULT (date_trunc('month', now() AT TIME ZONE 'utc'))::date,
  CONSTRAINT feature_usage_user_id_period_start_key UNIQUE (user_id, period_start),
  CONSTRAINT feature_usage_period_start_is_month_start
    CHECK (period_start = date_trunc('month', period_start)::date)
);

COMMENT ON TABLE public.feature_usage IS 'One row per user per Usage period (calendar month, UTC). Created lazily by the first metered action of the month, so an absent row means zero used.';
COMMENT ON COLUMN public.feature_usage.period_start IS 'First day of the Usage period this row counts (1st of the month, UTC). Not the Stripe billing period.';
COMMENT ON COLUMN public.feature_usage.monthly_exports_used IS 'Exports charged to this row''s Usage period only.';
COMMENT ON COLUMN public.feature_usage.monthly_llm_requests IS 'LLM calls charged to this row''s Usage period only.';

ALTER TABLE public.feature_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable users to view their own data only"
  ON public.feature_usage
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

GRANT SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, UPDATE
  ON TABLE public.feature_usage TO anon;
GRANT SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, UPDATE
  ON TABLE public.feature_usage TO authenticated;
GRANT SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, UPDATE
  ON TABLE public.feature_usage TO service_role;

CREATE FUNCTION public.increment_feature_usage(p_feature text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_period_start date := (date_trunc('month', now() AT TIME ZONE 'utc'))::date;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_feature NOT IN ('monthly_exports_used', 'monthly_llm_requests') THEN
    RAISE EXCEPTION 'unknown meter: %', p_feature;
  END IF;

  INSERT INTO public.feature_usage AS fu (user_id, period_start, monthly_exports_used, monthly_llm_requests)
  VALUES (
    v_user_id,
    v_period_start,
    CASE WHEN p_feature = 'monthly_exports_used' THEN 1 ELSE 0 END,
    CASE WHEN p_feature = 'monthly_llm_requests' THEN 1 ELSE 0 END
  )
  ON CONFLICT (user_id, period_start) DO UPDATE
  SET
    monthly_exports_used = fu.monthly_exports_used + CASE WHEN p_feature = 'monthly_exports_used' THEN 1 ELSE 0 END,
    monthly_llm_requests = fu.monthly_llm_requests + CASE WHEN p_feature = 'monthly_llm_requests' THEN 1 ELSE 0 END;
END;
$$;

ALTER FUNCTION public.increment_feature_usage(p_feature text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.increment_feature_usage(p_feature text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_feature_usage(p_feature text) FROM anon;
REVOKE ALL ON FUNCTION public.increment_feature_usage(p_feature text) FROM authenticated;
GRANT ALL ON FUNCTION public.increment_feature_usage(p_feature text) TO service_role;

CREATE FUNCTION public.get_my_feature_limits()
RETURNS TABLE (
  user_id uuid,
  tier text,
  has_active_subscription boolean,
  max_monthly_exports integer,
  monthly_exports_used integer,
  remaining_exports integer,
  max_monthly_llm_requests integer,
  monthly_llm_requests_used integer,
  remaining_llm_requests integer,
  period_start date,
  resets_on date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT
  param.user_id,
  COALESCE(prod.product_title, 'Free') AS tier,
  (s.status IN ('active', 'trialing')) AS has_active_subscription,

  COALESCE(pul.max_monthly_exports,
           free_pul.max_monthly_exports,
           5) AS max_monthly_exports,
  COALESCE(fu.monthly_exports_used, 0) AS monthly_exports_used,
  GREATEST(
    COALESCE(pul.max_monthly_exports, free_pul.max_monthly_exports, 5)
    - COALESCE(fu.monthly_exports_used, 0),
  0) AS remaining_exports,

  COALESCE(pul.max_monthly_llm_requests,
           free_pul.max_monthly_llm_requests,
           6000) AS max_monthly_llm_requests,
  COALESCE(fu.monthly_llm_requests, 0) AS monthly_llm_requests_used,
  GREATEST(
    COALESCE(pul.max_monthly_llm_requests, free_pul.max_monthly_llm_requests, 6000)
    - COALESCE(fu.monthly_llm_requests, 0),
  0) AS remaining_llm_requests,

  period.period_start,
  (period.period_start + INTERVAL '1 month')::date AS resets_on

FROM (SELECT auth.uid()::uuid AS user_id) param

CROSS JOIN (SELECT (date_trunc('month', now() AT TIME ZONE 'utc'))::date AS period_start) period

LEFT JOIN LATERAL (
  SELECT c.id
  FROM stripe.customers c
  WHERE c.metadata->>'client-reference-id' = param.user_id::text
  LIMIT 1
) c ON TRUE

LEFT JOIN LATERAL (
  SELECT s.*
  FROM stripe.subscriptions s
  WHERE c.id IS NOT NULL AND s.customer = c.id
  ORDER BY (s.status IN ('active', 'trialing')) DESC, s.created DESC NULLS LAST
  LIMIT 1
) s ON TRUE

LEFT JOIN LATERAL (
  SELECT prod.name AS product_title
  FROM stripe.subscription_items si
  JOIN stripe.prices pr
    ON pr.id = (CASE
                  WHEN jsonb_typeof(si.price) = 'object' THEN si.price->>'id'
                  ELSE si.price #>> '{}'
                END)
  JOIN stripe.products prod ON prod.id = pr.product
  WHERE s.id IS NOT NULL AND si.subscription = s.id
  LIMIT 1
) prod ON TRUE

LEFT JOIN LATERAL (
  SELECT pul.*
  FROM public.product_usage_limits pul
  WHERE prod.product_title IS NOT NULL AND pul.product_title = prod.product_title
  LIMIT 1
) pul ON TRUE

LEFT JOIN LATERAL (
  SELECT pul.max_monthly_exports, pul.max_monthly_llm_requests
  FROM public.product_usage_limits pul
  WHERE pul.product_title = 'Free'
  LIMIT 1
) free_pul ON TRUE

LEFT JOIN public.feature_usage fu
  ON fu.user_id = param.user_id
 AND fu.period_start = period.period_start
$$;

ALTER FUNCTION public.get_my_feature_limits() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_my_feature_limits() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_feature_limits() TO anon;
GRANT ALL ON FUNCTION public.get_my_feature_limits() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_feature_limits() TO service_role;

CREATE FUNCTION public.try_consume_feature_usage(p_feature text)
RETURNS TABLE (allowed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_period_start date := (date_trunc('month', now() AT TIME ZONE 'utc'))::date;
  v_max integer;
  v_consumed boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_feature NOT IN ('monthly_exports_used', 'monthly_llm_requests') THEN
    RAISE EXCEPTION 'unknown meter: %', p_feature;
  END IF;

  SELECT CASE
           WHEN p_feature = 'monthly_exports_used' THEN
             COALESCE(pul.max_monthly_exports, free_pul.max_monthly_exports, 5)
           ELSE
             COALESCE(pul.max_monthly_llm_requests, free_pul.max_monthly_llm_requests, 6000)
         END
    INTO v_max
  FROM (SELECT v_user_id AS user_id) param
  LEFT JOIN LATERAL (
    SELECT c.id
    FROM stripe.customers c
    WHERE c.metadata->>'client-reference-id' = param.user_id::text
    LIMIT 1
  ) c ON TRUE
  LEFT JOIN LATERAL (
    SELECT s.*
    FROM stripe.subscriptions s
    WHERE c.id IS NOT NULL AND s.customer = c.id
    ORDER BY (s.status IN ('active', 'trialing')) DESC, s.created DESC NULLS LAST
    LIMIT 1
  ) s ON TRUE
  LEFT JOIN LATERAL (
    SELECT prod.name AS product_title
    FROM stripe.subscription_items si
    JOIN stripe.prices pr
      ON pr.id = (CASE
                    WHEN jsonb_typeof(si.price) = 'object' THEN si.price->>'id'
                    ELSE si.price #>> '{}'
                  END)
    JOIN stripe.products prod ON prod.id = pr.product
    WHERE s.id IS NOT NULL AND si.subscription = s.id
    LIMIT 1
  ) prod ON TRUE
  LEFT JOIN LATERAL (
    SELECT pul.max_monthly_exports, pul.max_monthly_llm_requests
    FROM public.product_usage_limits pul
    WHERE prod.product_title IS NOT NULL AND pul.product_title = prod.product_title
    LIMIT 1
  ) pul ON TRUE
  LEFT JOIN LATERAL (
    SELECT pul.max_monthly_exports, pul.max_monthly_llm_requests
    FROM public.product_usage_limits pul
    WHERE pul.product_title = 'Free'
    LIMIT 1
  ) free_pul ON TRUE;

  INSERT INTO public.feature_usage AS fu (user_id, period_start, monthly_exports_used, monthly_llm_requests)
  VALUES (v_user_id, v_period_start, 0, 0)
  ON CONFLICT (user_id, period_start) DO NOTHING;

  IF p_feature = 'monthly_exports_used' THEN
    UPDATE public.feature_usage
    SET monthly_exports_used = monthly_exports_used + 1
    WHERE user_id = v_user_id
      AND period_start = v_period_start
      AND monthly_exports_used < v_max
    RETURNING true INTO v_consumed;
  ELSE
    UPDATE public.feature_usage
    SET monthly_llm_requests = monthly_llm_requests + 1
    WHERE user_id = v_user_id
      AND period_start = v_period_start
      AND monthly_llm_requests < v_max
    RETURNING true INTO v_consumed;
  END IF;

  RETURN QUERY SELECT COALESCE(v_consumed, false);
END;
$$;

ALTER FUNCTION public.try_consume_feature_usage(p_feature text) OWNER TO postgres;

COMMENT ON FUNCTION public.try_consume_feature_usage(p_feature text) IS
  'Atomically spend one unit of a Usage period meter if under the caller''s tier cap. Returns allowed=false at the ceiling without raising.';

REVOKE ALL ON FUNCTION public.try_consume_feature_usage(p_feature text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_consume_feature_usage(p_feature text) FROM anon;
GRANT ALL ON FUNCTION public.try_consume_feature_usage(p_feature text) TO authenticated;
GRANT ALL ON FUNCTION public.try_consume_feature_usage(p_feature text) TO service_role;

-- ---------------------------------------------------------------------------
-- Chat artifacts
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.set_updated_at_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.set_updated_at_metadata() OWNER TO postgres;

GRANT ALL ON FUNCTION public.set_updated_at_metadata() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at_metadata() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at_metadata() TO service_role;

CREATE TABLE public.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  title text,
  document jsonb NOT NULL DEFAULT '{"title":"","weeks":[]}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.artifacts IS
  'Durable Chat artifact JSON for the dual-pane builder (ADR 0034).';
COMMENT ON COLUMN public.artifacts.title IS
  'Optional denormalized title mirrored from document.title for list/query convenience.';
COMMENT ON COLUMN public.artifacts.document IS
  'Chat artifact JSON: { title, weeks: [{ days: [{ id, title, items: [{ id, title, notes? }] }] }] }.';

CREATE INDEX artifacts_user_id_updated_at_idx
  ON public.artifacts (user_id, updated_at DESC);

ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own artifacts"
  ON public.artifacts FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own artifacts"
  ON public.artifacts FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own artifacts"
  ON public.artifacts FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own artifacts"
  ON public.artifacts FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.artifacts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_metadata();

GRANT SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, UPDATE
  ON TABLE public.artifacts TO anon;
GRANT SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, UPDATE
  ON TABLE public.artifacts TO authenticated;
GRANT SELECT, INSERT, REFERENCES, DELETE, TRIGGER, TRUNCATE, UPDATE
  ON TABLE public.artifacts TO service_role;

-- ---------------------------------------------------------------------------
-- Vault helpers
-- ---------------------------------------------------------------------------
-- insert_secret takes the name from the caller. Description is auth.uid().
-- No hevy_api_key_ or proxima_api_key_ allowlist.

CREATE FUNCTION public.insert_secret(secret text, secret_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text := btrim(secret_name);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'secret name required';
  END IF;

  RETURN vault.create_secret(secret, v_name, v_uid::text);
END;
$$;

ALTER FUNCTION public.insert_secret(secret text, secret_name text) OWNER TO postgres;

COMMENT ON FUNCTION public.insert_secret(text, text) IS
  'Stores secret under secret_name. Description is auth.uid(). Rejects a missing session. The caller supplies the name.';

GRANT ALL ON FUNCTION public.insert_secret(secret text, secret_name text) TO anon;
GRANT ALL ON FUNCTION public.insert_secret(secret text, secret_name text) TO authenticated;
GRANT ALL ON FUNCTION public.insert_secret(secret text, secret_name text) TO service_role;

CREATE FUNCTION public.read_secret(secret_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  secret text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT decrypted_secret INTO secret
  FROM vault.decrypted_secrets
  WHERE name = secret_name AND description = auth.uid()::text;

  IF secret IS NULL THEN
    RAISE EXCEPTION 'Not authorized or secret does not exist';
  END IF;

  RETURN secret;
END;
$$;

ALTER FUNCTION public.read_secret(secret_name text) OWNER TO postgres;

GRANT ALL ON FUNCTION public.read_secret(secret_name text) TO anon;
GRANT ALL ON FUNCTION public.read_secret(secret_name text) TO authenticated;
GRANT ALL ON FUNCTION public.read_secret(secret_name text) TO service_role;

CREATE FUNCTION public.delete_secret(secret_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rows_deleted int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  DELETE FROM vault.decrypted_secrets
  WHERE name = secret_name AND description = auth.uid()::text;

  GET DIAGNOSTICS rows_deleted = ROW_COUNT;

  IF rows_deleted = 0 THEN
    RETURN 'no matching secret found';
  ELSE
    RETURN 'secret deleted';
  END IF;
END;
$$;

ALTER FUNCTION public.delete_secret(secret_name text) OWNER TO postgres;

GRANT ALL ON FUNCTION public.delete_secret(secret_name text) TO anon;
GRANT ALL ON FUNCTION public.delete_secret(secret_name text) TO authenticated;
GRANT ALL ON FUNCTION public.delete_secret(secret_name text) TO service_role;
