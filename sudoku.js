/* ═══════════════════════════════════════════════
   Sudoku Zen — sudoku.js
   Full puzzle generator, solver, UI, sound
═══════════════════════════════════════════════ */

"use strict";

// ─── Audio ────────────────────────────────────────────────────────────────────
let soundOn = true;
let audioCtx = null;

function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, type, duration, vol = 0.12, delay = 0) {
  if (!soundOn) return;
  try {
    const ctx  = getCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.value = freq;
    const t = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  } catch(e) {}
}

const SFX = {
  place()   { playTone(660, "sine", 0.08, 0.1); },
  error()   { playTone(180, "sawtooth", 0.18, 0.12); playTone(140, "sawtooth", 0.14, 0.1, 0.15); },
  hint()    { [0,0.1,0.2].forEach((d,i) => playTone([440,554,659][i], "triangle", 0.12, 0.13, d)); },
  erase()   { playTone(320, "triangle", 0.06, 0.08); },
  note()    { playTone(880, "sine", 0.05, 0.07); },
  select()  { playTone(500, "sine", 0.04, 0.07); },
  start()   { [0,0.1,0.2,0.32].forEach((d,i) => playTone([330,440,550,660][i], "triangle", 0.15, 0.15, d)); },
  complete(){ [0,0.1,0.2,0.3,0.42,0.55].forEach((d,i) => playTone([523,659,784,880,1047,1319][i], "sine", 0.22, 0.17, d)); },
  fail()    { playTone(220,"sawtooth",0.25,0.13); playTone(180,"sawtooth",0.3,0.12,0.22); },
};

// ─── Sudoku Generator / Solver ────────────────────────────────────────────────

function emptyGrid() { return Array.from({length:9}, () => new Array(9).fill(0)); }

function isValid(grid, row, col, num) {
  for (let i = 0; i < 9; i++) {
    if (grid[row][i] === num) return false;
    if (grid[i][col] === num) return false;
  }
  const br = Math.floor(row/3)*3, bc = Math.floor(col/3)*3;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      if (grid[br+r][bc+c] === num) return false;
  return true;
}

function shuffle(arr) {
  for (let i = arr.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
  return arr;
}

function fillGrid(grid) {
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (grid[row][col] === 0) {
        const nums = shuffle([1,2,3,4,5,6,7,8,9]);
        for (const num of nums) {
          if (isValid(grid, row, col, num)) {
            grid[row][col] = num;
            if (fillGrid(grid)) return true;
            grid[row][col] = 0;
          }
        }
        return false;
      }
    }
  }
  return true;
}

function countSolutions(grid, limit = 2) {
  let count = 0;
  function solve() {
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (grid[row][col] === 0) {
          for (let num = 1; num <= 9; num++) {
            if (isValid(grid, row, col, num)) {
              grid[row][col] = num;
              solve();
              grid[row][col] = 0;
              if (count >= limit) return;
            }
          }
          return;
        }
      }
    }
    count++;
  }
  solve();
  return count;
}

function generatePuzzle(clues) {
  const solution = emptyGrid();
  fillGrid(solution);

  const puzzle = solution.map(r => [...r]);
  const cells  = shuffle(Array.from({length:81}, (_,i) => i));
  let removed  = 0;
  const target = 81 - clues;

  for (const idx of cells) {
    if (removed >= target) break;
    const row = Math.floor(idx/9), col = idx%9;
    const backup = puzzle[row][col];
    puzzle[row][col] = 0;
    const copy = puzzle.map(r=>[...r]);
    if (countSolutions(copy, 2) !== 1) {
      puzzle[row][col] = backup; // restore if ambiguous
    } else {
      removed++;
    }
  }

  return { puzzle, solution };
}

// ─── Game State ────────────────────────────────────────────────────────────────
const CLUES = { easy: 36, medium: 28, hard: 22 };
const MAX_MISTAKES = 3;
const MAX_HINTS    = 3;

let G = {}; // global game state

