// Yocto-PowerColor: http://www.yoctopuce.com

var tinycolor   = require('tinycolor2')
  , util        = require('util')
  , yapi        = require('yoctolib')
  , devices     = require('./../../core/device')
  , steward     = require('./../../core/steward')
  , utility     = require('./../../core/utility')
  , lighting    = require('./../device-lighting')
  ;


var logger = lighting.logger;


var PowerColor = exports.Device = function(deviceID, deviceUID, info) {
  var self = this;

  self.whatami = info.deviceType;
  self.deviceID = deviceID.toString();
  self.deviceUID = deviceUID;
  self.name = info.device.name;

  self.status = 'waiting';
  self.changed();
  self.led = yapi.yFindColorLed(info.device.unit.serial + '.colorLed1');
  self.info = {};

  if (self.led.isOnline()) {
    self.led.get_logicalName_async(function(ctx, led, result) {
      if (result === yapi.Y_LOGICALNAME_INVALID) {
        return logger.error('device/' + self.deviceID,  { event: 'get_logicalName', diagnostic: 'logicalName invalid' });
      }

      if ((!result) || (result.length === 0) || (result === self.name)) return;

      logger.info('device/' + self.deviceID, { event: 'get_logicalName', result: result });
      self.setName(result);
    });
  }

  utility.broker.subscribe('actors', function(request, taskID, actor, perform, parameter) {
    if (actor !== ('device/' + self.deviceID)) return;

    if (request === 'perform') return self.perform(self, taskID, perform, parameter);
  });

  self.led.get_rgbColor_async(function(ctx, led, result) {
    var hsl;

    if (result === yapi.Y_RGBCOLOR_INVALID) {
      return logger.error('device/' + self.deviceID,  { event: 'get_rgbColor', diagnostic: 'rgbColor invalid' });
    }

    self.info.color = { model: 'rgb', rgb: { r: (result >> 16) & 255, g: (result >> 8) & 255, b: result & 255 } };
    hsl = tinycolor(self.info.color.rgb).toHsl();
    self.info.brightness = Math.round(hsl.s * 100);
    self.status = (self.info.brightness > 0) ? 'on' : 'off';
    self.changed();
  });
};
util.inherits(PowerColor, lighting.Device);


PowerColor.prototype.perform = function(self, taskID, perform, parameter) {
  var hsl, params, result, state;

  state = {};
  try { params = JSON.parse(parameter); } catch(ex) { params = {}; }

  if (perform === 'set') {
    result = self.led.set_logicalName(params.name);
    if (result === yapi.YAPI_SUCCESS) self.setName(params.name);

    logger.error('device/' + self.deviceID, { event: 'set_logicalName', result: result });
    return false;
  }

  if ((perform === 'on')
          && (!!params.brightness)
          && (lighting.validBrightness(params.brightness))) state.brightness = params.brightness;
  if ((!!state.brightness) && (state.brightness === 0)) perform = 'off';

  if (perform === 'off') {
    state.on = false;
    state.color = { model: 'rgb', rgb: { r: 0, g: 0, b: 0 } };
    state.brightness = 0;
  } else if (perform !== 'on') return false;
  else {
    state.on = true;

    state.color = params.color;
    if (!state.color) return false;
    if (state.color.model === 'hue') {
      if (!state.brightness) return false;

      state.color.model = 'rgb';
      state.color.rgb = tinycolor({ h : state.color.hue.hue
                                  , s : state.color.hue.saturation
                                  , l : state.brightness
                                  }).toRgb();
    } else if (state.color.model !== 'rgb') return false;
    else {
      hsl = tinycolor(state.color.rgb).toHsl();
      state.brightness = Math.round(hsl.s * 100);
    }

    if ((state.color.rgb.r === 0) || (state.color.rgb.g === 0) || (state.color.rgb.b === 0)) state.on = false;
  }
  logger.info('device/' + self.deviceID, { perform: state });

  if (self.led.set_rgbColor( (state.color.rgb.r << 16) + (state.color.rgb.g << 8) + (state.color.rgb.b))
        === yapi.Y_RGBCOLOR_INVALID) {
    logger.error('device/' + self.deviceID,  { event: 'set_rgbColor', diagnostic: 'rgbColor invalid' });
    return false;
  }

  self.status = state.on ? 'on' : 'off';
  self.info.color = state.color;
  self.info.brightness = state.brightness;
  self.changed();

  return steward.performed(taskID);
};

var validate_perform = function(perform, parameter) {
  var color
    , params = {}
    , result = { invalid: [], requires: [] };

  if (perform === 'off') return result;

  if (!parameter) {
    result.requires.push('parameter');
    return result;
  }
  try { params = JSON.parse(parameter); } catch(ex) { result.invalid.push('parameter'); }

  if (perform === 'set') {
    if (!params.name) result.requires.push('name');
    return result;
  }

  if (perform !== 'on') result.invalid.push('perform');

  color = params.color;
  if (!!color) {
    switch (color.model) {
        case 'hue':
          if (!lighting.validHue(color.hue)) result.invalid.push('color.hue');
          if (!lighting.validSaturation(color.saturation)) result.invalid.push('color.saturation');
          if (!params.brightness) result.requires.push('brightness');
          break;

        case 'rgb':
          if (!lighting.validRGB(color.rgb)) result.invalid.push('color.rgb');
          break;

        default:
          result.invalid.push('color.model');
          break;
    }
  } else result.requires.push('color');

  if ((!!params.brightness) && (!lighting.validBrightness(params.brightness))) result.invalid.push('brightness');

  return result;
};


exports.start = function() {
  steward.actors.device.lighting.yoctopuce = steward.actors.device.lighting.yoctopuce ||
      { $info     : { type: '/device/lighting/yoctopuce' } };

  steward.actors.device.lighting.yoctopuce.powercolor =
      { $info     : { type       : '/device/lighting/yoctopuce/powercolor'
                    , observe    : [ ]
                    , perform    : [ 'off', 'on' ]
                    , properties : { name       : true
                                   , status     : [ 'waiting', 'on', 'off' ]
                                   , color      : { model: [ { rgb         : { r: 'u8', g: 'u8', b: 'u8' } }
                                                           , { hue         : { hue: 'degrees', saturation: 'percentage' } }
                                                           ]
                                                  }
                                   , brightness : 'percentage'
                                   }
                    }
      , $validate : {  perform   : validate_perform }
      };
  devices.makers['/device/lighting/yoctopuce/powercolor'] = PowerColor;
};
