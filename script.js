
/* ==================================================
   PIXEL PARTY | GAME ENGINE
   GitHub Pages / Vanilla JavaScript
================================================== */

const $ = (id) => document.getElementById(id);

const games = {
  quick: { title: "QUICK TAP", bestKey: "quick", score: 0 },
  dodge: { title: "DODGE RUSH", bestKey: "dodge", score: 0 },
  memory: { title: "MEMORY FLIP", bestKey: "memory", score: 0 }
};

const STORAGE = "pixelParty_v1";
const area = $("gameArea");
const arcade = $("arcade");
const message = $("gameMessage");
const actionBtn = $("actionBtn");

let currentGame = null;
let running = false;
let soundOn = true;
let score = 0;
let timer = 0;
let tickHandle = null;
let spawnHandle = null;
let gameStartedAt = 0;
let playCount = 0;
let audioContext = null;

let player = { x: 50, y: 50, size: 24 };
let obstacles = [];
let keys = new Set();
let dodgeLastTime = 0;
let memory = { cards: [], open: [], matched: 0, moves: 0, locked: false };
let quickTarget = null;

function readRecords() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE) || "{}");
    return {
      best: { quick: 0, dodge: 0, memory: 0, ...(data.best || {}) },
      plays: Math.max(0, Number(data.plays) || 0)
    };
  } catch {
    return { best: { quick: 0, dodge: 0, memory: 0 }, plays: 0 };
  }
}

let records = readRecords();
playCount = records.plays;

function saveRecords() {
  try {
    localStorage.setItem(STORAGE, JSON.stringify({
      best: records.best,
      plays: playCount
    }));
  } catch (error) {
    console.warn("Records could not be saved.", error);
  }
  updateRecordsUI();
}

function updateRecordsUI() {
  for (const id of ["quick", "dodge", "memory"]) {
    $(`best-${id}`).textContent = records.best[id] || 0;
    $(`record-${id}`).innerHTML =
      `${records.best[id] || 0} <small>PTS</small>`;
  }

  $("totalBest").textContent = Math.max(
    0, ...Object.values(records.best).map(Number)
  );
  $("playCount").textContent = playCount;
  $("currentBest").textContent =
    currentGame ? records.best[currentGame] || 0 : 0;
}

function beep(frequency = 600, duration = 0.06, type = "square") {
  if (!soundOn) return;

  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") audioContext.resume();

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.045, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001, audioContext.currentTime + duration
    );

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  } catch {
    // Audio is optional; the game remains playable without it.
  }
}

function clearGameTimers() {
  clearInterval(tickHandle);
  clearInterval(spawnHandle);
  tickHandle = null;
  spawnHandle = null;
  running = false;
  keys.clear();
}

function setMessage(title, text, buttonText, buttonAction = startGame) {
  $("messageTitle").textContent = title;
  $("messageText").textContent = text;
  actionBtn.textContent = buttonText;
  actionBtn.onclick = buttonAction;
  message.classList.remove("hidden");
}

function selectGame(id) {
  clearGameTimers();
  currentGame = id;
  score = 0;
  timer = id === "quick" ? 30 : 0;
  obstacles = [];
  quickTarget = null;

  $("gameTitle").textContent = games[id].title;
  $("gameStatus").textContent = "READY";
  $("gameTimer").textContent = id === "quick" ? "TIME 30" : "TIME 00";
  $("gameScore").textContent = "SCORE 0";
  $("gameHelp").textContent = {
    quick: "ターゲットをクリック！制限時間は30秒。",
    dodge: "WASD / 矢印キーで移動。障害物にぶつからないように逃げよう。",
    memory: "カードを2枚選んで同じ絵柄のペアを見つけよう。"
  }[id];

  $("memoryControls").classList.toggle("hidden", id !== "memory");
  $("currentBest").textContent = records.best[id] || 0;

  area.replaceChildren();
  area.style.touchAction = id === "dodge" ? "none" : "manipulation";
  arcade.classList.remove("hidden");
  arcade.scrollIntoView({ behavior: "smooth", block: "start" });

  if (id === "memory") {
    createMemoryBoard();
    setMessage("READY PLAYER ONE", "カードのペアを全部揃えよう！", "▶ START GAME");
  } else {
    setMessage(
      "READY PLAYER ONE",
      id === "quick"
        ? "30秒でできるだけ多くのターゲットをタップ！"
        : "障害物を避けて、できるだけ長く生き残れ！",
      "▶ START GAME"
    );
  }
}

