// Language-neutral reference model of the shared client behaviours (docs/contract/behavior/*.json).
// Platforms replay the same fixtures against their real code; this model proves the fixtures agree with
// the written rules, so a platform test failing means the platform drifted, not the fixture.

export function runOutbox(fixture, steps) {
  const known = new Set(fixture.knownTypes);
  const max = fixture.maxAttempts;
  let queue = [];
  const failures = [];
  const trace = [];
  for (const step of steps) {
    if (step.enqueue) {
      if (!queue.some((i) => i.id === step.enqueue.id)) queue.push({ ...step.enqueue, status: 'pending', attempts: 0 });
      continue;
    }
    const times = step.repeatRun ?? 1;
    for (let n = 0; n < times; n++) {
      const outcomes = [...step.run.outcomes];
      const sent = [];
      let result = 'complete';
      for (const item of queue.filter((i) => i.status === 'pending')) {
        if (!known.has(item.type)) { item.status = 'failed'; continue; }
        const outcome = outcomes.shift();
        if (outcome === undefined) { failures.push(`${item.id}: no scripted outcome`); break; }
        sent.push({ id: item.id, idempotencyKey: item.id });
        if (outcome === 'ok') { item.status = 'delivered'; continue; }
        if (outcome === 'retryable' && item.attempts + 1 < max) { item.attempts += 1; result = 'retry'; break; }
        item.status = 'failed';
      }
      queue = queue.filter((i) => i.status !== 'delivered');
      trace.push({ result, sent, queue: queue.map(({ id, status, attempts }) => ({ id, status, attempts })) });
      if (n === times - 1 || step.repeatRun) {
        const e = step.expect;
        if (e.result !== undefined && e.result !== result) failures.push(`result ${result} != ${e.result}`);
        if (e.sent && JSON.stringify(e.sent) !== JSON.stringify(sent)) failures.push(`sent ${JSON.stringify(sent)} != ${JSON.stringify(e.sent)}`);
        const q = queue.map(({ id, status, attempts }) => ({ id, status, attempts }));
        if (e.queue && JSON.stringify(e.queue) !== JSON.stringify(q)) failures.push(`queue ${JSON.stringify(q)} != ${JSON.stringify(e.queue)}`);
      }
    }
  }
  return failures;
}

export function runSession(c) {
  const refresh = [...c.refresh];
  let refreshCalls = 0;
  let session = 'signed_in';
  let flight = null; // single-flight refresh outcome shared by concurrent 401s
  const results = {};
  const replays = {};
  const redeem = () => {
    if (flight === null) { refreshCalls += 1; flight = refresh.shift() ?? 'transient'; }
    return flight;
  };
  for (const r of c.requests) {
    const responses = [...r.server];
    replays[r.id] = 0;
    if (responses.shift() !== 401) { results[r.id] = 'ok'; continue; }
    const outcome = redeem();
    if (outcome === 'invalid_grant') { session = 'signed_out'; results[r.id] = 'unauthenticated'; continue; }
    if (outcome === 'transient') { results[r.id] = 'retryable_error'; continue; }
    replays[r.id] = 1; // exactly one replay, never a second refresh
    results[r.id] = responses.shift() === 401 ? 'unauthenticated' : 'ok';
  }
  return { refreshCalls, results, session, replays };
}

const parseVersion = (s) => (/^\d+\.\d+\.\d+$/.test(s) ? s.split('.').map(Number) : null);
const lessThan = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };

export function runGate(fixture, c) {
  if (c.path === '/livez' || c.path === '/readyz') return { allowed: true };
  const m = typeof c.header === 'string' ? /^(web|android|apple|desktop)\/(.+)$/.exec(c.header) : null;
  if (!m) return { allowed: true };
  const have = parseVersion(m[2]);
  const minRaw = fixture.minVersions[m[1]];
  if (!have || !minRaw) return { allowed: true };
  if (lessThan(have, parseVersion(minRaw)))
    return { allowed: false, code: 'failed_precondition', reason: 'CLIENT_UPGRADE_REQUIRED', ui: 'upgrade_screen' };
  return { allowed: true };
}

export function runCapabilities(fixture, c) {
  const build = fixture.clientBuild;
  const source = c.server ?? c.lastKnown;
  const out = {};
  const names = new Set([...Object.keys(c.expect)]);
  for (const name of names) {
    if (!build.features.includes(name)) { out[name] = false; continue; }
    const flagged = build.flagged.includes(name);
    const entry = source?.features?.[name];
    let enabled = entry ? entry.enabled === true : !flagged;
    if (entry?.requiredClientVersion && lessThan(parseVersion(build.version), parseVersion(entry.requiredClientVersion))) enabled = false;
    out[name] = enabled;
  }
  return out;
}

const CONNECT_CODES = [
  'canceled', 'unknown', 'invalid_argument', 'deadline_exceeded', 'not_found', 'already_exists', 'permission_denied',
  'resource_exhausted', 'failed_precondition', 'aborted', 'out_of_range', 'unimplemented', 'internal', 'unavailable',
  'data_loss', 'unauthenticated',
];
const TRANSPORT_KIND = { offline: 'offline', timeout: 'timeout', aborted: 'cancelled', storage: 'storage' };
const OUTBOX_VERDICTS = new Set(['retry', 'permanent', 'blocked']);

/** Structural problems of error-kinds.json itself (vocabulary, total code table, flag types). */
export function validateErrorKinds(fixture) {
  const problems = [];
  const kinds = Object.keys(fixture.kinds);
  for (const [id, flags] of Object.entries(fixture.kinds)) {
    if (typeof flags.retryable !== 'boolean') problems.push(`kind ${id}: retryable must be a boolean`);
    if (typeof flags.reportable !== 'boolean') problems.push(`kind ${id}: reportable must be a boolean`);
    if (!OUTBOX_VERDICTS.has(flags.outbox)) problems.push(`kind ${id}: outbox must be one of ${[...OUTBOX_VERDICTS].join('|')}`);
  }
  for (const code of CONNECT_CODES) if (!(code in fixture.connectCodes)) problems.push(`connectCodes: missing ${code}`);
  for (const [code, kind] of Object.entries(fixture.connectCodes)) {
    if (!CONNECT_CODES.includes(code)) problems.push(`connectCodes: ${code} is not a Connect code`);
    if (!kinds.includes(kind)) problems.push(`connectCodes.${code}: unknown kind ${kind}`);
  }
  const seen = new Set(Object.values(fixture.connectCodes));
  for (const [t, k] of Object.entries(TRANSPORT_KIND)) seen.add(k);
  seen.add('upgradeRequired');
  for (const k of kinds) if (!seen.has(k)) problems.push(`kind ${k}: no Connect code or transport failure maps to it`);
  return problems;
}

/** Classifies one case: a Connect code (plus optional ErrorInfo reason) or a client-side transport failure. */
export function runErrorKind(fixture, c) {
  let kind;
  if (c.transport !== undefined) kind = TRANSPORT_KIND[c.transport];
  else if (c.code === 'failed_precondition' && c.reason === 'CLIENT_UPGRADE_REQUIRED') kind = 'upgradeRequired';
  else kind = fixture.connectCodes[c.code];
  const flags = fixture.kinds[kind];
  if (!flags) return { kind: kind ?? null, retryable: null, reportable: null };
  return { kind, retryable: flags.retryable, reportable: flags.reportable };
}
