{{/* The release's name, trimmed to what Kubernetes will accept as a label value. */}}
{{- define "ai-world.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "ai-world.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "ai-world.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{/*
Labels every object carries.

`selectorLabels` is the subset that a Deployment's selector matches on, and it is deliberately
smaller: a selector is immutable once created, so anything that changes between releases — the
chart version, the app version — must not be in it, or the next upgrade fails with an error about
an immutable field and the only way out is deleting the Deployment.
*/}}
{{- define "ai-world.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "ai-world.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "ai-world.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ai-world.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* The image, pinned to appVersion unless a tag is given. */}}
{{- define "ai-world.image" -}}
{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}
{{- end -}}