function initGame(diff) {
  const { puzzle, solution } = generatePuzzle(CLUES[diff]);

  G = {
    diff,
    puzzle,                              // original puzzle (given cells)
    solution,                            // full solution
    board:    puzzle.map(r=>[...r]),     // player's working board
    notes:    Array.from({length:9}, ()=>Array.from({length:9}, ()=>new Set())),
    given:    puzzle.map(r=>r.map(v=>v!==0)),
    selected: null,                      // {row,col}
    mistakes: 0,
    hintsLeft:MAX_HINTS,
    hintsUsed:0,
    noteMode: false,
    history:  [],
    timerSec: 0,
    timerRef: null,
    filledCount: 0,
  };

  // count pre-filled
  G.filledCount = puzzle.flat().filter(v=>v!==0).length;
}

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const S = {
  start:    document.getElementById("screen-start"),
  game:     document.getElementById("screen-game"),
  end:      document.getElementById("screen-end"),
};

const E = {
  diffTabs:   document.querySelectorAll(".diff-tab"),
  btnStart:   document.getElementById("btn-start"),
  btnSoundS:  document.getElementById("btn-sound-start"),
  miniDemo:   document.getElementById("mini-demo"),

  board:      document.getElementById("sudoku-board"),
  hdrDiff:    document.getElementById("hdr-diff"),
  hdrTimer:   document.getElementById("hdr-timer"),
  hdrMistakes:document.getElementById("hdr-mistakes"),
  btnBack:    document.getElementById("btn-back"),
  btnNotes:   document.getElementById("btn-notes"),
  btnErase:   document.getElementById("btn-erase"),
  btnHintG:   document.getElementById("btn-hint-game"),
  btnUndo:    document.getElementById("btn-undo"),
  hintCount:  document.getElementById("hint-count"),
  numpad:     document.getElementById("numpad"),
  progressFill: document.getElementById("progress-fill"),
  progressLbl:  document.getElementById("progress-label"),

  endBadge:   document.getElementById("end-badge"),
  endHeading: document.getElementById("end-heading"),
  endSub:     document.getElementById("end-sub"),
  esTime:     document.getElementById("es-time"),
  esMistakes: document.getElementById("es-mistakes"),
  esHints:    document.getElementById("es-hints"),
  esStars:    document.getElementById("es-stars"),
  endMsg:     document.getElementById("end-msg"),
  btnNewPuzzle:document.getElementById("btn-new-puzzle"),
  btnMenuEnd: document.getElementById("btn-menu-end"),
  inkSplash:  document.getElementById("ink-splash"),
  btnPause:   document.getElementById("btn-pause"),
  btnResume:  document.getElementById("btn-resume"),
  pauseOverlay:document.getElementById("pause-overlay"),
};

// ─── Screen Management ────────────────────────────────────────────────────────
function showScreen(name) {
  Object.entries(S).forEach(([k,el]) => el.classList.toggle("active", k===name));
}

// ─── Mini Demo Grid (start screen) ───────────────────────────────────────────
const DEMO = [
  5,3,0, 0,7,0, 0,0,0,
  6,0,0, 1,9,5, 0,0,0,
  0,9,8, 0,0,0, 0,6,0,
  8,0,0, 0,6,0, 0,0,3,
  4,0,0, 8,0,3, 0,0,1,
  7,0,0, 0,2,0, 0,0,6,
  0,6,0, 0,0,0, 2,8,0,
  0,0,0, 4,1,9, 0,0,5,
  0,0,0, 0,8,0, 0,7,9,
];

function buildMiniDemo() {
  E.miniDemo.innerHTML = "";
  DEMO.forEach((v, i) => {
    const row = Math.floor(i/9), col = i%9;
    const cell = document.createElement("div");
    cell.className = "mgd-cell" + (v ? " given" : "");
    if (col === 2 || col === 5) cell.classList.add("box-r");
    if (row === 2 || row === 5) cell.classList.add("box-b");
    cell.textContent = v || "";
    E.miniDemo.appendChild(cell);
  });
}

// ─── Board Rendering ──────────────────────────────────────────────────────────
let cellEls = [];

