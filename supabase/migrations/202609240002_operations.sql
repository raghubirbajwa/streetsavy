-- M1 durable infrastructure only. There is deliberately no scheduler or provider worker yet.
-- Every RPC is service-role only, uses a fixed path and returns stable error codes.
alter table public.external_operations
  add column lease_token uuid,
  add column locked_until timestamptz,
  add column attempts integer not null default 0 check (attempts >= 0),
  add column last_error text;

alter table public.jobs add constraint jobs_lease_consistent check (
  (state = 'running' and lease_token is not null and locked_until is not null)
  or (state <> 'running' and lease_token is null and locked_until is null)
), add constraint jobs_attempt_bound check (attempts <= max_attempts);
alter table public.external_operations add constraint operations_lease_consistent check (
  (status = 'running' and lease_token is not null and locked_until is not null)
  or (status <> 'running' and lease_token is null and locked_until is null)
);

create index jobs_claimable_idx on public.jobs (run_after, created_at, id)
  where state in ('queued', 'retry');
create index jobs_expired_lease_idx on public.jobs (locked_until)
  where state = 'running';
create index operations_expired_lease_idx on public.external_operations (locked_until)
  where status = 'running';

-- Defense in depth: do not accept provider exception text as a persisted error.
create function public.is_safe_operation_error(p_code text) returns boolean
language sql immutable set search_path = '' as $$
  select p_code in ('INTEGRATION_UNCONFIGURED', 'UPSTREAM_UNAVAILABLE', 'UPSTREAM_REJECTED',
    'UPSTREAM_UNKNOWN', 'INVALID_PAYLOAD', 'LEASE_EXPIRED', 'RECONCILIATION_REQUIRED',
    'INTERNAL_ERROR');
$$;

