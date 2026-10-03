-- RentRecovery keep-set: auth profile + manager chat history.
-- Domain tables (landlords, properties, units, tenancies, policies, perks,
-- calls, plans) already live on prod and are not recreated here.
-- No Shipworthy artifacts, metering, vault helpers, or idea-demand views.

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

COMMENT ON TABLE public.users IS 'Profile data for each auth user.';

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

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_delete_user();

-- ---------------------------------------------------------------------------
-- public.chat_history
-- ---------------------------------------------------------------------------

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
