#pragma once

// ═══════════════════════════════════════════════════════════════════════════════
// Fibott ESP32-S3 N16R8 CAM + OV3640 — Camera Pinout Definitions
// ═══════════════════════════════════════════════════════════════════════════════
// This header contains pin assignments for the ESP32-S3 N16R8 CAM and related
// ESP32-S3 camera development boards.
// ═══════════════════════════════════════════════════════════════════════════════

#if defined(CAMERA_MODEL_ESP32S3_CAM_N16R8) || defined(CAMERA_MODEL_ESP32S3_EYE) || defined(CAMERA_MODEL_FREENOVE_ESP32S3_CAM)
  #define PWDN_GPIO_NUM     -1
  #define RESET_GPIO_NUM    -1
  #define XCLK_GPIO_NUM     15
  #define SIOD_GPIO_NUM      4
  #define SIOC_GPIO_NUM      5

  #define Y9_GPIO_NUM       16  // D7
  #define Y8_GPIO_NUM       17  // D6
  #define Y7_GPIO_NUM       18  // D5
  #define Y6_GPIO_NUM       12  // D4
  #define Y5_GPIO_NUM       10  // D3
  #define Y4_GPIO_NUM        8  // D2
  #define Y3_GPIO_NUM        9  // D1
  #define Y2_GPIO_NUM       11  // D0

  #define VSYNC_GPIO_NUM     6
  #define HREF_GPIO_NUM      7
  #define PCLK_GPIO_NUM     13

  // Onboard Indicators / Flash
  #ifndef PIN_LED_FLASH
    #define PIN_LED_FLASH   48  // Onboard Flash / White LED (or -1 if external/none)
  #endif
  #ifndef PIN_LED_STATUS
    #define PIN_LED_STATUS   2  // Built-in status indicator LED (active HIGH on most S3 boards)
  #endif
  #ifndef LED_STATUS_ACTIVE_LOW
    #define LED_STATUS_ACTIVE_LOW false
  #endif

#elif defined(CAMERA_MODEL_XIAO_ESP32S3)
  #define PWDN_GPIO_NUM     -1
  #define RESET_GPIO_NUM    -1
  #define XCLK_GPIO_NUM     10
  #define SIOD_GPIO_NUM     40
  #define SIOC_GPIO_NUM     39

  #define Y9_GPIO_NUM       48
  #define Y8_GPIO_NUM       11
  #define Y7_GPIO_NUM       12
  #define Y6_GPIO_NUM       14
  #define Y5_GPIO_NUM       16
  #define Y4_GPIO_NUM       18
  #define Y3_GPIO_NUM       17
  #define Y2_GPIO_NUM       15

  #define VSYNC_GPIO_NUM    38
  #define HREF_GPIO_NUM     47
  #define PCLK_GPIO_NUM     13

  #ifndef PIN_LED_FLASH
    #define PIN_LED_FLASH   -1
  #endif
  #ifndef PIN_LED_STATUS
    #define PIN_LED_STATUS  21
  #endif
  #ifndef LED_STATUS_ACTIVE_LOW
    #define LED_STATUS_ACTIVE_LOW true
  #endif

#elif defined(CAMERA_MODEL_WAVESHARE_ESP32S3_CAM)
  #define PWDN_GPIO_NUM     -1
  #define RESET_GPIO_NUM    -1
  #define XCLK_GPIO_NUM     15
  #define SIOD_GPIO_NUM      4
  #define SIOC_GPIO_NUM      5

  #define Y9_GPIO_NUM       16
  #define Y8_GPIO_NUM       17
  #define Y7_GPIO_NUM       18
  #define Y6_GPIO_NUM       12
  #define Y5_GPIO_NUM       10
  #define Y4_GPIO_NUM        8
  #define Y3_GPIO_NUM        9
  #define Y2_GPIO_NUM       11

  #define VSYNC_GPIO_NUM     6
  #define HREF_GPIO_NUM      7
  #define PCLK_GPIO_NUM     13

  #ifndef PIN_LED_FLASH
    #define PIN_LED_FLASH   48
  #endif
  #ifndef PIN_LED_STATUS
    #define PIN_LED_STATUS  38
  #endif
  #ifndef LED_STATUS_ACTIVE_LOW
    #define LED_STATUS_ACTIVE_LOW false
  #endif

#elif defined(CAMERA_MODEL_CUSTOM)
  // Define custom pins here if your board has a specialized custom schematic
  #define PWDN_GPIO_NUM     -1
  #define RESET_GPIO_NUM    -1
  #define XCLK_GPIO_NUM     15
  #define SIOD_GPIO_NUM      4
  #define SIOC_GPIO_NUM      5

  #define Y9_GPIO_NUM       16
  #define Y8_GPIO_NUM       17
  #define Y7_GPIO_NUM       18
  #define Y6_GPIO_NUM       12
  #define Y5_GPIO_NUM       10
  #define Y4_GPIO_NUM        8
  #define Y3_GPIO_NUM        9
  #define Y2_GPIO_NUM       11

  #define VSYNC_GPIO_NUM     6
  #define HREF_GPIO_NUM      7
  #define PCLK_GPIO_NUM     13

  #ifndef PIN_LED_FLASH
    #define PIN_LED_FLASH   48
  #endif
  #ifndef PIN_LED_STATUS
    #define PIN_LED_STATUS   2
  #endif
  #ifndef LED_STATUS_ACTIVE_LOW
    #define LED_STATUS_ACTIVE_LOW false
  #endif

#else
  #error "Camera model not selected! Please define CAMERA_MODEL_ESP32S3_CAM_N16R8 in config.h"
#endif
