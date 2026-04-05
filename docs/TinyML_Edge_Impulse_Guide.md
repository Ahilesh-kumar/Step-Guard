# StepGuard TinyML Guide: Edge Impulse Training (Clinical Grade)

This guide walks you through the process of utilizing the collected CSV data to train a lightweight Neural Network and an Anomaly Detection model for detecting neurodegenerative walking patterns and sudden outliers (falls/freezing).

## Step 1: Data Collection

1.  Flash `StepGuard.ino` to your ESP32.
2.  Connect your ESP32 to your PC via USB and ensure the Serial Monitor in Arduino IDE is **closed**.
3.  Open a terminal and navigate to the `tools` directory.
4.  Run the python script:
    ```bash
    pip install pyserial
    python data_logger.py --port COM3 --label normal
    ```
    *(Replace `COM3` with your actual port).*
5.  **Follow the Metronome:** The terminal will flash and beep every 1.5 seconds. Sync your steps exactly to this rhythm to ensure high-quality, rhythmically tight datasets. Do this for `--label normal` and `--label shuffling`.
6.  For `--label tremor`, stand still with foot vibrating slightly (No metronome required).
7.  You should now have multiple `.csv` files.

## Step 2: Uploading to Edge Impulse

1.  Create a free account at [edgeimpulse.com](https://edgeimpulse.com/) and create a new project called **StepGuard**.
2.  Go to **Data Acquisition** -> **Upload existing data**.
3.  Select your generated CSV files.
4.  Wait for the data to process. Use the train/test split option to automatically divide your data (usually 80/20).

## Step 3: Designing the Impulse (with Anomaly Detection)

1.  Navigate to **Impulse Design** -> **Create Impulse**.
2.  **Time Series Data:** Set the Window Size to **3000ms** (3 seconds) and the Window Increase to **500ms**. A 3-second window at a 1.5s metronome pace guarantees capturing exactly two steps per window.
3.  **Processing Block:** Add a **Spectral Analysis** block. This converts AC waveforms into frequency power domains, perfect for the TENG.
4.  **Learning Block (Primary):** Add a **Classification (Keras)** block. This maps the spectral features to [Normal, Shuffling, Tremor].
5.  **Learning Block (Anomaly):** Add an **Anomaly Detection (K-Means)** block. This runs in parallel to catch entirely unseen data (e.g., sudden trips, sensor disconnects, drops).
6.  Save the Impulse.

## Step 4: Feature Generation & K-Means Config

1.  Click on **Spectral Analysis** in the left menu. Generate Features.
2.  Click on **Classifier**. Set Training cycles to 50, Learning Rate to 0.005. Train the model.
3.  **Anomaly Detection Configuration:**
    - Navigate to **Anomaly Detection** in the left menu.
    - Important: Select the crucial axes. For Spectral Analysis, rely heavily on the lower-frequency buckets and the RMS (Root Mean Square) energy of the signal.
    - Set the number of clusters to 32.
    - Click **Start Training**. The K-Means algorithm will draw boundary bubbles around your known classes. Anything outside these bubbles is flagged as an anomaly.

## Step 5: Deployment

1.  Go to the **Deployment** tab.
2.  Search for **Arduino library**.
3.  Choose the **Unoptimized (float32)** version.
4.  Click **Build**. Install the downloaded `.ZIP` library into your Arduino IDE.
5.  To integrate it with the ESP32 code, include the AI inference loop and modify the BLE Service to transmit the inference result alongside the raw data.
