(function () {
  'use strict';

  var root = window.WheelTecModules = window.WheelTecModules || {};

  root.TOPICS = {
    CMD_VEL_WEB: '/cmd_vel_web',
    HEARTBEAT: '/web/heartbeat',
    ESTOP: '/web/estop',
    CRUISE_CMD: '/web/cruise_cmd',
    CRUISE_ENABLE: '/web/cruise_enable',
    CRUISE_STATUS: '/web/cruise_status',
    ODOM: '/odom',
    VOLTAGE: '/PowerVoltage',
    CURRENT_DATA: '/current_data',
    WHEEL_SPEED: '/wheel_speed',
    HEADING_DEG: '/chassis/heading_deg',
    HEADING_STATUS: '/web/heading_status',
    HEADING_ZERO: '/web/heading_zero',
    TARGET_ANGLE: '/target_angle',
    CONTROL_STATUS: '/web/control_status',
    COLLECTION_STATUS: '/web/collection_status',
    COLLECTION_CONFIG: '/web/collection_config',
    COLLECTION_ENABLE: '/web/collection_enable',
    CURRENT_READER_STATUS: '/web/current_reader_status',
    CURRENT_READER_CONFIG: '/web/current_reader_config',
    FAULT_STATUS: '/web/fault_injection_status',
    FAULT_CONFIG_WEB: '/web/fault_injection_config',
    FAULT_CONFIG_CHASSIS: '/chassis/fault_config',
  };
})();
