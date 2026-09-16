# HydroSense IoT: Security Assessment and Threat Analysis

This document provides a comprehensive security assessment of the current HydroSense IoT demonstration architecture deployed on Kubernetes and Minikube. It identifies architectural vulnerabilities, threat vectors, and compliance gaps across each layer of the application stack.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Threat Model and Attack Surface](#threat-model-and-attack-surface)
3. [Component-Level Vulnerability Analysis](#component-level-vulnerability-analysis)
   - [1. MQTT Broker (Mosquitto)](#1-mqtt-broker-mosquitto)
   - [2. Time-Series Database (InfluxDB v2)](#2-time-series-database-influxdb-v2)
   - [3. Telemetry Ingestion Agent (Telegraf)](#3-telemetry-ingestion-agent-telegraf)
   - [4. Visual Dashboard (Grafana)](#4-visual-dashboard-grafana)
   - [5. Kubernetes Cluster and Container Runtime](#5-kubernetes-cluster-and-container-runtime)
   - [6. Edge Nodes and Client Applications](#6-edge-nodes-and-client-applications)
4. [Cross-Cutting Security Concerns](#cross-cutting-security-concerns)
5. [Summary of Identified Risks](#summary-of-identified-risks)

---

## Executive Summary

The current deployment is optimized for local development, modular demonstration, and rapid testing. While effective for functional demonstration and horizontal scaling tests, several default configurations intentionally prioritize convenience over strict security boundaries. 

If transitioned to a staging or production environment without modification, the system would be vulnerable to:
- Unauthorized data injection and sensor spoofing
- Eavesdropping on unencrypted network traffic
- Lateral movement across the Kubernetes cluster
- Privilege escalation via shared administrative credentials
- Denial-of-Service (DoS) attacks from malicious or malfunctioning IoT clients

---

## Threat Model and Attack Surface

The system exposes multiple entry points across physical, network, and application layers:

```
[Untrusted IoT Field Nodes] ──────> (Port 1883 TCP)  ───┐
                                                         ├──> [Mosquitto Broker] ──> [Telegraf] ──> [InfluxDB]
[Untrusted Web Clients]     ──────> (Port 9001 WS)   ───┘                                           │
                                                                                                    │
[Public / Internal Users]   ──────> (Port 3000 HTTP) ───────────────────────────────────────────────┴──> [Grafana]
```

### Primary Threat Actors
1. **Rogue or Compromised Edge Nodes**: Compromised sensors injecting false dissolved oxygen readings to mask pollution events or trigger false hypoxia alerts.
2. **Network Eavesdroppers (Man-in-the-Middle)**: Actors intercepting unencrypted MQTT traffic across public or unsegmented networks.
3. **Malicious External Users**: Attackers probing exposed NodePorts on the Kubernetes host.
4. **Compromised Container Instances**: Attackers leveraging a single vulnerable pod to access cluster-wide Kubernetes API resources.

---

## Component-Level Vulnerability Analysis

### 1. MQTT Broker (Mosquitto)

#### Issue 1.1: Anonymous Access Enabled
- **Current State**: The configuration file (`mosquitto.conf`) sets `allow_anonymous true`.
- **Impact**: Any client with network reachability can connect to the broker without supplying credentials.
- **Risk Level**: High.

#### Issue 1.2: Lack of Topic Access Control Lists (ACLs)
- **Current State**: No ACL rules are defined. Any connected client can publish or subscribe to any topic, including wildcard topics (`#` or `water-quality/rivers/+/telemetry`).
- **Impact**: 
  - A single compromised sensor node can overwrite readings for all other river stations.
  - Malicious clients can publish fraudulent critical alerts (`water-quality/rivers/{id}/alerts`).
  - Unauthorized clients can eavesdrop on all river telemetry across the entire network.
- **Risk Level**: High.

#### Issue 1.3: Unencrypted Transport Layer
- **Current State**: The broker listens on raw TCP port `1883` and unencrypted WebSockets port `9001`.
- **Impact**: Payloads, client identifiers, and metadata are transmitted in plain text, making them susceptible to interception and tampering via Man-in-the-Middle (MitM) attacks.
- **Risk Level**: High.

#### Issue 1.4: Lack of Rate Limiting and Connection Throttling
- **Current State**: Mosquitto has no connection or message rate limits configured.
- **Impact**: A flood of connections or high-frequency publishes from rogue nodes can cause memory exhaustion and crash the broker.
- **Risk Level**: Medium.

---

### 2. Time-Series Database (InfluxDB v2)

#### Issue 2.1: Hardcoded Super-Admin Token
- **Current State**: The initialization token (`hydrosense-super-secret-auth-token-123`) is hardcoded in `secrets.yaml` and ConfigMaps.
- **Impact**: Possession of this token grants unrestricted administrative access to the entire InfluxDB instance, including the ability to drop buckets, delete historical data, and create administrative users.
- **Risk Level**: Critical.

#### Issue 2.2: Shared Administrative Token Usage
- **Current State**: Both Telegraf (data ingestion) and Grafana (data visualization) use the same all-powerful super-admin token.
- **Impact**: Violates the Principle of Least Privilege. If Grafana's datasource configuration is compromised, the attacker acquires write and administrative privileges across all InfluxDB organizations and buckets.
- **Risk Level**: High.

#### Issue 2.3: Unencrypted In-Cluster HTTP Communication
- **Current State**: Communication between Telegraf/Grafana and InfluxDB occurs over plain `http://influxdb-service:8086`.
- **Impact**: Internal network traffic within the cluster is unencrypted, allowing eavesdropping if cluster network isolation is compromised.
- **Risk Level**: Medium.

#### Issue 2.4: Absence of Automated Retention and Purge Policies
- **Current State**: Telemetry buckets are configured without explicit data retention constraints.
- **Impact**: Continuous high-frequency ingestion will eventually exhaust persistent storage volumes, causing database write failures.
- **Risk Level**: Medium.

---

### 3. Telemetry Ingestion Agent (Telegraf)

#### Issue 3.1: Static Client Identifier in Scaled Environments
- **Current State**: Telegraf is configured with a static `client_id = "telegraf-river-subscriber"`.
- **Impact**: When scaling Telegraf to $N$ replicas (`./scripts/scale.sh telegraf 3`), multiple instances connect using the same MQTT Client ID. The MQTT specification requires brokers to disconnect existing clients when a duplicate Client ID connects, leading to a continuous disconnect/reconnect loop and telemetry loss.
- **Risk Level**: High.

#### Issue 3.2: Unvalidated Payload Schema Ingestion
- **Current State**: The JSON parser processes fields directly into database metrics without strict schema validation or boundary checks.
- **Impact**: Malicious payloads with unexpected data types or malformed JSON can cause parsing errors, buffer overflows, or drop ingestion batches.
- **Risk Level**: Low.

---

### 4. Visual Dashboard (Grafana)

#### Issue 4.1: Default Administrative Credentials
- **Current State**: The administrative account is configured with username `admin` and password `admin` in `k8s/secrets.yaml`.
- **Impact**: Trivial credential guessing grants full administrative control over dashboards, user permissions, and datasources.
- **Risk Level**: Critical.

#### Issue 4.2: Lack of Centralized Authentication (SSO / MFA)
- **Current State**: Local username/password authentication is used with no Multi-Factor Authentication (MFA) or Single Sign-On (SSO) integration.
- **Impact**: Inability to enforce enterprise password policies, centralized access revocation, or MFA requirements.
- **Risk Level**: Medium.

#### Issue 4.3: Exposed Direct NodePort
- **Current State**: Grafana is exposed externally via static NodePort `30300` over unencrypted HTTP.
- **Impact**: Session cookies and login credentials travel over plain HTTP, making user sessions vulnerable to interception.
- **Risk Level**: High.

---

### 5. Kubernetes Cluster and Container Runtime

#### Issue 5.1: Absence of Network Policies (Open Internal Pod Network)
- **Current State**: No Kubernetes `NetworkPolicy` resources are deployed in the `hydrosense-iot` namespace.
- **Impact**: Any pod in the cluster can communicate directly with any other pod on any port. For example, a compromised edge simulator pod can establish direct TCP connections to InfluxDB on port `8086`, bypassing Mosquitto and Telegraf entirely.
- **Risk Level**: High.

#### Issue 5.2: Containers Running as Root User
- **Current State**: Pod specifications do not define a `securityContext` with `runAsNonRoot: true` or non-zero UIDs.
- **Impact**: If an attacker exploits a container vulnerability (e.g., in Node.js or Mosquitto), they gain root privileges inside the container, facilitating container escape and host compromise.
- **Risk Level**: High.

#### Issue 5.3: Writable Container Root Filesystems
- **Current State**: Containers run with standard writable root filesystems.
- **Impact**: Attackers can download malware, install compilation tools, or modify binary executables inside compromised containers.
- **Risk Level**: Medium.

#### Issue 5.4: Secrets Stored in Plaintext Manifests
- **Current State**: Passwords and tokens in `k8s/secrets.yaml` are stored as unencrypted strings (`stringData`).
- **Impact**: Committing these files to source control exposes credentials to unauthorized repository viewers.
- **Risk Level**: High.

---

### 6. Edge Nodes and Client Applications

#### Issue 6.1: Hardcoded Node Identity and Pre-Shared Logic
- **Current State**: Node identifiers (`thames-01`, `severn-02`) and simulation parameters are statically declared in application code.
- **Impact**: No cryptographic proof of device identity exists. Any rogue client can spoof any river identifier.
- **Risk Level**: Medium.

#### Issue 6.2: Missing Hardware Security Layer
- **Current State**: Clients rely purely on software-level configuration.
- **Impact**: Physical extraction of an edge device allows extraction of all credentials, certificates, and broker endpoints.
- **Risk Level**: Low (for simulation) / High (for physical deployment).

---

## Cross-Cutting Security Concerns

| Category | Description |
|---|---|
| **Audit Logging** | Neither Mosquitto nor InfluxDB are configured to forward structured audit logs to a centralized Security Information and Event Management (SIEM) system. |
| **Vulnerability Scanning** | Container images (`eclipse-mosquitto:latest`, `telegraf:latest`, `node:18-alpine`) rely on `:latest` tags rather than immutable SHA digests, risking supply chain attacks. |
| **DDoS Resilience** | The architecture lacks connection throttling, payload size limits, and ingress-level Web Application Firewall (WAF) filtering. |

---

## Summary of Identified Risks

| ID | Finding | Affected Component | Severity |
|---|---|---|---|
| SEC-01 | Super-admin token hardcoded in manifest and shared across services | InfluxDB / Manifests | Critical |
| SEC-02 | Default administrative credentials (`admin` / `admin`) enabled | Grafana | Critical |
| SEC-03 | Anonymous access enabled on MQTT broker | Mosquitto | High |
| SEC-04 | No topic-level access control lists (ACLs) enforced | Mosquitto | High |
| SEC-05 | Unencrypted transport (raw TCP 1883 / WS 9001 / HTTP 3000) | Full Stack | High |
| SEC-06 | No Kubernetes NetworkPolicies (unrestricted pod-to-pod traffic) | Kubernetes Cluster | High |
| SEC-07 | Containers running as root user without SecurityContext hardening | Kubernetes Pods | High |
| SEC-08 | Plaintext secrets committed to repository manifests | Secret Management | High |
| SEC-09 | Static Client ID preventing safe horizontal scaling of subscribers | Telegraf | High |
| SEC-10 | Missing rate limiting and connection throttling | Mosquitto | Medium |
| SEC-11 | Unencrypted internal HTTP communication for database queries | InfluxDB / Telegraf | Medium |
| SEC-12 | No automated database retention or disk exhaustion safeguards | InfluxDB | Medium |
