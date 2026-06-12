#!/usr/bin/env bash
# Baseline de latência dos endpoints de métricas.
#
# Uso:
#   COOKIE='ns_session=<valor>' BASE='https://dash.thenorthscales.com' ./scripts/perf-baseline.sh
#   COOKIE='ns_session=<valor>' BASE='http://localhost:3000' ./scripts/perf-baseline.sh
#
# Roda RUNS requests por (endpoint × range) e imprime uma linha por request:
#   <endpoint> <range>d run<i> ttfb=<s> total=<s> bytes=<n> http=<code>
# Use a mediana das runs 2..N — a run 1 pode pagar o refresh da MV (esse
# outlier é exatamente o problema A.2 do plano; ele É parte do baseline).
#
# Ranges alinhados a dia BRT: fronteiras em 03:00 UTC (= 00:00 BRT).
set -euo pipefail

: "${COOKIE:?defina COOKIE='ns_session=...'}"
: "${BASE:?defina BASE='https://...'}"
RUNS="${RUNS:-5}"
ENDPOINTS="${ENDPOINTS:-overview funnel products platforms affiliates orders}"

# Overview também com compare=1 (caminho mais caro da página inicial).
extra_params() {
  case "$1" in
    overview) echo "&compare=1" ;;
    orders) echo "&limit=500" ;;
    *) echo "" ;;
  esac
}

today_utc=$(date -u +%Y-%m-%d)
end="${today_utc}T02:59:59.999Z"
end_next=$(date -u -d "$today_utc + 1 day" +%Y-%m-%d)T02:59:59.999Z

for days in 7 30 90; do
  start=$(date -u -d "$today_utc - $days days" +%Y-%m-%d)T03:00:00.000Z
  for ep in $ENDPOINTS; do
    extra=$(extra_params "$ep")
    url="$BASE/api/metrics/$ep?start_date=$start&end_date=$end_next$extra"
    for i in $(seq 1 "$RUNS"); do
      curl -s -o /dev/null -H "Cookie: $COOKIE" \
        -w "$ep ${days}d run$i ttfb=%{time_starttransfer} total=%{time_total} bytes=%{size_download} http=%{http_code}\n" \
        "$url"
    done
  done
done

# Outlier "1ª request após idle": espere o throttle da MV expirar e meça 1 hit.
echo "--- aguardando 65s pra capturar o outlier de refresh da MV (overview 30d) ---"
sleep 65
start=$(date -u -d "$today_utc - 30 days" +%Y-%m-%d)T03:00:00.000Z
curl -s -o /dev/null -H "Cookie: $COOKIE" \
  -w "overview 30d POST-IDLE ttfb=%{time_starttransfer} total=%{time_total} http=%{http_code}\n" \
  "$BASE/api/metrics/overview?start_date=$start&end_date=$end_next&compare=1"
