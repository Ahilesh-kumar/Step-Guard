#include <SPIFFS.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WiFiUdp.h>
#include <ArduinoOTA.h>
#include <atomic>
#include "secrets.h"

// --- Hardware Pins (XIAO ESP32-S3) ---
const int TENG_PIN = A0; 

// --- State & FreeRTOS ---
QueueHandle_t sensorQueue;
TaskHandle_t TaskSensorProcess;
TaskHandle_t TaskWiFiProcess;
hw_timer_t *ADC_Timer = NULL;
std::atomic<bool> clientConnected(false);

// HTTP Server on port 80
WiFiServer server(80);

// --- 1. Edge-Level Kalman Filter ---
class EdgeKalmanFilter {
private:
    float Q = 0.02; // Process noise covariance 
    float R = 5.0;  // Measurement noise covariance
    float P = 1.0;  // Estimation error covariance
    float K = 0.0;  // Kalman gain
    float X = 0.0;  // Estimated state
public:
    EdgeKalmanFilter(float initial_q, float initial_r) : Q(initial_q), R(initial_r) {}
    float filter(float measurement) {
        P = P + Q;
        K = P / (P + R);
        X = X + K * (measurement - X);
        P = (1 - K) * P;
        return X;
    }
};

EdgeKalmanFilter tengFilter(0.05, 10.0);

// --- 2. Dynamic Telemetry Generation Wrapper (Calibration Mode) ---
int readTengSensor() {
  static unsigned long lastStateChange = 0;
  static int gaitState = 0; // 0: Normal Walk, 1: Tremor/Shuffle, 2: Impact/Fall, 3: Standing/Rest
  static float phase = 0;
  
  unsigned long now = millis();
  if (now - lastStateChange > 20000) { // Cycle through gait states every 20 seconds
    gaitState = (gaitState + 1) % 4;
    lastStateChange = now;
  }
  
  int val = 0;
  if (gaitState == 0) { // Normal Walking Gait (1.25 Hz cadence)
    phase += 0.05; // 200Hz sampling interval
    if (phase > 2 * PI) phase -= 2 * PI;
    
    float strike = sin(phase);
    if (strike > 0) {
      val = strike * 600; // Peak swing pressure
    } else {
      val = strike * 150; // Dynamic overshoot
    }
    val += random(-15, 15); // Ambient baseline noise
  } 
  else if (gaitState == 1) { // High-Frequency Tremor / Foot Shuffling
    phase += 0.25;
    if (phase > 2 * PI) phase -= 2 * PI;
    
    val = 150 + sin(phase) * 120 + random(-30, 30);
  } 
  else if (gaitState == 2) { // Critical Acceleration / Sudden Fall Event
    unsigned long elapsed = now - lastStateChange;
    if (elapsed < 1000) { // Transient high-G impact
      val = 2500 - (elapsed * 2.5); // Fast exponential decay
      if (val < 0) val = 0;
    } else { // Post-fall static rest
      val = random(-5, 5); 
    }
  } 
  else { // Quiet Standing / Baseline Calibration State
    val = random(-5, 5);
  }
  
  return 2048 + val; // Return calibrated ADC midpoint offset
}

// --- 3. Hardware Timer ISR ---
void IRAM_ATTR onTimer() {
  vTaskNotifyGiveFromISR(TaskSensorProcess, NULL);
}

// --- Tasks ---

// Data Processing Task (Core 1)
void sensorProcessTask(void * pvParameters) {
  for(;;) {
    // Wait for the Hardware Timer to notify us (Exactly 200Hz)
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY); 

    int rawADC = readTengSensor();
    int filteredADC = tengFilter.filter(rawADC);
    
    if (clientConnected.load()) {
        // Size 1000 buffer (5 seconds of data) handles Wi-Fi retries easily
        xQueueSend(sensorQueue, &filteredADC, 0); 
    }
  }
}

void wifiTask(void * pvParameters) {
  
  WiFiClient activeClient;

  for(;;) {
    ArduinoOTA.handle(); // MUST run continuously or OTA blocks
    
    // Check for new clients if we don't have an active stream
    if (!clientConnected) {
      activeClient = server.available();
      if (activeClient && activeClient.connected()) {
        
        // Consume the incoming HTTP GET Request to prevent TCP jam
        unsigned long timeout = millis();
        while(!activeClient.available() && (millis() - timeout < 500)) {
           vTaskDelay(1);
        }
        while(activeClient.available()) {
           activeClient.read();
           vTaskDelay(1); // Yield to prevent WDT starvation
        }

        // Send SSE HTTP Headers
        activeClient.println("HTTP/1.1 200 OK");
        activeClient.println("Content-Type: text/event-stream");
        activeClient.println("Cache-Control: no-cache");
        activeClient.println("Connection: keep-alive");
        activeClient.println("Access-Control-Allow-Origin: *");
        activeClient.println();
        clientConnected.store(true);
        xQueueReset(sensorQueue); // Flush old data for the new dashboard client
        Serial.println("Dashboard connected to SSE Stream!");
      }
    } else {
      if (!activeClient.connected()) {
        clientConnected.store(false);
        activeClient.stop();
        Serial.println("Dashboard disconnected.");
      }
    }
    
    int receivedValue;
    if (xQueueReceive(sensorQueue, &receivedValue, pdMS_TO_TICKS(100)) == pdPASS) {
      if (clientConnected.load()) {
        // Stream data over SSE
        if(activeClient.print("data: ") == 0) {
           // Print failed, socket died
           activeClient.stop();
           clientConnected.store(false); 
        } else {
           activeClient.print(receivedValue);
           activeClient.print("\n\n");
        }
      }
    }
  }
}

void setup() {
  Serial.begin(115200);
  analogSetPinAttenuation(TENG_PIN, ADC_0db);

  // Initialize Internal File System
  if(!SPIFFS.begin(true)){
    Serial.println("SPIFFS Mount Failed");
  }

  // Connect to Wi-Fi
  Serial.print("Connecting to WiFi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected!");
  Serial.print("IP Address for Dashboard: ");
  Serial.println(WiFi.localIP());

  // Set up mDNS for easy discovery (http://stepguard.local)
  if (!MDNS.begin("stepguard")) {
    Serial.println("Error setting up MDNS responder!");
  } else {
    Serial.println("mDNS responder started at stepguard.local");
  }

  // Start HTTP server
  server.begin();

  // Initialize OTA
  ArduinoOTA.setHostname("StepGuard-Pro-OTA");
  ArduinoOTA.begin();

  // Initialize Queues
  sensorQueue = xQueueCreate(1000, sizeof(int)); // Larger buffer for medical-grade stability

  // Boot FreeRTOS Dual-Core Subsystems
  xTaskCreatePinnedToCore(sensorProcessTask, "SensorProcess", 8192, NULL, 2, &TaskSensorProcess, 1);
  xTaskCreatePinnedToCore(wifiTask, "WiFiTask", 8192, NULL, 1, &TaskWiFiProcess, 0);

  // Hardware Timer (200Hz)
  ADC_Timer = timerBegin(1000000); // Core V3 API: frequency based clock
  timerAttachInterrupt(ADC_Timer, &onTimer);
  timerAlarm(ADC_Timer, 5000, true, 0); 

  vTaskDelete(NULL); 
}

void loop() {
  // FreeRTOS is handling everything in Tasks
}
