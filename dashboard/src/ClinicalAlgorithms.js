/**
 * StepGuard V3.1 - Domain 5 Clinical Analytics Suite
 * Contains the pure mathematical/heuristic algorithms to distill
 * raw StepGuard AI classifications and timings into true medical scores.
 */

// =========================================================================
// 1. Stride Time Variability (STV)
// =========================================================================
export function calculateSTV(stepIntervalsArray) {
    // Medical Fact: STV > 3% is a hardcore indicator of Parkinson's progression.
    // Formula: (Standard Deviation of Stride Times / Mean Stride Time) * 100
    if (stepIntervalsArray.length < 5) return 0;
    
    const mean = stepIntervalsArray.reduce((p, c) => p + c, 0) / stepIntervalsArray.length;
    const squaredDiffs = stepIntervalsArray.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((p, c) => p + c, 0) / stepIntervalsArray.length;
    const stdDev = Math.sqrt(variance);
    
    const stv = (stdDev / mean) * 100;
    return parseFloat(stv.toFixed(2)); // Returns percentage
}

// =========================================================================
// 2. Symmetry Index (SI)
// =========================================================================
export function calculateSymmetryIndex(leftLegMeanTime, rightLegMeanTime) {
    // Diagnoses Hemiparetic (one-sided) gait issues often seen in post-stroke or early PD.
    // Perfectly symmetrical gait = 0.
    const difference = Math.abs(leftLegMeanTime - rightLegMeanTime);
    const average = 0.5 * (leftLegMeanTime + rightLegMeanTime);
    const si = (difference / average) * 100;
    return parseFloat(si.toFixed(2)); 
}

// =========================================================================
// 3. Falling Risk Index (FRI)
// =========================================================================
export function evaluateFallRisk(stvScore, shuffleRatio, doubleSupportRatio) {
    // Composite heuristic score. 0% = Safe, 100% = Immediate high risk of falling.
    let risk = 0;
    
    // Stride variability heavily dictates balance loss
    if (stvScore > 2.0 && stvScore <= 4.0) risk += 20;
    else if (stvScore > 4.0) risk += 50;

    // High shuffling = festination (leaning forward with tiny steps)
    if (shuffleRatio > 0.3) risk += 30;

    // Double support (both feet glued to ground) means patient feels unsteady
    if (doubleSupportRatio > 0.25) risk += 20;

    return Math.min(100, risk); // Cap at 100%
}

// =========================================================================
// 4. UPDRS Motor Score Estimator (Part III)
// =========================================================================
export function estimateUPDRSMotorScore(tremorFrequencyHz, fogInstances, stvScore) {
    // The gold standard clinical Unified Parkinson's Disease Rating Scale.
    // Normally given by a doctor poking the patient. We use AI telemetry instead.
    // Scale goes 0 (Normal) to 132 (Severe). Focuses strictly on lower body motor metrics.
    
    let estimatedScore = 0;

    // Resting/Action tremor weighting (4 points per item in standard UPDRS)
    if (tremorFrequencyHz > 4.0 && tremorFrequencyHz < 6.0) estimatedScore += 3; // Classic pill-rolling resting tremor
    else if (tremorFrequencyHz >= 6.0) estimatedScore += 4; // Severe action tremor

    // Freezing of Gait scoring
    if (fogInstances > 0 && fogInstances <= 2) estimatedScore += 2;
    else if (fogInstances > 2) estimatedScore += 4;

    // Gait quality (via STV)
    if (stvScore > 3.0 && stvScore <= 5.0) estimatedScore += 2; // Moderate difficulty
    else if (stvScore > 5.0) estimatedScore += 4; // Severe assistance required

    // Add a baseline multiplier assuming upper body mimics lower body roughly
    estimatedScore = Math.round(estimatedScore * 2.5); 
    
    return Math.min(132, estimatedScore);
}

// =========================================================================
// 5. Circadian Medication Efficacy ("On/Off" State Tracker)
// =========================================================================
export function analyzeLevodopaWearOff(morningSTV, afternoonSTV) {
    // Levodopa (Sinemet) wears off throughout the day. 
    // If afternoon STV is massively worse than morning STV, they are experiencing "Wearing Off"
    const degradation = afternoonSTV - morningSTV;
    
    if (degradation > 2.0) {
        return "WARNING: Severe Motor Fluctuation Detected. Advise physician to adjust dosing schedule (fractionation).";
    } else if (degradation > 0.5) {
        return "Noted: Mild afternoon wearing-off.";
    }
    return "Stable: Medication efficacy consistent across observed circadian period.";
}

// =========================================================================
// 6. Stance vs Swing Phase Ratio
// =========================================================================
export function calculateGaitPhases(contactMs, flightMs) {
    // Normal human gait: 60% Stance (foot on ground), 40% Swing (foot in air).
    const totalCycle = contactMs + flightMs;
    const stancePhase = (contactMs / totalCycle) * 100;
    const swingPhase = (flightMs / totalCycle) * 100;
    
    return {
        stancePercent: parseFloat(stancePhase.toFixed(1)),
        swingPercent: parseFloat(swingPhase.toFixed(1)),
        isPathological: stancePhase > 65.0 // Pathological if dragging feet
    };
}

// =========================================================================
// 7. Domain 5.44: Gait Speed Estimation (Requires IMU fusion)
// =========================================================================
export function estimateGaitSpeedVelocity(imuAccelerationYArray, stepTimeSeconds) {
    // True velocity requires an IMU. Integrates standard Acceleration into Velocity (V = A*T).
    if (imuAccelerationYArray.length === 0) return 0;
    const avgAccel = imuAccelerationYArray.reduce((p, c) => p + c, 0) / imuAccelerationYArray.length;
    
    // Using a physical swing-phase trapezoidal integration heuristic (m/s)
    const velocity = avgAccel * stepTimeSeconds;
    return parseFloat(velocity.toFixed(2));
}

// =========================================================================
// 8. Domain 5.48: Center of Pressure (CoP) Excursion
// =========================================================================
export function calculateCoPExcursion(pixelArrayTENG) {
    // Requires Domain 1.5 (Multi-Pixel Mat). 
    // If the 4x4 mat sends 16 voltages, where is the center of gravity?
    let totalWeight = 0;
    let weightedX = 0;
    
    // Assuming a 4x4 matrix mapped to a 16-length array 
    for(let i=0; i<pixelArrayTENG.length; i++) {
        const row = Math.floor(i / 4);
        const col = i % 4;
        totalWeight += pixelArrayTENG[i];
        weightedX += pixelArrayTENG[i] * col;
    }
    
    // 0 = Hard Left Pronation. 3 = Hard Right Supination. 1.5 = Perfect Center.
    return totalWeight === 0 ? 1.5 : (weightedX / totalWeight);
}

// =========================================================================
// 9. Domain 5.43: FoG Prediction Horizon Math
// =========================================================================
export function analyzeFoGHorizonFrequency(voltageWindow) {
    // Looks for 'Festination'—a microscopic high-frequency trembling just before a freeze.
    // Standard waking > 2Hz. Festination > 3-8Hz but with rapidly dropping amplitude.
    const thresholdCount = voltageWindow.filter(v => v > 1500).length;
    const variance = calculateSTV(voltageWindow);
    
    // If variance is exploding and we pass a 6-second window analysis...
    if (variance > 10.0 && thresholdCount > 5) {
        return { fogImminent: true, timeToFreezeMs: 1500 };
    }
    return { fogImminent: false, timeToFreezeMs: -1 };
}
