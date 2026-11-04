{{- define "aedst-web.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "aedst-web.fullname" -}}
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

{{- define "aedst-web.selectorLabels" -}}
app.kubernetes.io/name: {{ include "aedst-web.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "aedst-web.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "aedst-web.selectorLabels" . }}
app.kubernetes.io/version: {{ include "aedst-web.imageTag" . | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "aedst-web.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "aedst-web.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* image.tag is required: a floating "latest" must never reach a cluster. */}}
{{- define "aedst-web.imageTag" -}}
{{- required "image.tag is required: pass --set image.tag=<immutable tag, e.g. sha-...>; there is no floating latest" .Values.image.tag -}}
{{- end -}}

{{- define "aedst-web.image" -}}
{{- printf "%s:%s" .Values.image.repository (include "aedst-web.imageTag" .) -}}
{{- end -}}
