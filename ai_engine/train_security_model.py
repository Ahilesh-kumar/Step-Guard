import pandas as pd
import numpy as np
import tensorflow as tf
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import RobustScaler
from tensorflow.keras import layers, models, callbacks

# ---------------------------------------------------------
# StepGuard V4: Biometric Security TIER 2 AI
# Trains a binary classifier recognizing Your Footprint vs The World
# ---------------------------------------------------------

WINDOW_SIZE = 300
NUM_CHANNELS = 1

print("\n--- TIER 2: SECURITY AI ARCHITECTURE ---")

# 1. Load the "Intruder" baseline (We use PhysioNet, since none of them are you)
print("Loading Intruder Baseline (PhysioNet Medical Data)...")
try:
    df_intruder = pd.read_csv("clinical_datasets/master_clinical_dataset.csv")
    df_intruder['Label'] = 1 # Force all medical rows to Class 1 (Unauthorized Intruder)
except FileNotFoundError:
    print("ERROR: Run download_clinical_data.py first!")
    exit()

# 2. Load the "Authorized" baseline (Your personal TENG measurements)
print("Loading Authorized User Baseline (Your Manual Hardware Data)...")
try:
    df_auth = pd.read_csv("clinical_datasets/manual_user_dataset.csv")
    df_auth['Label'] = 0 # Force all your physical rows to Class 0 (Authorized User)
except FileNotFoundError:
    print("❌ ERROR: You must run `python manual_ai_trainer.py` to record your body weight first!")
    print("-> Once you log 20-50 physical steps, re-run this script.")
    exit()

# 3. Splice and Scale the Biometric Database
df_combined = pd.concat([df_intruder, df_auth], ignore_index=True)

# Because we are mixing two entirely different patient origins, standard shuffling is safe here.
labels = df_combined.pop('Label').values
raw_data = df_combined.values
del df_combined # Prevent RAM OOM Crash

print("Applying RobustScaler...")
scaler = RobustScaler()
X_processed = scaler.fit_transform(raw_data).reshape(-1, WINDOW_SIZE, NUM_CHANNELS)
del raw_data 

X_train, X_test, y_train, y_test = train_test_split(X_processed, labels, test_size=0.2, shuffle=True)

# 4. Neural Network Design (Lightweight CNN optimized for ESP32/React Dual-Core running)
print("Compiling Biometric CNN architecture...")
model = models.Sequential([
    layers.Input(shape=(WINDOW_SIZE, NUM_CHANNELS)),
    
    # Feature Extraction (Impact Velocity Curve)
    layers.Conv1D(64, kernel_size=15, activation='relu', strides=2),
    layers.MaxPooling1D(pool_size=2),
    
    # Weight Amplitude Extraction
    layers.Conv1D(128, kernel_size=10, activation='relu', strides=2),
    layers.GlobalAveragePooling1D(),
    
    # Dense Classifier
    layers.Dense(64, activation='relu'),
    layers.Dropout(0.3),
    layers.Dense(1, activation='sigmoid') # Binary Output: 0 (Authorized Ahilesh) or 1 (Intruder)
])

model.compile(optimizer='adam', loss='binary_crossentropy', metrics=['accuracy'])

# 5. Execution
print("\n--- Commencing Biometric Training ---")
early_stop = callbacks.EarlyStopping(monitor='val_loss', patience=4, restore_best_weights=True)

model.fit(X_train, y_train, 
          epochs=25, 
          validation_data=(X_test, y_test),
          callbacks=[early_stop])

# 6. Export for Dashboard integration
model.save("stepguard_security_model.h5")
print("\n✅ SECURE! Biometric Security Engine exported to stepguard_security_model.h5")
