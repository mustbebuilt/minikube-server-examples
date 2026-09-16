# HydroSense IoT: Security Solutions and Hardening Guide

This document outlines architectural solutions, configuration patterns, and concrete remediation steps to address the vulnerabilities identified in [SECURITY_ISSUES.md](file:///Users/martincooper/Documents/github-demo-sites-for-modules/minikube-server-examples/SECURITY_ISSUES.md). It establishes a defense-in-depth security model for production and staging deployments.

---

## Table of Contents

1. [Defense-in-Depth Architecture](#defense-in-depth-architecture)
2. [MQTT Broker Hardening](#mqtt-broker-hardening)
   - [2.1 Disable Anonymous Access & Require Authentication](#21-disable-anonymous-access--require-authentication)
   - [2.2 Topic-Level Access Control Lists (ACLs)](#22-topic-level-access-control-lists-acls)
   - [2.3 Transport Layer Security (TLS / MQTTS and WSS)](#23-transport-layer-security-tls--mqtts-and-wss)
   - [2.4 Dynamic Client IDs for Horizontal Subscriber Scaling](#24-dynamic-client-ids-for-horizontal-subscriber-scaling)
   - [2.5 Connection and Rate Limiting](#25-connection-and-rate-limiting)
3. [Database and Ingestion Security](#database-and-ingestion-security)
   - [3.1 Scoped, Least-Privilege InfluxDB API Tokens](#31-scoped-least-privilege-influxdb-api-tokens)
   - [3.2 Automated Data Retention Policies](#32-automated-data-retention-policies)
   - [3.3 Storage Volume Encryption at Rest](#33-storage-volume-encryption-at-rest)
4. [Grafana and Dashboard Access Security](#grafana-and-dashboard-access-security)
   - [4.1 Credential Rotation and Password Policies](#41-credential-rotation-and-password-policies)
   - [4.2 Single Sign-On (SSO) and Multi-Factor Authentication (MFA)](#42-single-sign-on-sso-and-multi-factor-authentication-mfa)
   - [4.3 Role-Based Access Control (RBAC)](#43-role-based-access-control-rbac)
5. [Kubernetes Cluster and Pod Hardening](#kubernetes-cluster-and-pod-hardening)
   - [5.1 Micro-Segmentation with NetworkPolicies](#51-micro-segmentation-with-networkpolicies)
   - [5.2 Container SecurityContext and Pod Security Standards](#52-container-securitycontext-and-pod-security-standards)
   - [5.3 Ingress Controller with Automated TLS (cert-manager)](#53-ingress-controller-with-automated-tls-cert-manager)
   - [5.4 Secret Management (SealedSecrets / HashiCorp Vault)](#54-secret-management-sealedsecrets--hashicorp-vault)
6. [Edge Device and Hardware Security](#edge-device-and-hardware-security)
   - [6.1 Mutual TLS (mTLS) Device Authentication](#61-mutual-tls-mtls-device-authentication)
   - [6.2 Hardware Security Modules (HSM / TPM)](#62-hardware-security-modules-hsm--tpm)
7. [Remediation Roadmap and Implementation Priority](#remediation-roadmap-and-implementation-priority)

---

## Defense-in-Depth Architecture

A hardened production architecture enforces security controls at every layer:

```
[Edge Device / Web Client]
          │
          ▼ (mTLS / WSS Encrypted)
[Ingress Controller / TLS Termination]
          │
          ▼ (Strict NetworkPolicy Boundary)
[Mosquitto Broker (ACLs + Auth Required)]
          │
          ▼ (Dynamic Client IDs)
[Telegraf Workers (Scoped Write-Only Token)]
          │
          ▼ (mTLS In-Cluster Communication)
[InfluxDB v2 (Encrypted PVC + Retention Policy)]
          ▲
          │ (Scoped Read-Only Token)
[Grafana Server (OIDC SSO + MFA + RBAC)]
```

---

## MQTT Broker Hardening

### 2.1 Disable Anonymous Access & Require Authentication

Configure Mosquitto to reject anonymous connections and enforce password verification using a password hash file:

```ini
# mosquitto.conf
allow_anonymous false
password_file /mosquitto/config/passwords
```

Generate passwords using standard SHA-512 hashes via `mosquitto_passwd`:
```bash
mosquitto_passwd -c /mosquitto/config/passwords river-node-thames-01
mosquitto_passwd -b /mosquitto/config/passwords telegraf-subscriber <SecurePassword>
```

Mount this file via a Kubernetes Secret rather than a ConfigMap.

### 2.2 Topic-Level Access Control Lists (ACLs)

Define granular read/write rules to isolate devices and protect system topics:

```ini
# /mosquitto/config/aclfile

# 1. Telegraf Subscriber: Read-only access to all telemetry topics
user telegraf-subscriber
topic read water-quality/rivers/+/telemetry
topic read water-quality/rivers/+/status
topic read water-quality/rivers/+/alerts

# 2. Specific River Sensor: Write-only access to its own river topic
user river-node-thames-01
topic write water-quality/rivers/thames-01/telemetry
topic write water-quality/rivers/thames-01/status
topic write water-quality/rivers/thames-01/alerts

user river-node-severn-02
topic write water-quality/rivers/severn-02/telemetry
topic write water-quality/rivers/severn-02/status
topic write water-quality/rivers/severn-02/alerts

# 3. Deny all other topics by default
pattern read $SYS/#
```

Enable ACL enforcement in `mosquitto.conf`:
```ini
acl_file /mosquitto/config/aclfile
```

### 2.3 Transport Layer Security (TLS / MQTTS and WSS)

Transition all client and server listeners to encrypted ports:

```ini
# Encrypted TCP MQTT (MQTTS)
listener 8883
cafile /mosquitto/certs/ca.crt
certfile /mosquitto/certs/server.crt
keyfile /mosquitto/certs/server.key
tls_version tlsv1.3

# Encrypted WebSockets (WSS)
listener 8884
protocol websockets
cafile /mosquitto/certs/ca.crt
certfile /mosquitto/certs/server.crt
keyfile /mosquitto/certs/server.key
tls_version tlsv1.3
```

### 2.4 Dynamic Client IDs for Horizontal Subscriber Scaling

To support scaling Telegraf to $N$ replicas without broker connection conflicts, inject the Kubernetes Pod name into Telegraf's configuration dynamically:

```toml
# telegraf.conf
[[inputs.mqtt_consumer]]
  servers = ["ssl://mosquitto-service:8883"]
  topics = ["water-quality/rivers/+/telemetry"]
  qos = 1
  client_id = "telegraf-${HOSTNAME}"
  username = "telegraf-subscriber"
  password = "${TELEGRAF_MQTT_PASSWORD}"
```

Kubernetes automatically sets the `HOSTNAME` environment variable to the unique pod name (e.g., `telegraf-deployment-8f6d-abc12`), allowing multiple subscribers to process messages in parallel without disconnect loops.

### 2.5 Connection and Rate Limiting

Protect the broker against connection exhaustion and memory exhaustion:

```ini
# Resource limits in mosquitto.conf
max_connections 1000
max_queued_messages 5000
max_packet_size 65536
message_size_limit 65536
```

---

## Database and Ingestion Security

### 3.1 Scoped, Least-Privilege InfluxDB API Tokens

Replace the global super-admin token with dedicated, narrowly scoped tokens:

```bash
# 1. Generate Write-Only token for Telegraf
influx auth create \
  --org hydrosense \
  --description "Telegraf Ingestion Write Token" \
  --write-bucket <bucket-id>

# 2. Generate Read-Only token for Grafana
influx auth create \
  --org hydrosense \
  --description "Grafana Dashboard Read Token" \
  --read-bucket <bucket-id>
```

Store each token in separate Kubernetes Secrets:
- `telegraf-credentials` (contains only the write token)
- `grafana-credentials` (contains only the read token)

### 3.2 Automated Data Retention Policies

Configure automatic bucket retention rules to prevent disk saturation:

```bash
# Set 90-day retention on raw high-frequency telemetry
influx bucket update \
  --name river_water_quality \
  --retention 2160h
```

Use InfluxDB Downsampling Tasks to compute hourly and daily averages stored in a long-term retention bucket (e.g., 2-year retention).

### 3.3 Storage Volume Encryption at Rest

Enable storage volume encryption using Kubernetes StorageClasses backed by encrypted block storage (e.g., AWS EBS encryption with KMS, GCP Persistent Disk encryption, or LUKS on bare-metal).

---

## Grafana and Dashboard Access Security

### 4.1 Credential Rotation and Password Policies

1. Remove default `admin`/`admin` values from initial deployment manifests.
2. Require minimum password length (14+ characters) and complexity.
3. Configure automated secret rotation using HashiCorp Vault or Kubernetes Secret rotators.

### 4.2 Single Sign-On (SSO) and Multi-Factor Authentication (MFA)

Integrate Grafana with an OpenID Connect (OIDC) identity provider (Okta, Keycloak, Google Identity, Microsoft Entra ID):

```ini
# grafana.ini ConfigMap
[auth.generic_oauth]
enabled = true
name = Enterprise SSO
allow_sign_up = false
client_id = ${OAUTH_CLIENT_ID}
client_secret = ${OAUTH_CLIENT_SECRET}
scopes = openid profile email
auth_url = https://sso.example.com/oauth2/v1/authorize
token_url = https://sso.example.com/oauth2/v1/token
api_url = https://sso.example.com/oauth2/v1/userinfo
role_attribute_path = contains(groups[*], 'hydrosense-admins') && 'Admin' || contains(groups[*], 'hydrosense-editors') && 'Editor' || 'Viewer'
```

Enforce Multi-Factor Authentication (MFA) directly within the identity provider.

### 4.3 Role-Based Access Control (RBAC)

- **Admin**: Platform administrators (datasource modification, user management).
- **Editor**: Field engineers and environmental scientists (dashboard and alert threshold configuration).
- **Viewer**: General operators and stakeholders (read-only telemetry views).

---

## Kubernetes Cluster and Pod Hardening

### 5.1 Micro-Segmentation with NetworkPolicies

Deploy default-deny network policies with explicit egress/ingress rules:

```yaml
# k8s/network-policies.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: influxdb-network-policy
  namespace: hydrosense-iot
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: influxdb
  policyTypes:
    - Ingress
  ingress:
    # Only allow connections from Telegraf (port 8086) and Grafana (port 8086)
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: telegraf
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: grafana
      ports:
        - protocol: TCP
          port: 8086
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: mosquitto-network-policy
  namespace: hydrosense-iot
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: mosquitto
  policyTypes:
    - Ingress
  ingress:
    # Allow simulated nodes and external ingress to reach MQTT ports
    - ports:
        - protocol: TCP
          port: 1883
        - protocol: TCP
          port: 8883
        - protocol: TCP
          port: 9001
        - protocol: TCP
          port: 8884
```

### 5.2 Container SecurityContext and Pod Security Standards

Enforce Pod Security Standards (Restricted profile) across all deployments:

```yaml
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: mosquitto
          image: eclipse-mosquitto:2.0.18
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          resources:
            limits:
              cpu: "500m"
              memory: "256Mi"
            requests:
              cpu: "50m"
              memory: "64Mi"
```

### 5.3 Ingress Controller with Automated TLS (cert-manager)

Replace static NodePorts with an Ingress Controller managed by `cert-manager` for automated Let's Encrypt TLS certificates:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: hydrosense-ingress
  namespace: hydrosense-iot
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - grafana.hydrosense.example.com
        - mqtt.hydrosense.example.com
      secretName: hydrosense-tls-certs
  rules:
    - host: grafana.hydrosense.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: grafana-service
                port:
                  number: 3000
```

### 5.4 Secret Management (SealedSecrets / HashiCorp Vault)

Never store raw secrets in source control. Use encrypted GitOps workflows:

1. **Bitnami SealedSecrets**: Encrypts secret manifests using asymmetric cryptography so they can be safely committed to Git. The cluster-side controller decrypts them into native Kubernetes Secrets.
2. **External Secrets Operator (ESO)**: Synchronizes secrets dynamically from cloud key-vaults (AWS Secrets Manager, Azure Key Vault, HashiCorp Vault).

---

## Edge Device and Hardware Security

### 6.1 Mutual TLS (mTLS) Device Authentication

For physical IoT devices in the field:
1. Provision each sensor gateway with a private key and unique X.509 client certificate signed by a private Intermediate Certificate Authority (ICA).
2. Configure Mosquitto with `require_certificate true`:
```ini
# mosquitto.conf
require_certificate true
use_identity_as_username true
cafile /mosquitto/certs/ca.crt
```
3. When `use_identity_as_username true` is set, Mosquitto extracts the Common Name (CN) from the client certificate (e.g., `CN=river-node-thames-01`) and applies topic ACLs based on that authenticated identity.

### 6.2 Hardware Security Modules (HSM / TPM)

- Store client private keys inside a Trusted Platform Module (TPM 2.0) or hardware Secure Element (such as Microchip ATECC608B).
- Private keys cannot be extracted even if the physical sensor unit is stolen or disassembled.

---

## Remediation Roadmap and Implementation Priority

| Phase | Priority | Action Item | Target Components |
|---|---|---|---|
| **Phase 1: Immediate** | Critical | Rotate default credentials (`admin`/`admin`) | Grafana |
| | Critical | Separate InfluxDB tokens into Read-Only and Write-Only | InfluxDB, Telegraf, Grafana |
| | High | Disable anonymous MQTT access and enforce password authentication | Mosquitto |
| | High | Implement dynamic client IDs (`${HOSTNAME}`) for Telegraf | Telegraf |
| **Phase 2: Medium-Term** | High | Define Topic Access Control Lists (ACLs) | Mosquitto |
| | High | Deploy Kubernetes NetworkPolicies (default-deny pod traffic) | Kubernetes Cluster |
| | High | Apply Pod SecurityContexts (`runAsNonRoot`, `readOnlyRootFilesystem`) | All Deployments |
| | Medium | Configure 90-day retention policies on InfluxDB buckets | InfluxDB |
| **Phase 3: Long-Term / Production** | High | Enable TLS / MQTTS and WSS encryption with valid CA certs | Mosquitto, Ingress |
| | High | Implement OIDC / OAuth2 Single Sign-On (SSO) with MFA | Grafana |
| | High | Replace plaintext secret manifests with SealedSecrets or Vault | Kubernetes Manifests |
| | Medium | Enforce mTLS with hardware TPM key storage for field devices | Edge IoT Nodes |
