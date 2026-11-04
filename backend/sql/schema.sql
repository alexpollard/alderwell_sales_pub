


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."campaign_status" AS ENUM (
    'planning',
    'active',
    'paused',
    'completed',
    'cancelled'
);


ALTER TYPE "public"."campaign_status" OWNER TO "postgres";


CREATE TYPE "public"."interaction_type" AS ENUM (
    'meeting',
    'call',
    'email',
    'conference',
    'other'
);


ALTER TYPE "public"."interaction_type" OWNER TO "postgres";


CREATE TYPE "public"."sale_direction" AS ENUM (
    'buy',
    'sell'
);


ALTER TYPE "public"."sale_direction" OWNER TO "postgres";


CREATE TYPE "public"."task_status" AS ENUM (
    'pending',
    'in_progress',
    'done',
    'blocked'
);


ALTER TYPE "public"."task_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."archive_folder"("p_folder_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_role text;
  v_has_access boolean;
begin
  select company_role into v_role
  from public.profiles
  where user_id = auth.uid()
    and is_active = true
  limit 1;

  if v_role is null then
    raise exception 'Unauthorized';
  end if;

  -- User must be able to access folder, except admins who can always archive.
  select public.has_folder_access(p_folder_id) into v_has_access;
  if v_role <> 'admin' and coalesce(v_has_access, false) = false then
    raise exception 'Not allowed to archive this folder';
  end if;

  update public.folders
  set archive_status = true,
      archived_at = now(),
      archived_by = auth.uid()
  where folder_id = p_folder_id;

  if not found then
    raise exception 'Folder not found';
  end if;
end;
$$;


