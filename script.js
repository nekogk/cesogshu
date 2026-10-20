(() => {
  'use strict';

  /* ── 설정 ── */
  const N = 5;
  const MARGIN = 10;                         // 보드 가장자리 여백 (%)
  const CELL = (100 - 2 * MARGIN) / (N - 1); // 격자 간격 (%)
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const PROTECTED = new Set(['1,1', '1,3', '3,1', '3,3']); // 초기 보호 점
  const STORE_KEY = 'cesogshu-players';
  const AI_DEPTH = 4;      // 튜닝할 때와 같은 깊이
  const AI_DELAY = 450;    // 사람이 보기 편하게 두기 전에 잠깐 기다림 (ms)

  const DEFAULTS = {
    1: { name: '플레이어 1', color: '#a3db85' },
    2: { name: '플레이어 2', color: '#94d6ff' },
  };
  const players = {
    1: { ...DEFAULTS[1] },
    2: { ...DEFAULTS[2] },
  };

  /* ── 게임 상태 ── */
  let board, lines, current, recent, hasCaptured;
  let selecting, target, sources, winner;
  let history;             // 지금까지 나온 국면들 (AI가 반복 국면을 피하는 데 사용)
  let aiToken = 0;         // 새 게임·이름 변경 시 예약된 AI 수를 무효화하는 번호

  /* ── DOM ── */
  const $ = (s) => document.querySelector(s);
  const boardEl = $('#board');
  const linesEl = $('#lines');
  const statusEl = $('#status');
  const resultEl = $('#result');
  const resultText = $('#result-text');
  const pointEls = [];

  /* ── 유틸 ── */
  const pk = (r, c) => `${r},${c}`;
  const inBounds = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
  const pos = (i) => MARGIN + i * CELL;
  const nameOf = (p) => players[p].name || DEFAULTS[p].name;

  function lineKey(r1, c1, r2, c2) {
    if (r1 < r2 || (r1 === r2 && c1 < c2)) return `${r1},${c1}|${r2},${c2}`;
    return `${r2},${c2}|${r1},${c1}`;
  }
  const parseLine = (k) => k.split('|').map((p) => p.split(',').map(Number));
  const isProtected = (r, c) => !hasCaptured && PROTECTED.has(pk(r, c));

  /* ── 규칙 ── */
  // 인접한 자신의 점들
  function adjacentOwn(r, c, p) {
    const out = [];
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc) && board[nr][nc] === p) out.push([nr, nc]);
    }
    return out;
  }

  // 특정 점에 연결된 선의 개수 (소유자 무관)
  function connectedLines(r, c) {
    let n = 0;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc) && lines.has(lineKey(r, c, nr, nc))) n++;
    }
    return n;
  }

  // 특정 점에 연결된 선 제거 (다른 끝점이 교차점일 때만)
  function removeLinesAt(r, c) {
    const rm = [];
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const k = lineKey(r, c, nr, nc);
      if (lines.has(k) && connectedLines(nr, nc) >= 3) rm.push(k);
    }
    rm.forEach((k) => lines.delete(k));
  }

  // 서로 다른 색을 잇는 선 제거
  function cleanInvalidLines() {
    for (const k of [...lines]) {
      const [[r1, c1], [r2, c2]] = parseLine(k);
      const a = board[r1][c1], b = board[r2][c2];
      if (a !== null && b !== null && a !== b) lines.delete(k);
    }
  }

  // 플레이어 p가 (r, c)를 누를 수 있는지
  function canTake(r, c, p, ignoreRecent) {
    const v = board[r][c];
    if (isProtected(r, c)) return false;
    if (v === null) return adjacentOwn(r, c, p).length > 0;
    if (v === 3 - p) {
      if (!ignoreRecent && recent.has(pk(r, c))) return false;
      return connectedLines(r, c) === 1 && adjacentOwn(r, c, p).length > 0;
    }
    return false;
  }

  function canMove(p, ignoreRecent) {
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++)
        if (canTake(r, c, p, ignoreRecent)) return true;
    return false;
  }

  function endTurn(ignoreRecent) {
    current = 3 - current;
    history.push(snapshot());
    if (!canMove(current, ignoreRecent)) winner = 3 - current;
    render();
  }

  // 선을 그어 빈 점으로 이동
  function completeMove(tr, tc, sr, sc) {
    lines.add(lineKey(tr, tc, sr, sc));
    board[tr][tc] = current;
    cleanInvalidLines();
    recent.clear();
    endTurn(true);
  }

  // 상대 점을 먹음
  function capture(tr, tc, sr, sc) {
    const opponent = 3 - current;
    hasCaptured = true;
    recent.clear();

    removeLinesAt(tr, tc);
    board[tr][tc] = current;
    recent.add(pk(tr, tc));
    lines.add(lineKey(tr, tc, sr, sc));

    const visited = new Set([pk(tr, tc)]);
    captureConnected(tr, tc, opponent, visited);

    cleanInvalidLines();
    endTurn(false);
  }

  // 상대의 선으로 이어진 점들을 따라가며 먹음 (꺾이는 부분 포함)
  function captureConnected(r, c, opponent, visited) {
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (!inBounds(nr, nc) || visited.has(pk(nr, nc))) continue;

      const k = lineKey(r, c, nr, nc);
      if (board[nr][nc] !== opponent || !lines.has(k)) continue;
      if (connectedLines(nr, nc) >= 3) continue; // 교차점에서 멈춤

      visited.add(pk(nr, nc));
      removeLinesAt(nr, nc);
      board[nr][nc] = current;
      recent.add(pk(nr, nc));
      lines.add(k);
      captureConnected(nr, nc, opponent, visited);
    }
  }

  /* ── 입력 ── */
  function onPoint(r, c) {
    if (winner || isAI(current)) return;

    if (selecting) {
      if (!sources.some(([sr, sc]) => sr === r && sc === c)) return;
      const [tr, tc] = target;
      selecting = false; target = null; sources = [];
      if (board[tr][tc] === 3 - current) capture(tr, tc, r, c);
      else completeMove(tr, tc, r, c);
      return;
    }

    if (!canTake(r, c, current, false)) return;

    const src = adjacentOwn(r, c, current);
    const isCapture = board[r][c] !== null;
    if (src.length === 1) {
      (isCapture ? capture : completeMove)(r, c, src[0][0], src[0][1]);
    } else {
      selecting = true;
      target = [r, c];
      sources = src;
      render();
    }
  }

  /* ── 그리기 ── */
  function buildPoints() {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pt';
        btn.style.left = `${pos(c)}%`;
        btn.style.top = `${pos(r)}%`;
        btn.innerHTML = '<span class="dot"></span>';
        btn.addEventListener('click', () => onPoint(r, c));
        boardEl.insertBefore(btn, resultEl);
        pointEls.push(btn);
      }
    }
  }

  function render() {
    boardEl.dataset.turn = current;

    // 선
    linesEl.innerHTML = [...lines].map((k) => {
      const [[r1, c1], [r2, c2]] = parseLine(k);
      const owner = board[r1][c1] ?? board[r2][c2];
      return `<line class="p${owner}" x1="${pos(c1)}" y1="${pos(r1)}" x2="${pos(c2)}" y2="${pos(r2)}"/>`;
    }).join('');

    // 점
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const el = pointEls[r * N + c];
        const v = board[r][c];
        const isSource = selecting && sources.some(([sr, sc]) => sr === r && sc === c);
        const isTarget = selecting && target[0] === r && target[1] === c;
        const playable = !winner && !isAI(current) &&
          (selecting ? isSource : canTake(r, c, current, false));
        const locked = recent.has(pk(r, c)) || isProtected(r, c);

        el.className = 'pt';
        el.classList.add(v === null ? 'empty' : 'own');
        if (v !== null) el.classList.add(`p${v}`);
        el.classList.toggle('playable', playable);
        el.classList.toggle('source', isSource);
        el.classList.toggle('target', isTarget);
        el.classList.toggle('locked', locked);
        el.setAttribute('aria-disabled', String(!playable));

        const who = v === null ? '빈 점' : nameOf(v);
        el.setAttribute('aria-label', `${r + 1}행 ${c + 1}열, ${who}${locked ? ', 잠김' : ''}`);
      }
    }

    // 상태
    document.querySelectorAll('.player').forEach((el) => {
      el.classList.toggle('active', !winner && Number(el.dataset.player) === current);
    });

    if (winner) {
      statusEl.textContent = `${nameOf(winner)} 승리!`;
      resultText.textContent = `${nameOf(winner)} 승리!`;
      resultText.style.color = players[winner].color;
      resultEl.hidden = false;
    } else {
      // 화면에는 표시하지 않고, 스크린리더용으로만 알림
      statusEl.textContent = selecting
        ? '연결할 자신의 점을 선택하세요'
        : `${nameOf(current)} 차례`;
      resultEl.hidden = true;
    }

    if (!winner && isAI(current)) scheduleAI();
  }

  function reset() {
    board = Array.from({ length: N }, () => Array(N).fill(null));
    board[0][0] = 1;
    board[N - 1][N - 1] = 2;
    lines = new Set();
    current = 1;
    recent = new Set();
    hasCaptured = false;
    selecting = false;
    target = null;
    sources = [];
    winner = 0;
    history = [snapshot()];
    aiToken++;
    render();
  }

  /* ── AI ──
   * 플레이어 이름이 "AI"면 (1, 2 어느 쪽이든, 둘 다여도) engine.js를 불러와서 대신 둔다.
   * 규칙 처리는 이 파일의 capture / completeMove를 그대로 쓰고,
   * engine.js는 어떤 수를 둘지 고르는 데만 쓴다.
   */
  function isAI(p) {
    return players[p].name.trim().toUpperCase() === 'AI';
  }

  let enginePromise = null;
  function loadEngine() {
    if (window.CesogshuEngine) return Promise.resolve(window.CesogshuEngine);
    if (!enginePromise) {
      enginePromise = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = 'engine.js';
        el.onload = () => resolve(window.CesogshuEngine);
        el.onerror = () => { enginePromise = null; reject(new Error('engine.js를 불러오지 못했어')); };
        document.head.appendChild(el);
      });
    }
    return enginePromise;
  }

  let aiPending = false;
  function scheduleAI() {
    if (aiPending) return;
    aiPending = true;
    const token = aiToken;
    const started = Date.now();
    loadEngine()
      .then((engine) => {
        const wait = Math.max(0, AI_DELAY - (Date.now() - started));
        setTimeout(() => { aiPending = false; aiMove(engine, token); }, wait);
      })
      .catch((err) => {
        aiPending = false;
        console.error(err);
        statusEl.textContent = 'engine.js를 찾을 수 없어서 AI가 둘 수 없습니다';
      });
  }

  // 현재 국면 복사본 (반복 판정용)
  function snapshot() {
    return {
      board: board.map((row) => row.slice()),
      lines: [...lines],
      cur: current,
      recent: [...recent],
      hasCap: hasCaptured,
    };
  }

  // 이 파일의 상태 형식 → engine.js 상태 형식
  function toEngineState(engine, snap) {
    const b = new Int8Array(N * N);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) b[r * N + c] = snap.board[r][c] || 0;
    const l = new Uint8Array(engine.E);
    for (const k of snap.lines) {
      const [[r1, c1], [r2, c2]] = parseLine(k);
      l[engine.edgeIndex(r1, c1, r2, c2)] = 1;
    }
    let rec = 0;
    for (const p of snap.recent) { const [r, c] = p.split(',').map(Number); rec |= 1 << (r * N + c); }
    return { board: b, lines: l, cur: snap.cur, recent: rec, hasCap: snap.hasCap };
  }

  function aiMove(engine, token) {
    if (token !== aiToken) {           // 그사이 새 게임이 시작됐거나 이름이 바뀜
      if (!winner && isAI(current)) scheduleAI();
      return;
    }
    if (winner || !isAI(current)) return;
    selecting = false; target = null; sources = [];

    const state = toEngineState(engine, snapshot());
    const seen = new Set(history.map((h) => engine.key(toEngineState(engine, h))));
    const res = engine.chooseMove(state, engine.WEIGHTS, AI_DEPTH, seen);
    if (!res || !res.move) return;

    const tr = Math.floor(res.move.t / N), tc = res.move.t % N;
    const sr = Math.floor(res.move.src / N), sc = res.move.src % N;
    if (board[tr][tc] === 3 - current) capture(tr, tc, sr, sc);
    else completeMove(tr, tc, sr, sc);
  }

  /* ── 이름 · 색 설정 ── */
  function loadPlayers() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (saved) for (const p of [1, 2]) Object.assign(players[p], saved[p]);
    } catch (_) { /* 저장소를 못 쓰면 기본값 사용 */ }
  }

  function savePlayers() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(players)); } catch (_) {}
  }

  function applyColors() {
    const root = document.documentElement.style;
    root.setProperty('--p1', players[1].color);
    root.setProperty('--p2', players[2].color);
  }

  function bindPlayerInputs() {
    for (const p of [1, 2]) {
      const nameEl = $(`#name-${p}`);
      const colorEl = $(`#color-${p}`);
      nameEl.value = players[p].name;
      nameEl.placeholder = DEFAULTS[p].name;
      colorEl.value = players[p].color;

      nameEl.addEventListener('input', () => {
        players[p].name = nameEl.value.trim();
        savePlayers();
        if (!isAI(current)) aiToken++;   // AI 이름을 지우면 예약된 수 취소
        render();
      });
      nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameEl.blur(); });

      colorEl.addEventListener('input', () => {
        players[p].color = colorEl.value;
        applyColors();
        savePlayers();
        if (winner) resultText.style.color = players[winner].color;
      });
    }
  }

  /* ── 시작 ── */
  loadPlayers();
  applyColors();
  bindPlayerInputs();
  buildPoints();

  $('#restart').addEventListener('click', reset);
  $('#again').addEventListener('click', reset);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selecting) {
      selecting = false; target = null; sources = [];
      render();
    }
  });

  reset();
})();
