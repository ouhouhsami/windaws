'use strict';

var _Map = require('babel-runtime/core-js/map')['default'];

var d3 = require('d3');
var wavesControllers = require('waves-basic-controllers');
wavesControllers.setTheme('dark');
var wavesAudio = require('waves-audio');
var wavesLoaders = require('waves-loaders');
// core
var ns = require('waves-ui/dist/core/namespace');
var Timeline = require('waves-ui/dist/core/timeline');
var TimeContext = require('waves-ui/dist/core/time-context');
var Layer = require('waves-ui/dist/core/layer');
// interactions
var Event = require('waves-ui/dist/interactions/event');
var Surface = require('waves-ui/dist/interactions/surface');
var Keyboard = require('waves-ui/dist/interactions/keyboard');
// shapes
var Waveform = require('waves-ui/dist/shapes/waveform');
var Cursor = require('waves-ui/dist/shapes/cursor');
// timeline states
var BaseState = require('waves-ui/dist/timeline-states/base-state');
var SelectionState = require('waves-ui/dist/timeline-states/selection-state');
var EditionState = require('waves-ui/dist/timeline-states/edition-state');
var ContextEditionState = require('waves-ui/dist/timeline-states/context-edition-state');

// -----------------------------------------------------
// APPLICATION
// -----------------------------------------------------

var session = require('../assets/json/session.json');
// load all files
var filesSrc = './assets/sound/';
var loader = new wavesLoaders.AudioBufferLoader();
var files = [];

var width = window.innerWidth;
var height = window.innerHeight;

// dev only
//session = session.slice(0, 2);
//height = height / 3;
// populate files
session.forEach(function (track, index) {
  track.period.forEach(function (sample) {
    var file = filesSrc + sample.file;
    files.push(file);
  });
});

loader.load(files).then(function (buffers) {
  App.initialize(session);
  App.populateSession(buffers);

  App.initAudio();

  App.createAudioTracks();
  App.createCursorTrack();

  App.addTestControllers();

  App.renderTimeline();
})['catch'](function (err) {
  console.log(err.stack);
});