ALTER FUNCTION "public"."archive_folder"("p_folder_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clear_blocker_on_unblock"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if old.task_status = 'blocked' and new.task_status <> 'blocked' then
    new.blocker_resolved_by = null;
    new.blocker_resolved_at = null;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."clear_blocker_on_unblock"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_default_folder_access_policy"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_policy_id uuid;
begin
  -- Create a new access policy allowing all roles
  insert into public.folder_access_policies (folder_id, allow_all_roles, created_by)
  values (new.folder_id, true, new.created_by)
  returning policy_id into v_policy_id;

  return new;
end;
$$;


ALTER FUNCTION "public"."create_default_folder_access_policy"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.company_role
  from public.profiles p
  where p.user_id = auth.uid()
    and p.is_active = true
  limit 1;
$$;


ALTER FUNCTION "public"."current_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_folder_access"("p_folder_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
declare
  v_role text;
  v_allow_all boolean;
  v_policy_id uuid;
begin
  select company_role into v_role
  from public.profiles
  where user_id = auth.uid()
  limit 1;

  -- Check folder access policy for this folder.
  select policy_id, allow_all_roles
  into v_policy_id, v_allow_all
  from public.folder_access_policies
  where folder_id = p_folder_id
  limit 1;

  -- No policy row means open access.
  if v_policy_id is null then
    return true;
  end if;

  -- If folder is open to all roles, grant access.
  if v_allow_all then
    return true;
  end if;

  -- Admins always have access.
  if v_role = 'admin' then
    return true;
  end if;

  -- Check whether the user's role is in the allowed list.
  return exists (
    select 1
    from public.folder_access_roles
    where policy_id = v_policy_id
      and role = v_role
  );
end;
$$;


ALTER FUNCTION "public"."has_folder_access"("p_folder_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"("check_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = check_user_id
      and p.is_active = true
      and lower(p.company_role) = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_admin"("check_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_compliance_officer"("check_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = check_user_id
      and p.is_active = true
      and p.company_role = 'compliance_officer'
  );
$$;


ALTER FUNCTION "public"."is_compliance_officer"("check_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_general_staff"("check_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = check_user_id
      and p.is_active = true
      and p.company_role = 'general_staff'
  );
$$;


ALTER FUNCTION "public"."is_general_staff"("check_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_manager"("check_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = check_user_id
      and p.is_active = true
      and p.company_role = 'manager'
  );
$$;


ALTER FUNCTION "public"."is_manager"("check_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_marketing_team_member"("check_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = check_user_id
      and p.is_active = true
      and p.company_role = 'marketing_team_member'
  );
$$;


ALTER FUNCTION "public"."is_marketing_team_member"("check_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_sales_representative"("check_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = check_user_id
      and p.is_active = true
      and p.company_role = 'sales_representative'
  );
$$;


ALTER FUNCTION "public"."is_sales_representative"("check_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_blocker_resolved"("p_task_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_task_status   text;
  v_assigned_role text;
  v_user_role     text;
begin
  select task_status, assigned_role
    into v_task_status, v_assigned_role
    from public.tasks
    where task_id = p_task_id
    for update;

  if not found then
    raise exception 'Task not found';
  end if;

  if v_task_status <> 'blocked' then
    raise exception 'Task is not currently blocked';
  end if;

  select public.current_user_role() into v_user_role;

  if not (
    public.is_admin()
    or public.is_manager()
    or v_assigned_role = v_user_role
  ) then
    raise exception 'Permission denied';
  end if;

  update public.tasks
    set blocker_resolved_by = auth.uid(),
        blocker_resolved_at = now()
    where task_id = p_task_id;
end;
$$;


ALTER FUNCTION "public"."mark_blocker_resolved"("p_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purge_activity_logs"("retention_days" integer DEFAULT 21) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  deleted_count integer;
begin
  delete from public.activity_logs
  where occurred_at < now() - make_interval(days => retention_days);

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;


ALTER FUNCTION "public"."purge_activity_logs"("retention_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_campaign_archive_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.campaign_status = 'archived' then
    new.archive_status = true;
  elsif new.archive_status = true then
    new.campaign_status = 'archived';
  else
    new.archive_status = false;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_campaign_archive_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."take_task"("p_task_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_assigned_role text;
  v_taken_by      uuid;
  v_user_role     text;
begin
  select public.current_user_role() into v_user_role;

  select assigned_role, taken_by
    into v_assigned_role, v_taken_by
    from public.tasks
    where task_id = p_task_id
    for update;

  if v_assigned_role is null or v_assigned_role <> v_user_role then
    raise exception 'Task is not assigned to your role';
  end if;

  if v_taken_by is not null then
    raise exception 'Task has already been taken by someone else';
  end if;

  update public.tasks
    set taken_by = auth.uid(),
        assigned_user_id = auth.uid(),
      task_status = 'pending'
    where task_id = p_task_id;
end;
$$;


ALTER FUNCTION "public"."take_task"("p_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unarchive_folder"("p_folder_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- Only admins can unarchive.
  if not public.is_admin() then
    raise exception 'Only admins can unarchive folders';
  end if;

  update public.folders
  set archive_status = false,
      archived_at = null,
      archived_by = null
  where folder_id = p_folder_id;

  if not found then
    raise exception 'Folder not found';
  end if;
end;
$$;


ALTER FUNCTION "public"."unarchive_folder"("p_folder_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."activity_logs" (
    "log_id" bigint NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid",
    "person_name" "text" NOT NULL,
    "action_type" "text" NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."activity_logs" OWNER TO "postgres";


ALTER TABLE "public"."activity_logs" ALTER COLUMN "log_id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."activity_logs_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."campaign_assignees" (
    "campaign_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."campaign_assignees" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaign_materials" (
    "campaign_id" "uuid" NOT NULL,
    "document_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."campaign_materials" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaigns" (
    "campaign_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_name" "text" NOT NULL,
    "campaign_description" "text",
    "campaign_start_date" "date",
    "campaign_end_date" "date",
    "campaign_status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "archive_status" boolean DEFAULT false NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "campaigns_date_order" CHECK ((("campaign_end_date" IS NULL) OR ("campaign_start_date" IS NULL) OR ("campaign_end_date" >= "campaign_start_date"))),
    CONSTRAINT "campaigns_status_allowed" CHECK (("campaign_status" = ANY (ARRAY['draft'::"text", 'pending_approval'::"text", 'active'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documents" (
    "document_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "file_name" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "mime_type" "text",
    "size_bytes" bigint,
    "uploaded_by" "uuid" NOT NULL,
    "folder_id" "uuid",
    "document_group_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "document_version" integer DEFAULT 1 NOT NULL,
    "is_approved" boolean,
    "task_id" "uuid",
    "campaign_id" "uuid",
    "archive_status" boolean DEFAULT false NOT NULL,
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "document_category" "text" DEFAULT 'general'::"text" NOT NULL,
    CONSTRAINT "documents_category_check" CHECK (("document_category" = ANY (ARRAY['general'::"text", 'campaign_material'::"text"]))),
    CONSTRAINT "documents_size_nonnegative" CHECK ((("size_bytes" IS NULL) OR ("size_bytes" >= 0))),
    CONSTRAINT "documents_version_positive" CHECK (("document_version" > 0))
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


COMMENT ON COLUMN "public"."documents"."document_category" IS 'Classifies the document. campaign_material = appears in the campaign materials picker.';



CREATE TABLE IF NOT EXISTS "public"."folder_access_policies" (
    "policy_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "folder_id" "uuid" NOT NULL,
    "allow_all_roles" boolean DEFAULT false NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."folder_access_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."folder_access_roles" (
    "access_role_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "policy_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    CONSTRAINT "folder_access_roles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'manager'::"text", 'sales_representative'::"text", 'compliance_officer'::"text", 'general_staff'::"text"])))
);


ALTER TABLE "public"."folder_access_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."folders" (
    "folder_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "parent_folder_id" "uuid",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archive_status" boolean DEFAULT false,
    "archived_at" timestamp with time zone,
    "archived_by" "uuid"
);


ALTER TABLE "public"."folders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."follow_ups" (
    "follow_up_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "interaction_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "outcome" "text",
    "next_steps" "text",
    "follow_up_date" "date",
    "is_completed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."follow_ups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."interactions" (
    "interaction_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "hcp_name" "text" NOT NULL,
    "interaction_type" "public"."interaction_type" DEFAULT 'meeting'::"public"."interaction_type" NOT NULL,
    "interaction_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "notes" "text",
    "campaign_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "did_convert" boolean DEFAULT false NOT NULL,
    "conversion_value" numeric(12,2),
    "quantity" integer,
    "product_name" "text",
    "is_archived" boolean DEFAULT false NOT NULL,
    CONSTRAINT "interactions_conversion_fields_check" CHECK (((("did_convert" = false) AND ("conversion_value" IS NULL) AND ("quantity" IS NULL) AND ("product_name" IS NULL)) OR (("did_convert" = true) AND ("conversion_value" IS NOT NULL) AND ("conversion_value" >= (0)::numeric) AND (("quantity" IS NULL) OR ("quantity" >= 0)))))
);


ALTER TABLE "public"."interactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "user_id" "uuid" NOT NULL,
    "username" "text" NOT NULL,
    "full_name" "text",
    "company_role" "text" NOT NULL,
    "must_change_password" boolean DEFAULT true NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_company_role_check" CHECK (("company_role" = ANY (ARRAY['admin'::"text", 'manager'::"text", 'marketing_team_member'::"text", 'sales_representative'::"text", 'compliance_officer'::"text", 'general_staff'::"text"]))),
    CONSTRAINT "profiles_username_length" CHECK (("char_length"("username") >= 3))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales" (
    "sale_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "client" "text" NOT NULL,
    "sale_description" "text",
    "direction" "public"."sale_direction" NOT NULL,
    "sale_timestamp" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_assignees" (
    "task_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."task_assignees" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_notes" (
    "note_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "note_text" "text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "task_notes_text_not_blank" CHECK (("btrim"("note_text") <> ''::"text"))
);


ALTER TABLE "public"."task_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "task_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_name" "text" NOT NULL,
    "task_description" "text",
    "task_status" "public"."task_status" DEFAULT 'pending'::"public"."task_status" NOT NULL,
    "archive_status" boolean DEFAULT false NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "assigned_role" "text",
    "assigned_user_id" "uuid",
    "taken_by" "uuid",
    "is_urgent" boolean DEFAULT false NOT NULL,
    "blocker_resolved_by" "uuid",
    "blocker_resolved_at" timestamp with time zone,
    CONSTRAINT "tasks_assigned_role_check" CHECK ((("assigned_role" IS NULL) OR ("assigned_role" = ANY (ARRAY['admin'::"text", 'manager'::"text", 'marketing_team_member'::"text", 'sales_representative'::"text", 'compliance_officer'::"text", 'general_staff'::"text"]))))
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."todos" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."todos" OWNER TO "postgres";


ALTER TABLE "public"."todos" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."todos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."activity_logs"
    ADD CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("log_id");



ALTER TABLE ONLY "public"."campaign_assignees"
    ADD CONSTRAINT "campaign_assignees_pkey" PRIMARY KEY ("campaign_id", "user_id");



ALTER TABLE ONLY "public"."campaign_materials"
    ADD CONSTRAINT "campaign_materials_pkey" PRIMARY KEY ("campaign_id", "document_id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_pkey" PRIMARY KEY ("campaign_id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("document_id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_storage_path_key" UNIQUE ("storage_path");



ALTER TABLE ONLY "public"."folder_access_policies"
    ADD CONSTRAINT "folder_access_policies_pkey" PRIMARY KEY ("policy_id");



ALTER TABLE ONLY "public"."folder_access_roles"
    ADD CONSTRAINT "folder_access_roles_pkey" PRIMARY KEY ("access_role_id");



ALTER TABLE ONLY "public"."folder_access_roles"
    ADD CONSTRAINT "folder_access_roles_policy_id_role_key" UNIQUE ("policy_id", "role");



ALTER TABLE ONLY "public"."folders"
    ADD CONSTRAINT "folders_pkey" PRIMARY KEY ("folder_id");



ALTER TABLE ONLY "public"."follow_ups"
    ADD CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("follow_up_id");



ALTER TABLE ONLY "public"."interactions"
    ADD CONSTRAINT "interactions_pkey" PRIMARY KEY ("interaction_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_pkey" PRIMARY KEY ("sale_id");



ALTER TABLE ONLY "public"."task_assignees"
    ADD CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("task_id", "user_id");



ALTER TABLE ONLY "public"."task_notes"
    ADD CONSTRAINT "task_notes_pkey" PRIMARY KEY ("note_id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("task_id");



ALTER TABLE ONLY "public"."todos"
    ADD CONSTRAINT "todos_pkey" PRIMARY KEY ("id");



CREATE INDEX "activity_logs_occurred_at_idx" ON "public"."activity_logs" USING "btree" ("occurred_at" DESC);



CREATE INDEX "activity_logs_person_name_idx" ON "public"."activity_logs" USING "btree" ("person_name");



CREATE INDEX "campaigns_active_status_idx" ON "public"."campaigns" USING "btree" ("campaign_status") WHERE ("archive_status" = false);



CREATE UNIQUE INDEX "folder_access_policies_folder_id_key" ON "public"."folder_access_policies" USING "btree" ("folder_id");



CREATE UNIQUE INDEX "folders_name_parent_uq" ON "public"."folders" USING "btree" ("name", "parent_folder_id") WHERE ("parent_folder_id" IS NOT NULL);



CREATE UNIQUE INDEX "folders_name_root_uq" ON "public"."folders" USING "btree" ("name") WHERE ("parent_folder_id" IS NULL);



CREATE INDEX "idx_documents_folder" ON "public"."documents" USING "btree" ("folder_id");



CREATE INDEX "idx_documents_group" ON "public"."documents" USING "btree" ("document_group_id");



CREATE INDEX "idx_folder_access_policies_folder" ON "public"."folder_access_policies" USING "btree" ("folder_id");



CREATE INDEX "idx_folder_access_roles_policy" ON "public"."folder_access_roles" USING "btree" ("policy_id");



CREATE INDEX "idx_follow_ups_employee" ON "public"."follow_ups" USING "btree" ("employee_id", "follow_up_date");



CREATE INDEX "idx_follow_ups_interaction" ON "public"."follow_ups" USING "btree" ("interaction_id");



CREATE INDEX "idx_interactions_campaign" ON "public"."interactions" USING "btree" ("campaign_id");



CREATE INDEX "idx_interactions_employee" ON "public"."interactions" USING "btree" ("employee_id", "interaction_date" DESC);



CREATE INDEX "idx_task_notes_task_created" ON "public"."task_notes" USING "btree" ("task_id", "created_at" DESC);



CREATE INDEX "idx_tasks_assigned_role" ON "public"."tasks" USING "btree" ("assigned_role") WHERE ("assigned_role" IS NOT NULL);



CREATE INDEX "idx_tasks_taken_by" ON "public"."tasks" USING "btree" ("taken_by") WHERE ("taken_by" IS NOT NULL);



CREATE INDEX "interactions_is_archived_idx" ON "public"."interactions" USING "btree" ("is_archived");



CREATE INDEX "sales_employee_timestamp_idx" ON "public"."sales" USING "btree" ("employee_id", "sale_timestamp" DESC);



CREATE INDEX "tasks_active_status_idx" ON "public"."tasks" USING "btree" ("task_status") WHERE ("archive_status" = false);



CREATE OR REPLACE TRIGGER "set_campaigns_updated_at" BEFORE UPDATE ON "public"."campaigns" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_follow_ups_updated_at" BEFORE UPDATE ON "public"."follow_ups" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_interactions_updated_at" BEFORE UPDATE ON "public"."interactions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_sales_updated_at" BEFORE UPDATE ON "public"."sales" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_tasks_updated_at" BEFORE UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_clear_blocker" BEFORE UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."clear_blocker_on_unblock"();



CREATE OR REPLACE TRIGGER "trg_create_default_folder_access_policy" AFTER INSERT ON "public"."folders" FOR EACH ROW EXECUTE FUNCTION "public"."create_default_folder_access_policy"();



CREATE OR REPLACE TRIGGER "trg_sync_campaign_archive_status" BEFORE INSERT OR UPDATE ON "public"."campaigns" FOR EACH ROW EXECUTE FUNCTION "public"."sync_campaign_archive_status"();



ALTER TABLE ONLY "public"."activity_logs"
    ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."campaign_assignees"
    ADD CONSTRAINT "campaign_assignees_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("campaign_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_assignees"
    ADD CONSTRAINT "campaign_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_materials"
    ADD CONSTRAINT "campaign_materials_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("campaign_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_materials"
    ADD CONSTRAINT "campaign_materials_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("document_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("campaign_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("folder_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."folder_access_policies"
    ADD CONSTRAINT "folder_access_policies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."folder_access_policies"
    ADD CONSTRAINT "folder_access_policies_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("folder_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."folder_access_roles"
    ADD CONSTRAINT "folder_access_roles_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "public"."folder_access_policies"("policy_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."folders"
    ADD CONSTRAINT "folders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."folders"
    ADD CONSTRAINT "folders_parent_folder_id_fkey" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."folders"("folder_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."follow_ups"
    ADD CONSTRAINT "follow_ups_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."follow_ups"
    ADD CONSTRAINT "follow_ups_interaction_id_fkey" FOREIGN KEY ("interaction_id") REFERENCES "public"."interactions"("interaction_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."interactions"
    ADD CONSTRAINT "interactions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("campaign_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."interactions"
    ADD CONSTRAINT "interactions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."task_assignees"
    ADD CONSTRAINT "task_assignees_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_assignees"
    ADD CONSTRAINT "task_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_notes"
    ADD CONSTRAINT "task_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."task_notes"
    ADD CONSTRAINT "task_notes_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("task_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_blocker_resolved_by_fkey" FOREIGN KEY ("blocker_resolved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_taken_by_fkey" FOREIGN KEY ("taken_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."todos"
    ADD CONSTRAINT "todos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Users can insert own todos" ON "public"."todos" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own todos" ON "public"."todos" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."activity_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activity_logs_delete_admin" ON "public"."activity_logs" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "activity_logs_insert_authenticated" ON "public"."activity_logs" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" IS NULL) OR ("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "activity_logs_read_admin" ON "public"."activity_logs" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "activity_logs_select_own" ON "public"."activity_logs" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "activity_logs_update_admin" ON "public"."activity_logs" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."campaign_assignees" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "campaign_assignees_delete_workflow" ON "public"."campaign_assignees" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"()));



CREATE POLICY "campaign_assignees_full_access_authenticated" ON "public"."campaign_assignees" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "campaign_assignees_insert_workflow" ON "public"."campaign_assignees" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_marketing_team_member"()));



CREATE POLICY "campaign_assignees_select_workflow" ON "public"."campaign_assignees" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_marketing_team_member"() OR "public"."is_sales_representative"()));



CREATE POLICY "campaign_assignees_update_workflow" ON "public"."campaign_assignees" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_marketing_team_member"())) WITH CHECK (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_marketing_team_member"()));



ALTER TABLE "public"."campaign_materials" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "campaign_materials_delete" ON "public"."campaign_materials" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_marketing_team_member"()));



CREATE POLICY "campaign_materials_insert" ON "public"."campaign_materials" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_marketing_team_member"()));



CREATE POLICY "campaign_materials_select" ON "public"."campaign_materials" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_marketing_team_member"() OR ("public"."is_sales_representative"() AND (EXISTS ( SELECT 1
   FROM "public"."campaigns" "c"
  WHERE (("c"."campaign_id" = "campaign_materials"."campaign_id") AND ("c"."campaign_status" = 'active'::"text")))))));



ALTER TABLE "public"."campaigns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "campaigns_delete_admin_or_manager" ON "public"."campaigns" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"()));



CREATE POLICY "campaigns_full_access_authenticated" ON "public"."campaigns" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "campaigns_insert_workflow" ON "public"."campaigns" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR "public"."is_manager"() OR ("public"."is_marketing_team_member"() AND ("campaign_status" = 'draft'::"text"))));



CREATE POLICY "campaigns_select_workflow" ON "public"."campaigns" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_marketing_team_member"() OR ("public"."is_sales_representative"() AND ("campaign_status" = 'active'::"text"))));



CREATE POLICY "campaigns_update_manager_admin" ON "public"."campaigns" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"())) WITH CHECK (("public"."is_admin"() OR "public"."is_manager"()));



CREATE POLICY "campaigns_update_marketing_own" ON "public"."campaigns" FOR UPDATE TO "authenticated" USING (("public"."is_marketing_team_member"() AND ("created_by" = "auth"."uid"()))) WITH CHECK (("public"."is_marketing_team_member"() AND ("created_by" = "auth"."uid"()) AND ("campaign_status" = ANY (ARRAY['draft'::"text", 'pending_approval'::"text"]))));



ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "documents_full_access_authenticated" ON "public"."documents" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."folder_access_policies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "folder_access_policies_delete" ON "public"."folder_access_policies" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_compliance_officer"()));



CREATE POLICY "folder_access_policies_insert" ON "public"."folder_access_policies" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_marketing_team_member"() OR "public"."is_sales_representative"() OR "public"."is_compliance_officer"()));



CREATE POLICY "folder_access_policies_select" ON "public"."folder_access_policies" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "folder_access_policies_update" ON "public"."folder_access_policies" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_compliance_officer"())) WITH CHECK (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_compliance_officer"()));



ALTER TABLE "public"."folder_access_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "folder_access_roles_delete" ON "public"."folder_access_roles" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_marketing_team_member"() OR "public"."is_sales_representative"() OR "public"."is_compliance_officer"()));



CREATE POLICY "folder_access_roles_insert" ON "public"."folder_access_roles" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_marketing_team_member"() OR "public"."is_sales_representative"() OR "public"."is_compliance_officer"()));



CREATE POLICY "folder_access_roles_select" ON "public"."folder_access_roles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "folder_access_roles_update" ON "public"."folder_access_roles" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_marketing_team_member"() OR "public"."is_sales_representative"() OR "public"."is_compliance_officer"())) WITH CHECK (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_marketing_team_member"() OR "public"."is_sales_representative"() OR "public"."is_compliance_officer"()));



ALTER TABLE "public"."folders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "folders_delete" ON "public"."folders" FOR DELETE TO "authenticated" USING (false);



CREATE POLICY "folders_insert" ON "public"."folders" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_marketing_team_member"() OR "public"."is_sales_representative"() OR "public"."is_compliance_officer"()));



CREATE POLICY "folders_select" ON "public"."folders" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR (("archive_status" = false) AND "public"."has_folder_access"("folder_id"))));



CREATE POLICY "folders_update" ON "public"."folders" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR "public"."has_folder_access"("folder_id"))) WITH CHECK (("public"."is_admin"() OR "public"."has_folder_access"("folder_id")));



ALTER TABLE "public"."follow_ups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "follow_ups_delete" ON "public"."follow_ups" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR ("employee_id" = "auth"."uid"())));



CREATE POLICY "follow_ups_insert" ON "public"."follow_ups" FOR INSERT TO "authenticated" WITH CHECK (("employee_id" = "auth"."uid"()));



CREATE POLICY "follow_ups_select" ON "public"."follow_ups" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_marketing_team_member"() OR ("employee_id" = "auth"."uid"())));



CREATE POLICY "follow_ups_update" ON "public"."follow_ups" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR ("employee_id" = "auth"."uid"()))) WITH CHECK (("public"."is_admin"() OR "public"."is_manager"() OR ("employee_id" = "auth"."uid"())));



ALTER TABLE "public"."interactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "interactions_delete" ON "public"."interactions" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "interactions_insert" ON "public"."interactions" FOR INSERT TO "authenticated" WITH CHECK (("employee_id" = "auth"."uid"()));



CREATE POLICY "interactions_select" ON "public"."interactions" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_marketing_team_member"() OR ("employee_id" = "auth"."uid"())));



CREATE POLICY "interactions_update" ON "public"."interactions" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR ("employee_id" = "auth"."uid"()))) WITH CHECK (("public"."is_admin"() OR "public"."is_manager"() OR ("employee_id" = "auth"."uid"())));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_delete_admin" ON "public"."profiles" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "profiles_insert_self_or_admin" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));



