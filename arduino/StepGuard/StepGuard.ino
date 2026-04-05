#include <SPIFFS.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WiFiUdp.h>
#include <ArduinoOTA.h>

// --- Wi-Fi Credentials ---
const char* ssid = "Adorable Filter";
const char* password = "hitler123";

// --- Hardware Pins (XIAO ESP32-S3) ---
const int TENG_PIN = A0; 

// --- State & FreeRTOS ---
QueueHandle_t sensorQueue;
TaskHandle_t TaskSensorProcess;
TaskHandle_t TaskWiFiProcess;
hw_timer_t *ADC_Timer = NULL;
volatile bool clientConnected = false;

// HTTP Server on port 80
WiFiServer server(80);

// --- 1. Edge-Level Kalman Filter (Domain 2.18) ---
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

// --- 2. Hardware Timer ISR ---
void IRAM_ATTR onTimer() {
  vTaskNotifyGiveFromISR(TaskSensorProcess, NULL);
}

// --- Tasks ---

// Data Processing Task (Core 1)
void sensorProcessTask(void * pvParameters) {
  for(;;) {
    // Wait for the Hardware Timer to notify us (Exactly 200Hz)
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY); 

    int rawADC = analogRead(TENG_PIN);
    
    if (clientConnected) {
        // Size 1000 buffer (5 seconds of data) handles Wi-Fi retries easily
        xQueueSend(sensorQueue, &rawADC, 0); 
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
        }

        // Send SSE HTTP Headers
        activeClient.println("HTTP/1.1 200 OK");
        activeClient.println("Content-Type: text/event-stream");
        activeClient.println("Cache-Control: no-cache");
        activeClient.println("Connection: keep-alive");
        activeClient.println("Access-Control-Allow-Origin: *");
        activeClient.println();
        clientConnected = true;
        xQueueReset(sensorQueue); // Flush old data for the new dashboard client
        Serial.println("Dashboard connected to SSE Stream!");
      }
    } else {
      if (!activeClient.connected()) {
        clientConnected = false;
        activeClient.stop();
        Serial.println("Dashboard disconnected.");
      }
    }
    
    int receivedValue;
    if (xQueueReceive(sensorQueue, &receivedValue, pdMS_TO_TICKS(100)) == pdPASS) {
      if (clientConnected) {
        // Stream data over SSE
        if(activeClient.print("data: ") == 0) {
           // Print failed, socket died
           activeClient.stop();
           clientConnected = false; 
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
