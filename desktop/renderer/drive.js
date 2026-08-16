(function () {
  'use strict';

  var root = window.WheelTecModules = window.WheelTecModules || {};

  root.Drive = {
    emptyTwist: function () {
      return { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };
    },
  };
})();
