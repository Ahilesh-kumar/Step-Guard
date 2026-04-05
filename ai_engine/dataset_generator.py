import pandas as pd
import numpy as np
import os

# ---------------------------------------------------------
# StepGuard V4: Heel-Strike Synthetic Data Generator
# Mimics TENG voltage traces (0 - 4095mV) to validate
# the ML Pipeline before downloading massive clinical datasets.
# ---------------------------------------------------------

OUTPUT_DIR = "dataset_mock"
WINDOW_SIZE = 300 # 300 frames per sequence (e.g. 1.5 seconds at 200Hz)
NUM_SAMPLES_PER_CLASS = 50

if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

def generate_normal_walk(samples, window_size):
    """
    Heel-Strike Physics:
    Sharp, periodic spikes reaching ~2500-3500mV.
    The spike decays quickly as the foot rolls forward off the 9x9cm heel pad.
    """
    data = []
    labels = []
    for _ in range(samples):
        base_noise = np.random.normal(50, 15, window_size)
        # Random location for the heel strike
        strike_idx = np.random.randint(40, window_size - 60)
        
        # Create sharp strike (~2500mV) and decay
        strike_amp = np.random.uniform(2000, 3500)
        
        for i in range(window_size):
            if strike_idx <= i < strike_idx + 20: 
                # Sharp ramp up
                base_noise[i] += (i - strike_idx) * (strike_amp / 20)
            elif strike_idx + 20 <= i < strike_idx + 50:
                # Exponential decay as weight rolls off the heel
                base_noise[i] += strike_amp * np.exp(-(i - (strike_idx + 20)) / 10)
                
        # Clip to 0-4095 ADC constraints
        base_noise = np.clip(base_noise, 0, 4095)
        data.append(base_noise)
        labels.append(0) # Class 0: Normal
    return data, labels

def generate_shuffling_fog(samples, window_size):
    """
    Freezing of Gait (FoG) / Parkinson's Shuffle:
    Rapid, low-magnitude trembling on the heel pad.
    Usually 4Hz to 6Hz frequency, 300-800mV amplitude.
    """
    data = []
    labels = []
    for _ in range(samples):
        t = np.linspace(0, 1.5, window_size) # 1.5 seconds
        freq = np.random.uniform(4.0, 6.0) # Tremor frequency
        amp = np.random.uniform(300, 800)
        
        sine_wave = amp * np.sin(2 * np.pi * freq * t)
        noise = np.random.normal(0, 50, window_size)
        
        signal = np.abs(sine_wave) + noise + 100 # Keep positive
        signal = np.clip(signal, 0, 4095)
        data.append(signal)
        labels.append(1) # Class 1: Shuffle/FoG
    return data, labels

def generate_falls_anomaly(samples, window_size):
    """
    Catastrophic Fall (MobiAct/SisFall Equivalent):
    Sudden, chaotic massive spike hitting 4095 ceiling,
    followed immediately by flatline dead-zero (0mV).
    """
    data = []
    labels = []
    for _ in range(samples):
        base_noise = np.random.normal(50, 15, window_size)
        fall_idx = np.random.randint(100, window_size - 100)
        
        # The Fall Impact
        for i in range(window_size):
            if fall_idx <= i < fall_idx + 10:
                base_noise[i] = 4095 # Max out ADC
            elif i >= fall_idx + 10:
                base_noise[i] = np.random.normal(5, 2) # Flatline floor
                
        base_noise = np.clip(base_noise, 0, 4095)
        data.append(base_noise)
        labels.append(2) # Class 2: Fall/Anomaly
    return data, labels

print("Synthesizing Mock Heel-Strike TENG Dataset...")

normal_x, normal_y = generate_normal_walk(NUM_SAMPLES_PER_CLASS, WINDOW_SIZE)
shuffle_x, shuffle_y = generate_shuffling_fog(NUM_SAMPLES_PER_CLASS, WINDOW_SIZE)
fall_x, fall_y = generate_falls_anomaly(NUM_SAMPLES_PER_CLASS, WINDOW_SIZE)

# Combine and save
X_all = np.array(normal_x + shuffle_x + fall_x)
Y_all = np.array(normal_y + shuffle_y + fall_y)

# Save as CSVs where each row is a time-series window (300 cols), last col is label
df = pd.DataFrame(X_all)
df['Label'] = Y_all

# Shuffle the dataset
df = df.sample(frac=1).reset_index(drop=True)

csv_path = os.path.join(OUTPUT_DIR, "mock_heelstrike_data.csv")
df.to_csv(csv_path, index=False)

print(f"[Success] Generated {len(df)} samples across 3 classes -> {csv_path}")
