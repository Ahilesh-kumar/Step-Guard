import numpy as np
import pandas as pd
import tensorflow as tf
from tensorflow.keras import layers, models, callbacks
from sklearn.preprocessing import RobustScaler
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
import os

# ---------------------------------------------------------
# StepGuard V4: Advanced Domain 3 Artificial Intelligence
# Full Training Pipeline with TFLite Export
# ---------------------------------------------------------

WINDOW_SIZE = 300   
NUM_CHANNELS = 1    
NUM_CLASSES = 3     
DATA_PATH = "clinical_datasets/master_clinical_dataset.csv"

# =========================================================
# Core Architectures
# =========================================================
def build_classifier_model():
    inputs = tf.keras.Input(shape=(WINDOW_SIZE, NUM_CHANNELS))
    x = layers.Conv1D(filters=32, kernel_size=5, activation='relu', padding='same')(inputs)
    x = layers.MaxPooling1D(pool_size=2)(x)
    x = layers.LSTM(64, return_sequences=False)(x)
    x = layers.Dropout(0.4)(x)
    x = layers.Dense(32, activation='relu')(x)
    outputs = layers.Dense(NUM_CLASSES, activation='softmax')(x)
    model = models.Model(inputs=inputs, outputs=outputs, name="StepGuard_Diagnostic_CNN_BiLSTM")
    return model

# =========================================================
# TinyML Export Pipeline (Domain 3.40)
# =========================================================
def export_tflite(model, filename):
    print(f"\nExporting {filename}.tflite for ESP32 constraints...")
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    
    # Enable Post-Training Quantization (reduces size by 4x for microcontrollers)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    
    # We must provide a representative dataset to calibrate INT8 quantization
    def representative_dataset():
        for i in range(100):
            yield [X_train[i:i+1].astype(np.float32)]

    converter.representative_dataset = representative_dataset
    
    # CRITICAL FALLBACK: Allow standard TF operations for complex BiLSTM RNN blocks
    converter.target_spec.supported_ops = [
        tf.lite.OpsSet.TFLITE_BUILTINS_INT8,
        tf.lite.OpsSet.TFLITE_BUILTINS,
        tf.lite.OpsSet.SELECT_TF_OPS
    ]
    
    converter.inference_input_type = tf.int8
    converter.inference_output_type = tf.int8
    
    tflite_model = converter.convert()
    with open(f"{filename}.tflite", 'wb') as f:
        f.write(tflite_model)
    print(f"[Success] Saved {filename}.tflite")


if __name__ == "__main__":
    print("--- Booting StepGuard AI Training Pipeline --- \n")
    
    if not os.path.exists(DATA_PATH):
        raise FileNotFoundError(f"Could not find {DATA_PATH}. Run dataset_generator.py first!")

    # 1. Load Data (Merging Global Medical Data + Your Personal Hardware Data)
    print("Loading Global Clinical Dataset...")
    df_global = pd.read_csv(DATA_PATH)
    
    print("Merging Your Personal Biometric Data...")
    try:
        df_user = pd.read_csv("clinical_datasets/manual_user_dataset.csv")
        df = pd.concat([df_global, df_user], ignore_index=True)
        print(f"✅ Success: Training on {len(df)} total physiological profiles.")
    except FileNotFoundError:
        print("⚠️ Warning: No personal data found. Proceeding with global baseline only.")
        df = df_global

    labels = df.pop('Label').values
    raw_data = df.values
    del df # [MEDIUM PRIORITY FIX] Immediately clear DataFrame from RAM to prevent OOM
    
    # 2. Data Standard Preprocessing (Domain 3.33)
    print("Applying RobustScaler...")
    scaler = RobustScaler()
    scaled_data = scaler.fit_transform(raw_data)
    X_processed = scaled_data.reshape(-1, WINDOW_SIZE, NUM_CHANNELS)
    del raw_data # Clear raw arrays to free up GPU buffers
    
    # [HIGH PRIORITY FIX] Prevents Step-Level Data Leakage by keeping time-series sequentially blocked
    X_train, X_test, y_train, y_test = train_test_split(X_processed, labels, test_size=0.2, shuffle=False)

    # 3. Training Callbacks (Anti-Overfitting)
    early_stop = callbacks.EarlyStopping(monitor='val_loss', patience=5, restore_best_weights=True)
    checkpoint = callbacks.ModelCheckpoint('stepguard_best_model.h5', monitor='val_accuracy', save_best_only=True)

    # 4. Train Primary CNN+BiLSTM Classifier
    print("\n--- Training Diagnostic CNN+BiLSTM ---")
    classifier = build_classifier_model()
    classifier.compile(optimizer='adam', loss='sparse_categorical_crossentropy', metrics=['accuracy'])
    
    classifier.fit(
        X_train, y_train,
        validation_data=(X_test, y_test),
        epochs=30,
        batch_size=16,
        callbacks=[early_stop, checkpoint]
    )

    # 5. TinyML Compile & Export
    print("\n--- Initiating TinyML Export ---")
    export_tflite(classifier, "stepguard_cnn_bilstm")
    
    print("\n[!] Pipeline Complete. Models saved locally.")
    print("[!] TinyML binary (.tflite) ready for C++ embedded deployment.")
