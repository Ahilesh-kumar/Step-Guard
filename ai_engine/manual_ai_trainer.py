import pandas as pd
import numpy as np
import requests
import time
import os

# ---------------------------------------------------------
# StepGuard V4: Native Manual Hardware Trainer
# Records your live Wi-Fi Steps and splices them into PhysioNet ML datasets
# ---------------------------------------------------------

ESP32_IP = "10.67.89.47" # NOTE: Change this to the IP address shown in your Arduino Serial Monitor!
WIFI_URL = f"http://{ESP32_IP}/events"

WINDOW_SIZE = 300
USER_DATASET_PATH = "clinical_datasets/manual_user_dataset.csv"

# Hardware Flaw Fixes: Matches the Dashboard's mathematical amplifier
SOFTWARE_GAIN = 15.0  
IMPACT_THRESHOLD = 1700.0  

def record_physical_steps():
    print(f"\n--- STEPGUARD MANUAL AI TRAINER (Auto-Calibrating) ---")
    print(f"Connecting to ESP32 Wi-Fi Stream at {WIFI_URL}...")
    
    try:
        response = requests.get(WIFI_URL, stream=True, timeout=5)
    except requests.exceptions.RequestException:
        print(f"❌ ERROR: Cannot connect to {ESP32_IP}.")
        return


    print("⏳ CALIBRATING MAT NOISE... (Stay off the mat for 2s!)")
    calibration_samples = []
    
    # We take more samples over a slightly longer period for a stable baseline
    for line in response.iter_lines():
        if len(calibration_samples) >= 100: break 
        if line:
            decoded = line.decode('utf-8')
            if decoded.startswith("data:"):
                val = float(decoded.split("data:")[1].strip())
                calibration_samples.append(val * SOFTWARE_GAIN)
    
    baseline = np.mean(calibration_samples)
    noise_margin = 1000.0 # High margin for noisy hardware
    dynamic_threshold = baseline + noise_margin
    
    # Ensure directory exists
    os.makedirs(os.path.dirname(USER_DATASET_PATH), exist_ok=True)
    
    print(f"✅ Calibrated! Baseline: {baseline:.1f} | Threshold: {dynamic_threshold:.1f}")
    print("\nFOLLOW THESE INSTRUCTIONS:")
    print("1. Take ONE step. Wait for the 'Captured!' message.")
    print("2. Enter the Label. DO NOT step again until you see '--- AWAITING NEXT IMPACT ---'.")

    current_window = []
    is_recording = False
    hardware_dataset = []
    hardware_labels = []
    cooldown_until = 0

    try:
        for line in response.iter_lines():
            if line:
                decoded_line = line.decode('utf-8')
                if not decoded_line.startswith("data:"): continue
                
                try:
                    raw_voltage = float(decoded_line.split("data:")[1].strip())
                    boosted_voltage = min(4095.0, raw_voltage * SOFTWARE_GAIN)
                    
                    # Prevent phantom triggers if we just finished a step
                    if time.time() < cooldown_until: continue

                    if not is_recording and boosted_voltage > dynamic_threshold:
                        print(f"\n⚡ IMPACT! ({boosted_voltage:.1f}mV) Recording...")
                        is_recording = True
                        current_window = []
                        
                    if is_recording:
                        current_window.append(boosted_voltage)
                        if len(current_window) >= WINDOW_SIZE:
                            print(f"✅ Step Captured!")
                            
                            # Pause to prompt
                            print("\nLabel: [0] Normal | [1] Shuffle | [2] Fall | [D] Discard")
                            choice = input("Enter choice: ").strip().lower()
                            
                            if choice in ['0', '1', '2']:
                                hardware_dataset.append(current_window)
                                hardware_labels.append(int(choice))
                                print(f"-> SAVED. Total Recorded: {len(hardware_dataset)}")
                            else:
                                print("-> Discarded.")
                            
                            is_recording = False
                            current_window = []
                            cooldown_until = time.time() + 1.5 # 1.5 second "Safe zone"
                            print("\n--- AWAITING NEXT IMPACT ---")
                            
                except ValueError: continue
    
    except KeyboardInterrupt:
        print("\n\n--- RECORDING SESSION ENDED ---")
        if len(hardware_dataset) > 0:
            print(f"Injecting {len(hardware_dataset)} unique physiological records into the Medical Database...")
            
            # Format to perfectly match PhysioNet CSV dimensions
            df_new = pd.DataFrame(hardware_dataset)
            df_new['Label'] = hardware_labels
            
            # Append data blindly to the user dataset
            if not os.path.exists(USER_DATASET_PATH):
                # Write with headers if new
                df_new.to_csv(USER_DATASET_PATH, mode='w', header=True, index=False)
            else:
                df_new.to_csv(USER_DATASET_PATH, mode='a', header=False, index=False)
                
            print(f"✅ Success! Your specific biometric profile is securely isolated in {USER_DATASET_PATH}.")
            print("You can now securely run the Clinical & Security ML Compilers!")
        else:
            print("No new steps recorded. System ready for next session.")

if __name__ == "__main__":
    record_physical_steps()
