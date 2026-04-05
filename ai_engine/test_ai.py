import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.preprocessing import RobustScaler

# ---------------------------------------------------------
# StepGuard V4: Inference Tester
# Tests if the trained AI accurately predicts Gait status.
# ---------------------------------------------------------

WINDOW_SIZE = 300
NUM_CHANNELS = 1
DATA_PATH = "clinical_datasets/master_clinical_dataset.csv"
MODEL_PATH = "stepguard_best_model.h5"

print("--- StepGuard AI Diagnostic Tester --- \n")

# 1. Load the trained H5 model
print(f"Loading weights from {MODEL_PATH}...")
try:
    model = tf.keras.models.load_model(MODEL_PATH)
except Exception as e:
    print(f"[ERROR] Could not load model: {e}")
    exit()

# 2. Recreate the Scaler bounds (since we didn't save it)
df = pd.read_csv(DATA_PATH)
labels = df.pop('Label').values
raw_data = df.values

scaler = RobustScaler()
scaler.fit(raw_data) # Rebuild the scaling bounds

# 3. Pull one specific example of each class to test
class_names = ["Normal Heel-Strike Walk", "FoG / Shuffling", "Catastrophic Fall"]

test_indices = {
    0: np.where(labels == 0)[0][0], # First instance of Normal
    1: np.where(labels == 1)[0][0], # First instance of Shuffle
    2: np.where(labels == 2)[0][0]  # First instance of Fall
}

print("\n--- Running AI Inference ---")

for true_class_idx, row_idx in test_indices.items():
    # Extract the raw 300ms window
    raw_window = raw_data[row_idx].reshape(1, -1)
    
    # Scale it exactly like we did in training
    scaled_window = scaler.transform(raw_window)
    
    # Reshape for Neural Network (1 sample, 300 steps, 1 channel)
    nn_input = scaled_window.reshape(1, WINDOW_SIZE, NUM_CHANNELS)
    
    # Run Prediction! (softmax outputs an array of 3 percentages)
    prediction_array = model.predict(nn_input, verbose=0)[0]
    
    # Find the highest percentage
    predicted_class_idx = np.argmax(prediction_array)
    confidence = prediction_array[predicted_class_idx] * 100
    
    print(f"\n[Truth]: This dataset row is physically a {class_names[true_class_idx]}")
    print(f"[AI Diagnostics]: Detected {class_names[predicted_class_idx]} with {confidence:.2f}% Confidence.")
    
    if true_class_idx == predicted_class_idx:
        print(" -> Output: ✅ PERFECT MATCH")
    else:
        print(" -> Output: ❌ ERROR")
