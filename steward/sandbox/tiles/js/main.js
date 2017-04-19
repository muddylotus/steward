var api = new API();

var grid = null;
var update_functions = {};
function initGrid() {
  if(!!grid) {
    grid.gridList('destroy');
    grid = null;
  }

  grid = $('#grid').gridList({
    dragAndDrop: false,
    direction: 'vertical',
    lanes: 16,
    widthHeightRatio: 1,
    heightToFontSizeRatio: 0.5
  });
  $(window).resize();
}

$(function() {
  api.connect();

  $(".button-collapse").sideNav();

  $(window).resize(function() {
    var width = $(document).width();
    var newsize = 0;	
    if(width > 1200) {
      newsize = 12;
    } else if(width > 992) {
      newsize = 10;
    } else if(width > 600) {
      newsize = 6;
    } else {
      newsize = 4;
    }
    
    grid.gridList('resize', newsize);
  });

  initGrid();
});

function API() { 
  this.websocket = null;
  this.timeout = 5;
}
API.prototype.connect = function() {
  var self = this;
  
  this.websocket = new WebSocket('ws://localhost:8000/api/');
  this.websocket.onopen = function(evt) { 
    self.timeout = 5;
    Materialize.toast('Connected.', 2000);

    setTimeout(function() {
      self.websocket.send(JSON.stringify({'action': 'loadDevices'}));
    }, 500);
  };
  this.websocket.onclose = function(evt) {
    Materialize.toast('Connection closed.', 2000);
    self.reconnect();
  };
  this.websocket.onmessage = function onMessage(evt) {
    if(!!evt && !!evt.data) {
      var msg = JSON.parse(evt.data);

      if($('#grid #device-'+msg.id).length == 0) {
        $('#grid').append(msg.html);
        initGrid();
      }
      if(update_functions.hasOwnProperty('update_'+msg.id)) {
        update_functions['update_'+msg.id](msg.status, msg.info);
      }
    }
  }
  this.websocket.onerror = function(evt) {
    Materialize.toast('Error connecting. Retrying ... ', 2000);

    self.timeout *= 2;
    if(self.timeout > 60) {
      self.timeout = 60;
    }
  };
}
API.prototype.close = function() {
  if(!!this.websocket) {
    this.websocket.close();
  }
  this.websocket = null;
}
API.prototype.reconnect = function() {
  Materialize.toast('Connecting in&nbsp;<span id="RetryTimeout">' + this.timeout + '</span>&nbsp;second(s)', this.timeout * 1000);
  
  var timeout = this.timeout;
  var interval = setInterval(function() {
    if(--timeout <= 0) {
      clearInterval(interval);
    } else {
      $('#RetryTimeout').text(timeout);
    }
  }, 1000)

  this.close();
  var self = this;
  setTimeout(function() {
    self.connect();
  }, this.timeout * 1000);
}

/*
 * Replace all SVG images with inline SVG
 */
$.embedSVG = function() {
	$('img[src$=".svg"]').each(function(){
		var $img = $(this);
		var imgID = $img.attr('id');
		var imgClass = $img.attr('class');
		var imgURL = $img.attr('src');
		$.get(imgURL, function(data) {
			// Get the SVG tag, ignore the rest
			var $svg = $(data).find('svg');

			// Add replaced image's ID to the new SVG
			if(typeof imgID !== 'undefined') {
				$svg = $svg.attr('id', imgID);
			}
			// Add replaced image's classes to the new SVG
			if(typeof imgClass !== 'undefined') {
				$svg = $svg.attr('class', imgClass+' replaced-svg');
			}

			// Remove any invalid XML tags as per http://validator.w3.org
			$svg = $svg.removeAttr('xmlns:a');

			// Replace image with new SVG
			$img.replaceWith($svg);

		}, 'xml');

	});
};