function buildBoard() {
  E.board.innerHTML = "";
  cellEls = [];
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const cell = document.createElement("div");
      cell.className = "s-cell";
      if (col === 2 || col === 5) cell.classList.add("br");
      if (row === 2 || row === 5) cell.classList.add("bb");
      cell.dataset.row = row;
      cell.dataset.col = col;
      cell.addEventListener("click", () => onCellClick(row, col));
      E.board.appendChild(cell);
      cellEls.push(cell);
    }
  }
  renderBoard();
}

function cellEl(row, col) { return cellEls[row*9+col]; }

function renderBoard() {
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      renderCell(row, col);
    }
  }
  updateProgress();
  updateNumpadExhaustion();
}

function renderCell(row, col) {
  const el    = cellEl(row, col);
  const val   = G.board[row][col];
  const given = G.given[row][col];
  const notes = G.notes[row][col];
  const sel   = G.selected;

  // Classes
  el.className = "s-cell";
  if (col === 2 || col === 5) el.classList.add("br");
  if (row === 2 || row === 5) el.classList.add("bb");
  if (given) el.classList.add("given");

  // Highlight
  if (sel) {
    const [sr, sc] = [sel.row, sel.col];
    if (row === sr && col === sc) {
      el.classList.add("selected");
    } else if (row === sr || col === sc ||
               (Math.floor(row/3)===Math.floor(sr/3) && Math.floor(col/3)===Math.floor(sc/3))) {
      el.classList.add("highlight");
    }
    // Same number highlight
    const selVal = G.board[sr][sc];
    if (selVal && val === selVal) el.classList.add("same-num");
  }

  // Content
  if (val !== 0) {
    el.innerHTML = "";
    el.textContent = val;
    if (!given) el.classList.add("user-filled");
  } else if (notes.size > 0) {
    // Render notes
    el.innerHTML = "";
    const ng = document.createElement("div");
    ng.className = "notes-grid";
    for (let n = 1; n <= 9; n++) {
      const nd = document.createElement("div");
      nd.className = "note-digit";
      nd.textContent = notes.has(n) ? n : "";
      ng.appendChild(nd);
    }
    el.appendChild(ng);
  } else {
    el.innerHTML = "";
    el.textContent = "";
  }
}

function highlightAll() {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      renderCell(r, c);
}

// ─── Cell Interaction ─────────────────────────────────────────────────────────
function onCellClick(row, col) {
  if (paused) return;
  if (G.selected && G.selected.row === row && G.selected.col === col) {
    G.selected = null;
  } else {
    G.selected = { row, col };
    SFX.select();
  }
  highlightAll();
}

function onNumInput(num) {
  if (!G.selected) return;
  const { row, col } = G.selected;
  if (G.given[row][col]) return;

  if (G.noteMode) {
    // Toggle note
    const notes = G.notes[row][col];
    if (G.board[row][col] !== 0) return; // can't note on filled cell
    notes.has(num) ? notes.delete(num) : notes.add(num);
    SFX.note();
    renderCell(row, col);
    return;
  }

  // Push history
  G.history.push({
    row, col,
    prevVal: G.board[row][col],
    prevNotes: new Set(G.notes[row][col]),
  });

  // Clear notes for this cell
  G.notes[row][col].clear();

  if (G.board[row][col] === num) {
    // Tap same number = erase
    G.board[row][col] = 0;
    SFX.erase();
    G.filledCount--;
    renderCell(row, col);
    updateProgress();
    return;
  }

  G.board[row][col] = num;

  if (num !== G.solution[row][col]) {
    // Wrong
    G.mistakes++;
    E.hdrMistakes.textContent = `${G.mistakes} / ${MAX_MISTAKES}`;
    SFX.error();
    const el = cellEl(row, col);
    el.classList.add("error", "user-filled");
    el.textContent = num;
    setTimeout(() => {
      G.board[row][col] = 0;
      G.filledCount = Math.max(0, G.filledCount);
      renderCell(row, col);
      if (G.mistakes >= MAX_MISTAKES) endGame(false);
    }, 700);
    return;
  }

  // Correct placement
  G.filledCount++;
  SFX.place();
  renderBoard();

  // Animate placed cell
  const el = cellEl(row, col);
  el.classList.add("complete-flash");
  setTimeout(() => el.classList.remove("complete-flash"), 400);

  // Remove this number from notes in same row/col/box
  clearNotesForPlacement(row, col, num);

  // Check win
  if (isBoardComplete()) {
    setTimeout(() => endGame(true), 400);
  }
}

