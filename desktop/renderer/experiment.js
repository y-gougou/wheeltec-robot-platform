(function () {
  'use strict';

  var root = window.WheelTecModules = window.WheelTecModules || {};

  function faultMask(wheels) {
    var mask = 0;
    if (wheels && wheels.A) mask |= 1;
    if (wheels && wheels.B) mask |= 2;
    if (wheels && wheels.C) mask |= 4;
    return mask;
  }

  function chassisFaultMsg(enable, wheels, alpha) {
    alpha = alpha || {};
    return {
      layout: { dim: [{ size: 5, stride: 1 }], data_offset: 0 },
      data: [enable ? 1 : 0, faultMask(wheels), alpha.A == null ? 1 : alpha.A, alpha.B == null ? 1 : alpha.B, alpha.C == null ? 1 : alpha.C],
    };
  }

  function resetFaultConfig() {
    return {
      enable_fault: false,
      fault_type: 'normal',
      wheels: { A: false, B: false, C: false },
      alpha: { A: 1, B: 1, C: 1 },
    };
  }

  root.Experiment = {
    faultMask: faultMask,
    chassisFaultMsg: chassisFaultMsg,
    resetFaultConfig: resetFaultConfig,
  };
})();