// application
var App = {
  initialize: function initialize(session) {
    this.session = session;
    this.globals = { currentTime: 0, duration: 60 * 2 };
    this.layerEngineMap = new _Map();

    this.timeline = new Timeline({
      duration: this.globals.duration,
      width: 800
    });

    this.$container = document.querySelector('#session-container');
    // init default state
    var selectionState = new SelectionState(this.timeline);
    var contextEditionState = new ContextEditionState(this.timeline);

    this.timeline.setState(contextEditionState);
    this.timeline.on('update', this.onTimelineUpdate.bind(this));
  },

  addTestControllers: function addTestControllers() {
    var _this = this;

    var rAFId = null;
    var that = this;

    new wavesControllers.Buttons('transport', ['start', 'stop'], '#controls', function (value) {
      switch (value) {
        case 'start':
          _this.playControl.start();

          (function loop() {
            // console.log(that.transport.currentPosition);
            that.globals.currentTime = that.transport.currentPosition;
            that.timeline.update('cursor');

            rAFId = requestAnimationFrame(loop);
          })();
          break;
        case 'stop':
          _this.playControl.stop();
          cancelAnimationFrame(rAFId);
          _this.globals.currentTime = _this.transport.currentPosition;
          break;
      }
    });

    new wavesControllers.Slider('timeline stretchRatio', 0.1, 100, 0.1, 1, '', '', '#controls', function (value) {
      _this.timeline.context.stretchRatio = value;
      _this.timeline.update();
    });

    new wavesControllers.Slider('timeline translation', -this.globals.duration, this.globals.duration, 1, 0, '', '', '#controls', function (value) {
      _this.timeline.context.offset = value;
      _this.timeline.updateContainers();
    });

    new wavesControllers.Slider('waveform zoom y', 0.1, 10, 0.1, 1, '', '', '#controls', function (value) {
      var yDomain = [-1 / value, 1 / value];
      _this.timeline.layers.forEach(function (layer) {
        layer.yDomain = yDomain;
        _this.timeline.update(layer);
      });
    });
  },

  initAudio: function initAudio() {
    this.audioContext = wavesAudio.audioContext;
    this.transport = new wavesAudio.Transport();
    this.playControl = new wavesAudio.PlayControl(this.transport);
    this.playerEngines = {};
  },
  // add the buffers into the session configuration
  populateSession: function populateSession(buffers) {
    var index = 0;

    this.session.forEach(function (track) {
      track.period.forEach(function (sample) {
        sample.buffer = buffers[index];
        index += 1;
      });
    });
  },

  audioTrackTemplate: function audioTrackTemplate(data) {
    return '<div class="controls-container">\n        <h4>' + data.label + '</h4>\n      </div>\n      <div class="svg-container"></div>';
  },

  globalTrackTemplate: function globalTrackTemplate() {
    return '<div class="controls-container"></div>\n      <div class="svg-container"></div>';
  },

  // create the DOM structure for the session and add waveforms
  createAudioTracks: function createAudioTracks() {
    var _this2 = this;

    var trackHeight = 100; //Math.min(height / this.session.length) - 1;

    // create Tracks
    this.session.forEach(function (track, index) {
      // create a track element for each track
      var $track = document.createElement('li');
      $track.setAttribute('id', 'track-' + track.id);
      $track.classList.add('track');
      $track.style.height = '' + trackHeight + 'px';

      $track.innerHTML = _this2.audioTrackTemplate(track);
      _this2.$container.appendChild($track);

      var $sampleContainer = $track.querySelector('.svg-container');
      _this2.timeline.registerContainer(track.id, $sampleContainer, { height: trackHeight });

      _this2.playerEngines[track.id] = [];

      // create waveforms
      track.period.forEach(function (sample) {
        console.log(sample);
        var layer = new Layer('entity', sample.buffer.getChannelData(0), {
          height: trackHeight,
          yDomain: [-1, 1]
        });

        layer.setShape(Waveform, {
          y: function y(d) {
            return d;
          },
          sampleRate: function sampleRate() {
            return sample.buffer.sampleRate;
          }
        });

        _this2.timeline.add(layer, track.id, 'audio-track');

        var start = sample.begin / 1000;
        var duration = sample.buffer.duration;
        var end = start + duration;

        layer.editable = true;
        layer.setContextAttribute('start', start);
        layer.setContextAttribute('duration', duration);

        // init player engine
        var engine = new wavesAudio.PlayerEngine();
        engine.buffer = sample.buffer;
        engine.connect(_this2.audioContext.destination);

        var transportedEngine = _this2.transport.add(engine);
        _this2.layerEngineMap.set(layer, transportedEngine);
      });
    });
  },

  onTimelineUpdate: function onTimelineUpdate(layers) {
    var _this3 = this;

    layers.forEach(function (layer) {
      var contextAttributes = layer.contextAttributes;
      var engine = _this3.layerEngineMap.get(layer);
      // if the layer is not associated with an engine
      if (!engine) {
        return;
      }
      var start = contextAttributes.start;
      var end = start + contextAttributes.duration;
      var offset = start + contextAttributes.offset;
      // console.log(start, end, offset);

      engine.setBoundaries(start, end, offset);
    });
  },

  // add a cursor layer
  createCursorTrack: function createCursorTrack() {
    var $track = document.createElement('li');
    $track.setAttribute('id', 'cursor-layer');
    $track.classList.add('track', 'global');

    $track.innerHTML = this.globalTrackTemplate();
    this.$container.appendChild($track);

    var $cursorContainer = $track.querySelector('.svg-container');
    this.timeline.registerContainer('cursor', $cursorContainer, { height: height });

    var cursor = new Layer('entity', this.globals, { height: height });
    cursor.setShape(Cursor, {
      x: function x(d) {
        var v = arguments[1] === undefined ? null : arguments[1];

        if (v !== null) {
          d.currentTime = v;
        }
        return d.currentTime;
      }
    }, { color: 'red' });

    this.timeline.add(cursor, 'cursor', 'cursor');
  },

  renderTimeline: function renderTimeline() {
    this.timeline.render();

    this.timeline.draw();
    this.timeline.update();

    // cursor
    var prev = new Date().getTime();
    // const that = this;

    // (function loop() {
    //   const now = new Date().getTime();
    //   const delta = (now - prev) / 1000;
    //   that.globals.currentTime += delta;
    //   that.timeline.update();
    //   prev = now;

    //   requestAnimationFrame(loop);
    // }());
  }
};
//# sourceMappingURL=data:application/json;base64,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ID0gcmVxdWlyZSgnZDMnKTtcbmNvbnN0IHdhdmVzQ29udHJvbGxlcnMgPSByZXF1aXJlKCd3YXZlcy1iYXNpYy1jb250cm9sbGVycycpO1xud2F2ZXNDb250cm9sbGVycy5zZXRUaGVtZSgnZGFyaycpO1xuY29uc3Qgd2F2ZXNBdWRpbyA9IHJlcXVpcmUoJ3dhdmVzLWF1ZGlvJyk7XG5jb25zdCB3YXZlc0xvYWRlcnMgPSByZXF1aXJlKCd3YXZlcy1sb2FkZXJzJyk7XG4vLyBjb3JlXG5jb25zdCBucyA9IHJlcXVpcmUoJ3dhdmVzLXVpL2Rpc3QvY29yZS9uYW1lc3BhY2UnKTtcbmNvbnN0IFRpbWVsaW5lID0gcmVxdWlyZSgnd2F2ZXMtdWkvZGlzdC9jb3JlL3RpbWVsaW5lJyk7XG5jb25zdCBUaW1lQ29udGV4dCA9IHJlcXVpcmUoJ3dhdmVzLXVpL2Rpc3QvY29yZS90aW1lLWNvbnRleHQnKTtcbmNvbnN0IExheWVyID0gcmVxdWlyZSgnd2F2ZXMtdWkvZGlzdC9jb3JlL2xheWVyJyk7XG4vLyBpbnRlcmFjdGlvbnNcbmNvbnN0IEV2ZW50ID0gcmVxdWlyZSgnd2F2ZXMtdWkvZGlzdC9pbnRlcmFjdGlvbnMvZXZlbnQnKTtcbmNvbnN0IFN1cmZhY2UgPSByZXF1aXJlKCd3YXZlcy11aS9kaXN0L2ludGVyYWN0aW9ucy9zdXJmYWNlJyk7XG5jb25zdCBLZXlib2FyZCA9IHJlcXVpcmUoJ3dhdmVzLXVpL2Rpc3QvaW50ZXJhY3Rpb25zL2tleWJvYXJkJyk7XG4vLyBzaGFwZXNcbmNvbnN0IFdhdmVmb3JtID0gcmVxdWlyZSgnd2F2ZXMtdWkvZGlzdC9zaGFwZXMvd2F2ZWZvcm0nKTtcbmNvbnN0IEN1cnNvciA9IHJlcXVpcmUoJ3dhdmVzLXVpL2Rpc3Qvc2hhcGVzL2N1cnNvcicpO1xuLy8gdGltZWxpbmUgc3RhdGVzXG5jb25zdCBCYXNlU3RhdGUgPSByZXF1aXJlKCd3YXZlcy11aS9kaXN0L3RpbWVsaW5lLXN0YXRlcy9iYXNlLXN0YXRlJyk7XG5jb25zdCBTZWxlY3Rpb25TdGF0ZSA9IHJlcXVpcmUoJ3dhdmVzLXVpL2Rpc3QvdGltZWxpbmUtc3RhdGVzL3NlbGVjdGlvbi1zdGF0ZScpO1xuY29uc3QgRWRpdGlvblN0YXRlID0gcmVxdWlyZSgnd2F2ZXMtdWkvZGlzdC90aW1lbGluZS1zdGF0ZXMvZWRpdGlvbi1zdGF0ZScpO1xuY29uc3QgQ29udGV4dEVkaXRpb25TdGF0ZSA9IHJlcXVpcmUoJ3dhdmVzLXVpL2Rpc3QvdGltZWxpbmUtc3RhdGVzL2NvbnRleHQtZWRpdGlvbi1zdGF0ZScpO1xuXG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBUFBMSUNBVElPTlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxubGV0IHNlc3Npb24gPSByZXF1aXJlKCcuLi9hc3NldHMvanNvbi9zZXNzaW9uLmpzb24nKTtcbi8vIGxvYWQgYWxsIGZpbGVzXG5jb25zdCBmaWxlc1NyYyA9ICcuL2Fzc2V0cy9zb3VuZC8nO1xuY29uc3QgbG9hZGVyID0gbmV3IHdhdmVzTG9hZGVycy5BdWRpb0J1ZmZlckxvYWRlcigpO1xuY29uc3QgZmlsZXMgPSBbXTtcblxubGV0IHdpZHRoID0gd2luZG93LmlubmVyV2lkdGg7XG5sZXQgaGVpZ2h0ID0gd2luZG93LmlubmVySGVpZ2h0O1xuXG4vLyBkZXYgb25seVxuLy9zZXNzaW9uID0gc2Vzc2lvbi5zbGljZSgwLCAyKTtcbi8vaGVpZ2h0ID0gaGVpZ2h0IC8gMztcbi8vIHBvcHVsYXRlIGZpbGVzXG5zZXNzaW9uLmZvckVhY2goZnVuY3Rpb24odHJhY2ssIGluZGV4KSB7XG4gIHRyYWNrLnBlcmlvZC5mb3JFYWNoKGZ1bmN0aW9uKHNhbXBsZSkge1xuICAgIGNvbnN0IGZpbGUgPSBmaWxlc1NyYyArIHNhbXBsZS5maWxlO1xuICAgIGZpbGVzLnB1c2goZmlsZSk7XG4gIH0pO1xufSk7XG5cbmxvYWRlci5sb2FkKGZpbGVzKS50aGVuKGZ1bmN0aW9uKGJ1ZmZlcnMpIHtcbiAgQXBwLmluaXRpYWxpemUoc2Vzc2lvbik7XG4gIEFwcC5wb3B1bGF0ZVNlc3Npb24oYnVmZmVycyk7XG5cbiAgQXBwLmluaXRBdWRpbygpO1xuXG4gIEFwcC5jcmVhdGVBdWRpb1RyYWNrcygpO1xuICBBcHAuY3JlYXRlQ3Vyc29yVHJhY2soKTtcblxuICBBcHAuYWRkVGVzdENvbnRyb2xsZXJzKCk7XG5cbiAgQXBwLnJlbmRlclRpbWVsaW5lKCk7XG59KS5jYXRjaChmdW5jdGlvbihlcnIpIHtcbiAgY29uc29sZS5sb2coZXJyLnN0YWNrKTtcbn0pO1xuXG4vLyBhcHBsaWNhdGlvblxuY29uc3QgQXBwID0ge1xuICBpbml0aWFsaXplKHNlc3Npb24pIHtcbiAgICB0aGlzLnNlc3Npb24gPSBzZXNzaW9uO1xuICAgIHRoaXMuZ2xvYmFscyA9IHsgY3VycmVudFRpbWU6IDAsIGR1cmF0aW9uOiA2MCAqIDIgfTtcbiAgICB0aGlzLmxheWVyRW5naW5lTWFwID0gbmV3IE1hcCgpO1xuXG4gICAgdGhpcy50aW1lbGluZSA9IG5ldyBUaW1lbGluZSh7XG4gICAgICBkdXJhdGlvbjogdGhpcy5nbG9iYWxzLmR1cmF0aW9uLFxuICAgICAgd2lkdGg6IDgwMFxuICAgIH0pO1xuXG4gICAgdGhpcy4kY29udGFpbmVyID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcignI3Nlc3Npb24tY29udGFpbmVyJyk7XG4gICAgLy8gaW5pdCBkZWZhdWx0IHN0YXRlXG4gICAgY29uc3Qgc2VsZWN0aW9uU3RhdGUgPSBuZXcgU2VsZWN0aW9uU3RhdGUodGhpcy50aW1lbGluZSk7XG4gICAgY29uc3QgY29udGV4dEVkaXRpb25TdGF0ZSA9IG5ldyBDb250ZXh0RWRpdGlvblN0YXRlKHRoaXMudGltZWxpbmUpO1xuXG4gICAgdGhpcy50aW1lbGluZS5zZXRTdGF0ZShjb250ZXh0RWRpdGlvblN0YXRlKTtcbiAgICB0aGlzLnRpbWVsaW5lLm9uKCd1cGRhdGUnLCB0aGlzLm9uVGltZWxpbmVVcGRhdGUuYmluZCh0aGlzKSk7XG4gIH0sXG5cbiAgYWRkVGVzdENvbnRyb2xsZXJzKCkge1xuICAgIGxldCByQUZJZCA9IG51bGw7XG4gICAgY29uc3QgdGhhdCA9IHRoaXM7XG5cbiAgICBuZXcgd2F2ZXNDb250cm9sbGVycy5CdXR0b25zKCd0cmFuc3BvcnQnLCBbJ3N0YXJ0JywgJ3N0b3AnXSwgJyNjb250cm9scycsICh2YWx1ZSkgPT4ge1xuICAgICAgc3dpdGNoICh2YWx1ZSkge1xuICAgICAgICBjYXNlICdzdGFydCc6XG4gICAgICAgICAgdGhpcy5wbGF5Q29udHJvbC5zdGFydCgpO1xuXG4gICAgICAgICAgKGZ1bmN0aW9uIGxvb3AoKSB7XG4gICAgICAgICAgICAvLyBjb25zb2xlLmxvZyh0aGF0LnRyYW5zcG9ydC5jdXJyZW50UG9zaXRpb24pO1xuICAgICAgICAgICAgdGhhdC5nbG9iYWxzLmN1cnJlbnRUaW1lID0gdGhhdC50cmFuc3BvcnQuY3VycmVudFBvc2l0aW9uO1xuICAgICAgICAgICAgdGhhdC50aW1lbGluZS51cGRhdGUoJ2N1cnNvcicpO1xuXG4gICAgICAgICAgICByQUZJZCA9IHJlcXVlc3RBbmltYXRpb25GcmFtZShsb29wKTtcbiAgICAgICAgICB9KCkpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdzdG9wJzpcbiAgICAgICAgICB0aGlzLnBsYXlDb250cm9sLnN0b3AoKTtcbiAgICAgICAgICBjYW5jZWxBbmltYXRpb25GcmFtZShyQUZJZCk7XG4gICAgICAgICAgdGhpcy5nbG9iYWxzLmN1cnJlbnRUaW1lID0gdGhpcy50cmFuc3BvcnQuY3VycmVudFBvc2l0aW9uO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgbmV3IHdhdmVzQ29udHJvbGxlcnMuU2xpZGVyKCd0aW1lbGluZSBzdHJldGNoUmF0aW8nLCAwLjEsIDEwMCwgMC4xLCAxLCAnJywgJycsICcjY29udHJvbHMnLCAodmFsdWUpID0+IHtcbiAgICAgIHRoaXMudGltZWxpbmUuY29udGV4dC5zdHJldGNoUmF0aW8gPSB2YWx1ZTtcbiAgICAgIHRoaXMudGltZWxpbmUudXBkYXRlKCk7XG4gICAgfSk7XG5cbiAgICBuZXcgd2F2ZXNDb250cm9sbGVycy5TbGlkZXIoJ3RpbWVsaW5lIHRyYW5zbGF0aW9uJywgLXRoaXMuZ2xvYmFscy5kdXJhdGlvbiwgdGhpcy5nbG9iYWxzLmR1cmF0aW9uLCAxLCAwLCAnJywgJycsICcjY29udHJvbHMnLCAodmFsdWUpID0+IHtcbiAgICAgIHRoaXMudGltZWxpbmUuY29udGV4dC5vZmZzZXQgPSB2YWx1ZTtcbiAgICAgIHRoaXMudGltZWxpbmUudXBkYXRlQ29udGFpbmVycygpO1xuICAgIH0pO1xuXG4gICAgbmV3IHdhdmVzQ29udHJvbGxlcnMuU2xpZGVyKCd3YXZlZm9ybSB6b29tIHknLCAwLjEsIDEwLCAwLjEsIDEsICcnLCAnJywgJyNjb250cm9scycsICh2YWx1ZSkgPT4ge1xuICAgICAgY29uc3QgeURvbWFpbiA9IFstMS92YWx1ZSwgMS92YWx1ZV07XG4gICAgICB0aGlzLnRpbWVsaW5lLmxheWVycy5mb3JFYWNoKChsYXllcikgPT4ge1xuICAgICAgICBsYXllci55RG9tYWluID0geURvbWFpbjtcbiAgICAgICAgdGhpcy50aW1lbGluZS51cGRhdGUobGF5ZXIpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0sXG5cbiAgaW5pdEF1ZGlvKCkge1xuICAgIHRoaXMuYXVkaW9Db250ZXh0ID0gd2F2ZXNBdWRpby5hdWRpb0NvbnRleHQ7XG4gICAgdGhpcy50cmFuc3BvcnQgPSBuZXcgd2F2ZXNBdWRpby5UcmFuc3BvcnQoKTtcbiAgICB0aGlzLnBsYXlDb250cm9sID0gbmV3IHdhdmVzQXVkaW8uUGxheUNvbnRyb2wodGhpcy50cmFuc3BvcnQpO1xuICAgIHRoaXMucGxheWVyRW5naW5lcyA9IHt9O1xuICB9LFxuICAvLyBhZGQgdGhlIGJ1ZmZlcnMgaW50byB0aGUgc2Vzc2lvbiBjb25maWd1cmF0aW9uXG4gIHBvcHVsYXRlU2Vzc2lvbihidWZmZXJzKSB7XG4gICAgbGV0IGluZGV4ID0gMDtcblxuICAgIHRoaXMuc2Vzc2lvbi5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICB0cmFjay5wZXJpb2QuZm9yRWFjaChmdW5jdGlvbihzYW1wbGUpIHtcbiAgICAgICAgc2FtcGxlLmJ1ZmZlciA9IGJ1ZmZlcnNbaW5kZXhdO1xuICAgICAgICBpbmRleCArPSAxO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH0sXG5cbiAgYXVkaW9UcmFja1RlbXBsYXRlKGRhdGEpIHtcbiAgICByZXR1cm4gYDxkaXYgY2xhc3M9XCJjb250cm9scy1jb250YWluZXJcIj5cbiAgICAgICAgPGg0PiR7ZGF0YS5sYWJlbH08L2g0PlxuICAgICAgPC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwic3ZnLWNvbnRhaW5lclwiPjwvZGl2PmA7XG4gIH0sXG5cbiAgZ2xvYmFsVHJhY2tUZW1wbGF0ZSgpIHtcbiAgICByZXR1cm4gYDxkaXYgY2xhc3M9XCJjb250cm9scy1jb250YWluZXJcIj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJzdmctY29udGFpbmVyXCI+PC9kaXY+YDtcbiAgfSxcblxuICAvLyBjcmVhdGUgdGhlIERPTSBzdHJ1Y3R1cmUgZm9yIHRoZSBzZXNzaW9uIGFuZCBhZGQgd2F2ZWZvcm1zXG4gIGNyZWF0ZUF1ZGlvVHJhY2tzKCkge1xuICAgIGNvbnN0IHRyYWNrSGVpZ2h0ID0gMTAwOyAvL01hdGgubWluKGhlaWdodCAvIHRoaXMuc2Vzc2lvbi5sZW5ndGgpIC0gMTtcblxuICAgIC8vIGNyZWF0ZSBUcmFja3NcbiAgICB0aGlzLnNlc3Npb24uZm9yRWFjaCgodHJhY2ssIGluZGV4KSA9PiB7XG4gICAgICAvLyBjcmVhdGUgYSB0cmFjayBlbGVtZW50IGZvciBlYWNoIHRyYWNrXG4gICAgICBjb25zdCAkdHJhY2sgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdsaScpO1xuICAgICAgJHRyYWNrLnNldEF0dHJpYnV0ZSgnaWQnLCBgdHJhY2stJHt0cmFjay5pZH1gKTtcbiAgICAgICR0cmFjay5jbGFzc0xpc3QuYWRkKCd0cmFjaycpO1xuICAgICAgJHRyYWNrLnN0eWxlLmhlaWdodCA9IGAke3RyYWNrSGVpZ2h0fXB4YDtcblxuICAgICAgJHRyYWNrLmlubmVySFRNTCA9IHRoaXMuYXVkaW9UcmFja1RlbXBsYXRlKHRyYWNrKTtcbiAgICAgIHRoaXMuJGNvbnRhaW5lci5hcHBlbmRDaGlsZCgkdHJhY2spO1xuXG4gICAgICBjb25zdCAkc2FtcGxlQ29udGFpbmVyID0gJHRyYWNrLnF1ZXJ5U2VsZWN0b3IoJy5zdmctY29udGFpbmVyJyk7XG4gICAgICB0aGlzLnRpbWVsaW5lLnJlZ2lzdGVyQ29udGFpbmVyKHRyYWNrLmlkLCAkc2FtcGxlQ29udGFpbmVyLCB7IGhlaWdodDogdHJhY2tIZWlnaHQgfSk7XG5cbiAgICAgIHRoaXMucGxheWVyRW5naW5lc1t0cmFjay5pZF0gPSBbXTtcblxuICAgICAgLy8gY3JlYXRlIHdhdmVmb3Jtc1xuICAgICAgdHJhY2sucGVyaW9kLmZvckVhY2goKHNhbXBsZSkgPT4ge1xuICAgICAgICBjb25zb2xlLmxvZyhzYW1wbGUpO1xuICAgICAgICBjb25zdCBsYXllciA9IG5ldyBMYXllcignZW50aXR5Jywgc2FtcGxlLmJ1ZmZlci5nZXRDaGFubmVsRGF0YSgwKSwge1xuICAgICAgICAgIGhlaWdodDogdHJhY2tIZWlnaHQsXG4gICAgICAgICAgeURvbWFpbjogWy0xLCAxXVxuICAgICAgICB9KTtcblxuICAgICAgICBsYXllci5zZXRTaGFwZShXYXZlZm9ybSwge1xuICAgICAgICAgIHk6IGZ1bmN0aW9uKGQpIHsgcmV0dXJuIGQ7IH0sXG4gICAgICAgICAgc2FtcGxlUmF0ZTogZnVuY3Rpb24oKSB7IHJldHVybiBzYW1wbGUuYnVmZmVyLnNhbXBsZVJhdGU7IH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy50aW1lbGluZS5hZGQobGF5ZXIsIHRyYWNrLmlkLCAnYXVkaW8tdHJhY2snKTtcblxuICAgICAgICBjb25zdCBzdGFydCA9IHNhbXBsZS5iZWdpbiAvIDEwMDA7XG4gICAgICAgIGNvbnN0IGR1cmF0aW9uID0gc2FtcGxlLmJ1ZmZlci5kdXJhdGlvbjtcbiAgICAgICAgY29uc3QgZW5kID0gc3RhcnQgKyBkdXJhdGlvbjtcblxuICAgICAgICBsYXllci5lZGl0YWJsZSA9IHRydWU7XG4gICAgICAgIGxheWVyLnNldENvbnRleHRBdHRyaWJ1dGUoJ3N0YXJ0Jywgc3RhcnQpO1xuICAgICAgICBsYXllci5zZXRDb250ZXh0QXR0cmlidXRlKCdkdXJhdGlvbicsIGR1cmF0aW9uKTtcblxuICAgICAgICAvLyBpbml0IHBsYXllciBlbmdpbmVcbiAgICAgICAgY29uc3QgZW5naW5lID0gbmV3IHdhdmVzQXVkaW8uUGxheWVyRW5naW5lKCk7XG4gICAgICAgIGVuZ2luZS5idWZmZXIgPSBzYW1wbGUuYnVmZmVyO1xuICAgICAgICBlbmdpbmUuY29ubmVjdCh0aGlzLmF1ZGlvQ29udGV4dC5kZXN0aW5hdGlvbik7XG5cbiAgICAgICAgY29uc3QgdHJhbnNwb3J0ZWRFbmdpbmUgPSB0aGlzLnRyYW5zcG9ydC5hZGQoZW5naW5lKTtcbiAgICAgICAgdGhpcy5sYXllckVuZ2luZU1hcC5zZXQobGF5ZXIsIHRyYW5zcG9ydGVkRW5naW5lKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9LFxuXG4gIG9uVGltZWxpbmVVcGRhdGUobGF5ZXJzKSB7XG4gICAgbGF5ZXJzLmZvckVhY2goKGxheWVyKSA9PiB7XG4gICAgICBjb25zdCBjb250ZXh0QXR0cmlidXRlcyA9IGxheWVyLmNvbnRleHRBdHRyaWJ1dGVzO1xuICAgICAgY29uc3QgZW5naW5lID0gdGhpcy5sYXllckVuZ2luZU1hcC5nZXQobGF5ZXIpO1xuICAgICAgLy8gaWYgdGhlIGxheWVyIGlzIG5vdCBhc3NvY2lhdGVkIHdpdGggYW4gZW5naW5lXG4gICAgICBpZiAoIWVuZ2luZSkgeyByZXR1cm47IH1cbiAgICAgIGNvbnN0IHN0YXJ0ID0gY29udGV4dEF0dHJpYnV0ZXMuc3RhcnQ7XG4gICAgICBjb25zdCBlbmQgPSBzdGFydCArIGNvbnRleHRBdHRyaWJ1dGVzLmR1cmF0aW9uO1xuICAgICAgY29uc3Qgb2Zmc2V0ID0gc3RhcnQgKyBjb250ZXh0QXR0cmlidXRlcy5vZmZzZXQ7XG4gICAgICAvLyBjb25zb2xlLmxvZyhzdGFydCwgZW5kLCBvZmZzZXQpO1xuXG4gICAgICBlbmdpbmUuc2V0Qm91bmRhcmllcyhzdGFydCwgZW5kLCBvZmZzZXQpO1xuICAgIH0pO1xuICB9LFxuXG4gIC8vIGFkZCBhIGN1cnNvciBsYXllclxuICBjcmVhdGVDdXJzb3JUcmFjaygpIHtcbiAgICBjb25zdCAkdHJhY2sgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdsaScpO1xuICAgICR0cmFjay5zZXRBdHRyaWJ1dGUoJ2lkJywgJ2N1cnNvci1sYXllcicpO1xuICAgICR0cmFjay5jbGFzc0xpc3QuYWRkKCd0cmFjaycsICdnbG9iYWwnKTtcblxuICAgICR0cmFjay5pbm5lckhUTUwgPSB0aGlzLmdsb2JhbFRyYWNrVGVtcGxhdGUoKTtcbiAgICB0aGlzLiRjb250YWluZXIuYXBwZW5kQ2hpbGQoJHRyYWNrKTtcblxuICAgIGNvbnN0ICRjdXJzb3JDb250YWluZXIgPSAkdHJhY2sucXVlcnlTZWxlY3RvcignLnN2Zy1jb250YWluZXInKTtcbiAgICB0aGlzLnRpbWVsaW5lLnJlZ2lzdGVyQ29udGFpbmVyKCdjdXJzb3InLCAkY3Vyc29yQ29udGFpbmVyLCB7IGhlaWdodDogaGVpZ2h0IH0pO1xuXG4gICAgY29uc3QgY3Vyc29yID0gbmV3IExheWVyKCdlbnRpdHknLCB0aGlzLmdsb2JhbHMsIHsgaGVpZ2h0OiBoZWlnaHQgfSk7XG4gICAgY3Vyc29yLnNldFNoYXBlKEN1cnNvciwge1xuICAgICAgeDogZnVuY3Rpb24oZCwgdiA9IG51bGwpIHtcbiAgICAgICAgaWYgKHYgIT09IG51bGwpIHsgZC5jdXJyZW50VGltZSA9IHY7IH1cbiAgICAgICAgcmV0dXJuIGQuY3VycmVudFRpbWU7XG4gICAgICB9XG4gICAgfSwgeyBjb2xvcjogJ3JlZCcgfSk7XG5cbiAgICB0aGlzLnRpbWVsaW5lLmFkZChjdXJzb3IsICdjdXJzb3InLCAnY3Vyc29yJyk7XG4gIH0sXG5cbiAgcmVuZGVyVGltZWxpbmUoKSB7XG4gICAgdGhpcy50aW1lbGluZS5yZW5kZXIoKTtcblxuICAgIHRoaXMudGltZWxpbmUuZHJhdygpO1xuICAgIHRoaXMudGltZWxpbmUudXBkYXRlKCk7XG5cbiAgICAvLyBjdXJzb3JcbiAgICBsZXQgcHJldiA9IG5ldyBEYXRlKCkuZ2V0VGltZSgpO1xuICAgIC8vIGNvbnN0IHRoYXQgPSB0aGlzO1xuXG4gICAgLy8gKGZ1bmN0aW9uIGxvb3AoKSB7XG4gICAgLy8gICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLmdldFRpbWUoKTtcbiAgICAvLyAgIGNvbnN0IGRlbHRhID0gKG5vdyAtIHByZXYpIC8gMTAwMDtcbiAgICAvLyAgIHRoYXQuZ2xvYmFscy5jdXJyZW50VGltZSArPSBkZWx0YTtcbiAgICAvLyAgIHRoYXQudGltZWxpbmUudXBkYXRlKCk7XG4gICAgLy8gICBwcmV2ID0gbm93O1xuXG4gICAgLy8gICByZXF1ZXN0QW5pbWF0aW9uRnJhbWUobG9vcCk7XG4gICAgLy8gfSgpKTtcbiAgfVxufTtcbiJdfQ==