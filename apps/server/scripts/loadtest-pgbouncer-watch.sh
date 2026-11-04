#!/usr/bin/env bash
# Watches the PgBouncer compose profile while a k6 run is in flight and fails
# the run when the pooler shows distress. Used by `task loadtest:pgbouncer`.
#
#   loadtest-pgbouncer-watch.sh check-config   max_prepared_statements/pool mode as PgBouncer reports them
#   loadtest-pgbouncer-watch.sh sample FILE    append one TSV line every INTERVAL s until killed
#   loadtest-pgbouncer-watch.sh assert FILE    evaluate the samples + logs + River state, exit 1 on a breach
#
# Everything goes through `docker compose exec` into the postgres container
# (it ships psql), so nothing is needed on the host. Thresholds (env):
#   MAX_CL_WAITING   (default 5)    clients queued for a server connection
#   MAX_WAIT_S       (default 1)    PgBouncer maxwait, seconds
#   MAX_PG_CONNS     (default 0)    0 = derive: default_pool_size + jobs conns + 20 headroom
#   STUCK_JOB_S      (default 120)  an 'available' River job older than this is stuck
#   INTERVAL         (default 2)    sample period, seconds
#   COMPOSE_FILE     (default deployments/docker/docker-compose.yml)
#
# NOT verified against a live stack in the authoring environment (Docker was
# unavailable): treat the first real run as the acceptance test.
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE_FILE="${COMPOSE_FILE:-deployments/docker/docker-compose.yml}"
INTERVAL="${INTERVAL:-2}"
MAX_CL_WAITING="${MAX_CL_WAITING:-5}"
MAX_WAIT_S="${MAX_WAIT_S:-1}"
MAX_PG_CONNS="${MAX_PG_CONNS:-0}"
STUCK_JOB_S="${STUCK_JOB_S:-120}"
export MSYS_NO_PATHCONV=1 # Git Bash on Windows must not rewrite container paths

dc() { docker compose -f "$COMPOSE_FILE" --profile pgbouncer --profile loadtest "$@"; }
# psql inside the postgres container; $1 = host (postgres|pgbouncer), $2 = port, $3 = db
psql_at() {
  local host="$1" port="$2" db="$3"
  shift 3
  dc exec -T -e PGPASSWORD=aedst postgres psql -h "$host" -p "$port" -U aedst -d "$db" -At -F $'\t' "$@"
}
pgb() { psql_at pgbouncer 6432 pgbouncer "$@"; }
pg() { psql_at postgres 5432 aedst "$@"; }

cmd="${1:-}"
case "$cmd" in
check-config)
  echo "PgBouncer configuration as reported by SHOW CONFIG:"
  cfg="$(pgb -c 'SHOW CONFIG' | awk -F'\t' '$1 ~ /^(pool_mode|max_prepared_statements|default_pool_size|max_client_conn|ignore_startup_parameters|server_reset_query|query_wait_timeout)$/ {printf "  %-28s %s\n", $1, $2}')" || {
    echo "cannot query the PgBouncer admin console (is the stack up with --profile pgbouncer, and does the image honour ADMIN_USERS?)" >&2
    exit 2
  }
  echo "$cfg"
  grep -q 'pool_mode *transaction' <<<"$cfg" || { echo "FAIL: pool_mode is not transaction" >&2; exit 1; }
  mps="$(awk '$1=="max_prepared_statements"{print $2}' <<<"$cfg")"
  [ "${mps:-0}" -gt 0 ] || { echo "FAIL: max_prepared_statements is ${mps:-unset}; the edoburu image did not apply MAX_PREPARED_STATEMENTS" >&2; exit 1; }
  echo "ok"
  ;;

