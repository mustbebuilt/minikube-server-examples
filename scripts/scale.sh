#!/usr/bin/env bash
# ==============================================================================
# HydroSense IoT - Scalability Manager for Minikube
# ==============================================================================
# Usage:
#   ./scripts/scale.sh [component] [replicas]
#
# Examples:
#   ./scripts/scale.sh nodes 10        # Scale simulated river nodes to 10 instances
#   ./scripts/scale.sh telegraf 3      # Scale Telegraf ingest workers to 3 instances
#   ./scripts/scale.sh mosquitto 2     # Scale Mosquitto MQTT broker to 2 instances
#   ./scripts/scale.sh status          # View status of all deployments
# ==============================================================================

set -e

NAMESPACE="hydrosense-iot"
TARGET="$1"
COUNT="$2"

print_help() {
  echo "========================================================="
  echo " 🔄 HydroSense IoT Kubernetes Scaler"
  echo "========================================================="
  echo " Usage: ./scripts/scale.sh [component] [replicas]"
  echo ""
  echo " Components:"
  echo "   nodes       - Scale simulated IoT river sensor nodes (Deployment: river-nodes-deployment)"
  echo "   telegraf    - Scale Telegraf MQTT subscriber ingest workers (Deployment: telegraf-deployment)"
  echo "   mosquitto   - Scale Mosquitto broker instances (Deployment: mosquitto-deployment)"
  echo "   grafana     - Scale Grafana server instances (Deployment: grafana-deployment)"
  echo "   status      - Show current replica count and pod health for all components"
  echo ""
  echo " Examples:"
  echo "   ./scripts/scale.sh nodes 8"
  echo "   ./scripts/scale.sh telegraf 3"
  echo "   ./scripts/scale.sh status"
  echo "========================================================="
}

if [ -z "$TARGET" ]; then
  print_help
  exit 1
fi

show_status() {
  echo "========================================================="
  echo " 📊 Current HydroSense IoT Deployments & Pods (${NAMESPACE})"
  echo "========================================================="
  kubectl get deployments -n "$NAMESPACE"
  echo ""
  kubectl get pods -n "$NAMESPACE" -o wide
  echo "========================================================="
}

if [ "$TARGET" == "status" ]; then
  show_status
  exit 0
fi

if [ -z "$COUNT" ]; then
  echo "❌ Error: Please specify the desired number of replicas (e.g. ./scripts/scale.sh $TARGET 5)"
  exit 1
fi

DEPLOYMENT=""
case "$TARGET" in
  nodes|river-nodes|sensors)
    DEPLOYMENT="river-nodes-deployment"
    ;;
  telegraf|ingest|subscribers)
    DEPLOYMENT="telegraf-deployment"
    ;;
  mosquitto|mqtt|broker)
    DEPLOYMENT="mosquitto-deployment"
    ;;
  grafana|dashboard)
    DEPLOYMENT="grafana-deployment"
    ;;
  *)
    echo "❌ Unknown component: $TARGET"
    print_help
    exit 1
    ;;
esac

echo "========================================================="
echo " ⚙️ Scaling $DEPLOYMENT to $COUNT replicas in namespace $NAMESPACE..."
echo "========================================================="

kubectl scale deployment "$DEPLOYMENT" -n "$NAMESPACE" --replicas="$COUNT"

echo "⏳ Waiting for rollout to complete..."
kubectl rollout status deployment/"$DEPLOYMENT" -n "$NAMESPACE" --timeout=120s

echo "✅ Successfully scaled $DEPLOYMENT to $COUNT replicas!"
echo ""
show_status
