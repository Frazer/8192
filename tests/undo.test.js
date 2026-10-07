// Run with: node tests/undo.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function element() {
  const listeners = {};
  const children = [];
  const classes = new Set();
  return {
    hidden: true,
    disabled: false,
    textContent: "",
    classList: {
      add: value => classes.add(value),
      remove: value => classes.delete(value)
    },
    setAttribute() {},
    appendChild: child => children.push(child),
    removeChild: child => children.splice(children.indexOf(child), 1),
    get firstChild() { return children[0]; },
    getElementsByTagName: () => [element()],
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
    fire(type, extra = {}) {
      const event = Object.assign({ type, preventDefault() {} }, extra);
      (listeners[type] || []).forEach(fn => fn(event));
    }
  };
}

function harness(pointer) {
  const nodes = {};
  const document = element();
  document.querySelector = selector => nodes[selector] ||= element();
  document.getElementsByClassName = name => [document.querySelector("." + name)];
  document.createElement = element;
  const window = element();
  window.navigator = {};
  window.PointerEvent = pointer;
  window.requestAnimationFrame = fn => fn();
  let now = 0, next = 0;
  const timers = new Map();
  window.setTimeout = (fn, delay) => {
    timers.set(++next, { fn, at: now + delay });
    return next;
  };
  window.clearTimeout = id => timers.delete(id);
  const context = vm.createContext({ window, document });
  ["keyboard_input_manager", "grid", "tile", "local_storage_manager",
    "html_actuator", "game_manager"].forEach(name => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/" + name + ".js"),
      "utf8"), context);
  });
  function createGame() {
    return new context.GameManager(4, context.KeyboardInputManager,
      context.HTMLActuator, context.LocalStorageManager);
  }
  const game = createGame();
  return { game, nodes, document, window, context, createGame,
    tick(ms) {
      now += ms;
      for (const [id, timer] of timers) {
        if (timer.at <= now) { timers.delete(id); timer.fn(); }
      }
    }
  };
}

