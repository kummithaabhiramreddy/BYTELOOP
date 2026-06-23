#include <WiFi.h>
#include <HTTPClient.h>

// Wi-Fi Credentials
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Backend API URL (Update with your local network IP of the Node.js server)
const char* serverName = "http://192.168.1.100:3000/api/usage";

// We simulate this ESP32 device belonging to User 1
const int userId = 1;

void setup() {
  Serial.begin(115200);

  WiFi.begin(ssid, password);
  Serial.println("Connecting to WiFi...");
  while(WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("");
  Serial.print("Connected to WiFi network with IP Address: ");
  Serial.println(WiFi.localIP());

  Serial.println("Internet Data Saver IoT Device Ready.");
}

void loop() {
  // Check WiFi connection status
  if(WiFi.status() == WL_CONNECTED){
    HTTPClient http;
    
    // Connect to the API
    http.begin(serverName);
    http.addHeader("Content-Type", "application/json");
    
    // Simulate data usage reading (e.g., from a SIM7600 or counting bytes)
    // For this example, we randomly consume between 0.1 to 1.5 GB
    float simulatedDataUsed = random(1, 15) / 10.0;
    
    // Prepare JSON payload
    String httpRequestData = "{\"userId\":" + String(userId) + ",\"dataUsed\":" + String(simulatedDataUsed) + "}";           
    Serial.print("Sending POST: ");
    Serial.println(httpRequestData);
    
    // Send HTTP POST request
    int httpResponseCode = http.POST(httpRequestData);
     
    if (httpResponseCode > 0) {
      Serial.print("HTTP Response code: ");
      Serial.println(httpResponseCode);
      String payload = http.getString();
      Serial.println("Response Payload: " + payload);
    }
    else {
      Serial.print("Error code: ");
      Serial.println(httpResponseCode);
    }
    // Free resources
    http.end();
  }
  else {
    Serial.println("WiFi Disconnected");
  }
  
  // Wait for 10 seconds before sending the next telemetry ping
  // In a real device, this might be once an hour or day
  delay(10000);
}