CREATE POLICY "profiles_read_self_or_admin" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));



CREATE POLICY "profiles_select_authenticated" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("is_active" = true) OR ("auth"."uid"() = "user_id")));



CREATE POLICY "profiles_update_self_or_admin" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "user_id") OR "public"."is_admin"())) WITH CHECK ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));



ALTER TABLE "public"."sales" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_full_access_authenticated" ON "public"."sales" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."task_assignees" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_assignees_delete_managers" ON "public"."task_assignees" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"()));



CREATE POLICY "task_assignees_full_access_authenticated" ON "public"."task_assignees" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "task_assignees_insert_managers" ON "public"."task_assignees" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR "public"."is_manager"()));



CREATE POLICY "task_assignees_select_stakeholders" ON "public"."task_assignees" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR ("user_id" = "auth"."uid"())));



CREATE POLICY "task_assignees_update_managers" ON "public"."task_assignees" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"())) WITH CHECK (("public"."is_admin"() OR "public"."is_manager"()));



ALTER TABLE "public"."task_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_notes_delete_stakeholders" ON "public"."task_notes" FOR DELETE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR ("created_by" = "auth"."uid"())));



CREATE POLICY "task_notes_insert_stakeholders" ON "public"."task_notes" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR "public"."is_manager"() OR (("created_by" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."tasks" "t"
  WHERE (("t"."task_id" = "task_notes"."task_id") AND (("t"."taken_by" = "auth"."uid"()) OR ("t"."assigned_user_id" = "auth"."uid"()))))))));



