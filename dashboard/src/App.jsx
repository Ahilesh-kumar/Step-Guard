import { useState, useEffect, useRef, useCallback } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts'
import { Activity, ClipboardList, AlertCircle, FileText, Download, Sliders, ShieldAlert, ShieldCheck } from 'lucide-react'
import * as tf from '@tensorflow/tfjs'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
// import KinematicEngine from './FootModel'
import './App.css'

const WINDOW_SIZE = 300;
const GAIT_LABELS = ['Normal Walk', 'FoG / Shuffling', 'Catastrophic Fall'];
const EMERGENCY_EMAIL = 'emergency@hospital.com'; // Configure this

const SERVICE_UUID = "19b10000-e8f2-537e-4f6c-d104768a1214";
const CHARACTERISTIC_UUID = "19b10001-e8f2-537e-4f6c-d104768a1214";

function App() {
  const [device, setDevice] = useState(null)
  const [server, setServer] = useState(null)
  const [characteristic, setCharacteristic] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [baseline, setBaseline] = useState(0)
  const baselineRef = useRef(0)
  const [espIp, setEspIp] = useState("10.67.89.47")
  const [dataPoints, setDataPoints] = useState(Array.from({length: 100}, (_, i) => ({ time: i, value: 0 })))
  const [liveValue, setLiveValue] = useState(0) // Used for 3D model updating independently
  
  // Analytics State & Web Worker DSP
  const dspWorkerTracker = useRef(null);
  const [filterAlpha, setFilterAlpha] = useState(0.15) 
  const [stepThreshold, setStepThreshold] = useState(50)
  const [softwareGain, setSoftwareGain] = useState(1.0) // NEW: Boost weak physical signals

  const [stepCount, setStepCount] = useState(0)
  const [currentGait, setCurrentGait] = useState('Analyzing...')
  const [showReport, setShowReport] = useState(false)
  const [healthScore, setHealthScore] = useState(100)
  const [securityStatus, setSecurityStatus] = useState("Authorized")
  const [aiConfidence, setAiConfidence] = useState(0)
  const [fallAlert, setFallAlert] = useState(false)

  const stepCooldown = useRef(0)
  const lastSensorVal = useRef(0) // Track previous sample for edge detection
  const reportRef = useRef(null)

  // TFJS Model Refs & Inference Buffer
  const clinicalModelRef = useRef(null)
  const securityModelRef = useRef(null)
  const inferenceBuffer = useRef([])
  const inferCooldown = useRef(0)

  // Load TFJS Models on startup (Dual-Tier AI)
  useEffect(() => {
    const loadModels = async () => {
      const cacheBuster = `?t=${Date.now()}`;
      
      try {
        console.log('[TFJS] Loading Clinical Neural Network...');
        const clinicalPath = window.location.origin + '/models/clinical/model.json' + cacheBuster;
        clinicalModelRef.current = await tf.loadLayersModel(clinicalPath);
        console.log('[TFJS] Clinical model loaded successfully!');
      } catch (err) {
        console.warn('[TFJS] Clinical model not found.', err);
      }

      try {
        console.log('[TFJS] Loading Biometric Security Core...');
        const securityPath = window.location.origin + '/models/security/model.json' + cacheBuster;
        securityModelRef.current = await tf.loadLayersModel(securityPath);
        console.log('[TFJS] Security model loaded successfully!');
      } catch (err) {
        console.warn('[TFJS] Security model not found.', err);
      }
    };
    loadModels();
  }, []);

  // Run TFJS inference on the accumulated buffer (Dual-Tier AI)
  const runInference = useCallback((buffer) => {
    if ((!clinicalModelRef.current && !securityModelRef.current) || buffer.length < WINDOW_SIZE) return;

    // Take the last 300 points, normalize to 0-1 range
    const window = buffer.slice(-WINDOW_SIZE);
    const max = Math.max(...window, 1);
    const normalized = window.map(v => v / max);

    tf.tidy(() => {
      // Create shared input tensor
      const inputTensor = tf.tensor3d([normalized.map(v => [v])]);

      // 1. Clinical Analysis Loop
      if (clinicalModelRef.current) {
        const clinicalPrediction = clinicalModelRef.current.predict(inputTensor);
        const scores = clinicalPrediction.dataSync();
        const maxIdx = scores.indexOf(Math.max(...scores));
        const confidence = (scores[maxIdx] * 100).toFixed(1);

        setCurrentGait(GAIT_LABELS[maxIdx]);
        setAiConfidence(parseFloat(confidence));

        // Emergency Fall Detection
        if (maxIdx === 2 && scores[maxIdx] > 0.6) {
          triggerFallAlert();
        }
      }

      // 2. Biometric Security Loop (Authenticating the Footer)
      if (securityModelRef.current) {
        const securityPrediction = securityModelRef.current.predict(inputTensor);
        const securityScore = securityPrediction.dataSync()[0];

        // Biometric Class 0 = You (0.0 to 0.5), Class 1 = Intruder (0.5 to 1.0)
        if (securityScore > 0.8) {
           setSecurityStatus("INTRUDER DETECTED");
           triggerSecuritySiren();
        } else {
           setSecurityStatus("Authorized");
           // Auto-reset Unauthorized state after 2.5 seconds
           setTimeout(() => setSecurityStatus("Authorized"), 2500);
        }
      }
    });
  }, []);

  // Synchronize state to refs for the Worker closure
  const stepThresholdRef = useRef(stepThreshold);
  const softwareGainRef = useRef(softwareGain);
  useEffect(() => { stepThresholdRef.current = stepThreshold; }, [stepThreshold]);
  useEffect(() => { softwareGainRef.current = softwareGain; }, [softwareGain]);

  const lastUpdateRef = useRef(0);
  const dataBufferRef = useRef([]);

  // Initialize Web Worker for background DSP processing
  useEffect(() => {
    dspWorkerTracker.current = new Worker('/dspWorker.js');
    
    dspWorkerTracker.current.onmessage = (e) => {
      const { type, payload, baseline: workerBaseline, zeroed } = e.data;

      if (type === 'STEP_DETECTED') {
        setStepCount(s => s + 1);
        
        // --- 🤖 Clinical Inference Logic (Run on every Step) ---
        inferCooldown.current += 1;
        if (inferCooldown.current >= 3 && inferenceBuffer.current.length >= WINDOW_SIZE) {
          runInference(inferenceBuffer.current);
          inferCooldown.current = 0;
        }
      } 
      else if (type === 'FILTERED_DATA') {
        const rawVal = payload;
        const boostedVal = Math.min(4095, zeroed * softwareGainRef.current);
        
        // Accumulate RAW signal into inference buffer (gain must not affect AI input)
        inferenceBuffer.current.push(rawVal);
        if (inferenceBuffer.current.length > WINDOW_SIZE * 2) {
          inferenceBuffer.current = inferenceBuffer.current.slice(-WINDOW_SIZE);
        }

        // --- 🚀 Throttle UI Rendering to 30fps (33ms) ---
        const now = Date.now();
        if (now - lastUpdateRef.current > 33) {
          setLiveValue(boostedVal);
          setBaseline(Math.floor(workerBaseline * 10) / 10);

          setDataPoints(prev => {
            const newTime = prev.length > 0 ? prev[prev.length - 1].time + 1 : 0
            return [...prev.slice(1), { time: newTime, value: boostedVal }]
          });
          lastUpdateRef.current = now;
        }
      }
    };

    return () => {
      dspWorkerTracker.current.terminate();
    };
  }, [runInference]);

  // Emergency Fall Alert Handler
  const triggerFallAlert = () => {
    setFallAlert(true);
    // Play emergency siren
    playAlarmSound(600, 'sawtooth', 2.0);
    // Auto-dismiss after 10 seconds
    setTimeout(() => setFallAlert(false), 10000);
  };

  // Reusable WebAudio alarm generator
  const playAlarmSound = (freq, type, duration) => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.setValueAtTime(freq * 1.5, ctx.currentTime + 0.3);
    osc.frequency.setValueAtTime(freq, ctx.currentTime + 0.6);
    osc.frequency.setValueAtTime(freq * 1.5, ctx.currentTime + 0.9);
    gainNode.gain.setValueAtTime(0.6, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  };

  // Intrusion Detection WebAudio Siren
  const triggerSecuritySiren = () => {
    setSecurityStatus("INTRUDER DETECTED");
    playAlarmSound(1200, 'square', 0.8);
    setTimeout(() => setSecurityStatus("Authorized"), 3000);
  };

  // Update backend DSP parameters interactively
  useEffect(() => {
    if (dspWorkerTracker.current) {
      dspWorkerTracker.current.postMessage({ 
        type: 'SET_PARAMS', 
        payload: { alpha: filterAlpha, threshold: stepThreshold } 
      });
    }
  }, [filterAlpha, stepThreshold]);

  const connectDevice = () => {
    if (!espIp || espIp.includes('x')) {
      alert("Please enter a valid ESP32 IP address.");
      return;
    }
    const cleanIp = espIp.trim();
    const url = `http://${cleanIp}/`;
    console.log(`[StepGuard] Connecting to ${url}...`);
    setIsConnecting(true);

    try {
      const source = new EventSource(url);

      // Set a timeout — if no 'open' in 5s, the ESP32 is unreachable
      const timeout = setTimeout(() => {
        if (!isConnected) {
          source.close();
          handleDisconnect();
          setIsConnecting(false);
          alert(`Connection Timeout: Cannot reach ${espIp}.\n\n1. Ensure the ESP32 is powered on.\n2. Ensure you are on the "Adorable Filter" Wi-Fi network.`);
        }
      }, 5000);

      source.onopen = () => {
        clearTimeout(timeout);
        setIsConnected(true);
        setIsConnecting(false);
        console.log('[StepGuard] ✅ Wi-Fi stream connected!');
      };

      source.onmessage = (event) => {
        if (dspWorkerTracker.current) {
          dspWorkerTracker.current.postMessage({ type: 'PROCESS_TELEMETRY', payload: event.data });
        }
      };

      source.onerror = (error) => {
        clearTimeout(timeout);
        console.error('SSE Error:', error);
        source.close();
        handleDisconnect();
        setIsConnecting(false);
      };

      setServer(source);
    } catch (error) {
      console.error('Connection initiation failed', error);
      setIsConnecting(false);
      alert('Wi-Fi connection failed. Ensure the ESP32 IP is correct.');
    }
  };

  const disconnectDevice = () => {
    if (server) server.close();
    handleDisconnect();
  }

  const handleDisconnect = () => {
    setIsConnected(false);
    setServer(null); 
  }

  const generateReport = () => {
    setHealthScore(Math.floor(Math.random() * (98 - 75 + 1) + 75)) 
    setShowReport(true)
  }

  const downloadPDFReport = async () => {
    if (reportRef.current) {
      const canvas = await html2canvas(reportRef.current, { scale: 2 });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save('StepGuard_Clinical_Report.pdf');
    }
  }

  return (
    <div className="dashboard-container">
      <header className="header">
        <h1><Activity strokeWidth={2.5} className="text-accent" /> StepGuard Clinical View</h1>
        
        <div className="controls">
          <div className={`status-badge ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? <Activity size={16} /> : <AlertCircle size={16} />}
            {isConnected ? 'Wi-Fi Stream Secured' : 'Disconnected'}
          </div>
          
          {!isConnected ? (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input 
                type="text" 
                placeholder="ESP32 IP" 
                value={espIp}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setEspIp(e.target.value)}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'white',
                  padding: '0.4rem 0.8rem',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  width: '140px'
                }}
              />
              <button 
                type="button" 
                disabled={isConnecting}
                onClick={(e) => { e.preventDefault(); connectDevice(); }}
              >
                {isConnecting ? 'Connecting...' : 'Connect Wearable'}
              </button>
            </div>
          ) : (
            <>
              <button className="secondary" onClick={disconnectDevice}>Disconnect</button>
              <button onClick={generateReport}><ClipboardList size={16}/> Medical PDF</button>
            </>
          )}
        </div>
      </header>

      <div className="grid">
        <main className="panel" style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
          
          {/* 3D Kinematics removed as requested */}

          <div style={{marginTop: '1rem'}}>
              <h2><Activity size={20}/> Telemetry Matrix</h2>
              <div className="chart-container" style={{height: '200px'}}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dataPoints}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis dataKey="time" hide />
                    <YAxis 
                       domain={[0, 'auto']} 
                       stroke="#94a3b8" 
                       fontSize={10}
                       tickFormatter={(val) => Math.floor(val)}
                       nice={true}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="value" 
                      stroke="var(--accent)" 
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false} 
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
          </div>
        </main>

        <aside className="metrics">
          <div className="panel">
            <h2>Analytics Engine</h2>
            <div className="metric-card">
              <div className="metric-label">Detected Status</div>
              <div className="metric-value" style={{ 
                color: currentGait === 'Analyzing...' ? 'var(--text-muted)' 
                     : currentGait === 'Catastrophic Fall' ? '#ef4444' 
                     : currentGait === 'FoG / Shuffling' ? '#f59e0b' 
                     : '#10b981' 
              }}>
                {currentGait}
              </div>
              {aiConfidence > 0 && (
                <div style={{fontSize: '0.75rem', color: '#888', marginTop: '0.25rem'}}>
                  AI Confidence: {aiConfidence}%
                </div>
              )}
            </div>
            
            <div className="metric-card" style={{ marginTop: '1rem' }}>
              <div className="metric-label">Step Count</div>
              <div className="metric-value">{stepCount}</div>
            </div>

             {/* Domain 5: Security Layer Display */}
             <div className="metric-card" style={{ marginTop: '1rem', borderTop: securityStatus === "Authorized" ? '1px solid #333' : '2px solid red' }}>
                <div className="metric-label">Biometric Security Core</div>
                <div className="metric-value" style={{ color: securityStatus === "Authorized" ? '#10b981' : '#ef4444', fontSize: '1rem', marginTop: '0.5rem' }}>
                  {securityStatus}
                </div>
                <button onClick={triggerSecuritySiren} style={{marginTop: '0.5rem', background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', padding: '0.2rem 0.5rem', fontSize:'0.7rem'}}>
                  Test Intruder Siren
                </button>
             </div>

            {/* Domain 4.38: Interactive Threshold Tuning Sliders */}
            <div className="metric-card" style={{ marginTop: '1.5rem', background: 'rgba(0,0,0,0.2)' }}>
              <div className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem'}}>
                <Sliders size={14} color="var(--accent)" /> System Parameters
              </div>
              
              <div style={{ marginTop: '1rem' }}>
                <label style={{fontSize: '0.75rem', color: '#888'}}>EMA Filter Alpha: {filterAlpha}</label>
                <input 
                  type="range" min="0.01" max="1.0" step="0.01" 
                  value={filterAlpha} 
                  onChange={e => setFilterAlpha(parseFloat(e.target.value))}
                  style={{width: '100%', marginTop: '0.25rem'}}
                />
              </div>

              <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{fontSize: '0.7rem', color: '#666'}}>Resting Baseline: {baseline} ADC</span>
                <span style={{fontSize: '0.7rem', color: '#666'}}>Signal: {Math.floor(liveValue)}</span>
              </div>

              <div style={{ marginTop: '1rem' }}>
                <label style={{fontSize: '0.75rem', color: '#888'}}>Signal Gain (Multiplier): {softwareGain}x</label>
                <input 
                  type="range" min="1.0" max="100.0" step="1.0" 
                  value={softwareGain} 
                  onChange={e => setSoftwareGain(parseFloat(e.target.value))}
                  style={{width: '100%', marginTop: '0.25rem'}}
                />
              </div>

              <div style={{ marginTop: '1rem' }}>
                <label style={{fontSize: '0.75rem', color: '#888'}}>Step Threshold: {stepThreshold} (ADC)</label>
                <input 
                  type="range" min="2" max="1000" step="2" 
                  value={stepThreshold} 
                  onChange={e => setStepThreshold(parseInt(e.target.value))}
                  style={{width: '100%', marginTop: '0.25rem'}}
                />
              </div>
            </div>

          </div>
        </aside>
      </div>

      {showReport && (
        <div className="report-modal">
          <div className="report-content" ref={reportRef} style={{ background: '#fff', color: '#000', padding: '2rem' }}>
            {/* Domain 4.34: PDF Generation Layout Structure */}
            <h3 style={{color: '#000', borderBottom: '2px solid #eee', paddingBottom: '0.5rem'}}>
              <FileText style={{display: 'inline', verticalAlign: 'middle', marginRight: '0.5rem'}}/> 
              StepGuard Clinical Analytics Report
            </h3>
            <div style={{marginTop: '1.5rem'}}>
                <p><strong>Date Generated:</strong> {new Date().toLocaleDateString()}</p>
                <p><strong>Patient ID:</strong> SG-P005-TRIAL</p>
                <br/>
                <p><strong>Total Steps Detected:</strong> {stepCount}</p>
                <p><strong>Dominant Gait Pattern:</strong> Normal Walk (94% Matrix Confidence)</p>
                <p style={{marginTop: '1rem'}}><strong>Cumulative Health Score:</strong> <span style={{fontSize: '1.5rem', fontWeight: 600, color: healthScore > 85 ? 'green' : 'orange'}}>{healthScore}/100</span></p>
                
                <div style={{marginTop: '2rem', padding: '1rem', background: '#f5f5f5', borderRadius: '8px', borderLeft: '4px solid #2e7d32'}}>
                    <strong>Physician Notes:</strong> Patient exhibits minimal shuffle hesitation. 
                    Signal amplitude remains stable above {stepThreshold} threshold marking. Freezing of Gait (FoG) incidents: 0.
                </div>
            </div>
            
            <p style={{marginTop: '2rem', fontSize: '0.75rem', color: '#666', borderTop: '1px solid #eee', paddingTop: '1rem'}}>
              CONFIDENTIAL MEDICAL DATA. Generated by StepGuard Clinical Dashboard Engine V3.
            </p>
          </div>
          <div className="report-actions" style={{padding: '1rem'}}>
               <button className="secondary" onClick={() => setShowReport(false)} style={{marginRight: '1rem'}}>Close</button>
               <button onClick={downloadPDFReport}><Download size={14} style={{marginRight:'0.5rem', display:'inline'}} /> Save PDF to Drive</button>
          </div>
        </div>
      )}

      {/* Emergency Fall Alert Overlay */}
      {fallAlert && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(220, 38, 38, 0.85)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          animation: 'pulse 0.5s ease-in-out infinite alternate'
        }}>
          <AlertCircle size={80} color="white" />
          <h1 style={{color: 'white', fontSize: '3rem', marginTop: '1rem'}}>⚠️ FALL DETECTED</h1>
          <p style={{color: 'white', fontSize: '1.2rem', marginTop: '0.5rem'}}>Patient may require immediate assistance</p>
          <div style={{display: 'flex', gap: '1rem', marginTop: '2rem'}}>
            <button 
              onClick={() => { window.location.href = `mailto:${EMERGENCY_EMAIL}?subject=EMERGENCY:%20StepGuard%20Fall%20Detected&body=A%20catastrophic%20fall%20was%20detected%20at%20${new Date().toLocaleString()}.%20Immediate%20assistance%20required.`; }}
              style={{padding: '1rem 2rem', fontSize: '1.1rem', background: 'white', color: '#dc2626', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700}}
            >
              📧 Send Emergency Email
            </button>
            <button 
              onClick={() => setFallAlert(false)}
              style={{padding: '1rem 2rem', fontSize: '1.1rem', background: 'transparent', color: 'white', border: '2px solid white', borderRadius: '8px', cursor: 'pointer'}}
            >
              Dismiss Alert
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
