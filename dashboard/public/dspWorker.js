// dspWorker.js - StepGuard High-Performance DSP Engine V4.5
// Offloads heavy signal processing and step detection from the Main UI Thread.

let emaAlpha = 0.15;
let lastEmaValue = 0;
let baseline = 0;
let stepThreshold = 50;

// Schmitt Trigger State
let isStepActive = false;

self.onmessage = function(e) {
    const { type, payload } = e.data;

    if (type === 'SET_PARAMS') {
        if (payload.alpha !== undefined) emaAlpha = payload.alpha;
        if (payload.threshold !== undefined) stepThreshold = payload.threshold;
    } 
    else if (type === 'PROCESS_TELEMETRY') {
        const rawVal = parseInt(payload, 10);
        if (isNaN(rawVal)) return;

        // 1. Exponential Moving Average (Smoothing)
        const smoothed = (emaAlpha * rawVal) + ((1 - emaAlpha) * lastEmaValue);
        lastEmaValue = smoothed;

        // 2. Dynamic Baseline Tracking (Auto-Zero)
        if (smoothed < baseline || baseline === 0) {
            baseline = smoothed;
        } else {
            baseline += 0.0005; // Slow drift for environmental normalization
        }

        const zeroed = Math.max(0, smoothed - baseline);

        // 3. Schmitt Trigger Step Detection (Hysteresis)
        // High Trigger: stepThreshold | Low Reset: 60% of stepThreshold
        const resetThreshold = stepThreshold * 0.6;

        if (!isStepActive && zeroed > stepThreshold) {
            isStepActive = true;
            self.postMessage({ type: 'STEP_DETECTED' });
        } else if (isStepActive && zeroed < resetThreshold) {
            isStepActive = false;
        }

        // 4. Report results back to UI @ 200Hz
        // The UI will throttle these for the chart, but the math stays high-res.
        self.postMessage({ 
            type: 'FILTERED_DATA', 
            payload: rawVal, 
            baseline: baseline,
            zeroed: zeroed 
        });
    }
};