CREATE POLICY "task_notes_select_stakeholders" ON "public"."task_notes" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR (EXISTS ( SELECT 1
   FROM "public"."tasks" "t"
  WHERE (("t"."task_id" = "task_notes"."task_id") AND (("t"."taken_by" = "auth"."uid"()) OR ("t"."assigned_user_id" = "auth"."uid"()))))) OR (EXISTS ( SELECT 1
   FROM "public"."tasks" "t"
  WHERE (("t"."task_id" = "task_notes"."task_id") AND ("t"."task_status" = 'blocked'::"public"."task_status") AND ("t"."assigned_role" = "public"."current_user_role"())))) OR (EXISTS ( SELECT 1
   FROM "public"."tasks" "t"
  WHERE (("t"."task_id" = "task_notes"."task_id") AND "public"."is_compliance_officer"() AND ("t"."assigned_role" = "public"."current_user_role"()) AND (("t"."task_status" = 'done'::"public"."task_status") OR ("t"."archive_status" = true)))))));



CREATE POLICY "task_notes_update_stakeholders" ON "public"."task_notes" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR ("created_by" = "auth"."uid"()))) WITH CHECK (("public"."is_admin"() OR "public"."is_manager"() OR ("created_by" = "auth"."uid"())));



ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tasks_delete_admin" ON "public"."tasks" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "tasks_full_access_authenticated" ON "public"."tasks" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "tasks_insert_allowed" ON "public"."tasks" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR "public"."is_manager"() OR "public"."is_general_staff"() OR "public"."is_compliance_officer"()));



