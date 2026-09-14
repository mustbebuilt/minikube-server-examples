#!/usr/bin/env bash
# ==============================================================================
# HydroSense IoT - Local Port-Forwarding Helper
# ==============================================================================
# Forwards ports to localhost:
#   - Grafana:     http://localhost:3000
#   - MQTT TCP:    localhost:1883
#   - MQTT WS:     ws://localhost:9001
#   - InfluxDB:    http://localhost:8086
# ==============================================================================

set -e

NAMESPACE="hydrosense-iot"

echo "========================================================="
echo " 🔌 Setting up local port-forwarding to Minikube..."
echo "========================================================="
echo " - Grafana Dashboard:  http://localhost:3000 (admin / admin)"
echo " - MQTT Broker (TCP):  localhost:1883"
echo " - MQTT Broker (WS):   ws://localhost:9001"
echo " - InfluxDB API:       http://localhost:8086"
echo "========================================================="
echo " Press Ctrl+C to terminate all port forwards."
echo "========================================================="

# Trap to kill background jobs on Ctrl+C
trap 'kill $(jobs -p)' EXIT

kubectl port-forward svc/grafana-service -n "$NAMESPACE" 3000:3000 >/dev/null 2>&1 &
kubectl port-forward svc/mosquitto-service -n "$NAMESPACE" 1883:1883 >/dev/null 2>&1 &
kubectl port-forward svc/mosquitto-service -n "$NAMESPACE" 9001:9001 >/dev/null 2>&1 &
kubectl port-forward svc/influxdb-service -n "$NAMESPACE" 8086:8086 >/dev/null 2>&1 &

wait
