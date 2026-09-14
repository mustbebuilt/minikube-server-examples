#!/usr/bin/env bash
# ==============================================================================
# HydroSense IoT - Teardown Script
# ==============================================================================
# Cleans up all HydroSense resources from Minikube.
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "========================================================="
echo " 🧹 Tearing down HydroSense IoT Stack from Minikube..."
echo "========================================================="

kubectl delete -k k8s/ --ignore-not-found=true

echo "✅ All HydroSense IoT resources removed from Minikube."