CREATE POLICY "tasks_select_stakeholders" ON "public"."tasks" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"() OR (("assigned_user_id" IS NULL) AND ("taken_by" IS NULL) AND ("assigned_role" = "public"."current_user_role"())) OR ("assigned_user_id" = "auth"."uid"()) OR ("taken_by" = "auth"."uid"()) OR ("created_by" = "auth"."uid"()) OR (("task_status" = 'blocked'::"public"."task_status") AND ("assigned_role" = "public"."current_user_role"())) OR ("public"."is_compliance_officer"() AND ("assigned_role" = "public"."current_user_role"()) AND (("task_status" = 'done'::"public"."task_status") OR ("archive_status" = true)))));



CREATE POLICY "tasks_update_executor" ON "public"."tasks" FOR UPDATE TO "authenticated" USING ((("taken_by" = "auth"."uid"()) OR ("assigned_user_id" = "auth"."uid"()))) WITH CHECK ((("taken_by" = "auth"."uid"()) OR ("assigned_user_id" = "auth"."uid"())));



CREATE POLICY "tasks_update_group_done_close" ON "public"."tasks" FOR UPDATE TO "authenticated" USING (("public"."is_compliance_officer"() AND ("assigned_role" = "public"."current_user_role"()) AND ("task_status" = 'done'::"public"."task_status"))) WITH CHECK (("public"."is_compliance_officer"() AND ("assigned_role" = "public"."current_user_role"()) AND ("task_status" = 'done'::"public"."task_status") AND ("archive_status" = true)));



