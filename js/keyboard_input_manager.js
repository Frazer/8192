function KeyboardInputManager() {
  this.events = {};

  if (window.navigator.msPointerEnabled) {
    //Internet Explorer 10 style
    this.eventTouchstart    = "MSPointerDown";
    this.eventTouchmove     = "MSPointerMove";
    this.eventTouchend      = "MSPointerUp";
  } else {
    this.eventTouchstart    = "touchstart";
    this.eventTouchmove     = "touchmove";
    this.eventTouchend      = "touchend";
  }

  this.listen();
}

KeyboardInputManager.prototype.on = function (event, callback) {
  if (!this.events[event]) {
    this.events[event] = [];
  }
  this.events[event].push(callback);
};

KeyboardInputManager.prototype.emit = function (event, data) {
  var callbacks = this.events[event];
  if (callbacks) {
    callbacks.forEach(function (callback) {
      callback(data);
    });
  }
};

KeyboardInputManager.prototype.listen = function () {
  var self = this;

  var map = {
    38: 0, // Up
    39: 1, // Right
    40: 2, // Down
    37: 3, // Left
    75: 0, // Vim up
    76: 1, // Vim right
    74: 2, // Vim down
    72: 3, // Vim left
    87: 0, // W
    68: 1, // D
    83: 2, // S
    65: 3  // A
  };

  // Respond to direction keys
  document.addEventListener("keydown", function (event) {
    var modifiers = event.altKey || event.ctrlKey || event.metaKey ||
                    event.shiftKey;
    var mapped    = map[event.which];

    if (!modifiers) {
      if (mapped !== undefined) {
        event.preventDefault();
        self.emit("move", mapped);
      }
    }

    // R key restarts the game
    if (!modifiers && event.which === 82) {
      self.restart.call(self, event);
    }
  });

  // Respond to button presses
  this.bindButtonPress(".retry-button", this.restart);
  this.bindNewGameButton();
  this.bindHoldButton(".score-container", function () {
    self.emit("enableUndo");
  });
  document.querySelector(".undo-button").addEventListener("click", function () {
    self.emit("undo");
  });
  this.bindButtonPress(".keep-playing-button", this.keepPlaying);

  // Respond to swipe events
  var touchStartClientX, touchStartClientY;
  var gameContainer = document.getElementsByClassName("game-container")[0];

  gameContainer.addEventListener(this.eventTouchstart, function (event) {
    if ((!window.navigator.msPointerEnabled && event.touches.length > 1) ||
        event.targetTouches.length > 1) {
      return; // Ignore if touching with more than 1 finger
    }

    if (window.navigator.msPointerEnabled) {
      touchStartClientX = event.pageX;
      touchStartClientY = event.pageY;
    } else {
      touchStartClientX = event.touches[0].clientX;
      touchStartClientY = event.touches[0].clientY;
    }

    event.preventDefault();
  });

  gameContainer.addEventListener(this.eventTouchmove, function (event) {
    event.preventDefault();
  });

  gameContainer.addEventListener(this.eventTouchend, function (event) {
    if ((!window.navigator.msPointerEnabled && event.touches.length > 0) ||
        event.targetTouches.length > 0) {
      return; // Ignore if still touching with one or more fingers
    }

    var touchEndClientX, touchEndClientY;

    if (window.navigator.msPointerEnabled) {
      touchEndClientX = event.pageX;
      touchEndClientY = event.pageY;
    } else {
      touchEndClientX = event.changedTouches[0].clientX;
      touchEndClientY = event.changedTouches[0].clientY;
    }

    var dx = touchEndClientX - touchStartClientX;
    var absDx = Math.abs(dx);

    var dy = touchEndClientY - touchStartClientY;
    var absDy = Math.abs(dy);

    if (Math.max(absDx, absDy) > 10) {
      // (right : left) : (down : up)
      self.emit("move", absDx > absDy ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
    }
  });
};

KeyboardInputManager.prototype.restart = function (event) {
  event.preventDefault();
  this.emit("restart");
};

KeyboardInputManager.prototype.keepPlaying = function (event) {
  event.preventDefault();
  this.emit("keepPlaying");
};

KeyboardInputManager.prototype.bindButtonPress = function (selector, fn) {
  var button = document.querySelector(selector);
  button.addEventListener("click", fn.bind(this));
  button.addEventListener(this.eventTouchend, fn.bind(this));
};

KeyboardInputManager.prototype.bindNewGameButton = function () {
  var self = this;
  this.bindHoldButton(".restart-button", function () {
    self.emit("restart", true);
  }, function () {
    self.emit("restart");
  });
};

KeyboardInputManager.prototype.bindHoldButton = function (selector, onHold,
                                                        onPress) {
  var button = document.querySelector(selector);
  var timer = null;
  var held = false;
  var pointerId = null;

  function cancel() {
    window.clearTimeout(timer);
    timer = null;
    pointerId = null;
  }

  function start(event) {
    if (timer !== null || (event.button !== undefined && event.button !== 0) ||
        (event.touches && event.touches.length !== 1) ||
        event.isPrimary === false) return;

    held = false;
    pointerId = event.pointerId;
    // Prevent legacy touch events from generating a second mouse click.
    if (event.type === "touchstart") event.preventDefault();
    timer = window.setTimeout(function () {
      held = true;
      onHold();
    }, 2000);
  }

  function end(event) {
    if (pointerId !== null && event.pointerId !== pointerId) return;
    var active = timer !== null;
    cancel();
    if (event.type === "touchend") {
      event.preventDefault();
      if (active && !held && onPress) onPress();
    }
  }

  button.addEventListener("click", function (event) {
    event.preventDefault();
    if (!held && onPress) onPress();
  });
  button.addEventListener("contextmenu", function (event) {
    event.preventDefault();
  });

  if (window.PointerEvent) {
    button.addEventListener("pointerdown", start);
    document.addEventListener("pointerup", end);
    button.addEventListener("pointerleave", cancel);
    document.addEventListener("pointercancel", cancel);
  } else {
    button.addEventListener("mousedown", start);
    document.addEventListener("mouseup", end);
    button.addEventListener("mouseleave", cancel);
    button.addEventListener("touchstart", start, { passive: false });
    button.addEventListener("touchend", end);
    button.addEventListener("touchmove", cancel);
    button.addEventListener("touchcancel", cancel);
  }
  window.addEventListener("blur", cancel);
};
