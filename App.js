document.addEventListener('DOMContentLoaded', () => {
    // Konfigurasi MQTT
    const MQTT_BROKER = 'e81af177c9af406794c5f43addea8b52.s1.eu.hivemq.cloud';
    const MQTT_PORT = 8884;
    const MQTT_PATH = '/mqtt';
    const MQTT_USERNAME = 'ekgitera';
    const MQTT_PASSWORD = 'Itera123';
    const ECG_TOPIC = 'ekg/data_batch';
    const BPM_TOPIC = 'ekg/bpm';
    const STATUS_TOPIC = 'ekg/status';
    const HRV_TOPIC = 'ekg/hrv';

    // Konfigurasi Firebase
    const firebaseConfig = {
        apiKey: "AIzaSyBnXD2kCG_V7wU3ooDjUNTaGHJIKP6mOY4",
        authDomain: "portableecgitera.firebaseapp.com",
        databaseURL: "https://portableecgitera-default-rtdb.firebaseio.com",
        projectId: "portableecgitera",
        storageBucket: "portableecgitera.appspot.com",
        messagingSenderId: "1049018106297",
        appId: "1:1049018106297:web:4744d70ad3c1cd43bd3668",
        measurementId: "G-V9J2L7CN9W"
    };

    const MAX_CHART_POINTS = 200; // Jumlah data ECG maksimal ditampilkan di chart
    const BUFFER_SIZE = 100;      // Jumlah data sebelum flush ke Firebase
    const FLUSH_INTERVAL = 2000;  // Interval flush otomatis ke Firebase (ms)

    firebase.initializeApp(firebaseConfig);
    const database = firebase.database();

    // Element UI
    const connectionStatusEl = document.getElementById('connection-status');
    const bpmValueEl = document.getElementById('bpm-value');
    const hrvValueEl = document.getElementById('hrv-value');
    const statusValueEl = document.getElementById('status-value');
    const statusCardEl = document.getElementById('status-card');
    const modalReset = document.getElementById('modal-reset');

    let ecgChart;
    let ecgBuffer = [];
    let lastFlushTime = Date.now();

    const currentState = {
        bpm: "0",
        hrv: "0",
        status: "N/A"
    };

    // Inisialisasi chart ECG
    function initCharts() {
        const ecgCtx = document.getElementById('ecgChart').getContext('2d');
        ecgChart = new Chart(ecgCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Sinyal ECG',
                    data: [],
                    borderColor: 'rgb(75, 192, 192)',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                scales: {
                    x: { display: false }, // Sembunyikan sumbu X
                    y: {}
                }
            }
        });
    }

    // Update status koneksi MQTT di UI
    function updateConnectionStatus(msg, isConnected) {
        connectionStatusEl.textContent = msg;
        connectionStatusEl.style.color = isConnected ? 'var(--green-strong)' : 'var(--red-strong)';
    }

    // Flush buffer ECG ke Firebase
    function flushBufferToFirebase() {
        if (ecgBuffer.length === 0) return;
        const dataToPush = [...ecgBuffer];
        ecgBuffer = [];
        const updates = {};
        dataToPush.forEach(logEntry => {
            const newKey = database.ref('ecgdata/history').push().key;
            updates[`ecgdata/history/${newKey}`] = logEntry;
        });
        database.ref().update(updates).catch(error => console.error("Firebase batch update failed:", error));
        lastFlushTime = Date.now();
    }

    // Koneksi ke MQTT Broker
    function connectMqtt() {
        const clientId = 'web-dashboard-' + Math.random().toString(16).substr(2, 8);
        updateConnectionStatus('Connecting...', false);
        const client = new Paho.MQTT.Client(MQTT_BROKER, MQTT_PORT, MQTT_PATH, clientId);

        client.onConnectionLost = res => {
            if (res.errorCode !== 0) {
                updateConnectionStatus('Disconnected. Retrying...', false);
                setTimeout(connectMqtt, 5000);
            }
        };

        client.onMessageArrived = msg => {
            const topic = msg.destinationName;
            const payload = msg.payloadString;

            if (topic === ECG_TOPIC) {
                try {
                    const values = JSON.parse(payload);
                    if (Array.isArray(values)) {
                        values.forEach(val => {
                            const num = parseFloat(val);
                            if (!isNaN(num)) handleEcgData(num);
                        });
                    }
                } catch (e) {
                    const val = parseFloat(payload);
                    if (!isNaN(val)) handleEcgData(val);
                }
            } else {
                updateDashboard(topic, payload);
            }
        };

        client.connect({
            onSuccess: () => {
                updateConnectionStatus('Connected', true);
                client.subscribe(ECG_TOPIC);
                client.subscribe(BPM_TOPIC);
                client.subscribe(STATUS_TOPIC);
                client.subscribe(HRV_TOPIC);
                setInterval(flushBufferToFirebase, FLUSH_INTERVAL); // Auto flush
            },
            onFailure: m => updateConnectionStatus(`Connection Failed: ${m.errorMessage}`, false),
            userName: MQTT_USERNAME,
            password: MQTT_PASSWORD,
            useSSL: true
        });
    }

    // Menangani data ECG baru
    function handleEcgData(value) {
        const timestamp = new Date();
        updateChartData(ecgChart, timestamp.toLocaleTimeString('id-ID'), value);
        database.ref('ecgdata/realtime/ecg').set(value.toFixed(4));
        const logEntry = {
            timestamp: timestamp.toISOString(),
            ecg: value.toFixed(4),
            bpm: currentState.bpm,
            hrv: currentState.hrv,
            status: currentState.status
        };
        ecgBuffer.push(logEntry);
        if (ecgBuffer.length >= BUFFER_SIZE) flushBufferToFirebase();
    }

    // Update UI untuk BPM, HRV, Status
    function updateDashboard(topic, payload) {
        const value = parseFloat(payload);
        if (topic === BPM_TOPIC && !isNaN(value)) {
            currentState.bpm = String(Math.round(value));
            bpmValueEl.textContent = currentState.bpm;
            database.ref('ecgdata/realtime/BPM').set(currentState.bpm);
        } else if (topic === HRV_TOPIC && !isNaN(value)) {
            currentState.hrv = String(Math.round(value));
            hrvValueEl.textContent = currentState.hrv;
            database.ref('ecgdata/realtime/hrv').set(currentState.hrv);
        } else if (topic === STATUS_TOPIC) {
            currentState.status = payload;
            statusValueEl.textContent = payload;
            statusCardEl.classList.remove('status-normal', 'status-arrhythmia');
            statusCardEl.classList.add(payload.toLowerCase().includes('normal') ? 'status-normal' : 'status-arrhythmia');
            database.ref('ecgdata/realtime/status').set(currentState.status);
        }
    }

    // Update data chart ECG
    function updateChartData(chart, label, data) {
        chart.data.labels.push(label);
        chart.data.datasets[0].data.push(data);
        if (chart.data.labels.length > MAX_CHART_POINTS) {
            chart.data.labels.shift();
            chart.data.datasets[0].data.shift();
        }
        const dataset = chart.data.datasets[0].data;
        const minY = Math.min(...dataset) - 50;
        const maxY = Math.max(...dataset) + 50;
        chart.options.scales.y.min = minY;
        chart.options.scales.y.max = maxY;
        chart.update('none');
    }

    // Reset semua data di UI, chart, dan Firebase
    function resetAllData() {
        fetch('https://script.google.com/macros/s/AKfycbx9qcA7Cc4D8bJVJRv0w67bLtHAb0D1CE3Wn9vDcF4EV5URY9RyP6C5gFsLJKRotwyknw/exec')
            .catch(error => console.error("Error executing spreadsheet clear script:", error));

        flushBufferToFirebase();
        database.ref('ecgdata').remove().then(() => console.log("Firebase data reset successfully.")).catch(error => console.error("Firebase reset failed:", error));
        
        bpmValueEl.textContent = '0';
        hrvValueEl.textContent = '0';
        statusValueEl.textContent = 'N/A';
        statusCardEl.classList.remove('status-normal', 'status-arrhythmia');
        ecgChart.data.labels = [];
        ecgChart.data.datasets[0].data = [];
        ecgChart.update();
        currentState.bpm = "0";
        currentState.status = "N/A";
        currentState.hrv = "0";
    }

    // Event listeners untuk tombol reset
    function setupEventListeners() {
        document.getElementById('resetData').addEventListener('click', () => { modalReset.classList.add('show'); });
        document.getElementById('confirmReset').addEventListener('click', () => { resetAllData(); modalReset.classList.remove('show'); });
        document.querySelectorAll('.modal-btn-cancel').forEach(btn => { btn.addEventListener('click', () => { btn.closest('.modal').classList.remove('show'); }); });
    }

    // Inisialisasi
    initCharts();
    setupEventListeners();
    connectMqtt();
});