CREATE POLICY "tasks_update_managers" ON "public"."tasks" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR "public"."is_manager"())) WITH CHECK (("public"."is_admin"() OR "public"."is_manager"()));



ALTER TABLE "public"."todos" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































REVOKE ALL ON FUNCTION "public"."archive_folder"("p_folder_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."archive_folder"("p_folder_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."archive_folder"("p_folder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."archive_folder"("p_folder_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."clear_blocker_on_unblock"() TO "anon";
GRANT ALL ON FUNCTION "public"."clear_blocker_on_unblock"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."clear_blocker_on_unblock"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_default_folder_access_policy"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_default_folder_access_policy"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_default_folder_access_policy"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_folder_access"("p_folder_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_folder_access"("p_folder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_folder_access"("p_folder_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin"("check_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"("check_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"("check_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"("check_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_compliance_officer"("check_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_compliance_officer"("check_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_compliance_officer"("check_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_compliance_officer"("check_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_general_staff"("check_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_general_staff"("check_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_general_staff"("check_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_general_staff"("check_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_manager"("check_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_manager"("check_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_manager"("check_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_manager"("check_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_marketing_team_member"("check_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_marketing_team_member"("check_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_marketing_team_member"("check_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_marketing_team_member"("check_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_sales_representative"("check_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_sales_representative"("check_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_sales_representative"("check_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_sales_representative"("check_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_blocker_resolved"("p_task_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_blocker_resolved"("p_task_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_blocker_resolved"("p_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_blocker_resolved"("p_task_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."purge_activity_logs"("retention_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_activity_logs"("retention_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."purge_activity_logs"("retention_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."purge_activity_logs"("retention_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_campaign_archive_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_campaign_archive_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_campaign_archive_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."take_task"("p_task_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."take_task"("p_task_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."take_task"("p_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."take_task"("p_task_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."unarchive_folder"("p_folder_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."unarchive_folder"("p_folder_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."unarchive_folder"("p_folder_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unarchive_folder"("p_folder_id" "uuid") TO "service_role";


















GRANT ALL ON TABLE "public"."activity_logs" TO "anon";
GRANT ALL ON TABLE "public"."activity_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."activity_logs_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."activity_logs_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."activity_logs_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."campaign_assignees" TO "anon";
GRANT ALL ON TABLE "public"."campaign_assignees" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_assignees" TO "service_role";



GRANT ALL ON TABLE "public"."campaign_materials" TO "anon";
GRANT ALL ON TABLE "public"."campaign_materials" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_materials" TO "service_role";



GRANT ALL ON TABLE "public"."campaigns" TO "anon";
GRANT ALL ON TABLE "public"."campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON TABLE "public"."folder_access_policies" TO "anon";
GRANT ALL ON TABLE "public"."folder_access_policies" TO "authenticated";
GRANT ALL ON TABLE "public"."folder_access_policies" TO "service_role";



GRANT ALL ON TABLE "public"."folder_access_roles" TO "anon";
GRANT ALL ON TABLE "public"."folder_access_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."folder_access_roles" TO "service_role";



GRANT ALL ON TABLE "public"."folders" TO "anon";
GRANT ALL ON TABLE "public"."folders" TO "authenticated";
GRANT ALL ON TABLE "public"."folders" TO "service_role";



GRANT ALL ON TABLE "public"."follow_ups" TO "anon";
GRANT ALL ON TABLE "public"."follow_ups" TO "authenticated";
GRANT ALL ON TABLE "public"."follow_ups" TO "service_role";



GRANT ALL ON TABLE "public"."interactions" TO "anon";
GRANT ALL ON TABLE "public"."interactions" TO "authenticated";
GRANT ALL ON TABLE "public"."interactions" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."sales" TO "anon";
GRANT ALL ON TABLE "public"."sales" TO "authenticated";
GRANT ALL ON TABLE "public"."sales" TO "service_role";



GRANT ALL ON TABLE "public"."task_assignees" TO "anon";
GRANT ALL ON TABLE "public"."task_assignees" TO "authenticated";
GRANT ALL ON TABLE "public"."task_assignees" TO "service_role";



GRANT ALL ON TABLE "public"."task_notes" TO "anon";
GRANT ALL ON TABLE "public"."task_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."task_notes" TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT ALL ON TABLE "public"."todos" TO "anon";
GRANT ALL ON TABLE "public"."todos" TO "authenticated";
GRANT ALL ON TABLE "public"."todos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."todos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."todos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."todos_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