function startGame() {
  if (!currentGame || running) return;

  clearGameTimers();
  running = true;
  score = 0;
  gameStartedAt = performance.now();
  obstacles = [];
  $("gameStatus").textContent = "PLAYING";
  $("gameScore").textContent = "SCORE 0";
  message.classList.add("hidden");
  beep(700, 0.09);

  if (currentGame === "quick") {
    timer = 30;
    spawnQuickTarget();
    tickHandle = setInterval(() => {
      if (!running) return;
      timer--;
      $("gameTimer").textContent = `TIME ${timer}`;
      if (timer <= 0) finishGame();
    }, 1000);
  } else if (currentGame === "dodge") {
    timer = 0;
    player = { x: 50, y: 55, size: 24 };
    area.replaceChildren();
    createPlayer();
    addTouchPad();
    spawnHandle = setInterval(spawnObstacle, 650);
    dodgeLastTime = performance.now();
    requestAnimationFrame(dodgeLoop);
  } else if (currentGame === "memory") {
    memory = {
      cards: memory.cards,
      open: [],
      matched: 0,
      moves: 0,
      locked: false
    };
    area.querySelectorAll(".memory-tile").forEach((tile) => {
      tile.disabled = false;
    });
    updateMemoryHUD();
  }

  if (currentGame !== "memory") playCount++;
  saveRecords();
}

function finishGame() {
  if (!running) return;

  const finishedGame = currentGame;
  const finalScore = Math.max(0, Math.floor(score));
  clearGameTimers();
  $("gameStatus").textContent = "GAME OVER";

  if (finalScore > (records.best[finishedGame] || 0)) {
    records.best[finishedGame] = finalScore;
    beep(900, 0.15);
    setTimeout(() => beep(1200, 0.18), 120);
  } else {
    beep(220, 0.18);
  }

  saveRecords();
  $("currentBest").textContent = records.best[finishedGame] || 0;

  const summary = finishedGame === "quick"
    ? `30秒終了！ ${finalScore}ポイント獲得。`
    : finishedGame === "dodge"
      ? `${timer}秒生存！ スコア ${finalScore}。`
      : `全ペア達成！ ${memory.moves}手でクリア。`;

  setMessage(
    "GAME OVER!",
    summary,
    "↻ PLAY AGAIN",
    () => selectGame(finishedGame)
  );

  // Finish screen button starts a fresh run on the next click.
  actionBtn.onclick = () => {
    selectGame(finishedGame);
    startGame();
  };
}

function updateScore(value) {
  score = Math.max(0, Math.floor(value));
  $("gameScore").textContent = `SCORE ${score}`;
}

/* QUICK TAP */

function spawnQuickTarget() {
  if (!running || currentGame !== "quick") return;

  if (quickTarget) quickTarget.remove();

  const target = document.createElement("button");
  target.className = "target";
  target.type = "button";
  target.textContent = ["✦", "✹", "★", "◆"][Math.floor(Math.random() * 4)];
  target.setAttribute("aria-label", "ターゲットをタップ");
  target.style.left = `${5 + Math.random() * 83}%`;
  target.style.top = `${5 + Math.random() * 70}%`;

  target.addEventListener("click", () => {
    if (!running || currentGame !== "quick") return;
    updateScore(score + 10);
    beep(500 + Math.random() * 400, 0.04);
    target.remove();
    quickTarget = null;
    spawnQuickTarget();
  });

  quickTarget = target;
  area.appendChild(target);
}

/* DODGE RUSH */

function createPlayer() {
  const el = document.createElement("div");
  el.className = "player-dot";
  el.id = "playerDot";
  el.textContent = "◆";
  area.appendChild(el);
  drawPlayer();
}

function drawPlayer() {
  const el = $("playerDot");
  if (!el) return;
  el.style.left = `${player.x}%`;
  el.style.top = `${player.y}%`;
}

