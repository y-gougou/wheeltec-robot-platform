(function () {
  'use strict';

  var root = window.WheelTecModules = window.WheelTecModules || {};

  function TimeSeriesChart(canvas, seriesConfig, maxSeconds, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.series = seriesConfig;
    this.maxSeconds = maxSeconds || 60;
    this.options = options || {};
    this.buffers = seriesConfig.map(function () { return []; });
    this.maxPoints = this.options.maxPoints || 600;
    this.minDrawIntervalMs = this.options.minDrawIntervalMs || 120;
    this._visible = true;
    this.hover = null;
    this._lastPlot = null;
    this._lastDrawAt = 0;
    this._pendingDrawTimer = null;
    this.bindHoverEvents();
  }

  TimeSeriesChart.prototype.bindHoverEvents = function () {
    var self = this;
    this.canvas.addEventListener('mousemove', function (event) {
      var rect = self.canvas.getBoundingClientRect();
      self.hover = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      self.scheduleDraw();
    });
    this.canvas.addEventListener('mouseleave', function () {
      self.hover = null;
      self.scheduleDraw();
    });
  };

  TimeSeriesChart.prototype.push = function (values) {
    var self = this;
    var now = performance.now() / 1000;
    var cutoff = now - self.maxSeconds;
    this.buffers.forEach(function (buf, i) {
      buf.push({ t: now, v: values[i] });
      while (buf.length > 0 && buf[0].t < cutoff) buf.shift();
      if (buf.length > self.maxPoints) {
        buf.splice(0, buf.length - self.maxPoints);
      }
    });
    this.scheduleDraw();
  };

  TimeSeriesChart.prototype.scheduleDraw = function () {
    var self = this;
    if (!this._visible || this._drawScheduled) return;
    var elapsed = performance.now() - this._lastDrawAt;
    if (elapsed < this.minDrawIntervalMs) {
      if (!this._pendingDrawTimer) {
        this._pendingDrawTimer = setTimeout(function () {
          self._pendingDrawTimer = null;
          self.scheduleDraw();
        }, this.minDrawIntervalMs - elapsed);
      }
      return;
    }
    this._drawScheduled = true;
    requestAnimationFrame(function () {
      self._drawScheduled = false;
      self._lastDrawAt = performance.now();
      self.draw();
    });
  };

  TimeSeriesChart.prototype.visiblePoints = function (buf, xOf, pixelWidth) {
    var out = [];
    var lastPixel = -Infinity;
    var minPoint = null;
    var maxPoint = null;
    function flushBucket() {
      if (!minPoint) return;
      if (minPoint === maxPoint) {
        out.push(minPoint);
      } else if (minPoint.t <= maxPoint.t) {
        out.push(minPoint, maxPoint);
      } else {
        out.push(maxPoint, minPoint);
      }
      minPoint = null;
      maxPoint = null;
    }
    for (var i = 0; i < buf.length; i++) {
      var p = buf[i];
      if (p.v == null || !isFinite(p.v)) continue;
      var pixel = Math.floor(xOf(p.t));
      if (pixel !== lastPixel || out.length > pixelWidth * 2) {
        flushBucket();
        lastPixel = pixel;
      }
      if (!minPoint || p.v < minPoint.v) minPoint = p;
      if (!maxPoint || p.v > maxPoint.v) maxPoint = p;
    }
    flushBucket();
    return out;
  };

  TimeSeriesChart.prototype.syncCanvasSize = function () {
    var dpr = window.devicePixelRatio || 1;
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.round(rect.width);
    var h = Math.round(rect.height);
    if (w <= 0 || h <= 0) return null;

    var pixelW = Math.max(1, Math.round(w * dpr));
    var pixelH = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pixelW || this.canvas.height !== pixelH) {
      this.canvas.width = pixelW;
      this.canvas.height = pixelH;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: w, height: h };
  };

  TimeSeriesChart.prototype.draw = function () {
    var ctx = this.ctx;
    var size = this.syncCanvasSize();
    var w = size ? size.width : (this.canvas.clientWidth || this.canvas.width);
    var h = size ? size.height : (this.canvas.clientHeight || this.canvas.height);
    if (w <= 0 || h <= 0) return;

    var style = getComputedStyle(document.documentElement);
    var bg = style.getPropertyValue('--chart-bg').trim() || '#1a1a1a';
    var grid = style.getPropertyValue('--chart-grid').trim() || '#333';
    var textColor = style.getPropertyValue('--text-secondary').trim() || '#858585';

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    var now = performance.now() / 1000;
    var cutoff = now - this.maxSeconds;
    var firstT = Infinity;

    var allValues = [];
    this.buffers.forEach(function (buf) {
      buf.forEach(function (p) {
        if (p.t < cutoff) return;
        allValues.push(p.v);
        if (p.t < firstT) firstT = p.t;
      });
    });

    var yMin = Infinity, yMax = -Infinity;
    allValues.forEach(function (v) {
      if (v != null && isFinite(v)) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    });
    var hasData = isFinite(yMin);
    if (!hasData) { yMin = -1; yMax = 1; }
    var yPad = (yMax - yMin) * 0.1 || 0.2;
    yMin -= yPad; yMax += yPad;

    var padding = { top: 10, right: 12, bottom: 22, left: 50 };
    var pw = w - padding.left - padding.right;
    var ph = h - padding.top - padding.bottom;
    var xStart = isFinite(firstT) ? Math.max(cutoff, firstT) : cutoff;
    if (now - xStart < 1) xStart = now - 1;
    this._lastPlot = { now: now, xStart: xStart, yMin: yMin, yMax: yMax, padding: padding, pw: pw, ph: ph, w: w, h: h };

    function xOf(t) { return padding.left + ((t - xStart) / (now - xStart)) * pw; }
    function yOf(v) { return padding.top + ph - ((v - yMin) / (yMax - yMin)) * ph; }

    ctx.strokeStyle = grid;
    ctx.lineWidth = 0.5;
    var yTicks = 5;
    for (var i = 0; i <= yTicks; i++) {
      var y = padding.top + (ph / yTicks) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, Math.round(y) + 0.5);
      ctx.lineTo(w - padding.right, Math.round(y) + 0.5);
      ctx.stroke();
      var label = (yMax - (yMax - yMin) * (i / yTicks)).toFixed(1);
      ctx.fillStyle = textColor;
      ctx.font = '10px ' + style.getPropertyValue('--font-mono');
      ctx.textAlign = 'right';
      ctx.fillText(label, padding.left - 4, y + 4);
    }

    ctx.fillStyle = textColor;
    ctx.font = '10px ' + style.getPropertyValue('--font-mono');
    ctx.textAlign = 'center';
    var tickStep = (now - xStart) <= 15 ? 5 : 10;
    for (var s = Math.ceil(xStart / tickStep) * tickStep; s <= now; s += tickStep) {
      var x = xOf(s);
      ctx.fillText('-' + Math.round(now - s) + 's', x, h - 4);
    }

    if (!hasData) {
      ctx.fillStyle = textColor;
      ctx.font = '12px ' + style.getPropertyValue('--font-mono');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var emptyText = typeof this.options.emptyText === 'function' ? this.options.emptyText() : this.options.emptyText;
      ctx.fillText(emptyText || 'No data', padding.left + pw / 2, padding.top + ph / 2);
      ctx.textBaseline = 'alphabetic';
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(padding.left, padding.top, pw, ph);
    ctx.clip();

    var self = this;
    this.series.forEach(function (cfg, idx) {
      var buf = self.buffers[idx];
      if (buf.length < 2) return;
      var points = self.visiblePoints(buf, xOf, Math.max(1, Math.floor(pw)));
      if (points.length < 2) return;
      ctx.strokeStyle = cfg.color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      var first = true;
      points.forEach(function (p) {
        var px = xOf(p.t), py = yOf(p.v);
        if (first) { ctx.moveTo(px, py); first = false; }
        else { ctx.lineTo(px, py); }
      });
      ctx.stroke();
    });

    ctx.restore();
    this.drawHover(ctx, style, xOf, yOf);
  };

  TimeSeriesChart.prototype.findNearestPoint = function (buf, targetT) {
    var best = null;
    var bestDistance = Infinity;
    for (var i = 0; i < buf.length; i++) {
      var p = buf[i];
      if (p.v == null || !isFinite(p.v)) continue;
      var distance = Math.abs(p.t - targetT);
      if (distance < bestDistance) {
        best = p;
        bestDistance = distance;
      }
    }
    return best;
  };

  TimeSeriesChart.prototype.formatValue = function (value) {
    if (value == null || !isFinite(value)) return '--';
    var abs = Math.abs(value);
    if (abs >= 100) return value.toFixed(1);
    if (abs >= 10) return value.toFixed(2);
    return value.toFixed(3);
  };

  TimeSeriesChart.prototype.drawHover = function (ctx, style, xOf, yOf) {
    if (!this.hover || !this._lastPlot) return;
    var plot = this._lastPlot;
    var padding = plot.padding;
    var hoverX = Math.max(padding.left, Math.min(plot.w - padding.right, this.hover.x));
    if (this.hover.y < padding.top || this.hover.y > padding.top + plot.ph) return;

    var ratio = (hoverX - padding.left) / plot.pw;
    var targetT = plot.xStart + ratio * (plot.now - plot.xStart);
    var rows = [];
    var nearestX = hoverX;
    var self = this;
    this.series.forEach(function (cfg, idx) {
      var point = self.findNearestPoint(self.buffers[idx], targetT);
      if (!point) return;
      nearestX = xOf(point.t);
      rows.push({ label: cfg.label, color: cfg.color, value: point.v, y: yOf(point.v), t: point.t });
    });
    if (!rows.length) return;

    var textColor = style.getPropertyValue('--text').trim() || '#cccccc';
    var mutedColor = style.getPropertyValue('--text-secondary').trim() || '#858585';
    var panelBg = style.getPropertyValue('--panel-bg').trim() || '#252526';
    var borderColor = style.getPropertyValue('--panel-border').trim() || '#333333';
    var mono = style.getPropertyValue('--font-mono').trim() || 'monospace';

    ctx.save();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(Math.round(nearestX) + 0.5, padding.top);
    ctx.lineTo(Math.round(nearestX) + 0.5, padding.top + plot.ph);
    ctx.stroke();
    ctx.setLineDash([]);

    rows.forEach(function (row) {
      ctx.fillStyle = row.color;
      ctx.strokeStyle = panelBg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(nearestX, row.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    var tooltipW = 128;
    var tooltipH = 22 + rows.length * 18;
    var tooltipX = nearestX + 12;
    if (tooltipX + tooltipW > plot.w - 6) tooltipX = nearestX - tooltipW - 12;
    tooltipX = Math.max(6, tooltipX);
    var tooltipY = Math.max(6, Math.min(plot.h - tooltipH - 6, this.hover.y - tooltipH / 2));

    ctx.fillStyle = panelBg;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    roundedRect(ctx, tooltipX, tooltipY, tooltipW, tooltipH, 4);
    ctx.fill();
    ctx.stroke();

    ctx.font = '11px ' + mono;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = mutedColor;
    var timeLabel = '-' + Math.max(0, plot.now - targetT).toFixed(1) + 's';
    ctx.fillText(timeLabel, tooltipX + 10, tooltipY + 13);
    rows.forEach(function (row, idx) {
      var y = tooltipY + 32 + idx * 18;
      ctx.fillStyle = row.color;
      ctx.beginPath();
      ctx.arc(tooltipX + 12, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = textColor;
      ctx.fillText(row.label + '  ' + self.formatValue(row.value), tooltipX + 22, y);
    });
    ctx.restore();
  };

  function roundedRect(ctx, x, y, width, height, radius) {
    var r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  TimeSeriesChart.prototype.resize = function () {
    this.draw();
  };

  TimeSeriesChart.prototype.setVisible = function (v) {
    this._visible = v;
    if (v) this.draw();
  };

  root.TimeSeriesChart = TimeSeriesChart;
})();
