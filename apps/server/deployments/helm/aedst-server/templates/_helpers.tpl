{{/* Chart name, truncated to the 63-char DNS label limit. */}}
{{- define "aedst-server.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Fully qualified app name. */}}
{{- define "aedst-server.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "aedst-server.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "aedst-server.selectorLabels" -}}
app.kubernetes.io/name: {{ include "aedst-server.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "aedst-server.labels" -}}
helm.sh/chart: {{ include "aedst-server.chart" . }}
{{ include "aedst-server.selectorLabels" . }}
app.kubernetes.io/version: {{ include "aedst-server.imageTag" . | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "aedst-server.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "aedst-server.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* Name of the pre-existing Secret holding all sensitive values. */}}
{{- define "aedst-server.secretName" -}}
{{- required "existingSecret is required: name of an existing Secret with the database DSN (and the Valkey password)" .Values.existingSecret -}}
{{- end -}}

{{/* image.tag is required: a floating "latest" must never reach a cluster. */}}
{{- define "aedst-server.imageTag" -}}
{{- required "image.tag is required: pass --set image.tag=<immutable tag, e.g. sha-...>; there is no floating latest" .Values.image.tag -}}
{{- end -}}

{{- define "aedst-server.image" -}}
{{- printf "%s:%s" .Values.image.repository (include "aedst-server.imageTag" .) -}}
{{- end -}}

{{- define "aedst-server.migrationImage" -}}
{{- printf "%s:%s" .Values.migrations.image.repository (.Values.migrations.image.tag | default (include "aedst-server.imageTag" .)) -}}
{{- end -}}

{{/*
terminationGracePeriodSeconds must exceed AEDST_SHUTDOWN_DRAIN_SECONDS (readiness
fails, listener still open) + AEDST_SHUTDOWN_TIMEOUT_SECONDS (in-flight requests
finish), otherwise the kubelet SIGKILLs the pod mid-drain.
*/}}
{{- define "aedst-server.terminationGracePeriodSeconds" -}}
{{- $min := add (int .Values.config.shutdownDrainSeconds) (int .Values.config.shutdownTimeoutSeconds) -}}
{{- if .Values.terminationGracePeriodSeconds -}}
{{- if le (int .Values.terminationGracePeriodSeconds) (int $min) -}}
{{- fail (printf "terminationGracePeriodSeconds (%v) must be greater than shutdownDrainSeconds + shutdownTimeoutSeconds (%v)" .Values.terminationGracePeriodSeconds $min) -}}
{{- end -}}
{{- int .Values.terminationGracePeriodSeconds -}}
{{- else -}}
{{- add $min 10 -}}
{{- end -}}
{{- end -}}

{{/* AEDST_ROLE_POLICY: procedure=role|role,procedure=role (map keys sorted by Helm). */}}
{{- define "aedst-server.rolePolicy" -}}
{{- $parts := list -}}
{{- range $procedure, $roles := .Values.config.rolePolicy -}}
{{- $parts = append $parts (printf "%s=%s" $procedure (join "|" $roles)) -}}
{{- end -}}
{{- join "," $parts -}}
{{- end }}

{{/*
Postgres connection budget. Fails the render when the worst case exceeds
database.serverMaxConnections (0 disables the check):
  direct jobs pools   (API at autoscaling.maxReplicas + every worker) x jobsMaxConns
  API pools           x maxConns when there is no pooler, else the pooler's server
                      connections (database.poolerServerConns = instances x default_pool_size)
  other clients       database.reservedConns (IdP, admin sessions, operator)
*/}}
{{- define "aedst-server.connectionBudget" -}}
{{- $max := int64 (default 0 .Values.database.serverMaxConnections) -}}
{{- if gt $max 0 -}}
{{- $api := int64 .Values.replicaCount -}}
{{- if .Values.autoscaling.enabled -}}{{- $api = int64 .Values.autoscaling.maxReplicas -}}{{- end -}}
{{- $workers := int64 0 -}}
{{- range .Values.workers -}}{{- $workers = add $workers (int64 (default 1 .replicas)) -}}{{- end -}}
{{- $jobs := mul (add $api $workers) (int64 .Values.database.jobsMaxConns) -}}
{{- $apiConns := int64 0 -}}
{{- if eq (default "none" .Values.database.pooler) "pgbouncer" -}}
{{- $apiConns = int64 (default 0 .Values.database.poolerServerConns) -}}
{{- else -}}
{{- $apiConns = mul $api (int64 .Values.database.maxConns) -}}
{{- end -}}
{{- $total := add $jobs $apiConns (int64 (default 0 .Values.database.reservedConns)) -}}
{{- if gt $total $max -}}
{{- fail (printf "database connection budget exceeded: %d (jobs pools %d + API connections %d + reserved %d) > database.serverMaxConnections %d. Lower jobsMaxConns/maxReplicas, raise Postgres max_connections, or shrink the pooler pool (docs/content/server/scaling.md)" $total $jobs $apiConns (int64 (default 0 .Values.database.reservedConns)) $max) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
GOMEMLIMIT for a container: 85% of resources.limits.memory, in MiB, so the Go GC
works harder before the kernel OOM-kills the pod. Empty when there is no limit or
the quantity is not Ki/Mi/Gi/Ti (K8s decimal suffixes are rare and approximated by
the caller setting config.goMemLimit). Argument: the resources map.
*/}}
{{- define "aedst-server.goMemLimit" -}}
{{- $limit := "" -}}
{{- if and . .limits .limits.memory -}}{{- $limit = toString .limits.memory -}}{{- end -}}
{{- $mib := int64 0 -}}
{{- if hasSuffix "Gi" $limit -}}{{- $mib = mul (int64 (trimSuffix "Gi" $limit)) 1024 -}}
{{- else if hasSuffix "Mi" $limit -}}{{- $mib = int64 (trimSuffix "Mi" $limit) -}}
{{- else if hasSuffix "Ti" $limit -}}{{- $mib = mul (int64 (trimSuffix "Ti" $limit)) 1048576 -}}
{{- else if hasSuffix "Ki" $limit -}}{{- $mib = div (int64 (trimSuffix "Ki" $limit)) 1024 -}}
{{- end -}}
{{- if gt $mib 0 -}}{{- printf "%dMiB" (div (mul $mib 85) 100) -}}{{- end -}}
{{- end -}}
