-- Trusted database operator only. Create the Supabase Auth user first.
-- psql "$ISOLATED_DATABASE_URL" -v owner_user_id='<Auth UUID>' -f scripts/bootstrap-owner.sql
-- Not executed automatically or by the app. No password or key belongs in this file.
\set ON_ERROR_STOP on
\if :{?owner_user_id}
begin;
select set_config('app.bootstrap_user_id', :'owner_user_id', true);
do $$
declare target uuid := current_setting('app.bootstrap_user_id')::uuid;
begin
  if not exists(select 1 from auth.users where id = target) then
    raise exception 'Create and verify the intended Auth user before assigning owner access.';
  end if;
  insert into public.admin_memberships(user_id,role,enabled)
  values(target,'owner',true)
  on conflict(user_id) do update set role='owner',enabled=true;
  insert into public.audit_logs(actor,action,entity_type,entity_id,diff,reason)
  values('trusted-bootstrap','admin.owner.bootstrap','admin_membership',target::text,'{"role":"owner","enabled":true}','Explicit trusted owner bootstrap/recovery');
end $$;
commit;
\else
\echo 'Missing owner_user_id. No changes made.'
\quit 1
\endif