-- Persistence sanitization is a backstop. Callers must still construct allowlisted payloads;
-- no heuristic can identify every secret embedded in an arbitrary free-text value.
create function public.redact_operational_json(p_value jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_result jsonb; v_key text; v_value jsonb;
begin
  if p_value is null then return null; end if;
  if jsonb_typeof(p_value) = 'object' then
    v_result := '{}'::jsonb;
    for v_key, v_value in select key, value from jsonb_each(p_value) loop
      if v_key ~* '(secret|password|token|authorization|cookie|signature|email|phone|address|card|credential|api.?key)' then
        v_result := v_result || jsonb_build_object(v_key, '[REDACTED]');
      else
        v_result := v_result || jsonb_build_object(v_key, public.redact_operational_json(v_value));
      end if;
    end loop;
    return v_result;
  elsif jsonb_typeof(p_value) = 'array' then
    select coalesce(jsonb_agg(public.redact_operational_json(value)), '[]'::jsonb)
      into v_result from jsonb_array_elements(p_value);
    return v_result;
  end if;
  return p_value;
end;
$$;

create function public.enqueue_job(
  p_type text, p_dedupe_key text, p_payload jsonb,
  p_max_attempts integer default 5, p_run_after timestamptz default now()
) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare v_job public.jobs;
begin
  if p_type is null or p_type !~ '^[a-z][a-z0-9_.]{0,99}$'
    or p_dedupe_key is null or length(p_dedupe_key) not between 1 and 200
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or octet_length(p_payload::text) > 65536
    or p_max_attempts is null or p_max_attempts not between 1 and 25
    or p_run_after is null then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD';
  end if;
  insert into public.jobs(type, dedupe_key, payload, max_attempts, run_after)
    values (p_type, p_dedupe_key, p_payload, p_max_attempts, p_run_after)
    on conflict (dedupe_key) do nothing returning * into v_job;
  if not found then
    select * into strict v_job from public.jobs where dedupe_key = p_dedupe_key for update;
    if v_job.type <> p_type or v_job.payload <> p_payload or v_job.max_attempts <> p_max_attempts then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;
  end if;
  return v_job;
end;
$$;

create function public.reclaim_expired_jobs(p_limit integer default 100) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_now timestamptz := clock_timestamp();
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD';
  end if;
  with expired as (
    select id from public.jobs where state = 'running' and locked_until <= v_now
      order by locked_until, id for update skip locked limit p_limit
  ) update public.jobs j
    set state = case when j.attempts >= j.max_attempts then 'dead' else 'retry' end,
      run_after = v_now + make_interval(secs => least(3600, (5 * power(2, least(j.attempts - 1, 10)))::integer)),
      locked_until = null, lease_token = null, last_error = 'LEASE_EXPIRED', updated_at = v_now
    from expired where j.id = expired.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.claim_jobs(p_limit integer default 10, p_lease_seconds integer default 60)
returns setof public.jobs
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp();
begin
  if p_limit is null or p_limit not between 1 and 100
    or p_lease_seconds is null or p_lease_seconds not between 5 and 300 then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD';
  end if;
  perform public.reclaim_expired_jobs(100);
  return query with ready as (
    select id from public.jobs
    where state in ('queued', 'retry') and run_after <= v_now and attempts < max_attempts
    order by run_after, created_at, id for update skip locked limit p_limit
  ) update public.jobs j
    set state = 'running', attempts = j.attempts + 1,
      lease_token = gen_random_uuid(), locked_until = v_now + make_interval(secs => p_lease_seconds),
      updated_at = v_now
    from ready where j.id = ready.id returning j.*;
end;
$$;

create function public.extend_job_lease(p_id uuid, p_lease_token uuid, p_lease_seconds integer default 60)
returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare v_job public.jobs; v_now timestamptz := clock_timestamp();
begin
  if p_lease_seconds is null or p_lease_seconds not between 5 and 300 then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD';
  end if;
  perform 1 from public.jobs where id = p_id for update;
  v_now := clock_timestamp();
  update public.jobs set locked_until = v_now + make_interval(secs => p_lease_seconds), updated_at = v_now
    where id = p_id and state = 'running' and lease_token = p_lease_token and locked_until > v_now
    returning * into v_job;
  if not found then raise exception using errcode = 'P0001', message = 'LEASE_LOST'; end if;
  return v_job;
end;
$$;

create function public.complete_job(p_id uuid, p_lease_token uuid) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare v_job public.jobs; v_now timestamptz := clock_timestamp();
begin
  perform 1 from public.jobs where id = p_id for update;
  v_now := clock_timestamp();
  update public.jobs set state = 'done', locked_until = null, lease_token = null,
      last_error = null, updated_at = v_now
    where id = p_id and state = 'running' and lease_token = p_lease_token and locked_until > v_now
    returning * into v_job;
  if not found then raise exception using errcode = 'P0001', message = 'LEASE_LOST'; end if;
  return v_job;
end;
$$;

create function public.fail_job(p_id uuid, p_lease_token uuid, p_error_code text) returns public.jobs
language plpgsql security definer set search_path = '' as $$
declare v_job public.jobs; v_now timestamptz := clock_timestamp();
begin
  if p_error_code is null or not public.is_safe_operation_error(p_error_code) then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD';
  end if;
  perform 1 from public.jobs where id = p_id for update;
  v_now := clock_timestamp();
  update public.jobs set state = case when attempts >= max_attempts then 'dead' else 'retry' end,
      run_after = v_now + make_interval(secs => least(3600, (5 * power(2, least(attempts - 1, 10)))::integer)),
      locked_until = null, lease_token = null, last_error = p_error_code, updated_at = v_now
    where id = p_id and state = 'running' and lease_token = p_lease_token and locked_until > v_now
    returning * into v_job;
  if not found then raise exception using errcode = 'P0001', message = 'LEASE_LOST'; end if;
  return v_job;
end;
$$;

create function public.begin_operation(
  p_scope text, p_actor_or_session_key text, p_idempotency_key text, p_request_hash text,
  p_expires_at timestamptz default null
) returns public.external_operations
language plpgsql security definer set search_path = '' as $$
declare v_operation public.external_operations;
begin
  if p_scope is null or p_scope !~ '^[a-z][a-z0-9_.]{0,99}$'
    or p_actor_or_session_key is null or length(p_actor_or_session_key) not between 1 and 200
    or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 200
    or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD';
  end if;
  insert into public.external_operations(scope, actor_or_session_key, idempotency_key, request_hash, expires_at)
    values (p_scope, p_actor_or_session_key, p_idempotency_key, p_request_hash, p_expires_at)
    on conflict (scope, actor_or_session_key, idempotency_key) do nothing returning * into v_operation;
  if not found then
    select * into strict v_operation from public.external_operations
      where scope = p_scope and actor_or_session_key = p_actor_or_session_key and idempotency_key = p_idempotency_key
      for update;
    if v_operation.request_hash <> p_request_hash then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;
  end if;
  -- Expiry is retention metadata; it NEVER permits reuse of an old key.
  -- Replays expose progress, never an already-running worker's fencing token.
  v_operation.lease_token := null;
  return v_operation;
end;
$$;

create function public.claim_operation(p_id uuid, p_lease_seconds integer default 60)
returns public.external_operations
language plpgsql security definer set search_path = '' as $$
declare v_operation public.external_operations; v_now timestamptz := clock_timestamp();
begin
  if p_lease_seconds is null or p_lease_seconds not between 5 and 300 then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD';
  end if;
  select * into v_operation from public.external_operations where id = p_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'OPERATION_NOT_FOUND'; end if;
  v_now := clock_timestamp();
  if v_operation.status = 'running' and v_operation.locked_until <= v_now then
    -- A worker may have reached the provider before dying. Do not repeat its create.
    update public.external_operations set status = 'unknown', lease_token = null, locked_until = null,
      last_error = 'RECONCILIATION_REQUIRED', updated_at = v_now where id = p_id returning * into v_operation;
    return v_operation;
  end if;
  if v_operation.status = 'running' then
    raise exception using errcode = 'P0001', message = 'OPERATION_BUSY';
  end if;
  if v_operation.status <> 'queued' then return v_operation; end if;
  update public.external_operations set status = 'running', attempts = attempts + 1,
    lease_token = gen_random_uuid(), locked_until = v_now + make_interval(secs => p_lease_seconds), updated_at = v_now
    where id = p_id returning * into v_operation;
  return v_operation;
end;
$$;

create function public.finish_operation(
  p_id uuid, p_lease_token uuid, p_status text,
  p_provider_reference text default null, p_result jsonb default null, p_error_code text default null
) returns public.external_operations
language plpgsql security definer set search_path = '' as $$
declare v_operation public.external_operations; v_now timestamptz := clock_timestamp();
begin
  if p_status is null or p_status not in ('succeeded', 'failed', 'unknown')
    or (p_provider_reference is not null and length(p_provider_reference) > 200)
    or (p_result is not null and (jsonb_typeof(p_result) <> 'object' or octet_length(p_result::text) > 65536))
    or (p_error_code is not null and not public.is_safe_operation_error(p_error_code)) then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD';
  end if;
  perform 1 from public.external_operations where id = p_id for update;
  v_now := clock_timestamp();
  update public.external_operations set status = p_status, provider_reference = p_provider_reference,
      result_json = public.redact_operational_json(p_result), last_error = p_error_code,
      lease_token = null, locked_until = null, updated_at = v_now
    where id = p_id and status = 'running' and lease_token = p_lease_token and locked_until > v_now
    returning * into v_operation;
  if not found then raise exception using errcode = 'P0001', message = 'LEASE_LOST'; end if;
  return v_operation;
end;
$$;

create function public.reclaim_expired_operations(p_limit integer default 100) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_now timestamptz := clock_timestamp();
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD';
  end if;
  with expired as (
    select id from public.external_operations where status = 'running' and locked_until <= v_now
      order by locked_until, id for update skip locked limit p_limit
  ) update public.external_operations o set status = 'unknown', locked_until = null, lease_token = null,
      last_error = 'RECONCILIATION_REQUIRED', updated_at = v_now
    from expired where o.id = expired.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Signature/auth validation belongs to the future provider adapter, BEFORE this call.
-- Only redacted JSON is retained; raw signed bytes must never be reconstructed from JSON.
create function public.receive_webhook(
  p_provider text, p_environment text, p_provider_event_id text,
  p_payload_hash text, p_verification_result text, p_payload jsonb
) returns public.webhook_events
language plpgsql security definer set search_path = '' as $$
declare v_event public.webhook_events; v_dedupe text;
begin
  if p_provider is null or p_provider !~ '^[a-z][a-z0-9_.]{0,49}$'
    or p_environment is null or p_environment not in ('test', 'live')
    or (p_provider_event_id is not null and length(p_provider_event_id) not between 1 and 200)
    or p_payload_hash is null or p_payload_hash !~ '^[a-f0-9]{64}$'
    or p_verification_result is null or p_verification_result not in ('verified', 'hint', 'rejected')
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 262144 then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD';
  end if;
  v_dedupe := case when p_provider_event_id is null then 'hash:' || p_payload_hash else 'event:' || p_provider_event_id end;
  -- A rejected signature must not poison the dedupe identity of a later valid delivery.
  if p_verification_result = 'rejected' then v_dedupe := 'rejected:' || p_payload_hash; end if;
  insert into public.webhook_events(provider, environment, provider_event_id, dedupe_hash, dedupe_key,
      verification_result, payload, processing_status)
    values (p_provider, p_environment, p_provider_event_id, p_payload_hash, v_dedupe,
      p_verification_result, public.redact_operational_json(p_payload),
      case when p_verification_result = 'rejected' then 'ignored' else 'pending' end)
    on conflict (provider, environment, dedupe_key) do nothing returning * into v_event;
  if not found then
    select * into strict v_event from public.webhook_events
      where provider = p_provider and environment = p_environment and dedupe_key = v_dedupe for update;
    if v_event.dedupe_hash <> p_payload_hash or v_event.verification_result <> p_verification_result then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;
  elsif p_verification_result <> 'rejected' then
    -- Receipt and its work item commit together. Hints require authoritative reconciliation.
    perform public.enqueue_job(case when p_verification_result = 'hint' then 'webhook.reconcile' else 'webhook.process' end,
      'webhook:' || v_event.id::text, jsonb_build_object('webhookEventId', v_event.id), 5);
  end if;
  return v_event;
end;
$$;

create function public.finish_webhook(
  p_event_id uuid, p_job_id uuid, p_lease_token uuid, p_error_code text default null
) returns public.webhook_events
language plpgsql security definer set search_path = '' as $$
declare v_job public.jobs; v_event public.webhook_events;
begin
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found or v_job.state <> 'running' or v_job.lease_token is distinct from p_lease_token
    or v_job.locked_until <= clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'LEASE_LOST';
  end if;
  if v_job.type not in ('webhook.process', 'webhook.reconcile')
    or v_job.payload ->> 'webhookEventId' is distinct from p_event_id::text then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD';
  end if;
  if p_error_code is null then
    perform public.complete_job(p_job_id, p_lease_token);
  else
    perform public.fail_job(p_job_id, p_lease_token, p_error_code);
  end if;
  update public.webhook_events set processing_status = case when p_error_code is null then 'processed' else 'failed' end,
    attempts = v_job.attempts, error = p_error_code
    where id = p_event_id and verification_result <> 'rejected' returning * into v_event;
  if not found then raise exception using errcode = 'P0001', message = 'WEBHOOK_NOT_FOUND'; end if;
  return v_event;
end;
$$;

create function public.record_audit(
  p_actor text, p_action text, p_entity_type text, p_entity_id text,
  p_diff jsonb default '{}', p_reason text default null, p_request_id text default null,
  p_actor_user_id uuid default null
) returns public.audit_logs
language plpgsql security definer set search_path = '' as $$
declare v_audit public.audit_logs;
begin
  if p_actor is null or length(p_actor) not between 1 and 100
    or p_action is null or p_action !~ '^[a-z][a-z0-9_.]{0,99}$'
    or p_entity_type is null or p_entity_type !~ '^[a-z][a-z0-9_]{0,99}$'
    or (p_entity_id is not null and length(p_entity_id) > 200)
    or p_diff is null or jsonb_typeof(p_diff) <> 'object' or octet_length(p_diff::text) > 65536
    or (p_reason is not null and length(p_reason) > 500)
    or (p_request_id is not null and length(p_request_id) > 100) then
    raise exception using errcode = '22023', message = 'INVALID_PAYLOAD';
  end if;
  insert into public.audit_logs(actor, actor_user_id, action, entity_type, entity_id, diff, reason, request_id)
    values(p_actor, p_actor_user_id, p_action, p_entity_type, p_entity_id,
      public.redact_operational_json(p_diff), p_reason, p_request_id) returning * into v_audit;
  return v_audit;
end;
$$;

-- Do not grant these routines to PUBLIC, anon or authenticated, including helper routines.
do $$
declare v_routine regprocedure;
begin
  for v_routine in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'is_safe_operation_error', 'redact_operational_json', 'enqueue_job', 'reclaim_expired_jobs',
      'claim_jobs', 'extend_job_lease', 'complete_job', 'fail_job', 'begin_operation', 'claim_operation',
      'finish_operation', 'reclaim_expired_operations', 'receive_webhook', 'finish_webhook', 'record_audit'
    )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_routine);
    execute format('grant execute on function %s to service_role', v_routine);
  end loop;
end;
$$;