function addTouchPad() {
  const pad = document.createElement("div");
  pad.style.cssText =
    "position:absolute;left:10px;bottom:10px;display:grid;" +
    "grid-template-columns:repeat(3,38px);gap:3px;z-index:5;opacity:.85";

  const buttons = [
    ["", 0, 0], ["▲", 0, -1], ["", 0, 0],
    ["◀", -1, 0], ["●", 0, 0], ["▶", 1, 0],
    ["", 0, 0], ["▼", 0, 1], ["", 0, 0]
  ];

  buttons.forEach(([label, dx, dy]) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.cssText =
      "width:38px;height:38px;background:#26264c;color:#5cf5ee;" +
      "border:1px solid #515180;font-size:17px;touch-action:none";
    btn.disabled = !label || (dx === 0 && dy === 0);

    const down = (event) => {
      event.preventDefault();
      if (!running) return;
      keys.add(`touch-${dx}-${dy}`);
    };
    const up = () => keys.delete(`touch-${dx}-${dy}`);

    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("pointerleave", up);
    pad.appendChild(btn);
  });

  area.appendChild(pad);
}

function spawnObstacle() {
  if (!running || currentGame !== "dodge") return;

  const el = document.createElement("div");
  el.className = "obstacle";
  el.textContent = Math.random() > 0.5 ? "✹" : "✦";
  const size = 20 + Math.random() * 12;
  const x = Math.random() * 94;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.left = `${x}%`;
  el.style.top = "-28px";
  area.appendChild(el);

  obstacles.push({
    el,
    x,
    y: -28,
    size,
    speed: 1.2 + Math.random() * 1.5 + timer * 0.018
  });
}

function dodgeLoop(now) {
  if (!running || currentGame !== "dodge") return;

  const dt = Math.min((now - dodgeLastTime) / 16.67, 2);
  dodgeLastTime = now;

  const left = keys.has("ArrowLeft") || keys.has("a") || keys.has("touch--1-0");
  const right = keys.has("ArrowRight") || keys.has("d") || keys.has("touch-1-0");
  const up = keys.has("ArrowUp") || keys.has("w") || keys.has("touch-0--1");
  const down = keys.has("ArrowDown") || keys.has("s") || keys.has("touch-0-1");

  player.x += ((right ? 1 : 0) - (left ? 1 : 0)) * 0.85 * dt;
  player.y += ((down ? 1 : 0) - (up ? 1 : 0)) * 0.85 * dt;
  player.x = Math.max(1, Math.min(95, player.x));
  player.y = Math.max(1, Math.min(88, player.y));
  drawPlayer();

  const playerRect = {
    x: area.clientWidth * player.x / 100,
    y: area.clientHeight * player.y / 100,
    w: player.size,
    h: player.size
  };

  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.y += o.speed * dt;
    o.el.style.top = `${o.y}px`;

    const ox = area.clientWidth * o.x / 100;
    const oy = o.y;
    const hit =
      playerRect.x < ox + o.size - 5 &&
      playerRect.x + playerRect.w > ox + 5 &&
      playerRect.y < oy + o.size - 5 &&
      playerRect.y + playerRect.h > oy + 5;

    if (hit) {
      finishGame();
      return;
    }

    if (o.y > area.clientHeight + 35) {
      o.el.remove();
      obstacles.splice(i, 1);
      updateScore(score + 5);
    }
  }

  const elapsed = Math.floor((now - gameStartedAt) / 1000);
  timer = elapsed;
  $("gameTimer").textContent = `TIME ${String(timer).padStart(2, "0")}`;
  $("gameStatus").textContent = `WAVE ${Math.floor(timer / 10) + 1}`;

  requestAnimationFrame(dodgeLoop);
}

/* MEMORY FLIP */

function createMemoryBoard() {
  const symbols = ["★", "◆", "♥", "☀", "♠", "✿", "♫", "☾"];
  memory = {
    cards: [...symbols, ...symbols].sort(() => Math.random() - 0.5),
    open: [],
    matched: 0,
    moves: 0,
    locked: false
  };

  area.replaceChildren();
  area.classList.add("memory-board");

  memory.cards.forEach((symbol, index) => {
    const tile = document.createElement("button");
    tile.className = "memory-tile";
    tile.type = "button";
    tile.textContent = "?";
    tile.dataset.index = index;
    tile.setAttribute("aria-label", `カード ${index + 1}`);
    tile.addEventListener("click", () => flipCard(index, tile));
    area.appendChild(tile);
  });

  updateMemoryHUD();
}

