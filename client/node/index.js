/**
 * HydroSense IoT - Headless Node.js MQTT Water Quality Client
 * 
 * Usage Examples:
 *   Standard local broker (Port 1883, 1-hour interval):
 *     node index.js
 * 
 *   Switch to Public EMQX broker:
 *     BROKER=emqx node index.js
 * 
 *   Set custom interval (e.g. 5 seconds for fast testing):
 *     INTERVAL_SECS=5 node index.js
 * 
 *   CLI Flags:
 *     node index.js --broker emqx --interval 10
 */

const mqtt = require('mqtt');

// Parse CLI flags (--broker emqx, --interval 5)
const args = process.argv.slice(2);
let cliBroker = null;
let cliInterval = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--broker' && args[i + 1]) cliBroker = args[i + 1];
  if (args[i] === '--interval' && args[i + 1]) cliInterval = parseInt(args[i + 1], 10);
}

// Broker Targets Registry
const BROKER_PRESETS = {
  local: 'mqtt://localhost:1883',
  minikube: process.env.MINIKUBE_IP ? `mqtt://${process.env.MINIKUBE_IP}:31883` : 'mqtt://127.0.0.1:31883',
  emqx: 'mqtt://broker.emqx.io:1883',
  hivemq: 'mqtt://broker.hivemq.com:1883'
};

// Configuration Settings
const selectedBrokerKey = (cliBroker || process.env.BROKER || 'local').toLowerCase();
const BROKER_URL = process.env.MQTT_BROKER_URL || BROKER_PRESETS[selectedBrokerKey] || selectedBrokerKey;

const CLIENT_ID = process.env.MQTT_CLIENT_ID || `river-node-cli-${Math.random().toString(16).substring(2, 8)}`;
const TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX || 'water-quality/rivers';
const RIVER_ID = process.env.RIVER_ID || 'thames-01';
const PUBLISH_INTERVAL_SECS = cliInterval || parseInt(process.env.INTERVAL_SECS || '3600', 10);

const TELEMETRY_TOPIC = `${TOPIC_PREFIX}/${RIVER_ID}/telemetry`;
const ALERT_TOPIC = `${TOPIC_PREFIX}/${RIVER_ID}/alerts`;
const LWT_TOPIC = `${TOPIC_PREFIX}/${RIVER_ID}/status`;

console.log('=========================================================');
console.log(' HydroSense IoT - Headless Node.js MQTT Client');
console.log('=========================================================');
console.log(`Target Broker:       ${BROKER_URL}`);
console.log(`Client ID:           ${CLIENT_ID}`);
console.log(`Telemetry Topic:     ${TELEMETRY_TOPIC}`);
console.log(`Publish Schedule:    Every ${PUBLISH_INTERVAL_SECS} second(s)`);
console.log('=========================================================');

// Initialize MQTT Client
const client = mqtt.connect(BROKER_URL, {
  clientId: CLIENT_ID,
  keepalive: 60,
  clean: true,
  will: {
    topic: LWT_TOPIC,
    payload: JSON.stringify({ deviceId: CLIENT_ID, status: 'OFFLINE', timestamp: new Date().toISOString() }),
    qos: 1,
    retain: false
  }
});

client.on('connect', () => {
  console.log(`[${new Date().toISOString()}] Successfully connected to MQTT Broker.`);
  
  // Publish Online LWT status
  client.publish(LWT_TOPIC, JSON.stringify({ deviceId: CLIENT_ID, status: 'ONLINE', timestamp: new Date().toISOString() }), { qos: 1 });

  // Initial publish on startup
  publishTelemetry();

  // Schedule periodic publish
  setInterval(publishTelemetry, PUBLISH_INTERVAL_SECS * 1000);
});

client.on('error', (err) => {
  console.error(`[MQTT Error]: ${err.message}`);
});

client.on('offline', () => {
  console.warn(`[${new Date().toISOString()}] MQTT Client offline. Reconnecting...`);
});

// Generate realistic Dissolved Oxygen & Water Quality readings
function generateTelemetryPayload() {
  const now = new Date();
  const currentHour = now.getHours() + (now.getMinutes() / 60);

  const diurnalFactor = Math.sin((currentHour - 8) * (Math.PI / 12));
  const baseSat = 85 + (diurnalFactor * 12);
  const randomNoise = (Math.random() - 0.5) * 3;
  const oxygenSaturationPct = parseFloat(Math.max(20, Math.min(120, baseSat + randomNoise)).toFixed(1));

  const waterTempC = parseFloat((15.0 + (diurnalFactor * 2.5) + ((Math.random() - 0.5) * 0.5)).toFixed(1));
  const maxSolubility = 14.652 - (0.41022 * waterTempC) + (0.007991 * Math.pow(waterTempC, 2));
  const dissolvedOxygenMgl = parseFloat(((oxygenSaturationPct / 100) * maxSolubility).toFixed(2));
  const ph = parseFloat((7.35 + (diurnalFactor * 0.15) + ((Math.random() - 0.5) * 0.05)).toFixed(2));

  return {
    deviceId: CLIENT_ID,
    riverId: RIVER_ID,
    riverName: 'River Thames (Node #1)',
    location: {
      latitude: 51.5074,
      longitude: -0.1278
    },
    telemetry: {
      oxygenSaturationPct: oxygenSaturationPct,
      dissolvedOxygenMgl: dissolvedOxygenMgl,
      waterTempC: waterTempC,
      ph: ph
    },
    status: {
      batteryPct: 98,
      hypoxiaWarning: oxygenSaturationPct < 50
    },
    timestamp: now.toISOString()
  };
}

function publishTelemetry() {
  const payload = generateTelemetryPayload();
  const payloadStr = JSON.stringify(payload);

  client.publish(TELEMETRY_TOPIC, payloadStr, { qos: 1 }, (err) => {
    if (!err) {
      console.log(`[${new Date().toISOString()}] MQTT Telemetry Published -> ${TELEMETRY_TOPIC}`);
      console.log(`   Payload: Saturation=${payload.telemetry.oxygenSaturationPct}%, DO=${payload.telemetry.dissolvedOxygenMgl}mg/L, Temp=${payload.telemetry.waterTempC}°C`);
    } else {
      console.error(`[Publish Error]: ${err.message}`);
    }
  });

  if (payload.telemetry.oxygenSaturationPct < 50) {
    const alertPayload = JSON.stringify({
      alertType: 'HYPOXIA_CRITICAL_LOW_OXYGEN',
      severity: 'CRITICAL',
      riverName: payload.riverName,
      oxygenSaturationPct: payload.telemetry.oxygenSaturationPct,
      timestamp: payload.timestamp
    });

    client.publish(ALERT_TOPIC, alertPayload, { qos: 1 }, () => {
      console.warn(`[${new Date().toISOString()}] !!! HYPOXIA ALERT PUBLISHED -> ${ALERT_TOPIC} !!!`);
    });
  }
}
