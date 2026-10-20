/*
 * 체소그슈 규칙 엔진 + 탐색 AI (화면 없음, Node / 브라우저 공용)
 * 원본 Cesogshu.py 로직을 그대로 옮긴 순수 함수 버전.
 *
 * 상태 s = { board: Int8Array(25), lines: Uint8Array(40), cur, recent(비트마스크), hasCap }
 *   board[p]: 0 빈 점, 1/2 플레이어      p = r*5 + c
 *   lines[e]: 0/1                        e = 변 번호 (가로 20 + 세로 20)
 */

// Node(require)에서도, 브라우저(<script>, window.CesogshuEngine)에서도 쓸 수 있게 감싼다
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CesogshuEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const N = 5;
  const P = N * N;
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // 원본과 같은 순서 (연쇄 먹기 순서에 영향)
  const PROTECTED = (1 << 6) | (1 << 8) | (1 << 16) | (1 << 18); // (1,1) (1,3) (3,1) (3,3)

  /* ── 격자 준비 ── */
  const EDGE_A = [], EDGE_B = [];
  function edgeIndex(r1, c1, r2, c2) {
    if (r1 > r2 || (r1 === r2 && c1 > c2)) [r1, c1, r2, c2] = [r2, c2, r1, c1];
    return r1 === r2 ? r1 * (N - 1) + c1 : N * (N - 1) + r1 * N + c1;
  }
  for (let r = 0; r < N; r++) for (let c = 0; c < N - 1; c++) {
    const e = edgeIndex(r, c, r, c + 1); EDGE_A[e] = r * N + c; EDGE_B[e] = r * N + c + 1;
  }
  for (let r = 0; r < N - 1; r++) for (let c = 0; c < N; c++) {
    const e = edgeIndex(r, c, r + 1, c); EDGE_A[e] = r * N + c; EDGE_B[e] = (r + 1) * N + c;
  }
  const E = EDGE_A.length; // 40
  const NB = []; // NB[p] = [[이웃 점, 변 번호], ...]  (DIRS 순서)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const list = [];
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < N && nc >= 0 && nc < N) list.push([nr * N + nc, edgeIndex(r, c, nr, nc)]);
    }
    NB.push(list);
  }

  /* ── 상태 ── */
  function initial() {
    const board = new Int8Array(P);
    board[0] = 1; board[P - 1] = 2;
    return { board, lines: new Uint8Array(E), cur: 1, recent: 0, hasCap: false };
  }
  const clone = (s) => ({ board: s.board.slice(), lines: s.lines.slice(), cur: s.cur, recent: s.recent, hasCap: s.hasCap });
  const isProt = (s, p) => !s.hasCap && ((PROTECTED >> p) & 1) === 1;

  function key(s) {
    let k = '';
    for (let i = 0; i < P; i++) k += s.board[i];
    for (let i = 0; i < E; i++) k += s.lines[i];
    return k + s.cur + (s.hasCap ? 'c' : 'n') + s.recent;
  }

  function lineCount(s, p) {
    let n = 0;
    for (const [, e] of NB[p]) n += s.lines[e];
    return n;
  }

  function adjOwn(s, p, pl) {
    const out = [];
    for (const [q] of NB[p]) if (s.board[q] === pl) out.push(q);
    return out;
  }

  function canTake(s, p, pl, ignoreRecent) {
    if (isProt(s, p)) return false;
    const v = s.board[p];
    if (v === 0) {
      for (const [q] of NB[p]) if (s.board[q] === pl) return true;
      return false;
    }
    if (v === 3 - pl) {
      if (!ignoreRecent && ((s.recent >> p) & 1)) return false;
      if (lineCount(s, p) !== 1) return false;
      for (const [q] of NB[p]) if (s.board[q] === pl) return true;
    }
    return false;
  }

  // 수 = { t: 누를 점, src: 선을 이을 내 점, cap: 잡는 수인지 }
  function genMoves(s, pl = s.cur, ignoreRecent = false) {
    const moves = [];
    for (let p = 0; p < P; p++) {
      if (!canTake(s, p, pl, ignoreRecent)) continue;
      const cap = s.board[p] !== 0;
      for (const q of adjOwn(s, p, pl)) moves.push({ t: p, src: q, cap });
    }
    return moves;
  }

  /* ── 규칙 처리 (원본 함수와 1:1 대응) ── */
  function removeLinesAt(s, p) {
    const rm = [];
    for (const [q, e] of NB[p]) if (s.lines[e] && lineCount(s, q) >= 3) rm.push(e);
    for (const e of rm) s.lines[e] = 0;
  }

  function cleanInvalid(s) {
    for (let e = 0; e < E; e++) {
      if (!s.lines[e]) continue;
      const a = s.board[EDGE_A[e]], b = s.board[EDGE_B[e]];
      if (a && b && a !== b) s.lines[e] = 0;
    }
  }

  function captureRec(s, p, opp, visited) {
    for (const [q, e] of NB[p]) {
      if (visited.has(q)) continue;
      if (s.board[q] !== opp || !s.lines[e]) continue;
      if (lineCount(s, q) >= 3) continue;
      visited.add(q);
      removeLinesAt(s, q);
      s.board[q] = s.cur;
      s.recent |= 1 << q;
      s.lines[e] = 1;
      captureRec(s, q, opp, visited);
    }
  }

  // 수를 둔 새 상태를 반환 (원본은 변경하지 않음)
  function applyMove(s0, m) {
    const s = clone(s0);
    const e = edgeIndex(Math.floor(m.t / N), m.t % N, Math.floor(m.src / N), m.src % N);
    if (s.board[m.t] === 3 - s.cur) {           // capture()
      const opp = 3 - s.cur;
      s.hasCap = true;
      s.recent = 0;
      removeLinesAt(s, m.t);
      s.board[m.t] = s.cur;
      s.recent |= 1 << m.t;
      s.lines[e] = 1;
      captureRec(s, m.t, opp, new Set([m.t]));
      cleanInvalid(s);
    } else {                                    // complete_move()
      s.lines[e] = 1;
      s.board[m.t] = s.cur;
      cleanInvalid(s);
      s.recent = 0;
    }
    s.cur = 3 - s.cur;
    return s;  // 새 차례의 genMoves가 비어 있으면 그 플레이어 패배
  }

  /* ── 평가 특징 (모두 "지금 둘 차례인 쪽" 기준) ── */
  const FEATURE_NAMES = [
    'material',     // 내 돌 - 상대 돌
    'my_mob',       // 내가 누를 수 있는 점 수
    'op_mob',       // 상대가 누를 수 있는 점 수
    'my_low',       // max(0, 3 - my_mob)  : 내가 막히기 직전
    'op_low',       // max(0, 3 - op_mob)  : 상대가 막히기 직전
    'threat_max',   // 상대가 다음에 한 번에 먹을 수 있는 최대 돌 수
    'threat_cnt',   // 상대가 공격할 수 있는 내 점 수
    'junction',     // 선 3개 이상 점(연쇄 차단): 내 것 - 상대 것
  ];
  // 처음엔 'zero_line'(선 0개 점)과 'exclusive'(한쪽만 닿는 빈칸)도 있었는데,
  // 자가 대국 결과 zero_line은 무작위 오프닝 이후 한 번도 0이 아닌 적이 없었고
  // exclusive는 조용한 국면에서 my_mob - op_mob + threat_cnt 와 정확히 같아서 뺐다.
  // 'one_line'(선 1개 점)도 넣어봤지만, 선 구조가 거의 항상 나무 모양이라
  // (끝점 수 = 2 × 묶음 수 + 갈래점 수) junction과 사실상 같은 정보여서 뺐다.

  function distinctTargets(s, pl, ignoreRecent) {
    let n = 0;
    for (let p = 0; p < P; p++) if (canTake(s, p, pl, ignoreRecent)) n++;
    return n;
  }

  function features(s) {
    const me = s.cur, op = 3 - me, b = s.board;
    let material = 0, junction = 0;
    for (let p = 0; p < P; p++) {
      const v = b[p];
      if (!v) continue;
      const sg = v === me ? 1 : -1;
      material += sg;
      if (lineCount(s, p) >= 3) junction += sg;
    }
    const myMob = distinctTargets(s, me, false);
    const opMob = distinctTargets(s, op, true);

    // 상대가 지금 둘 수 있다고 가정하고 잡기 수를 시뮬레이션
    let threatMax = 0, threatCnt = 0;
    const sim = clone(s); sim.cur = op; sim.recent = 0;
    const seen = new Set();
    for (const m of genMoves(sim, op, true)) {
      if (!m.cap) continue;
      if (!seen.has(m.t)) { seen.add(m.t); threatCnt++; }
      const after = applyMove(sim, m);
      let gain = 0;
      for (let p = 0; p < P; p++) if (after.board[p] === op && sim.board[p] !== op) gain++;
      if (gain > threatMax) threatMax = gain;
    }
    return [material, myMob, opMob, Math.max(0, 3 - myMob), Math.max(0, 3 - opMob),
            threatMax, threatCnt, junction];
  }

  function evaluate(s, w) {
    const f = features(s);
    let v = 0;
    for (let i = 0; i < f.length; i++) v += f[i] * w[i];
    return v;
  }

  /* ── 탐색 (negamax + 알파-베타 + 잡기 정지탐색) ── */
  const WIN = 1e6;
  const QDEPTH = 4;

  function qsearch(s, alpha, beta, ctx, ply, qd) {
    ctx.nodes++;
    const moves = genMoves(s);
    if (!moves.length) return -WIN + ply;
    const stand = evaluate(s, ctx.w);
    if (qd === 0) return stand;
    const caps = moves.filter((m) => m.cap);
    if (!caps.length) return stand;
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    let best = stand;
    for (const m of caps) {
      const v = -qsearch(applyMove(s, m), -beta, -alpha, ctx, ply + 1, qd - 1);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  function search(s, depth, alpha, beta, ctx, ply) {
    ctx.nodes++;
    const k = key(s);
    if (ctx.history.has(k) || ctx.path.has(k)) return 0; // 반복 국면은 무승부로 간주
    const moves = genMoves(s);
    if (!moves.length) return -WIN + ply;
    if (depth <= 0) return qsearch(s, alpha, beta, ctx, ply, QDEPTH);
    moves.sort((a, b) => b.cap - a.cap);
    ctx.path.add(k);
    let best = -Infinity;
    for (const m of moves) {
      const v = -search(applyMove(s, m), depth - 1, -beta, -alpha, ctx, ply + 1);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    ctx.path.delete(k);
    return best;
  }

  // 약한 랜덤: 최선 수와 점수 차가 margin 이내인 수들 중에서
  // exp((점수 - 최선) / temperature) 비율로 뽑는다. 이기는 수가 보이면 무조건 그 수.
  // 평가 점수 감각: 둘 수 있는 점 하나 차이 ≈ 12점
  const RANDOMNESS = { margin: 4, temperature: 2 };

  // 최선의 수 고르기.
  //   history: 지금까지 나온 국면 key 집합
  //   rng: 난수 함수
  //   opts: 랜덤 정도. { margin: 0 }을 넘기면 랜덤 없이 최선 수만 (동점끼리만 무작위)
  function chooseMove(s, w, depth, history, rng = Math.random, opts = RANDOMNESS) {
    const moves = genMoves(s);
    if (!moves.length) return null;
    for (let i = moves.length - 1; i > 0; i--) { // 동점 수를 무작위로 고르기 위해 섞음
      const j = Math.floor(rng() * (i + 1)); [moves[i], moves[j]] = [moves[j], moves[i]];
    }
    moves.sort((a, b) => b.cap - a.cap);

    const margin = opts && opts.margin > 0 ? opts.margin : 0;
    const temp = opts && opts.temperature > 0 ? opts.temperature : 1;
    const ctx = { w, history, path: new Set(), nodes: 0 };
    const scored = [];
    let bestV = -Infinity, best = null;
    for (const m of moves) {
      // 최선 - margin 보다 나은 수는 정확한 점수가 나오도록 탐색 창을 넓혀 둔다
      const alpha = bestV - margin;
      const v = -search(applyMove(s, m), depth - 1, -Infinity, -alpha, ctx, 1);
      scored.push([m, v]);
      if (v > bestV) { bestV = v; best = m; }
    }

    if (margin === 0 || bestV >= WIN / 2) return { move: best, score: bestV, nodes: ctx.nodes };

    const pool = scored.filter(([, v]) => v >= bestV - margin && v > -WIN / 2);
    if (!pool.length) return { move: best, score: bestV, nodes: ctx.nodes };
    const weights = pool.map(([, v]) => Math.exp((v - bestV) / temp));
    let x = rng() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) {
      x -= weights[i];
      if (x <= 0) return { move: pool[i][0], score: pool[i][1], nodes: ctx.nodes };
    }
    return { move: pool[pool.length - 1][0], score: pool[pool.length - 1][1], nodes: ctx.nodes };
  }

  // 자가 대국 튜닝 최종 가중치 (w3.json, 깊이 4 기준)
  const WEIGHTS = [3.13, 12.43, -11.67, -7.01, -9.11, -0.03, -1.58, -1.25];

  return {
    N, P, E, initial, clone, key, edgeIndex, genMoves, applyMove, features, evaluate,
    chooseMove, lineCount, FEATURE_NAMES, WEIGHTS, RANDOMNESS, WIN,
  };
});