function clearNotesForPlacement(row, col, num) {
  const br = Math.floor(row/3)*3, bc = Math.floor(col/3)*3;
  for (let i = 0; i < 9; i++) {
    G.notes[row][i].delete(num);
    G.notes[i][col].delete(num);
  }
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      G.notes[br+r][bc+c].delete(num);
  highlightAll();
}

function isBoardComplete() {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (G.board[r][c] !== G.solution[r][c]) return false;
  return true;
}

// ─── Tools ───────────────────────────────────────────────────────────────────
E.btnNotes.addEventListener("click", () => {
  G.noteMode = !G.noteMode;
  E.btnNotes.classList.toggle("active-tool", G.noteMode);
});

E.btnErase.addEventListener("click", () => {
  if (!G.selected) return;
  const { row, col } = G.selected;
  if (G.given[row][col]) return;
  G.history.push({ row, col, prevVal: G.board[row][col], prevNotes: new Set(G.notes[row][col]) });
  if (G.board[row][col] !== 0) G.filledCount--;
  G.board[row][col] = 0;
  G.notes[row][col].clear();
  SFX.erase();
  renderBoard();
});

E.btnUndo.addEventListener("click", () => {
  if (!G.history.length) return;
  const last = G.history.pop();
  const wasVal = G.board[last.row][last.col];
  if (wasVal !== 0 && last.prevVal === 0) G.filledCount--;
  if (wasVal === 0 && last.prevVal !== 0) G.filledCount++;
  G.board[last.row][last.col] = last.prevVal;
  G.notes[last.row][last.col] = last.prevNotes;
  SFX.erase();
  renderBoard();
});

E.btnHintG.addEventListener("click", () => {
  if (G.hintsLeft <= 0) return;
  // Find a random empty correct cell
  const empties = [];
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (G.board[r][c] === 0) empties.push({r,c});
  if (!empties.length) return;

  const {r, c} = empties[Math.floor(Math.random()*empties.length)];
  G.history.push({ row:r, col:c, prevVal:0, prevNotes: new Set(G.notes[r][c]) });
  G.board[r][c] = G.solution[r][c];
  G.notes[r][c].clear();
  G.filledCount++;
  G.hintsLeft--;
  G.hintsUsed++;
  E.hintCount.textContent = `(${G.hintsLeft})`;
  if (G.hintsLeft === 0) E.btnHintG.style.opacity = "0.4";

  SFX.hint();
  clearNotesForPlacement(r, c, G.solution[r][c]);
  const el = cellEl(r, c);
  el.classList.add("hint-filled");
  setTimeout(() => el.classList.remove("hint-filled"), 500);
  G.selected = {row:r, col:c};
  renderBoard();

  if (isBoardComplete()) setTimeout(() => endGame(true), 400);
});

// ─── Keyboard ────────────────────────────────────────────────────────────────
document.addEventListener("keydown", e => {
  if (!S.game.classList.contains("active")) return;
  if (e.key === "Escape" || e.key === "p" || e.key === "P") { paused ? resume() : pause(); return; }
  if (paused) return;

  if (e.key >= "1" && e.key <= "9") { onNumInput(parseInt(e.key)); return; }
  if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") {
    E.btnErase.click(); return;
  }

  // Arrow navigation
  if (!G.selected) { G.selected = {row:4,col:4}; highlightAll(); return; }
  const {row,col} = G.selected;
  const moves = { ArrowUp:[-1,0], ArrowDown:[1,0], ArrowLeft:[0,-1], ArrowRight:[0,1] };
  if (moves[e.key]) {
    e.preventDefault();
    const [dr,dc] = moves[e.key];
    G.selected = { row: Math.max(0,Math.min(8,row+dr)), col: Math.max(0,Math.min(8,col+dc)) };
    highlightAll();
  }
  if (e.key === "n" || e.key === "N") E.btnNotes.click();
});