sample)
  file="${2:?usage: sample FILE}"
  : >"$file"
  # columns: epoch  cl_waiting_max  maxwait_max  sv_total  pg_aedst_conns  pg_direct_listen
  while true; do
    # SHOW POOLS (1.24): database user cl_active cl_waiting ... maxwait maxwait_us pool_mode; cl_waiting is $4, maxwait is $(NF-2).
    sp="$(pgb -c 'SHOW POOLS' 2>/dev/null || true)"
    waiting="$(awk -F'	' '$1!="pgbouncer" {w+=$4} END {print w+0}' <<<"$sp")"
    maxwait="$(awk -F'	' '$1!="pgbouncer" {if ($(NF-2)+0>m) m=$(NF-2)+0} END {print m+0}' <<<"$sp")"
    servers="$(pgb -c 'SHOW SERVERS' 2>/dev/null | wc -l | tr -d ' ')"
    pgconns="$(pg -c "SELECT count(*) FROM pg_stat_activity WHERE datname='aedst' AND usename='aedst'" 2>/dev/null || echo 0)"
    printf '%s\t%s\t%s\t%s\t%s\n' "$(date +%s)" "${waiting:-0}" "${maxwait:-0}" "${servers:-0}" "${pgconns:-0}" >>"$file"
    sleep "$INTERVAL"
  done
  ;;

assert)
  file="${2:?usage: assert FILE}"
  fail=0
  note() { echo "  $*"; }
  bad() { echo "  FAIL: $*" >&2; fail=1; }

  echo "PgBouncer samples ($(wc -l <"$file" | tr -d ' ') points):"
  read -r max_w max_mw max_sv max_pg < <(awk -F'\t' '{if($2>a)a=$2; if($3>b)b=$3; if($4>c)c=$4; if($5>d)d=$5} END {print a+0, b+0, c+0, d+0}' "$file")
  note "peak cl_waiting=$max_w  peak maxwait=${max_mw}s  peak server conns=$max_sv  peak pg_stat_activity (aedst)=$max_pg"
  [ "$max_w" -le "$MAX_CL_WAITING" ] || bad "cl_waiting peaked at $max_w (limit $MAX_CL_WAITING): default_pool_size is too small for this replica count"
  [ "$max_mw" -le "$MAX_WAIT_S" ] || bad "maxwait peaked at ${max_mw}s (limit ${MAX_WAIT_S}s): clients queue for a server connection"
  if [ "$MAX_PG_CONNS" -gt 0 ]; then
    [ "$max_pg" -le "$MAX_PG_CONNS" ] || bad "Postgres saw $max_pg connections (limit $MAX_PG_CONNS)"
  fi

  echo "Server logs (replicas):"
  logs="$(dc logs --no-color server 2>&1 || true)"
  for pat in 'prepared statement .* does not exist' 'prepared statement .* already exists' 'lock held by another session' 'unsupported startup parameter' 'no more connections allowed' 'query_wait_timeout' 'conn closed'; do
    n="$(grep -ciE "$pat" <<<"$logs" || true)"
    note "$pat: $n"
    [ "${n:-0}" -eq 0 ] || bad "server logs contain '$pat' ($n times)"
  done

  echo "River (jobs) state:"
  stuck="$(pg -c "SELECT count(*) FROM river_job WHERE state='available' AND scheduled_at < now() - make_interval(secs => $STUCK_JOB_S)" 2>/dev/null || echo '?')"
  states="$(pg -c "SELECT state || '=' || count(*) FROM river_job GROUP BY state ORDER BY state" 2>/dev/null | paste -sd' ' - || true)"
  note "states: ${states:-none}"
  note "available for more than ${STUCK_JOB_S}s: $stuck"
  if [ "$stuck" != "?" ] && [ "$stuck" -gt 0 ]; then bad "$stuck River jobs are stuck 'available' (workers not picking up: LISTEN/NOTIFY through the pooler, or no worker queue?)"; fi
  discarded="$(pg -c "SELECT count(*) FROM river_job WHERE state='discarded' AND finalized_at > now() - interval '15 minutes'" 2>/dev/null || echo 0)"
  [ "${discarded:-0}" -eq 0 ] || bad "$discarded River jobs were discarded in the last 15 minutes"

  [ "$fail" -eq 0 ] && echo "pooler checks passed" || { echo "pooler checks FAILED" >&2; exit 1; }
  ;;

*)
  echo "usage: $0 check-config | sample FILE | assert FILE" >&2
  exit 64
  ;;
esac
