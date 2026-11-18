{{/*
Pod spec shared by the API Deployment and the worker Deployments.
Arguments (dict): root (the chart context), selectorLabels (rendered YAML), resources,
queues (AEDST_JOBS_QUEUES override, "" = use the ConfigMap value).
*/}}
{{- define "aedst-server.podSpec" -}}
{{- $a := . -}}
{{- $root := .root -}}
{{- with $root.Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
serviceAccountName: {{ include "aedst-server.serviceAccountName" $root }}
automountServiceAccountToken: false
terminationGracePeriodSeconds: {{ include "aedst-server.terminationGracePeriodSeconds" $root }}
securityContext:
  {{- toYaml $root.Values.podSecurityContext | nindent 2 }}
containers:
  - name: server
    image: {{ include "aedst-server.image" $root | quote }}
    imagePullPolicy: {{ $root.Values.image.pullPolicy }}
    securityContext:
      {{- toYaml $root.Values.securityContext | nindent 6 }}
    ports:
      - name: http
        containerPort: {{ $root.Values.containerPorts.http }}
        protocol: TCP
      {{- if $root.Values.metrics.enabled }}
      - name: metrics
        containerPort: {{ $root.Values.containerPorts.metrics }}
        protocol: TCP
      {{- end }}
    envFrom:
      - configMapRef:
          name: {{ include "aedst-server.fullname" $root }}
    env:
      - name: AEDST_DATABASE_URL
        valueFrom:
          secretKeyRef:
            name: {{ include "aedst-server.secretName" $root }}
            key: {{ required "database.dsnSecretKey is required" $root.Values.database.dsnSecretKey }}
      {{- if $root.Values.database.directDsnSecretKey }}
      - name: AEDST_DATABASE_DIRECT_DSN
        valueFrom:
          secretKeyRef:
            name: {{ include "aedst-server.secretName" $root }}
            key: {{ $root.Values.database.directDsnSecretKey }}
      {{- end }}
      {{- if $root.Values.database.readDsnSecretKey }}
      - name: AEDST_DATABASE_READ_URL
        valueFrom:
          secretKeyRef:
            name: {{ include "aedst-server.secretName" $root }}
            key: {{ $root.Values.database.readDsnSecretKey }}
      {{- end }}
      {{- if $root.Values.secretKeys.valkeyPassword }}
      - name: AEDST_VALKEY_PASSWORD
        valueFrom:
          secretKeyRef:
            name: {{ include "aedst-server.secretName" $root }}
            key: {{ $root.Values.secretKeys.valkeyPassword }}
            optional: true
      {{- end }}
      {{- if $root.Values.imgproxy.enabled }}
      - name: AEDST_IMGPROXY_KEY
        valueFrom:
          secretKeyRef:
            name: {{ required "imgproxy.existingSecret is required" $root.Values.imgproxy.existingSecret }}
            key: {{ $root.Values.imgproxy.secretKeys.key }}
      - name: AEDST_IMGPROXY_SALT
        valueFrom:
          secretKeyRef:
            name: {{ $root.Values.imgproxy.existingSecret }}
            key: {{ $root.Values.imgproxy.secretKeys.salt }}
      {{- end }}
      {{- if $a.serviceName }}
      - name: AEDST_SERVICE_NAME
        value: {{ $a.serviceName | quote }}
      {{- end }}
      # One telemetry identity per pod: the Downward API pod name is the OTel
      # service.instance.id, so two replicas never collapse into one series.
      {{- $memLimit := include "aedst-server.goMemLimit" $a.resources }}
      {{- if $memLimit }}
      - name: GOMEMLIMIT
        value: {{ $memLimit | quote }}
      {{- end }}
      - name: POD_NAME
        valueFrom:
          fieldRef:
            fieldPath: metadata.name
      - name: OTEL_RESOURCE_ATTRIBUTES
        value: {{ printf "service.instance.id=$(POD_NAME)%s" (ternary (printf ",%s" $root.Values.config.otel.resourceAttributes) "" (ne $root.Values.config.otel.resourceAttributes "")) | quote }}
      {{- if $a.queues }}
      - name: AEDST_JOBS_QUEUES
        value: {{ $a.queues | quote }}
      {{- end }}
      {{- if $a.modules }}
      - name: AEDST_MODULES
        value: {{ $a.modules | quote }}
      {{- end }}
      {{- $sk := $root.Values.secretKeys }}
      {{- $optional := dict "AEDST_STORAGE_ACCESS_KEY_ID" $sk.storageAccessKeyId "AEDST_STORAGE_SECRET_ACCESS_KEY" $sk.storageSecretAccessKey "AEDST_PUSH_VAPID_PRIVATE_KEY" $sk.vapidPrivateKey "AEDST_PUSH_FCM_CREDENTIALS_JSON" $sk.fcmCredentialsJson "AEDST_PUSH_APNS_PRIVATE_KEY" $sk.apnsPrivateKey "AEDST_INTEGRITY_CREDENTIALS_JSON" $sk.integrityCredentialsJson }}
      {{- range $name, $key := $optional }}
      {{- if $key }}
      - name: {{ $name }}
        valueFrom:
          secretKeyRef:
            name: {{ include "aedst-server.secretName" $root }}
            key: {{ $key }}
      {{- end }}
      {{- end }}
      {{- with $root.Values.extraEnv }}
      {{- toYaml . | nindent 6 }}
      {{- end }}
    startupProbe:
      httpGet:
        path: /livez
        port: http
      periodSeconds: {{ $root.Values.probes.startup.periodSeconds }}
      failureThreshold: {{ $root.Values.probes.startup.failureThreshold }}
    livenessProbe:
      httpGet:
        path: /livez
        port: http
      periodSeconds: {{ $root.Values.probes.liveness.periodSeconds }}
      timeoutSeconds: {{ $root.Values.probes.liveness.timeoutSeconds }}
      failureThreshold: {{ $root.Values.probes.liveness.failureThreshold }}
    # /readyz checks dependencies and flips to 503 the moment SIGTERM arrives
    # (graceful drain), so no preStop hook is needed.
    readinessProbe:
      httpGet:
        path: /readyz
        port: http
      periodSeconds: {{ $root.Values.probes.readiness.periodSeconds }}
      timeoutSeconds: {{ $root.Values.probes.readiness.timeoutSeconds }}
      failureThreshold: {{ $root.Values.probes.readiness.failureThreshold }}
    resources:
      {{- toYaml $a.resources | nindent 6 }}
    volumeMounts:
      - name: tmp
        mountPath: /tmp
      {{- with $root.Values.extraVolumeMounts }}
      {{- toYaml . | nindent 6 }}
      {{- end }}
volumes:
  - name: tmp
    emptyDir: {}
  {{- with $root.Values.extraVolumes }}
  {{- toYaml . | nindent 2 }}
  {{- end }}
{{- with $root.Values.topologySpreadConstraints }}
topologySpreadConstraints:
  {{- range . }}
  - {{- toYaml . | nindent 4 }}
    labelSelector:
      matchLabels:
        {{- $a.selectorLabels | nindent 8 }}
  {{- end }}
{{- end }}
{{- with $root.Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with $root.Values.affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with $root.Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}
