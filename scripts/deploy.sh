#!/usr/bin/env bash
# ==============================================================================
# HydroSense IoT - Minikube Deployment Script
# ==============================================================================
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "========================================================="
echo " 🚀 Deploying HydroSense IoT Platform to Minikube"
echo "========================================================="

# 1. Check if Minikube is running
if ! minikube status >/dev/null 2>&1; then
  echo "⚠️ Minikube is not running. Starting Minikube..."
  minikube start --cpus=2 --memory=4096
else
  echo "✅ Minikube is running."
fi

# 2. Apply all manifests using Kustomize
echo "📦 Applying Kubernetes manifests..."
kubectl apply -k k8s/

# 3. Wait for core services to become ready
echo "⏳ Waiting for InfluxDB and Mosquitto to be ready..."
kubectl rollout status deployment/influxdb-deployment -n hydrosense-iot --timeout=120s
kubectl rollout status deployment/mosquitto-deployment -n hydrosense-iot --timeout=120s
kubectl rollout status deployment/telegraf-deployment -n hydrosense-iot --timeout=120s
kubectl rollout status deployment/grafana-deployment -n hydrosense-iot --timeout=120s
kubectl rollout status deployment/river-nodes-deployment -n hydrosense-iot --timeout=120s

MINIKUBE_IP=$(minikube ip)

echo "========================================================="
echo " ✅ HydroSense IoT Stack successfully deployed!"
echo "========================================================="
echo " 🌐 Minikube IP:         ${MINIKUBE_IP}"
echo " 📊 Grafana Dashboard:   http://${MINIKUBE_IP}:30300"
echo "    - Username: admin"
echo "    - Password: admin"
echo " 📡 MQTT TCP (CLI/Node): ${MINIKUBE_IP}:31883"
echo " 🔌 MQTT WS (Browser):   ws://${MINIKUBE_IP}:30901"
echo " 🗄️ InfluxDB v2 (API):   http://${MINIKUBE_IP}:8086 (or port-forward)"
echo "========================================================="
echo "💡 Useful commands:"
echo "   - Scale servers/nodes: ./scripts/scale.sh nodes 10"
echo "   - Port forwarding:     ./scripts/port-forward.sh"
echo "   - Open Grafana in browser: minikube service grafana-service -n hydrosense-iot"
echo "========================================================="