function flipCard(index, tile) {
  if (!running || memory.locked || tile.classList.contains("matched") ||
      memory.open.some((item) => item.index === index)) return;

  tile.textContent = memory.cards[index];
  tile.classList.add("flipped");
  memory.open.push({ index, tile });
  beep(450, 0.04);

  if (memory.open.length === 2) {
    memory.moves++;
    memory.locked = true;
    const [first, second] = memory.open;

    if (memory.cards[first.index] === memory.cards[second.index]) {
      first.tile.classList.add("matched");
      second.tile.classList.add("matched");
      memory.matched += 2;
      memory.open = [];
      memory.locked = false;
      beep(800, 0.1);

      if (memory.matched === memory.cards.length) {
        // More points for finishing in fewer moves.
        updateScore(Math.max(10, 1000 - memory.moves * 30));
        $("gameTimer").textContent = `MOVES ${memory.moves}`;
        finishGame();
        return;
      }
    } else {
      setTimeout(() => {
        if (currentGame !== "memory") return;
        first.tile.textContent = "?";
        second.tile.textContent = "?";
        first.tile.classList.remove("flipped");
        second.tile.classList.remove("flipped");
        memory.open = [];
        memory.locked = false;
      }, 650);
    }
  }

  updateMemoryHUD();
}

function updateMemoryHUD() {
  $("gameScore").textContent = `PAIRS ${memory.matched / 2} / 8`;
  $("gameTimer").textContent = `MOVES ${memory.moves}`;
}

function retryMemory() {
  if (currentGame !== "memory") return;
  clearGameTimers();
  createMemoryBoard();
  setMessage("READY PLAYER ONE", "カードのペアを全部揃えよう！", "▶ START GAME");
}

/* INPUTS & UI */

document.addEventListener("keydown", (event) => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(key)) {
    event.preventDefault();
  }

  keys.add(key);

  if (key === " " && running && currentGame === "quick" && quickTarget) {
    quickTarget.click();
  }
});

document.addEventListener("keyup", (event) => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  keys.delete(key);
});

window.addEventListener("blur", () => keys.clear());

document.querySelectorAll("[data-game]").forEach((button) => {
  button.addEventListener("click", () => selectGame(button.dataset.game));
});

$("startBtn").addEventListener("click", () => {
  selectGame("quick");
  startGame();
});

$("exitBtn").addEventListener("click", () => {
  clearGameTimers();
  currentGame = null;
  arcade.classList.add("hidden");
  area.classList.remove("memory-board");
  area.replaceChildren();
});

actionBtn.addEventListener("click", () => {
  if (currentGame === "memory" && running) return;
});

$("resetMemory").addEventListener("click", retryMemory);

$("soundToggle").addEventListener("click", () => {
  soundOn = !soundOn;
  $("soundToggle").textContent = soundOn ? "♫ SOUND ON" : "♫ SOUND OFF";
  if (soundOn) beep();
});

$("shareBtn").addEventListener("click", async () => {
  if (!currentGame) {
    alert("まずはミニゲームをプレイしてね！");
    return;
  }

  const text =
    `🎮 PIXEL PARTY\n${games[currentGame].title}\n` +
    `今回のスコア：${score}\n自己ベスト：${records.best[currentGame] || 0}\n` +
    `${location.href}`;

  try {
    if (navigator.share) {
      await navigator.share({ title: "PIXEL PARTY", text });
    } else if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      alert("スコアをコピーしたよ！友達に送って対決しよう！");
    } else {
      window.prompt("このスコアをコピーしてね！", text);
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      window.prompt("スコアをコピーしてね！", text);
    }
  }
});

$("resetRecords").addEventListener("click", () => {
  if (!confirm("すべての自己ベストとプレイ回数をリセットする？")) return;
  records = { best: { quick: 0, dodge: 0, memory: 0 }, plays: 0 };
  playCount = 0;
  saveRecords();
});

updateRecordsUI();