for (const pointer of [true, false]) {
  const h = harness(pointer);
  const { game, nodes } = h;
  const score = nodes[".score-container"];
  const down = pointer ? "pointerdown" : "touchstart";
  const up = pointer ? "pointerup" : "touchend";
  const start = () => score.fire(down, { pointerId: 1, touches: [{}] });
  const end = () => (pointer ? h.document : score).fire(up, { pointerId: 1 });
  assert.equal(nodes[".undo-controls"].hidden, true);
  start();
  h.tick(1999);
  assert.equal(game.undoEnabled, false);
  end();
  h.tick(1);
  assert.equal(game.undoEnabled, false, "short hold does not enable undo");
  start();
  h.window.fire("blur");
  h.tick(2000);
  assert.equal(game.undoEnabled, false, "blur cancels hold");
  start();
  h.tick(2000);
  end();
  assert.equal(nodes[".undo-controls"].hidden, false);
  assert.equal(nodes[".undo-button"].disabled, true);
  game.undo();
  assert.equal(game.undoCount, 0, "empty history does not count");

  // A merge must restore both original tiles and remove the random spawn.
  game.grid = new h.context.Grid(4);
  game.grid.insertTile(new h.context.Tile({ x: 0, y: 0 }, 2));
  game.grid.insertTile(new h.context.Tile({ x: 1, y: 0 }, 2));
  game.score = 20;
  const before = JSON.stringify(game.serializeBoard());
  game.move(3);
  assert.equal(game.score, 24);
  assert.equal(nodes[".score-container"].textContent, 24);
  assert.equal(nodes[".undo-button"].disabled, false);
  const afterMerge = JSON.stringify(game.serializeBoard());
  game.move(2);
  assert.equal(game.history.length, 2);
  nodes[".undo-button"].fire("click");
  assert.equal(JSON.stringify(game.serializeBoard()), afterMerge);
  assert.equal(nodes[".undo-count"].textContent, 1);
  nodes[".undo-button"].fire("click");
  assert.equal(JSON.stringify(game.serializeBoard()), before);
  assert.equal(nodes[".score-container"].textContent, 20);
  assert.equal(game.undoCount, 2);
  assert.equal(nodes[".undo-button"].disabled, true);
  game.undo();
  assert.equal(game.undoCount, 2);
  assert.equal(game.storageManager.getBestScore(), "24");
  game.move(0);
  assert.equal(game.history.length, 0, "no-op move creates no history");

  game.move(3);
  const reloaded = h.createGame();
  assert.equal(reloaded.undoEnabled, true);
  assert.equal(reloaded.undoCount, 2);
  reloaded.undo();
  assert.equal(JSON.stringify(reloaded.serializeBoard()), before);
  assert.equal(reloaded.undoCount, 3);
  // Undo remains available after game over and clears termination flags.
  reloaded.move(3);
  reloaded.over = true;
  reloaded.actuate();
  assert.equal(reloaded.storageManager.getGameState().over, true);
  reloaded.undo();
  assert.equal(reloaded.over, false);
  assert.equal(reloaded.score, 20);
  reloaded.restart(true);
  assert.equal(reloaded.undoCount, 0);
  assert.equal(reloaded.history.length, 0);
  assert.equal(reloaded.undoEnabled, true);
  assert.equal(reloaded.grid.cells[0][0].value, 4096);
  assert.equal(reloaded.grid.cells[0][1].value, 2048);
  assert.equal(reloaded.grid.availableCells().length, 13);
  let twos = 0;
  reloaded.grid.eachCell((x, y, tile) => {
    if (tile && tile.value === 2) twos++;
  });
  assert.equal(twos, 1, "long press adds exactly one 2 in an empty cell");

  // Preserve the existing New Game hold, including release suppression.
  nodes[".restart-button"].fire(down, { pointerId: 1, touches: [{}] });
  h.tick(2000);
  (pointer ? h.document : nodes[".restart-button"]).fire(up, { pointerId: 1 });
  nodes[".restart-button"].fire("click");
  assert.equal(game.grid.cells[0][0].value, 4096);
  assert.equal(game.grid.cells[0][1].value, 2048);
  assert.equal(game.grid.availableCells().length, 13);

  // Ten seconds upgrades the corner stack; releasing must preserve it.
  const restart = nodes[".restart-button"];
  restart.fire(down, { pointerId: 1, touches: [{}] });
  h.tick(9999);
  assert.equal(game.grid.cells[0][0].value, 4096);
  h.tick(1);
  assert.equal(game.grid.cells[0][0].value, 8192);
  assert.equal(game.grid.cells[0][1].value, 4096);
  assert.equal(game.grid.cells[0][2].value, 2048);
  assert.equal(game.grid.availableCells().length, 12);
  twos = 0;
  game.grid.eachCell((x, y, tile) => {
    if (tile && tile.value === 2) twos++;
  });
  assert.equal(twos, 1);
  assert.equal(game.score, 0);
  assert.equal(game.history.length, 0);
  assert.equal(game.isGameTerminated(), false);
  const specialBoard = JSON.stringify(game.serializeBoard());
  (pointer ? h.document : restart).fire(up, { pointerId: 1 });
  restart.fire("click");
  h.tick(10000);
  assert.equal(JSON.stringify(game.serializeBoard()), specialBoard);

  // Release or leave before ten seconds cancels the upgrade.
  for (const cancel of ["release", "leave", "blur", "cancel"]) {
    restart.fire(down, { pointerId: 1, touches: [{}] });
    h.tick(9999);
    if (cancel === "release") {
      (pointer ? h.document : restart).fire(up, { pointerId: 1 });
    } else if (cancel === "blur") {
      h.window.fire("blur");
    } else if (cancel === "leave") {
      restart.fire(pointer ? "pointerleave" : "touchmove");
    } else {
      (pointer ? h.document : restart).fire(pointer ? "pointercancel" : "touchcancel");
    }
    h.tick(1);
    assert.equal(game.grid.cells[0][0].value, 4096, cancel + " cancels upgrade");
    assert.equal(game.grid.availableCells().length, 13);
  }

  // A short press still starts the ordinary two-tile game.
  restart.fire(down, { pointerId: 1, touches: [{}] });
  h.tick(100);
  (pointer ? h.document : restart).fire(up, { pointerId: 1 });
  if (pointer) restart.fire("click");
  assert.equal(game.grid.availableCells().length, 14);
  h.tick(10000);
  assert.equal(game.grid.availableCells().length, 14);

  game.grid = new h.context.Grid(4);
  game.grid.insertTile(new h.context.Tile({ x: 0, y: 0 }, 4096));
  game.grid.insertTile(new h.context.Tile({ x: 1, y: 0 }, 4096));
  game.move(3);
  assert.equal(game.won, true);
  game.undo();
  assert.equal(game.won, false, "undo allows play after a winning move");
  assert.equal(game.grid.cells[1][0].value, 4096);

  // Existing saves without undo fields still load and become undoable.
  game.storageManager.setGameState(game.serializeBoard());
  const legacy = h.createGame();
  assert.equal(legacy.undoCount, 0);
  assert.equal(legacy.history.length, 0);
  assert.equal(legacy.undoEnabled, false);
  legacy.move(3);
  legacy.enableUndo();
  legacy.undo();
  assert.equal(legacy.undoCount, 1);
  assert.equal(legacy.won, false);
  console.log("PASS: " + (pointer ? "pointer" : "touch") +
    " hold, undo UI, score, history, count, reload, game over, restart");
}
