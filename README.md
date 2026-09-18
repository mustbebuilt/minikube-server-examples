> [!CAUTION]
> Please complete the [basic MQTT] Lab (https://github.com/mustbebuilt/mqtt-client) before attempting this lab.

# HydroSense IoT - Kubernetes and Minikube Scalable Server Infrastructure

A production-grade Kubernetes and Minikube implementation of the HydroSense IoT River Water Quality Monitoring System. This platform enables horizontal scaling across N server instances, subscriber ingestion agents, and edge simulation nodes with automated persistent storage, telemetry ingestion, and Grafana dashboard visualization.

---

## Table of Contents

- [HydroSense IoT - Kubernetes and Minikube Scalable Server Infrastructure](#hydrosense-iot---kubernetes-and-minikube-scalable-server-infrastructure)
  - [Table of Contents](#table-of-contents)
  - [Key Concepts and Technologies](#key-concepts-and-technologies)
    - [What is Minikube?](#what-is-minikube)
    - [What is Kubernetes (K8s)?](#what-is-kubernetes-k8s)
    - [Kubernetes Resource Types Used](#kubernetes-resource-types-used)
    - [Role of the Bash Automation Scripts](#role-of-the-bash-automation-scripts)
    - [IoT Telemetry Pipeline Architecture](#iot-telemetry-pipeline-architecture)
  - [Architecture Overview](#architecture-overview)
  - [Repository Layout](#repository-layout)
  - [Quick Start](#quick-start)
    - [Prerequisites](#prerequisites)
    - [1. Deploy the Complete Stack](#1-deploy-the-complete-stack)
  - [Service Access and Endpoints](#service-access-and-endpoints)
    - [Launch Grafana in Web Browser](#launch-grafana-in-web-browser)
    - [Local Port Forwarding Helper](#local-port-forwarding-helper)
  - [Horizontal Scaling (N Servers and Nodes)](#horizontal-scaling-n-servers-and-nodes)
    - [1. Scale Simulated IoT River Nodes](#1-scale-simulated-iot-river-nodes)
    - [2. Scale Telegraf Telemetry Ingestion Workers](#2-scale-telegraf-telemetry-ingestion-workers)
    - [3. Scale MQTT Brokers or Grafana Servers](#3-scale-mqtt-brokers-or-grafana-servers)
    - [4. Inspect Current Status](#4-inspect-current-status)
  - [Testing with External Clients](#testing-with-external-clients)
    - [1. Headless Node.js Multi-Node Client (Outside Cluster)](#1-headless-nodejs-multi-node-client-outside-cluster)
    - [2. Browser Web Client](#2-browser-web-client)
  - [Security Assessment and Hardening](#security-assessment-and-hardening)
  - [Teardown and Cleanup](#teardown-and-cleanup)

---

## Key Concepts and Technologies

### What is Minikube?

Minikube is an open-source tool developed by the Kubernetes community that provisions a local Kubernetes cluster on a developer's workstation.

- **Local Virtualization / Containerization**: Rather than requiring a costly multi-node cloud environment (such as Google GKE, AWS EKS, or Azure AKS), Minikube runs a complete Kubernetes control plane and worker runtime inside a local Docker container or lightweight virtual machine.
- **Development-to-Production Parity**: Minikube uses standard upstream Kubernetes APIs. Any manifest (`.yaml`), Deployment, Service, or ConfigMap tested in Minikube can be deployed to production enterprise clusters with minimal configuration changes.
- **Built-in Addons and Networking**: Minikube includes local DNS resolution, metric servers, ingress controllers, and tunneling tools (`minikube service`, `minikube tunnel`, `minikube dashboard`) that make cluster networking accessible from the host operating system.

### What is Kubernetes (K8s)?

Kubernetes is an orchestration platform designed to automate the deployment, scaling, networking, and management of containerized applications.

In traditional container environments (like standalone Docker or Docker Compose), containers run as fixed, host-bound processes. If a container crashes, runs out of memory, or requires horizontal scaling across multiple instances, manual intervention is needed. Kubernetes solves this by:

- **Declarative Desired State**: You declare _what_ the system should look like (e.g., "maintain 5 running replicas of the river node simulator"), and the Kubernetes controller constantly works to match actual state with desired state.
- **Self-Healing**: If a pod crashes or becomes unresponsive, Kubernetes automatically restarts or replaces it on a healthy node.
- **Service Discovery and Internal Load Balancing**: Kubernetes assigns stable internal DNS names and virtual IPs to services, distributing traffic across all healthy pod replicas.

### Kubernetes Resource Types Used

This project utilizes standard Kubernetes resource specifications organized under the `k8s/` directory:

1. **Namespaces (`namespace.yaml`)**:
   - Provides logical isolation within the cluster. All HydroSense resources are housed inside the `hydrosense-iot` namespace, preventing naming collisions with system components.
2. **Deployments (`mosquitto.yaml`, `influxdb.yaml`, `telegraf.yaml`, `grafana.yaml`, `simulator-nodes.yaml`)**:
   - Manages the lifecycle of stateless or replicated applications. A Deployment defines container images, replica counts, environment variables, resource limits (CPU/RAM), and health check policies.
3. **Services (`mosquitto-service`, `influxdb-service`, `grafana-service`)**:
   - **ClusterIP**: Internal-only virtual IP used for communication between pods inside the cluster (e.g., Telegraf sending data to `http://influxdb-service:8086`).
   - **NodePort**: Exposes a service on a static port on every cluster node (e.g., `:31883` for MQTT TCP and `:30300` for Grafana HTTP), allowing external host applications to reach cluster services.
4. **ConfigMaps (`configmaps.yaml`)**:
   - Decouples configuration files from container images. Contains configuration files for Mosquitto (`mosquitto.conf`), Telegraf (`telegraf.conf`), and Grafana dashboard/datasource JSON and YAML files, mounted as read-only filesystems into running pods.
5. **Secrets (`secrets.yaml`)**:
   - Securely stores sensitive credentials, including InfluxDB authentication tokens, administrative passwords, and organization names, injected as environment variables into pods.
6. **PersistentVolumeClaims (`storage.yaml`)**:
   - Requests persistent disk storage independent of the pod lifecycle. Even if an InfluxDB or Grafana pod restarts or is rescheduled, historical telemetry data remains preserved on the persistent volume.
7. **Kustomize (`kustomization.yaml`)**:
   - A native Kubernetes configuration management tool that bundles multiple YAML files into a single, cohesive deployment manifest without requiring third-party template engines.

### Role of the Bash Automation Scripts

The project includes shell scripts in `scripts/` to automate operational tasks:

- **`deploy.sh`**: Checks if Minikube is active (starting it if stopped), applies the Kustomize manifests using `kubectl apply -k k8s/`, blocks until all deployments report ready via `kubectl rollout status`, and outputs connection details.
- **`scale.sh`**: Provides a command-line interface to scale any server component or client simulator to N instances (e.g., `./scripts/scale.sh telegraf 3` or `./scripts/scale.sh nodes 10`), using `kubectl scale` and polling for rollout completion.
- **`port-forward.sh`**: Establishes background port forwarding tunnels (`kubectl port-forward`) between the host workstation and the Minikube cluster, routing ports `1883`, `9001`, `3000`, and `8086` directly to `localhost`.
- **`teardown.sh`**: Performs clean cluster cleanup by executing `kubectl delete -k k8s/`, removing all pods, services, secrets, and volumes.

### IoT Telemetry Pipeline Architecture

The data pipeline operates as follows:

1. **Edge Simulator Nodes**: Simulated IoT river nodes publish JSON telemetry payloads (dissolved oxygen, water temperature, pH, battery status) over MQTT topics (`water-quality/rivers/{river_id}/telemetry`).
2. **Mosquitto MQTT Broker**: Ingests high-frequency telemetry over TCP (`1883`) and WebSockets (`9001`).
3. **Telegraf Ingestion Workers**: Subscribes to wildcard MQTT topics (`water-quality/rivers/+/telemetry`), parses incoming JSON metrics, applies tags, and writes structured records into InfluxDB.
4. **InfluxDB v2**: Time-series database that indexes and stores historical telemetry data.
5. **Grafana**: Queries InfluxDB using the Flux language and visualizes live saturation gauges, diurnal trendlines, and hypoxia threshold indicators.

---

## Architecture Overview

```
+-----------------------------------------------------------------------------+
|                       Minikube Cluster (hydrosense-iot)                     |
|                                                                             |
|   +------------------------+         +----------------------------------+   |
|   |  Mosquitto MQTT Broker |<--------|  Simulated River Nodes (Pods)    |   |
|   |  (Port 1883 / 9001)    |         |  (Scalable to N Replicas)        |   |
|   |  Service: NodePort     |         +----------------------------------+   |
|   +-----------+------------+                                                |
|               |                                                             |
|               v                                                             |
|   +------------------------+                                                |
|   |  Telegraf Ingest Agent |                                                |
|   |  (Scalable to N Pods)  |                                                |
|   +-----------+------------+                                                |
|               |                                                             |
|               v                                                             |
|   +------------------------+         +----------------------------------+   |
|   |  InfluxDB v2 Database  |<--------|  Grafana Visualization Server    |   |
|   |  (Port 8086 + PVC)     |         |  (Port 3000 + NodePort 30300)    |   |
|   +------------------------+         +----------------------------------+   |
+-----------------------------------------------------------------------------+
       ^                                         ^
       |                                         |
+------+----------------------+           +------+--------------------------+
| External Web UI / Browser   |           | External Node.js Edge Clients   |
| (ws://<minikube-ip>:30901)  |           | (mqtt://<minikube-ip>:31883)    |
+-----------------------------+           +---------------------------------+
```

---

## Repository Layout

```
minikube-server-examples/
├── k8s/                                # Kubernetes Manifests (Kustomize)
│   ├── kustomization.yaml              # Root Kustomize resource bundle
│   ├── namespace.yaml                  # Dedicated hydrosense-iot namespace
│   ├── secrets.yaml                    # InfluxDB and Grafana authentication tokens
│   ├── configmaps.yaml                 # Mosquitto, Telegraf, and Grafana configurations
│   ├── storage.yaml                    # PersistentVolumeClaims (InfluxDB and Grafana)
│   ├── mosquitto.yaml                  # MQTT Broker Deployment and NodePort Service
│   ├── influxdb.yaml                   # Time-Series Database Deployment and Service
│   ├── telegraf.yaml                   # Scalable MQTT Subscriber / Ingestion Deployment
│   ├── grafana.yaml                    # Visual Dashboard Server and NodePort Service
│   └── simulator-nodes.yaml            # Scalable IoT Edge Simulation Node Deployment
│
├── scripts/                            # Operational and Scaling Automation Scripts
│   ├── deploy.sh                       # One-command Minikube startup and deployment
│   ├── scale.sh                        # Dynamic scaler for N servers, workers, or nodes
│   ├── port-forward.sh                 # Localhost port forwarding helper
│   └── teardown.sh                     # Cluster cleanup and teardown script
│
├── client/                             # Client Applications
│   ├── web/                            # Web Client (Browser Simulator and Live Monitor)
│   │   ├── index.html
│   │   ├── style.css
│   │   └── app.js
│   └── node/                           # Headless Node.js Multi-Node CLI Client
│       ├── package.json
│       ├── index.js
│       └── simulate-nodes.js
│
├── index.html                          # Root redirect to Web Client
├── package.json                        # Root project metadata
└── README.md                           # Documentation and Operating Instructions
```

---

## Quick Start

### Prerequisites

- [Minikube](https://minikube.sigs.k8s.io/docs/start/) installed
- [kubectl](https://kubernetes.io/docs/tasks/tools/) installed
- [Docker](https://docs.docker.com/get-docker/) installed

### 1. Deploy the Complete Stack

Run the automated deployment script:

```bash
./scripts/deploy.sh
```

The script executes the following stages:

1. Verifies that Minikube is running (initiates `minikube start` if stopped).
2. Provisions the `hydrosense-iot` namespace.
3. Applies all ConfigMaps, Secrets, PVCs, Services, and Deployments.
4. Monitors deployment rollouts until all pods reach a ready state.
5. Prints active service endpoints and connectivity details.

---

## Service Access and Endpoints

| Service               | Protocol / Port | Minikube NodePort            | Port-Forward (Localhost) |
| --------------------- | --------------- | ---------------------------- | ------------------------ |
| **Grafana Dashboard** | HTTP / `3000`   | `http://<minikube-ip>:30300` | `http://localhost:3000`  |
| **MQTT Broker (TCP)** | TCP / `1883`    | `<minikube-ip>:31883`        | `localhost:1883`         |
| **MQTT WebSockets**   | WS / `9001`     | `ws://<minikube-ip>:30901`   | `ws://localhost:9001`    |
| **InfluxDB v2**       | HTTP / `8086`   | ClusterIP (Internal)         | `http://localhost:8086`  |

Authentication Credentials:

- **Grafana**: User `admin` / Password `admin`
- **InfluxDB**: User `admin` / Password `adminpassword123` / Org `hydrosense` / Bucket `river_water_quality`

### Launch Grafana in Web Browser

To open Grafana directly via Minikube's built-in service tunnel:

```bash
minikube service grafana-service -n hydrosense-iot
```

### Local Port Forwarding Helper

To forward all cluster ports to `localhost` on the host machine:

```bash
./scripts/port-forward.sh
```

---

## Horizontal Scaling (N Servers and Nodes)

The platform supports dynamic horizontal scalability. You can scale server ingestion workers, broker instances, dashboard servers, or simulated IoT nodes using `./scripts/scale.sh` or standard `kubectl scale` commands:

### 1. Scale Simulated IoT River Nodes

Scale the number of in-cluster IoT river sensor nodes publishing real-time telemetry:

```bash
# Scale to 10 simulated sensor nodes
./scripts/scale.sh nodes 10

# Scale to 25 simulated sensor nodes
./scripts/scale.sh nodes 25

# Stop simulated nodes (scale to 0)
./scripts/scale.sh nodes 0
```

### 2. Scale Telegraf Telemetry Ingestion Workers

Scale the number of Telegraf subscriber workers handling high-throughput MQTT ingestion:

```bash
# Scale to 3 ingestion workers
./scripts/scale.sh telegraf 3
```

### 3. Scale MQTT Brokers or Grafana Servers

```bash
# Scale Mosquitto brokers
./scripts/scale.sh mosquitto 2

# Scale Grafana servers
./scripts/scale.sh grafana 2
```

### 4. Inspect Current Status

```bash
./scripts/scale.sh status
```

Or query via `kubectl`:

```bash
kubectl get deployments -n hydrosense-iot
kubectl get pods -n hydrosense-iot -o wide
```

---

## Testing with External Clients

### 1. Headless Node.js Multi-Node Client (Outside Cluster)

You can run simulated IoT nodes directly on your host machine targeting the Minikube cluster:

```bash
cd client/node
npm install

# Connect to Minikube MQTT broker:
MINIKUBE_IP=$(minikube ip) node index.js

# Spawn 10 nodes publishing every 2 seconds to Minikube:
MINIKUBE_IP=$(minikube ip) node simulate-nodes.js 10 2
```

### 2. Browser Web Client

1. Open `client/web/index.html` in your browser.
2. Under **MQTT Broker Target & Connection Settings**, set the target broker URL:
   - `ws://<minikube-ip>:30901` (or `ws://localhost:9001` if running `./scripts/port-forward.sh`)
3. Click **"Connect to Broker"**.
4. Telemetry published from in-cluster or external nodes will stream live into the dashboard gauges and charts.

---

## Security Assessment and Hardening

For detailed security analyses and hardening patterns:

- **[SECURITY_ISSUES.md](file:///Users/martincooper/Documents/github-demo-sites-for-modules/minikube-server-examples/SECURITY_ISSUES.md)**: Thorough vulnerability assessment covering MQTT anonymous access, unencrypted network transports, super-admin token sharing, lack of Kubernetes NetworkPolicies, and default credentials.
- **[SECURITY_SOLUTIONS.md](file:///Users/martincooper/Documents/github-demo-sites-for-modules/minikube-server-examples/SECURITY_SOLUTIONS.md)**: Concrete implementation patterns, configuration recipes, and defense-in-depth solutions for authentication, topic ACLs, mTLS, scoped InfluxDB tokens, OIDC SSO, and Kubernetes Pod Security Standards.

---

## Teardown and Cleanup

To remove all deployed resources and persistent volume claims from Minikube:

```bash
./scripts/teardown.sh
```

To stop the local Minikube cluster:

```bash
minikube stop
```
