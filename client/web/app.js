/**
 * HydroSense IoT - River Water Quality Monitoring Web Client
 * Author: Antigravity AI
 */

(function () {
  'use strict';

  // --- App State ---
  let mqttClient = null;
  let isConnected = false;
  let publishedMessageCount = 0;
  
  // Timer & Scheduler Settings (seconds)
  let timerInterval = null;
  let currentPublishIntervalSecs = 3600; // Default 1 hour (3600s)
  let secondsRemaining = currentPublishIntervalSecs;

  // Sensor Telemetry State
  let currentTelemetry = {
    riverId: 'thames-01',
    riverName: 'River Thames (London Node #1)',
    latitude: 51.5074,
    longitude: -0.1278,
    oxygenSaturationPct: 86.4,
    dissolvedOxygenMgl: 8.92,
    waterTempC: 14.8,
    ph: 7.42,
    batteryPct: 98,
    timestamp: new Date().toISOString()
  };

  // Telemetry History for Canvas Charting
  const maxHistoryPoints = 30;
  const telemetryHistory = [];

  // --- DOM Elements ---
  const brokerPresetSelect = document.getElementById('brokerPresetSelect');
  const brokerUrlInput = document.getElementById('brokerUrl');
  const clientIdInput = document.getElementById('clientId');
  const topicPrefixInput = document.getElementById('topicPrefix');
  const qosSelect = document.getElementById('qosSelect');
  const connectBtn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');

  const statusPill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');
  const toggleConfigBtn = document.getElementById('toggleConfigBtn');
  const configGrid = document.getElementById('configGrid');

  const riverSelect = document.getElementById('riverSelect');
  const intervalSelect = document.getElementById('intervalSelect');
  const customIntervalGroup = document.getElementById('customIntervalGroup');
  const customIntervalInput = document.getElementById('customIntervalInput');

  const hypoxiaSimToggle = document.getElementById('hypoxiaSimToggle');
  const publishNowBtn = document.getElementById('publishNowBtn');

  const timerValue = document.getElementById('timerValue');
  const timerProgressFill = document.getElementById('timerProgressFill');
  const scheduleBadge = document.getElementById('scheduleBadge');

  const metaNodeId = document.getElementById('metaNodeId');
  const metaBattery = document.getElementById('metaBattery');
  const metaTopic = document.getElementById('metaTopic');

  const doSaturationVal = document.getElementById('doSaturationVal');
  const doQualityBadge = document.getElementById('doQualityBadge');
  const gaugeFill = document.getElementById('gaugeFill');

  const doConcentrationVal = document.getElementById('doConcentrationVal');
  const waterTempVal = document.getElementById('waterTempVal');
  const phVal = document.getElementById('phVal');
  const packetsCountVal = document.getElementById('packetsCountVal');
  const lastUpdatedTime = document.getElementById('lastUpdatedTime');

  const chartCanvas = document.getElementById('telemetryChart');
  const clearChartBtn = document.getElementById('clearChartBtn');
  const consoleBody = document.getElementById('consoleBody');
  const clearConsoleBtn = document.getElementById('clearConsoleBtn');
  const subscribeTopicBtn = document.getElementById('subscribeTopicBtn');

  // --- Initialize App ---
  function init() {
    setupEventListeners();
    updateTopicMetadata();
    generateSensorData();
    updateUI();
    startPublishScheduler();
    renderChart();
  }

  // --- Event Listeners ---
  function setupEventListeners() {
    connectBtn.addEventListener('click', connectMQTT);
    disconnectBtn.addEventListener('click', disconnectMQTT);

    // Broker Preset Selector
    brokerPresetSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val !== 'custom') {
        brokerUrlInput.value = val;
        logToConsole('info', `Broker URL preset loaded: ${val}`);
      }
    });

    toggleConfigBtn.addEventListener('click', () => {
      const isHidden = configGrid.style.display === 'none';
      configGrid.style.display = isHidden ? 'grid' : 'none';
      toggleConfigBtn.textContent = isHidden ? 'Hide Settings' : 'Show Settings';
    });

    riverSelect.addEventListener('change', (e) => {
      const selectedOption = riverSelect.options[riverSelect.selectedIndex];
      currentTelemetry.riverId = e.target.value;
      currentTelemetry.riverName = selectedOption.text;
      currentTelemetry.latitude = parseFloat(selectedOption.dataset.lat);
      currentTelemetry.longitude = parseFloat(selectedOption.dataset.lon);

      metaNodeId.textContent = e.target.value.toUpperCase() + '-O2';
      updateTopicMetadata();
      logToConsole('info', `Switched active node to ${currentTelemetry.riverName}`);
    });

    // Interval Selector & Custom Input
    intervalSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'custom') {
        customIntervalGroup.style.display = 'flex';
        updateInterval(parseInt(customIntervalInput.value, 10) || 30);
      } else {
        customIntervalGroup.style.display = 'none';
        updateInterval(parseInt(val, 10));
      }
    });

    customIntervalInput.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (val > 0) {
        updateInterval(val);
      }
    });

    topicPrefixInput.addEventListener('input', updateTopicMetadata);

    hypoxiaSimToggle.addEventListener('change', (e) => {
      if (e.target.checked) {
        logToConsole('alert', 'SIMULATION: Hypoxia event triggered (<50% Oxygen Saturation)');
      }
      generateSensorData();
      updateUI();
    });

    publishNowBtn.addEventListener('click', () => {
      publishTelemetryPayload(true);
      resetTimer();
    });

    clearChartBtn.addEventListener('click', () => {
      telemetryHistory.length = 0;
      renderChart();
      logToConsole('info', 'Telemetry trend graph reset');
    });

    clearConsoleBtn.addEventListener('click', () => {
      consoleBody.innerHTML = '';
    });

    subscribeTopicBtn.addEventListener('click', () => {
      if (!mqttClient || !isConnected) {
        alert('Please connect to MQTT Broker first.');
        return;
      }
      const subTopic = `${topicPrefixInput.value.trim()}/#`;
      mqttClient.subscribe(subTopic, { qos: parseInt(qosSelect.value) }, (err) => {
        if (err) {
          logToConsole('info', `Subscribe failed: ${err.message}`);
        } else {
          logToConsole('info', `Subscribed to MQTT topic pattern: ${subTopic}`);
        }
      });
    });
  }

  function updateInterval(secs) {
    currentPublishIntervalSecs = secs;
    secondsRemaining = currentPublishIntervalSecs;
    
    // Format human-readable badge text
    let label = `${secs}s`;
    if (secs >= 3600) label = `${(secs / 3600).toFixed(1)}h`;
    else if (secs >= 60) label = `${(secs / 60).toFixed(1)}m`;

    scheduleBadge.textContent = `${label} Interval`;
    updateTimerDisplay();
    logToConsole('info', `Publish interval updated to ${secs} seconds (${label})`);
  }

  function updateTopicMetadata() {
    const prefix = topicPrefixInput.value.trim().replace(/\/$/, '');
    const topic = `${prefix}/${currentTelemetry.riverId}/telemetry`;
    metaTopic.textContent = topic;
  }

  // --- MQTT Client Logic ---
  function connectMQTT() {
    const brokerUrl = brokerUrlInput.value.trim();
    const clientId = clientIdInput.value.trim() || `river-node-${Math.random().toString(16).substring(2, 8)}`;
    
    if (!brokerUrl) {
      alert('Please specify a valid MQTT WebSocket URL (e.g. ws://localhost:9001)');
      return;
    }

    updateConnectionStatus('connecting', 'Connecting...');
    logToConsole('info', `Connecting to MQTT broker at ${brokerUrl} (Client ID: ${clientId})...`);

    const prefix = topicPrefixInput.value.trim().replace(/\/$/, '');
    const lwtTopic = `${prefix}/${currentTelemetry.riverId}/status`;

    const options = {
      clientId: clientId,
      keepalive: 60,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 30000,
      will: {
        topic: lwtTopic,
        payload: JSON.stringify({ deviceId: clientId, status: 'OFFLINE', timestamp: new Date().toISOString() }),
        qos: 1,
        retain: false
      }
    };

    try {
      if (typeof mqtt === 'undefined') {
        throw new Error('MQTT.js library failed to load. Check internet connection.');
      }

      mqttClient = mqtt.connect(brokerUrl, options);

      mqttClient.on('connect', () => {
        isConnected = true;
        updateConnectionStatus('connected', 'MQTT Connected');
        logToConsole('info', `Successfully connected to MQTT broker ${brokerUrl}`);
        connectBtn.disabled = true;
        disconnectBtn.disabled = false;

        // Publish LWT Online status
        mqttClient.publish(lwtTopic, JSON.stringify({ deviceId: clientId, status: 'ONLINE', timestamp: new Date().toISOString() }), { qos: 1 });
      });

      mqttClient.on('error', (err) => {
        logToConsole('info', `MQTT Error: ${err.message}`);
        updateConnectionStatus('disconnected', 'Connection Error');
      });

      mqttClient.on('close', () => {
        if (isConnected) {
          isConnected = false;
          updateConnectionStatus('disconnected', 'MQTT Disconnected');
          logToConsole('info', 'MQTT connection closed');
          connectBtn.disabled = false;
          disconnectBtn.disabled = true;
        }
      });

      mqttClient.on('message', (topic, payload) => {
        logToConsole('publish', `Received [${topic}]: ${payload.toString()}`);
      });

    } catch (err) {
      logToConsole('info', `Connection Exception: ${err.message}`);
      updateConnectionStatus('disconnected', 'Connection Failed');
    }
  }

  function disconnectMQTT() {
    if (mqttClient) {
      logToConsole('info', 'Disconnecting from MQTT broker...');
      mqttClient.end(false, () => {
        isConnected = false;
        updateConnectionStatus('disconnected', 'MQTT Disconnected');
        connectBtn.disabled = false;
        disconnectBtn.disabled = true;
      });
    }
  }

  function updateConnectionStatus(state, text) {
    statusPill.className = `connection-status-pill ${state}`;
    statusText.textContent = text;
  }

  // --- Sensor Data Simulation Model ---
  function generateSensorData() {
    const now = new Date();
    const currentHour = now.getHours() + (now.getMinutes() / 60);

    const diurnalFactor = Math.sin((currentHour - 8) * (Math.PI / 12));
    const baseSat = 85 + (diurnalFactor * 12); 
    const randomNoise = (Math.random() - 0.5) * 3; 

    let finalSat = Math.max(20, Math.min(120, baseSat + randomNoise));

    if (hypoxiaSimToggle.checked) {
      finalSat = 38.5 + (Math.random() * 8);
    }

    const baseTemp = 15.0 + (diurnalFactor * 2.5) + ((Math.random() - 0.5) * 0.5);
    const waterTemp = parseFloat(baseTemp.toFixed(1));

    const maxSolubility = 14.652 - (0.41022 * waterTemp) + (0.007991 * Math.pow(waterTemp, 2));
    const doMgl = parseFloat(((finalSat / 100) * maxSolubility).toFixed(2));

    const ph = parseFloat((7.35 + (diurnalFactor * 0.15) + ((Math.random() - 0.5) * 0.05)).toFixed(2));

    currentTelemetry.oxygenSaturationPct = parseFloat(finalSat.toFixed(1));
    currentTelemetry.dissolvedOxygenMgl = doMgl;
    currentTelemetry.waterTempC = waterTemp;
    currentTelemetry.ph = ph;
    currentTelemetry.timestamp = now.toISOString();

    telemetryHistory.push({
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      satPct: currentTelemetry.oxygenSaturationPct,
      doMgl: currentTelemetry.dissolvedOxygenMgl
    });

    if (telemetryHistory.length > maxHistoryPoints) {
      telemetryHistory.shift();
    }
  }

  // --- Publish Telemetry Payload ---
  function publishTelemetryPayload(isManual = false) {
    generateSensorData();
    updateUI();
    renderChart();

    const prefix = topicPrefixInput.value.trim().replace(/\/$/, '');
    const telemetryTopic = `${prefix}/${currentTelemetry.riverId}/telemetry`;
    const alertTopic = `${prefix}/${currentTelemetry.riverId}/alerts`;
    const qos = parseInt(qosSelect.value);

    const payload = {
      deviceId: metaNodeId.textContent,
      riverId: currentTelemetry.riverId,
      riverName: currentTelemetry.riverName,
      location: {
        latitude: currentTelemetry.latitude,
        longitude: currentTelemetry.longitude
      },
      telemetry: {
        oxygenSaturationPct: currentTelemetry.oxygenSaturationPct,
        dissolvedOxygenMgl: currentTelemetry.dissolvedOxygenMgl,
        waterTempC: currentTelemetry.waterTempC,
        ph: currentTelemetry.ph
      },
      status: {
        batteryPct: currentTelemetry.batteryPct,
        hypoxiaWarning: currentTelemetry.oxygenSaturationPct < 50
      },
      timestamp: currentTelemetry.timestamp
    };

    const payloadStr = JSON.stringify(payload, null, 2);

    if (mqttClient && isConnected) {
      mqttClient.publish(telemetryTopic, JSON.stringify(payload), { qos: qos }, (err) => {
        if (!err) {
          publishedMessageCount++;
          packetsCountVal.textContent = publishedMessageCount;
          logToConsole('publish', `MQTT PUBLISH [${telemetryTopic}] (QoS ${qos}):\n${payloadStr}`);
        } else {
          logToConsole('info', `Publish error: ${err.message}`);
        }
      });

      if (currentTelemetry.oxygenSaturationPct < 50) {
        const alertPayload = {
          alertType: 'HYPOXIA_CRITICAL_LOW_OXYGEN',
          severity: 'CRITICAL',
          riverName: currentTelemetry.riverName,
          oxygenSaturationPct: currentTelemetry.oxygenSaturationPct,
          timestamp: currentTelemetry.timestamp
        };
        mqttClient.publish(alertTopic, JSON.stringify(alertPayload), { qos: 1 });
        logToConsole('alert', `MQTT ALERT PUBLISHED [${alertTopic}]: Critical Oxygen Saturation ${currentTelemetry.oxygenSaturationPct}%`);
      }

    } else {
      logToConsole('info', `[Simulated Publish - Offline] Payload for [${telemetryTopic}]:\n${payloadStr}`);
    }
  }

  // --- Scheduler & Countdown Timer ---
  function startPublishScheduler() {
    if (timerInterval) clearInterval(timerInterval);

    timerInterval = setInterval(() => {
      secondsRemaining--;

      if (secondsRemaining <= 0) {
        publishTelemetryPayload(false);
        resetTimer();
      } else {
        updateTimerDisplay();
      }
    }, 1000);
  }

  function resetTimer() {
    secondsRemaining = currentPublishIntervalSecs;
    updateTimerDisplay();
  }

  function updateTimerDisplay() {
    const mins = Math.floor(secondsRemaining / 60);
    const secs = secondsRemaining % 60;
    
    if (currentPublishIntervalSecs >= 3600) {
      const hrs = Math.floor(secondsRemaining / 3600);
      const remMins = Math.floor((secondsRemaining % 3600) / 60);
      timerValue.textContent = `${hrs.toString().padStart(2, '0')}:${remMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      timerValue.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    const progressPct = ((currentPublishIntervalSecs - secondsRemaining) / currentPublishIntervalSecs) * 100;
    timerProgressFill.style.width = `${progressPct}%`;
  }

  // --- UI Update & SVG Gauge Animation ---
  function updateUI() {
    doSaturationVal.textContent = currentTelemetry.oxygenSaturationPct.toFixed(1);
    doConcentrationVal.textContent = currentTelemetry.dissolvedOxygenMgl.toFixed(2);
    waterTempVal.textContent = currentTelemetry.waterTempC.toFixed(1);
    phVal.textContent = currentTelemetry.ph.toFixed(2);
    lastUpdatedTime.textContent = `Last Read: ${new Date().toLocaleTimeString()}`;

    const sat = Math.min(100, Math.max(0, currentTelemetry.oxygenSaturationPct));
    const strokeDashoffset = 251 - (251 * (sat / 100));
    gaugeFill.style.strokeDashoffset = strokeDashoffset;

    if (sat >= 75) {
      doQualityBadge.className = 'quality-badge optimal';
      doQualityBadge.textContent = 'OPTIMAL';
      gaugeFill.style.stroke = 'var(--status-optimal)';
    } else if (sat >= 50) {
      doQualityBadge.className = 'quality-badge warning';
      doQualityBadge.textContent = 'MODERATE';
      gaugeFill.style.stroke = 'var(--status-warning)';
    } else {
      doQualityBadge.className = 'quality-badge critical';
      doQualityBadge.textContent = 'CRITICAL HYPOXIA';
      gaugeFill.style.stroke = 'var(--status-danger)';
    }
  }

  // --- Canvas Trend Chart ---
  function renderChart() {
    if (!chartCanvas) return;
    const ctx = chartCanvas.getContext('2d');
    const width = chartCanvas.clientWidth;
    const height = chartCanvas.clientHeight;

    chartCanvas.width = width * window.devicePixelRatio;
    chartCanvas.height = height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    ctx.clearRect(0, 0, width, height);

    const paddingLeft = 40;
    const paddingBottom = 30;
    const paddingTop = 20;
    const paddingRight = 20;
    const chartW = width - paddingLeft - paddingRight;
    const chartH = height - paddingTop - paddingBottom;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px JetBrains Mono';

    const ySteps = [0, 25, 50, 75, 100, 120];
    ySteps.forEach(val => {
      const y = paddingTop + chartH - (val / 120 * chartH);
      ctx.beginPath();
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(width - paddingRight, y);
      ctx.stroke();
      ctx.fillText(`${val}%`, 5, y + 3);
    });

    const hypoxiaY = paddingTop + chartH - (50 / 120 * chartH);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(paddingLeft, hypoxiaY);
    ctx.lineTo(width - paddingRight, hypoxiaY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#f87171';
    ctx.fillText('Hypoxia Threshold (50%)', width - paddingRight - 140, hypoxiaY - 4);

    if (telemetryHistory.length < 2) return;

    const stepX = chartW / (maxHistoryPoints - 1);
    ctx.beginPath();
    ctx.lineWidth = 2.5;

    telemetryHistory.forEach((pt, idx) => {
      const x = paddingLeft + (idx * stepX);
      const y = paddingTop + chartH - (Math.min(120, pt.satPct) / 120 * chartH);
      if (idx === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    const gradient = ctx.createLinearGradient(0, paddingTop, 0, height - paddingBottom);
    gradient.addColorStop(0, 'rgba(0, 229, 255, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 229, 255, 0.0)');

    const lastX = paddingLeft + ((telemetryHistory.length - 1) * stepX);
    ctx.lineTo(lastX, paddingTop + chartH);
    ctx.lineTo(paddingLeft, paddingTop + chartH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = '#00e5ff';
    telemetryHistory.forEach((pt, idx) => {
      const x = paddingLeft + (idx * stepX);
      const y = paddingTop + chartH - (Math.min(120, pt.satPct) / 120 * chartH);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    telemetryHistory.forEach((pt, idx) => {
      const x = paddingLeft + (idx * stepX);
      const y = paddingTop + chartH - (Math.min(120, pt.satPct) / 120 * chartH);
      
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = pt.satPct < 50 ? '#ef4444' : '#00e5ff';
      ctx.fill();
      ctx.strokeStyle = '#0b0f19';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }

  function logToConsole(type, message) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = `[${new Date().toLocaleTimeString()}]`;

    const msgSpan = document.createElement('span');
    msgSpan.className = 'log-msg';
    msgSpan.textContent = message;

    entry.appendChild(timeSpan);
    entry.appendChild(msgSpan);

    consoleBody.appendChild(entry);
    consoleBody.scrollTop = consoleBody.scrollHeight;
  }

  window.addEventListener('resize', renderChart);
  document.addEventListener('DOMContentLoaded', init);

})();