// ─── Numpad ───────────────────────────────────────────────────────────────────
E.numpad.querySelectorAll(".num-btn").forEach(btn => {
  btn.addEventListener("click", () => onNumInput(parseInt(btn.dataset.num)));
});

function updateNumpadExhaustion() {
  for (let n = 1; n <= 9; n++) {
    let count = 0;
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        if (G.board[r][c] === n) count++;
    const btn = E.numpad.querySelector(`[data-num="${n}"]`);
    btn.classList.toggle("exhausted", count >= 9);
  }
}

// ─── Progress ────────────────────────────────────────────────────────────────
function updateProgress() {
  const pct = (G.filledCount / 81) * 100;
  E.progressFill.style.width = `${pct}%`;
  E.progressLbl.textContent  = `${G.filledCount} / 81`;
}

// ─── Timer ───────────────────────────────────────────────────────────────────
function startTimer() {
  clearInterval(G.timerRef);
  G.timerSec = 0;
  G.timerRef = setInterval(() => {
    G.timerSec++;
    E.hdrTimer.textContent = formatTime(G.timerSec);
  }, 1000);
}

function formatTime(sec) {
  const m = String(Math.floor(sec/60)).padStart(2,"0");
  const s = String(sec%60).padStart(2,"0");
  return `${m}:${s}`;
}

// ─── Difficulty Selection ─────────────────────────────────────────────────────
let selectedDiff = "easy";
E.diffTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    E.diffTabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    selectedDiff = tab.dataset.diff;
  });
});

// ─── Sound Toggle ─────────────────────────────────────────────────────────────
E.btnSoundS.addEventListener("click", () => {
  soundOn = !soundOn;
  E.btnSoundS.textContent = soundOn ? "🔊 Sound On" : "🔇 Sound Off";
});

// ─── Back button ─────────────────────────────────────────────────────────────
E.btnBack.addEventListener("click", () => {
  clearInterval(G.timerRef);
  showScreen("start");
});

// ─── Start Game ───────────────────────────────────────────────────────────────
E.btnStart.addEventListener("click", () => {
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  getCtx();

  showScreen("game");
  paused = false;
  E.pauseOverlay.classList.add("hidden");
  E.btnPause.textContent = "⏸";
  E.board.innerHTML = "";
  cellEls = [];
  E.hdrDiff.textContent      = selectedDiff.charAt(0).toUpperCase() + selectedDiff.slice(1);
  E.hdrMistakes.textContent  = `0 / ${MAX_MISTAKES}`;
  E.hdrTimer.textContent     = "00:00";
  E.hintCount.textContent    = `(${MAX_HINTS})`;
  E.btnHintG.style.opacity   = "1";
  E.btnNotes.classList.remove("active-tool");

  // Show loading briefly, then generate (heavy for hard)
  setTimeout(() => {
    initGame(selectedDiff);
    buildBoard();
    startTimer();
    SFX.start();
  }, 60);
});

// ─── End Game ─────────────────────────────────────────────────────────────────
function endGame(won) {
  clearInterval(G.timerRef);

  const time  = formatTime(G.timerSec);
  const stars = calcStars(won, G.mistakes, G.hintsUsed, G.timerSec, G.diff);

  E.esTime.textContent     = time;
  E.esMistakes.textContent = G.mistakes;
  E.esHints.textContent    = G.hintsUsed;
  E.esStars.textContent    = "★".repeat(stars) + "☆".repeat(3-stars);

  if (won) {
    E.endBadge.textContent   = stars === 3 ? "🏆" : stars === 2 ? "🥈" : "✅";
    E.endHeading.textContent = stars === 3 ? "Flawless!" : stars === 2 ? "Well Solved!" : "Puzzle Complete!";
    E.endSub.textContent     = "Your results";
    E.endMsg.textContent     = wonMessage(stars, G.diff, G.timerSec);
    SFX.complete();
    spawnInkSplash();
  } else {
    E.endBadge.textContent   = "💔";
    E.endHeading.textContent = "Too Many Mistakes";
    E.endSub.textContent     = "Better luck next time";
    E.endMsg.textContent     = "Three strikes and the grid locks. Try again — each puzzle makes you sharper.";
    SFX.fail();
  }

  showScreen("end");
}

