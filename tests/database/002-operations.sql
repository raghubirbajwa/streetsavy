-- The database runner wraps this file in a transaction and rolls it back.
set local role service_role;
do $$
declare
  j public.jobs; j2 public.jobs; token uuid; op public.external_operations; op2 public.external_operations;
  e public.webhook_events; e2 public.webhook_events; a public.audit_logs; n integer;
begin
  j := public.enqueue_job('test.unit', 'm1-test:lease', '{"orderId":"one"}', 2);
  j2 := public.enqueue_job('test.unit', 'm1-test:lease', '{"orderId":"one"}', 2);
  assert j.id = j2.id, 'same enqueue key/payload must converge';
  begin
    perform public.enqueue_job('test.unit', 'm1-test:lease', '{"orderId":"two"}', 2);
    raise exception 'expected enqueue payload conflict';
  exception when unique_violation then assert sqlerrm = 'IDEMPOTENCY_CONFLICT'; end;
  begin
    perform public.claim_jobs(0);
    raise exception 'expected claim bounds rejection';
  exception when invalid_parameter_value then assert sqlerrm = 'INVALID_PAYLOAD'; end;
  select * into strict j from public.claim_jobs(100) where id = j.id;
  token := j.lease_token;
  assert j.state = 'running' and j.attempts = 1 and token is not null;
  select count(*) into n from public.claim_jobs(100) where id = j.id;
  assert n = 0, 'running job cannot be claimed twice';
  j2 := public.extend_job_lease(j.id, token, 120);
  assert j2.locked_until > j.locked_until, 'current worker can renew its lease';
  begin
    perform public.complete_job(j.id, gen_random_uuid());
    raise exception 'expected forged lease rejection';
  exception when raise_exception then assert sqlerrm = 'LEASE_LOST'; end;
  begin
    perform public.fail_job(j.id, token, 'customer@example.test token=secret');
    raise exception 'expected raw exception rejection';
  exception when invalid_parameter_value then assert sqlerrm = 'INVALID_PAYLOAD'; end;
  j := public.fail_job(j.id, token, 'UPSTREAM_UNAVAILABLE');
  assert j.state = 'retry' and j.lease_token is null and j.run_after > clock_timestamp();
  update public.jobs set run_after = clock_timestamp() - interval '1 second' where id = j.id;
  select * into strict j from public.claim_jobs(100) where id = j.id;
  assert j.attempts = 2 and j.lease_token <> token;
  begin
    perform public.complete_job(j.id, token);
    raise exception 'expected stale worker fencing';
  exception when raise_exception then assert sqlerrm = 'LEASE_LOST'; end;
  j := public.fail_job(j.id, j.lease_token, 'UPSTREAM_UNAVAILABLE');
  assert j.state = 'dead' and j.attempts = 2 and j.lease_token is null;
  select count(*) into n from public.claim_jobs(100) where id = j.id;
  assert n = 0, 'dead job cannot silently re-enter queue';

  j := public.enqueue_job('test.unit', 'm1-test:expired', '{}', 2);
  select * into strict j from public.claim_jobs(100) where id = j.id;
  token := j.lease_token;
  update public.jobs set locked_until = clock_timestamp() - interval '1 second' where id = j.id;
  begin
    perform public.extend_job_lease(j.id, token);
    raise exception 'expected expired renewal rejection';
  exception when raise_exception then assert sqlerrm = 'LEASE_LOST'; end;
  assert public.reclaim_expired_jobs(100) = 1;
  select * into strict j from public.jobs where id = j.id;
  assert j.state = 'retry' and j.last_error = 'LEASE_EXPIRED' and j.lease_token is null;
  update public.jobs set run_after = clock_timestamp() - interval '1 second' where id = j.id;
  select * into strict j from public.claim_jobs(100) where id = j.id;
  update public.jobs set locked_until = clock_timestamp() - interval '1 second' where id = j.id;
  assert public.reclaim_expired_jobs(100) = 1;
  select * into strict j from public.jobs where id = j.id;
  assert j.state = 'dead', 'repeated worker crashes also exhaust retry budget';

  op := public.begin_operation('test.create', 'actor:1', 'm1-test:operation', repeat('a',64));
  op2 := public.begin_operation('test.create', 'actor:1', 'm1-test:operation', repeat('a',64));
  assert op.id = op2.id;
  begin
    perform public.begin_operation('test.create', 'actor:1', 'm1-test:operation', repeat('b',64));
    raise exception 'expected operation payload conflict';
  exception when unique_violation then assert sqlerrm = 'IDEMPOTENCY_CONFLICT'; end;
  op := public.claim_operation(op.id);
  token := op.lease_token;
  assert op.status = 'running' and op.attempts = 1 and token is not null;
  op2 := public.begin_operation('test.create', 'actor:1', 'm1-test:operation', repeat('a',64));
  assert op2.status = 'running' and op2.lease_token is null, 'replayed operation must not disclose another worker token';
  begin
    perform public.claim_operation(op.id);
    raise exception 'expected operation exclusive claim';
  exception when raise_exception then assert sqlerrm = 'OPERATION_BUSY'; end;
  update public.external_operations set locked_until = clock_timestamp() - interval '1 second' where id = op.id;
  op := public.claim_operation(op.id);
  assert op.status = 'unknown' and op.lease_token is null and op.last_error = 'RECONCILIATION_REQUIRED';
  op2 := public.claim_operation(op.id);
  assert op2.status = 'unknown' and op2.attempts = 1, 'uncertain create must not be attempted again';
  begin
    perform public.finish_operation(op.id, token, 'succeeded');
    raise exception 'expected stale operation fencing';
  exception when raise_exception then assert sqlerrm = 'LEASE_LOST'; end;
  op := public.begin_operation('test.create', 'actor:1', 'm1-test:finish', repeat('c',64));
  op := public.claim_operation(op.id);
  op := public.finish_operation(op.id, op.lease_token, 'succeeded', 'provider-1', '{"status":"ok","nested":{"apiKey":"private","email":"private@example.test"}}');
  assert op.status = 'succeeded' and op.lease_token is null and op.provider_reference = 'provider-1';
  assert op.result_json #>> '{nested,apiKey}' = '[REDACTED]' and op.result_json #>> '{nested,email}' = '[REDACTED]';
  op2 := public.claim_operation(op.id);
  assert op2.status = 'succeeded' and op2.attempts = 1;

  -- Invalid signature cannot reserve a provider event's verified dedupe identity.
  e := public.receive_webhook('testprovider', 'test', 'evt-1', repeat('d',64), 'rejected', '{"secret":"private"}');
  assert e.processing_status = 'ignored';
  select count(*) into n from public.jobs where dedupe_key = 'webhook:' || e.id::text;
  assert n = 0;
  e := public.receive_webhook('testprovider', 'test', 'evt-1', repeat('d',64), 'verified', '{"secret":"private","status":"captured"}');
  e2 := public.receive_webhook('testprovider', 'test', 'evt-1', repeat('d',64), 'verified', '{"secret":"private","status":"captured"}');
  assert e.id = e2.id and e.payload ->> 'secret' = '[REDACTED]';
  select count(*) into n from public.jobs where dedupe_key = 'webhook:' || e.id::text;
  assert n = 1, 'duplicate webhook must share one durable work item';
  begin
    perform public.receive_webhook('testprovider', 'test', 'evt-1', repeat('e',64), 'verified', '{}');
    raise exception 'expected webhook payload conflict';
  exception when unique_violation then assert sqlerrm = 'IDEMPOTENCY_CONFLICT'; end;
  select * into strict j from public.claim_jobs(100) where payload ->> 'webhookEventId' = e.id::text;
  token := j.lease_token;
  begin
    perform public.finish_webhook(gen_random_uuid(), j.id, token);
    raise exception 'expected webhook/job identity mismatch';
  exception when invalid_parameter_value then assert sqlerrm = 'INVALID_PAYLOAD'; end;
  e := public.finish_webhook(e.id, j.id, token);
  select * into strict j from public.jobs where id = j.id;
  assert e.processing_status = 'processed' and e.attempts = 1 and j.state = 'done';
  begin
    perform public.finish_webhook(e.id, j.id, token);
    raise exception 'expected webhook completion replay fencing';
  exception when raise_exception then assert sqlerrm = 'LEASE_LOST'; end;
  e := public.receive_webhook('testprovider', 'test', null, repeat('f',64), 'hint', '{}');
  select count(*) into n from public.jobs where dedupe_key = 'webhook:' || e.id::text and type = 'webhook.reconcile';
  assert n = 1, 'unverified hint must request authoritative reconciliation';

  a := public.record_audit('system', 'test.inspect', 'jobs', j.id::text,
    '{"status":"done","password":"private","items":[{"phone":"123"}]}');
  assert a.diff ->> 'status' = 'done' and a.diff ->> 'password' = '[REDACTED]';
  assert a.diff #>> '{items,0,phone}' = '[REDACTED]';
  begin
    update public.audit_logs set action = 'test.rewrite' where id = a.id;
    raise exception 'expected audit append-only enforcement';
  exception when check_violation then null; end;
end;
$$;

reset role;
do $$
declare fn record; r text;
begin
  for fn in select p.oid, p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'is_safe_operation_error','redact_operational_json','enqueue_job','claim_jobs','reclaim_expired_jobs',
      'extend_job_lease','complete_job','fail_job','begin_operation','claim_operation','finish_operation',
      'reclaim_expired_operations','receive_webhook','finish_webhook','record_audit'
    ) loop
    foreach r in array array['anon','authenticated'] loop
      assert not has_function_privilege(r, fn.oid, 'EXECUTE'), fn.proname || ' exposed to ' || r;
    end loop;
    assert has_function_privilege('service_role', fn.oid, 'EXECUTE'), fn.proname || ' unavailable to worker';
    assert array_to_string(fn.proconfig, ',') like '%search_path=%', fn.proname || ' missing fixed search_path';
  end loop;
end;
$$;
set local role anon;
do $$ begin
  begin
    perform public.claim_jobs();
    raise exception 'expected anon RPC denial';
  exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
do $$ begin
  begin
    perform public.begin_operation('test.admin', 'actor:1', 'key', repeat('a',64));
    raise exception 'expected authenticated RPC denial';
  exception when insufficient_privilege then null; end;
end $$;
