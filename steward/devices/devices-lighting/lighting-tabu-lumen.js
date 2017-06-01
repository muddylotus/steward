// tabu Lumen BLE bulb: http://tabuproducts.com/shop/lumen-bulb/

var lumen
  , utility     = require('./../../core/utility')
  ;

try {
  lumen         = require('lumen');
} catch(ex) {
  exports.start = function() {};

  return utility.logger('devices').info('failing tabu-lumen lighting (continuing)', { diagnostic: ex.message });
}

var colorconv   = require('color-convert')
  , util        = require('util')
  , devices     = require('./../../core/device')
  , steward     = require('./../../core/steward')
  , lighting    = require('./../device-lighting')
  ;


var logger = lighting.logger;


var Lumen = exports.Device = function(deviceID, deviceUID, info) {
  var self = this;

  self.whatami = info.deviceType;
  self.deviceID = deviceID.toString();
  self.deviceUID = deviceUID;
  self.name = info.device.name;
  self.getName();

  self.status = 'waiting';
  self.changed();
  self.peripheral = info.peripheral;
  self.info = { color      : { model: 'rgb', rgb: { r: 0, g: 0, b: 0 } }
              , brightness : 0
              , rssi       : self.peripheral.rssi
              };

  self.peripheral.on('disconnect', function() {
    logger.info('device/' + self.deviceID, { status: self.status });
// TBD: handle connection timeout...

    self.lumen = null;
    setTimeout(function() { /* self.status = 'waiting'; self.changed(); */ self.connect(self); }, 1 * 1000);
  }).on('rssiUpdate', function(rssi) {
    self.info.rssi = rssi;
    self.refresh(self);
  });

  utility.broker.on('actors', function(request, taskID, actor, perform, parameter) {
    if (actor !== ('device/' + self.deviceID)) return;

    if (request === 'perform') return self.perform(self, taskID, perform, parameter);
  });

  self.refresh(self);
  setInterval(function() { self.heartbeat(self); }, 30 * 1000);
};
util.inherits(Lumen, lighting.Device);


Lumen.prototype.connect = function(self) {
  self.peripheral.connect(function(err) {
    var bulb;

    if (err) return logger.error('device/' + self.deviceID, { event: 'connect', diagnostic: err.message });

    bulb = new lumen(self.peripheral);

    bulb.discoverServicesAndCharacteristics(function(err) {
      if (err) return logger.error('device/' + self.deviceID,
                                   { event: 'discoverServicesAndCharacteristics', diagnostic: err.message });

      bulb.setup(function(err) {
        if (err) return logger.error('device/' + self.deviceID, { event: 'setup', diagnostic: err.message });

        self.lumen = bulb;
        self.refresh(self);
      });
    });
  });
};

Lumen.prototype.heartbeat = function(self) {
  if (self.status !== 'waiting') self.refresh(self); else self.connect(self);
};

Lumen.prototype.refresh = function(self) {
  if (!self.lumen) return;

  self.lumen.readDeviceName(function(lightName) {
    if (self.name !== lightName) {
      self.name = lightName;
      self.changed();
    }
  });

  self.lumen.readState(function(state) {
    var info    = utility.clone(self.info)
      , onoff   = state.on ? 'on' : 'off'
      , states  = { warmWhite: function() {
                                  info.brightness = Math.round(parseInt(state.warmPercentageWhite, 10));

                                  info.color.rgb = { r: 255, g: 255, b: 255 };
                                }
                  , color     : function() {
                                  var rgb;

                                  info.brightness = Math.round(state.colorW * 100);
                                  if ((state.colorC === 0) && (state.colorM === 0) && (state.colorY === 0)) {
                                    info.color.rgb = { r: 255, g: 255, b: 255 };
                                    return;
                                  }

                                  rgb = colorconv.cmyk2rgb([ state.colorC * 100
                                                           , state.colorM * 100
                                                           , state.colorY * 100
                                                           , 100 - info.brightness
                                                           ]);
                                  info.color.rgb = { r: rgb[0], g: rgb[1], b: rgb[2] };
                                }
                  }
      , updateP = false
      ;

    if (states[state.mode]) (states[state.mode])();

    if (self.status !== onoff) {
      self.status = onoff;
      updateP = true;
    }
    if ((self.info.color.rgb.r !== info.color.rgb.r)
            || (self.info.color.rgb.g !== info.color.rgb.g)
            || (self.info.color.rgb.b !== info.color.rgb.b)) {
      self.info.color.rgb = info.color.rgb;
      updateP = true;
    }
    if ((!isNaN(info.brightness)) && (self.info.brightness !== info.brightness)) {
      self.info.brightness = info.brightness;
      updateP = true;
    }

    if (updateP) self.changed();
  });
};