function calcStars(won, mistakes, hints, sec, diff) {
  if (!won) return 0;
  let s = 3;
  if (mistakes > 0) s--;
  if (hints > 0)    s--;
  // Time bonus — forgive more on hard
  const timeLimits = { easy: 300, medium: 600, hard: 1200 };
  if (sec > timeLimits[diff] && s === 3) s = 2;
  return Math.max(1, s);
}

function wonMessage(stars, diff, sec) {
  if (stars === 3) return `A perfect solve on ${diff} in ${formatTime(sec)}. No mistakes, no hints — pure logic!`;
  if (stars === 2) return `Great work finishing the ${diff} puzzle in ${formatTime(sec)}. A clean solve with minor help.`;
  return `You completed the ${diff} puzzle! Keep practising for a cleaner run next time.`;
}

// ─── Ink Splash ───────────────────────────────────────────────────────────────
function spawnInkSplash() {
  E.inkSplash.innerHTML = "";
  const colors = ["#2d6a4f","#52b788","#b7e4c7","#c9820a","#8b5cf6","#b5451b"];
  const cx = window.innerWidth/2, cy = window.innerHeight/2;
  for (let i = 0; i < 40; i++) {
    const dot = document.createElement("div");
    dot.className = "ink-dot";
    const size = 6 + Math.random()*18;
    const angle = Math.random()*Math.PI*2;
    const dist  = 80 + Math.random()*280;
    dot.style.cssText = `
      width:${size}px; height:${size}px;
      left:${cx}px; top:${cy}px;
      background:${colors[Math.floor(Math.random()*colors.length)]};
      --tx:${Math.cos(angle)*dist}px;
      --ty:${Math.sin(angle)*dist}px;
      animation-duration:${0.6+Math.random()*0.8}s;
      animation-delay:${Math.random()*0.3}s;
    `;
    E.inkSplash.appendChild(dot);
  }
  setTimeout(() => { E.inkSplash.innerHTML = ""; }, 2000);
}

// ─── End screen buttons ───────────────────────────────────────────────────────
E.btnNewPuzzle.addEventListener("click", () => {
  showScreen("game");
  paused = false;
  E.pauseOverlay.classList.add("hidden");
  E.btnPause.textContent = "⏸";
  E.board.innerHTML = "";
  cellEls = [];
  E.hdrDiff.textContent      = G.diff.charAt(0).toUpperCase() + G.diff.slice(1);
  E.hdrMistakes.textContent  = `0 / ${MAX_MISTAKES}`;
  E.hdrTimer.textContent     = "00:00";
  E.hintCount.textContent    = `(${MAX_HINTS})`;
  E.btnHintG.style.opacity   = "1";
  E.btnNotes.classList.remove("active-tool");
  setTimeout(() => {
    initGame(G.diff);
    buildBoard();
    startTimer();
    SFX.start();
  }, 60);
});

E.btnMenuEnd.addEventListener("click", () => showScreen("start"));

// ─── Pause / Resume ───────────────────────────────────────────────────────────
let paused = false;

function pause() {
  if (paused || !S.game.classList.contains("active")) return;
  paused = true;
  clearInterval(G.timerRef);
  E.pauseOverlay.classList.remove("hidden");
  E.btnPause.textContent = "▶";
  E.btnPause.title = "Resume game";
}

function resume() {
  if (!paused) return;
  paused = false;
  E.pauseOverlay.classList.add("hidden");
  E.btnPause.textContent = "⏸";
  E.btnPause.title = "Pause game";
  // Restart timer from where it left off
  G.timerRef = setInterval(() => {
    G.timerSec++;
    E.hdrTimer.textContent = formatTime(G.timerSec);
  }, 1000);
}

E.btnPause.addEventListener("click",  () => paused ? resume() : pause());
E.btnResume.addEventListener("click", () => resume());

// Pause on tab/window blur
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});

// ─── Init ─────────────────────────────────────────────────────────────────────
buildMiniDemo();
