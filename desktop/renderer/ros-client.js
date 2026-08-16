(function () {
  'use strict';

  var root = window.WheelTecModules = window.WheelTecModules || {};

  function RosClient(options) {
    options = options || {};
    this.socket = null;
    this.handlers = {};
    this.state = 'offline';
    this.onStateChange = null;
    this.onMessage = null;
    this.onOpen = null;
    this._pending = {};
    this._rafId = null;
    this._msgCount = 0;
    this._log = options.log || function () {};
    this._translate = options.translate || function (key) { return key; };
    this._onDisconnect = options.onDisconnect || function () {};
  }

  RosClient.prototype.connect = function (ip) {
    var self = this;
    if (this.socket) { this.disconnect(); }

    this._setState('connecting');
    var url = 'ws://' + ip + ':9090';

    try {
      this.socket = new WebSocket(url);
    } catch (e) {
      this._setState('error');
      this._log('WebSocket error: ' + e.message, 'event-error');
      return;
    }

    this.socket.onopen = function () {
      self._setState('online');
      self._log(self._translate('connected') + ' -> ' + url, 'event-connected');
      Object.keys(self.handlers).forEach(function (topic) {
        self._sendSubscribe(topic, self.handlers[topic].type);
      });
      if (self.onOpen) self.onOpen();
    };

    this.socket.onclose = function () {
      // Preserve error state so failed connection attempts are visible
      if (self.state !== 'error') {
        self._setState('offline');
        self._log(self._translate('disconnected'), 'event-disconnected');
      }
      self.socket = null;
      self._stopRAF();
      self._onDisconnect();
    };

    this.socket.onerror = function () {
      self._setState('error');
      self._log(self._translate('connectFailed'), 'event-error');
    };

    this.socket.onmessage = function (event) {
      self._msgCount++;
      self._onRosMessage(event.data);
    };
  };

  RosClient.prototype.disconnect = function () {
    this._stopRAF();
    this._onDisconnect();
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
    this._setState('offline');
  };

  RosClient.prototype._setState = function (newState) {
    this.state = newState;
    if (this.onStateChange) this.onStateChange(newState);
  };

  RosClient.prototype._sendSubscribe = function (topic, type) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({
      op: 'subscribe',
      topic: topic,
      type: type,
      queue_length: 1,
    }));
  };

  RosClient.prototype._sendUnsubscribe = function (topic, type) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({
      op: 'unsubscribe',
      topic: topic,
      type: type,
    }));
  };

  RosClient.prototype.publish = function (topic, msg) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ op: 'publish', topic: topic, msg: msg }));
    return true;
  };

  RosClient.prototype.subscribe = function (topic, type, callback) {
    var self = this;
    this.handlers[topic] = { type: type, callback: callback };
    if (this.state === 'online') {
      this._sendSubscribe(topic, type);
    }
    return function () {
      delete self.handlers[topic];
      self._sendUnsubscribe(topic, type);
    };
  };

  RosClient.prototype.unsubscribe = function (topic) {
    var h = this.handlers[topic];
    if (h) {
      this._sendUnsubscribe(topic, h.type);
      delete this.handlers[topic];
    }
  };

  RosClient.prototype._onRosMessage = function (raw) {
    var self = this;
    try {
      var msg = JSON.parse(raw);
      if (msg.op !== 'publish') return;
      var h = this.handlers[msg.topic];
      if (!h) return;

      this._pending[msg.topic] = { msg: msg.msg, callback: h.callback };

      if (!this._rafId) {
        this._rafId = requestAnimationFrame(function () {
          self._rafId = null;
          var pending = self._pending;
          self._pending = {};
          Object.keys(pending).forEach(function (topic) {
            var p = pending[topic];
            p.callback(p.msg);
          });
          if (self.onMessage) self.onMessage();
        });
      }
    } catch (_) {}
  };

  RosClient.prototype._stopRAF = function () {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  };

  root.RosClient = RosClient;
})();