Lumen.prototype.perform = function(self, taskID, perform, parameter) {
  var cmyk, color, params, refresh, state;

  if (!self.lumen) return false;

  try { params = JSON.parse(parameter); } catch(ex) { params = {}; }

  refresh = function() { setTimeout (function() { self.refresh(self); }, 0); };

  if (perform === 'set') return self.perform(self, taskID, perform, parameter);

  state = { color: self.info.color, brightness: self.info.brightness };
  if (perform === 'off') state.on = false;
  else if (perform !== 'on') return false;
  else {
    state.on = true;

    color = params.color;
    if (!!color) {
      switch (color.model) {
        case 'rgb':
          if (!lighting.validRGB(color.rgb)) return false;
          cmyk = colorconv.rgb2cmyk([ color.rgb.r, color.rgb.g, color.rgb.b ]);
          color.model = 'cmyw';
          color.cmyw = { c: cmyk[0], m: cmyk[1], y: cmyk[2], w: 100 - cmyk[3] };
          break;

        case 'cmyw':
          if (!lighting.validCMYW(color.cmyw)) return false;
          break;

        default:
          break;
      }
      state.color = color;
    }

    if ((!!params.brightness) && (lighting.validBrightness(params.brightness))) state.brightness = params.brightness;

    if ((state.color.cmyw.c === 0) && (state.color.cmyw.m === 0) && (state.color.cmyw.y === 0) && (state.color.cmyw.w === 0)) {
      state.on = false;
    }
  }

  logger.notice('device/' + self.deviceID, { perform: state });

  if (!state.on) self.lumen.turnOff(refresh);
  else {
    if ((state.color.cmyw.c === 0) && (state.color.cmyw.m === 0) && (state.color.cmyw.y === 0)) {
      self.lumen.warmWhite(state.brightness, refresh);
    } else {
      self.lumen.turnOn(function() {
        self.lumen.color(state.color.cmyw.c / 100, state.color.cmyw.m / 100, state.color.cmyw.y / 100,
                         state.color.cmyw.w / 100, refresh);
      });
    }
  }

  return steward.performed(taskID);
};

var validate_perform = function(perform, parameter) {
  var color
    , params = {}
    , result = { invalid: [], requires: [] }
    ;

  if (!!parameter) try { params = JSON.parse(parameter); } catch(ex) { result.invalid.push('parameter'); }

  if (perform === 'off') return result;

  if (perform === 'set') {
    if (!params.name) result.requires.push('name');
    return result;
  }

  if (perform !== 'on') {
    result.invalid.push('perform');
    return result;
  }

  color = params.color;
  if (!!color) {
    switch (color.model) {
        case 'cmyw':
          if (!lighting.validCMYW(color.cmyw)) result.invalid.push('color.cmyw');
          break;

        case 'rgb':
          if (!lighting.validRGB(color.rgb)) result.invalid.push('color.rgb');
          break;

        default:
          result.invalid.push('color.model');
          break;
    }
  }

  if ((!!params.brightness) && (!lighting.validBrightness(params.brightness))) result.invalid.push('brightness');

  return result;
};


exports.start = function() {
  steward.actors.device.lighting.tabu = steward.actors.device.lighting.tabu ||
      { $info     : { type: '/device/lighting/tabu' } };

  steward.actors.device.lighting.tabu.bulb =
      { $info     : { type       : '/device/lighting/tabu/bulb'
                    , observe    : [ ]
                    , perform    : [ 'off', 'on' ]
                    , properties : { name         : true
                                   , status       : [ 'waiting', 'on', 'off' ]
                                   , color        : { model: [ { rgb : { r: 'u8',  g: 'u8',  b: 'u8' } }
                                                             , { cmyw : { c : 'percentage'
                                                                        , m : 'percentage'
                                                                        , y : 'percentage'
                                                                        , w : 'percentage'
                                                                        }
                                                               }
                                                             ]
                                                    }
                                   , brightness   : 'percentage'
                                   , rssi         : 's8'
                                   }
                    }
      , $validate : { perform    : validate_perform }
      };
  devices.makers['/device/lighting/tabu/bulb'] = Lumen;

  require('./../../discovery/discovery-ble').register('/device/lighting/tabu/bulb', 'iSmartLight Bough', [ 'fff0' ]);
};
