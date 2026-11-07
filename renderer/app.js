'use strict';
(function () {
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const GCOLORS = { 1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26', 6: '#f4511e', 7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000' };
  const GCOLOR_NAMES = { 1: '라벤더', 2: '세이지', 3: '포도', 4: '플라밍고', 5: '바나나', 6: '귤', 7: '공작', 8: '흑연', 9: '블루베리', 10: '바질', 11: '토마토' };
  // 예람쌤 캘린더 입력 규칙
  const RULES = [
    { label: '🔴 제출', prefix: '🔴[제출] ', color: '2', allDay: true, remind: 'none' },
    { label: '✔️ 할 일', prefix: '✔️', color: '8', allDay: false, time: ['23:00', '24:00'], remind: 'none' },
    { label: '⭐️ 출장', prefix: '⭐️[출장] ', color: '3' },
    { label: '⭐️ 출강', prefix: '⭐️[출강] ', color: '7' },
    { label: '🖥 회의', prefix: '🖥[회의] ', color: '1' },
    { label: '🖥 연수', prefix: '🖥[연수] ', color: '' },
    { label: '📽 촬영', prefix: '📽[촬영] ', color: '' },
    { label: '🗓 일정', prefix: '🗓[일정] ', color: '1' },
    { label: '📍 약속', prefix: '📍[약속] ', color: '4' },
    { label: '🏥 예약', prefix: '🏥[예약] ', color: '5' },
    { label: '🏫 학교', prefix: '🏫', color: '10' },
    { label: '🐻 쿼카', prefix: '🐻[쿼카] ', color: '6' },
    { label: '🟡 발표', prefix: '🟡', color: '2', allDay: true, remind: 'none' },
    { label: '⚫️ 갱신', prefix: '⚫️', color: '8', remind: 'none' }
  ];
  const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';

  // ---------- 날짜 도구 ----------
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const hm = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
  const parse = (s) => { const p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const dnum = (s) => { const p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5; };
  const md = (s) => (+s.slice(5, 7)) + '/' + (+s.slice(8, 10));
  const wd = (s) => WD[parse(s).getDay()];
  const todayStr = () => ymd(new Date());
  const localIso = (dateStr, time) => dateStr + 'T' + (time || '00:00') + ':00';

  // ---------- 상태 ----------
  const S = {
    cfg: {}, cals: [], calMap: {}, events: [], ym: todayStr().slice(0, 7), sel: todayStr(),
    loading: false, lastSync: null, searchResults: null, timer: null, lastFocusLoad: 0, dragKey: null
  };

  // 설정창에서 고르는 중인 값(미리보기)을 저장된 값 위에 얹어서 본다
  const V = () => (S.draft ? Object.assign({}, S.cfg, S.draft) : S.cfg);
  function visibleCalIds() { const hidden = new Set(V().hiddenCalendars || []); return S.cals.filter(c => !hidden.has(c.id)).map(c => c.id); }
  function gridStart(ym) {
    const first = parse(ym + '-01'); const ws = +V().weekStart || 0;
    const off = (first.getDay() - ws + 7) % 7; first.setDate(first.getDate() - off); return ymd(first);
  }

  function norm(e) {
    const cal = S.calMap[e._cal] || {};
    const allDay = !!(e.start && e.start.date);
    let sd, ed, st = '', et = '';
    if (allDay) { sd = e.start.date; ed = addDays(e.end && e.end.date ? e.end.date : sd, -1); if (ed < sd) ed = sd; }
    else {
      const s = new Date(e.start.dateTime), en = new Date(e.end ? e.end.dateTime : e.start.dateTime);
      sd = ymd(s); ed = ymd(new Date(Math.max(+s, +en - 1))); st = hm(s); et = hm(en);
    }
    return {
      raw: e, id: e.id, calId: e._cal, title: e.summary || '(제목 없음)', allDay, sd, ed, st, et,
      color: GCOLORS[e.colorId] || cal.color || '#7986cb', colorId: e.colorId || '',
      loc: e.location || '', desc: e.description || '', link: e.htmlLink || '',
      recurring: !!e.recurringEventId, holiday: /#holiday@/.test(e._cal || ''), writable: cal.writable !== false
    };
  }
  function sortEv(a, b) {
    if (a.holiday !== b.holiday) return a.holiday ? -1 : 1;
    const am = a.ed > a.sd, bm = b.ed > b.sd;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    if (am !== bm) return am ? -1 : 1;
    if (a.st !== b.st) return a.st < b.st ? -1 : 1;
    return a.title < b.title ? -1 : 1;
  }
  function byDay(list) {
    const map = {};
    list.forEach(ev => {
      let n = dnum(ev.ed) - dnum(ev.sd); if (n > 62) n = 62;
      for (let i = 0; i <= n; i++) { const d = addDays(ev.sd, i); (map[d] = map[d] || []).push(ev); }
    });
    Object.values(map).forEach(a => a.sort(sortEv));
    return map;
  }

  // ---------- 그리기 ----------
  function render() {
    const today = todayStr();
    $('monthTitle').textContent = S.ym.slice(0, 4) + '년 ' + (+S.ym.slice(5)) + '월';
    const ws = +V().weekStart || 0;
    const dow = $('dow'); dow.textContent = '';
    for (let i = 0; i < 7; i++) { const k = (i + ws) % 7; dow.appendChild(el('div', k === 0 ? 'sun' : k === 6 ? 'sat' : '', WD[k])); }

    const start = gridStart(S.ym);
    const list = S.events.map(norm);
    const map = byDay(list);
    S.dayMap = map;
    const grid = $('grid'); grid.textContent = '';
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i), dow_ = parse(d).getDay(), evs = map[d] || [];
      const hol = evs.find(e => e.holiday);
      const c = el('div', 'cell' + (d.slice(0, 7) !== S.ym ? ' out' : '') + (d === today ? ' today' : '') + (d === S.sel ? ' sel' : '') +
        (dow_ === 0 ? ' sun' : dow_ === 6 ? ' sat' : '') + (hol ? ' hol' : ''));
      c.dataset.d = d;
      const tint = (S.cfg.dayColors || {})[d]; if (tint) { c.classList.add('tinted'); c.style.setProperty('--tint', tint); }
      const bord = (S.cfg.dayBorders || {})[d]; if (bord) { c.classList.add('bordered'); c.style.setProperty('--bord', bord); }
      const head = el('div', 'chead'); head.appendChild(el('span', 'num', String(+d.slice(8))));
      const demo = (S.cfg.dayEmojis || {})[d]; if (demo) { const de = el('span', 'demoji', demo); de.title = '오른쪽 클릭해서 바꾸기'; head.appendChild(de); }
      if (hol) head.appendChild(el('span', 'hname', hol.title));
      c.appendChild(head);
      const chips = el('div', 'chips');
      evs.filter(e => !e.holiday).forEach(ev => {
        const ch = el('div', 'chip' + (ev.sd < d && ev.allDay ? ' cont' : ''));
        ch.style.setProperty('--cc', ev.color);
        if (!ev.allDay && ev.sd === d) ch.appendChild(el('span', 'tm', ev.st));
        // 여러 날 일정은 시작일과 주 첫 칸에만 제목을 쓰고 나머지는 색 띠로 이어 보여준다
        if (!(ev.allDay && ev.sd < d && i % 7 !== 0)) ch.appendChild(el('span', 'tx', ev.title));
        else ch.appendChild(el('span', 'tx', '\u00a0'));
        ch.appendChild(el('span', 'ic', leadIcon(ev.title)));
        ch.title = ev.title + (ev.allDay ? '' : ' (' + ev.st + '–' + ev.et + ')') + (ev.loc ? '\n' + ev.loc : '');
        ch.draggable = ev.writable;
        ch.addEventListener('click', (e) => { e.stopPropagation(); select(d, false); openEditor(ev); });
        ch.addEventListener('dblclick', (e) => e.stopPropagation());
        ch.addEventListener('dragstart', (e) => { S.drag = { ev, from: d }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ev.id); });
        chips.appendChild(ch);
      });
      c.appendChild(chips);
      c.addEventListener('click', () => select(d, true));
      c.addEventListener('contextmenu', (e) => { e.preventDefault(); openTint(c); });
      c.addEventListener('mouseenter', () => { clearTimeout(PK.timer); if (S.cfg.hoverZoom === false || S.drag || tintEl) return; showPeek(c); });
      c.addEventListener('mouseleave', () => { clearTimeout(PK.timer); setTimeout(() => { if (!PK.over) hidePeek(); }, 90); });
      c.addEventListener('dblclick', () => openEditor(null, d));
      c.addEventListener('dragover', (e) => { if (S.drag) { e.preventDefault(); c.classList.add('drop'); } });
      c.addEventListener('dragleave', () => c.classList.remove('drop'));
      c.addEventListener('drop', (e) => { e.preventDefault(); c.classList.remove('drop'); if (S.drag) moveEvent(S.drag.ev, dnum(d) - dnum(S.drag.from)); S.drag = null; });
      grid.appendChild(c);
    }
    requestAnimationFrame(fitChips);
    renderPanel();
    renderFoot();
  }

  // 제목 맨 앞 이모지(없으면 앞 두 글자)
  const seg = window.Intl && Intl.Segmenter ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null;
  function leadIcon(t) {
    const g = seg ? Array.from(seg.segment(t), x => x.segment) : Array.from(t);
    if (g.length && /\p{Extended_Pictographic}/u.test(g[0])) return g[0];
    return g.slice(0, 2).join('');
  }
  // 칸이 좁으면 ① 작은 글씨 → ② 이모지만 → ③ 그래도 넘치면 +N 순서로 최대한 보이게
  function fitChips() {
    document.querySelectorAll('.cell').forEach(c => {
      const box = c.querySelector('.chips'); if (!box) return;
      const old = box.querySelector('.more'); if (old) old.remove();
      c.classList.remove('dense', 'tiny', 'icons');
      const chips = Array.from(box.querySelectorAll('.chip'));
      chips.forEach(ch => ch.hidden = false);
      if (!chips.length) return;
      const fits = () => box.scrollHeight <= box.clientHeight + 1;
      if (fits()) return;
      c.classList.add('dense'); if (fits()) return;
      c.classList.remove('dense'); c.classList.add('tiny'); if (fits()) return;
      const m = el('div', 'more');
      m.addEventListener('click', (e) => { e.stopPropagation(); select(c.dataset.d, false); setPanel('day', true); });
      box.appendChild(m);
      for (let k = chips.length - 1; k >= 0; k--) {
        chips[k].hidden = true; m.textContent = '+' + (chips.length - k);
        if (fits()) break;
      }
    });
  }

  // ---------- 마우스 올린 칸 크게 보기 ----------
  const PK = { timer: null, over: false, el: null };
  function hidePeek() { if (PK.el) { PK.el.remove(); PK.el = null; } }
  function showPeek(c) {
    hidePeek();
    const d = c.dataset.d, all = (S.dayMap || {})[d] || [];
    const evs = all.filter(e => !e.holiday); if (!evs.length) return;
    const month = $('month');
    const p = el('div', 'peek');
    const head = el('div', 'peek-h', md(d) + ' (' + wd(d) + ')');
    const hol = all.find(e => e.holiday); if (hol) head.appendChild(el('span', 'peek-hol', hol.title));
    if (d === todayStr()) head.appendChild(el('span', 'peek-hol today', '오늘'));
    p.appendChild(head);
    evs.forEach(ev => {
      const r = el('div', 'prow'); r.style.setProperty('--cc', ev.color);
      r.appendChild(el('span', 'pt', ev.allDay ? (ev.ed > ev.sd ? '~' + md(ev.ed) : '종일') : (ev.sd === d ? ev.st : '~' + ev.et)));
      r.appendChild(el('span', 'pn', ev.title));
      r.title = ev.loc || '';
      r.addEventListener('click', (e) => { e.stopPropagation(); hidePeek(); select(d, false); openEditor(ev); });
      p.appendChild(r);
    });
    const foot = el('div', 'peek-foot');
    const add = el('button', 'peek-add', '＋ 일정 추가'); add.type = 'button';
    add.addEventListener('click', (e) => { e.stopPropagation(); hidePeek(); openEditor(null, d); });
    const tb = el('button', 'peek-add', '칸 색'); tb.type = 'button';
    tb.addEventListener('click', (e) => { e.stopPropagation(); hidePeek(); openTint(c); });
    foot.append(add, tb); p.appendChild(foot);
    p.addEventListener('mouseenter', () => { PK.over = true; });
    p.addEventListener('mouseleave', () => { PK.over = false; hidePeek(); });
    const cw = c.offsetWidth, w = Math.max(cw * 1.6, 230);
    p.style.width = w + 'px'; p.style.maxHeight = (month.clientHeight - 8) + 'px';
    month.appendChild(p); PK.el = p;
    let left = c.offsetLeft + cw / 2 - w / 2; left = Math.max(4, Math.min(left, month.clientWidth - w - 4));
    let top = c.offsetTop - 6; const h = p.offsetHeight;
    if (top + h > month.clientHeight - 4) top = Math.max(4, month.clientHeight - h - 4);
    p.style.left = left + 'px'; p.style.top = top + 'px';
    p.style.transformOrigin = (c.offsetLeft + cw / 2 - left) + 'px ' + (c.offsetTop + c.offsetHeight / 2 - top) + 'px';
  }

  // ---------- 날짜 칸 배경색 (오른쪽 클릭) ----------
  const TINTS = ['#ffd6e0', '#ffe3c2', '#fff1a8', '#d7f5c8', '#c9ecf7', '#d5dcff', '#e8d5ff', '#e2e5ea', '#ff9aa8', '#7fd1ae'];
  let tintEl = null;
  function closeTint() { if (tintEl) { tintEl.remove(); tintEl = null; } }
  const DAY_EMOJIS = ['🎂', '🎉', '⭐', '❤️', '📌', '🔥', '✈️', '🏖️', '🎁', '📚', '💰', '☕', '🏫', '💊', '😴', '🍀'];
  const BORDERS = ['#ff5a7a', '#ff9a3c', '#f2c200', '#34b36b', '#20a4d8', '#4f6bed', '#9b5de5', '#6b7280', '#1d2330', '#ffffff'];
  function openTint(c) {
    hidePeek(); closeTint();
    const d = c.dataset.d, month = $('month');
    const m = el('div', 'tintmenu');
    const section = (title, list, cur, key, defPick) => {
      m.appendChild(el('div', 'tint-h', title));
      const row = el('div', 'swatches' + (key === 'dayBorders' ? ' borders' : ''));
      const none = el('button', 'def', '없음'); none.type = 'button'; none.setAttribute('aria-pressed', String(!cur)); row.appendChild(none);
      none.onclick = () => setDayStyle(key, d, '');
      list.forEach(col => { const b = el('button'); b.type = 'button'; b.style.setProperty('--sw', col); b.setAttribute('aria-pressed', String(cur === col)); b.onclick = () => setDayStyle(key, d, col); row.appendChild(b); });
      const pick = el('input', 'colorpick'); pick.type = 'color'; pick.value = cur || defPick; pick.title = '직접 고르기';
      pick.addEventListener('change', () => setDayStyle(key, d, pick.value)); row.appendChild(pick);
      m.appendChild(row);
    };
    section(md(d) + ' 칸 배경', TINTS, (S.cfg.dayColors || {})[d] || '', 'dayColors', '#ffd6e0');
    section('칸 테두리', BORDERS, (S.cfg.dayBorders || {})[d] || '', 'dayBorders', '#ff5a7a');
    // 날짜 옆 이모지
    m.appendChild(el('div', 'tint-h', '날짜 옆 이모지'));
    const curE = (S.cfg.dayEmojis || {})[d] || '';
    const erow = el('div', 'emorow');
    const enone = el('button', 'def', '없음'); enone.type = 'button'; enone.setAttribute('aria-pressed', String(!curE)); enone.onclick = () => setDayStyle('dayEmojis', d, ''); erow.appendChild(enone);
    // 한 줄(7개)만 보이고 나머지는 … 를 눌러 펼치기
    const FIRST = 7;
    DAY_EMOJIS.forEach((em, k) => { const b = el('button', 'emo' + (k >= FIRST ? ' more-emo' : ''), em); b.type = 'button'; b.setAttribute('aria-pressed', String(curE === em)); b.onclick = () => setDayStyle('dayEmojis', d, em); erow.appendChild(b); });
    const moreB = el('button', 'emo emo-more', '…'); moreB.type = 'button'; moreB.title = '이모지 더 보기';
    moreB.onclick = () => { erow.classList.toggle('open'); moreB.textContent = erow.classList.contains('open') ? '‹' : '…'; };
    erow.appendChild(moreB);
    if (curE && DAY_EMOJIS.indexOf(curE) >= FIRST) { erow.classList.add('open'); moreB.textContent = '‹'; }
    const ein = el('input', 'emoin'); ein.placeholder = '직접(윈도우+.)'; ein.maxLength = 8; ein.value = DAY_EMOJIS.includes(curE) ? '' : curE;
    ein.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setDayStyle('dayEmojis', d, ein.value.trim()); } });
    ein.addEventListener('change', () => setDayStyle('dayEmojis', d, ein.value.trim()));
    erow.appendChild(ein); m.appendChild(erow);
    m.addEventListener('mousedown', (e) => e.stopPropagation());
    month.appendChild(m); tintEl = m;
    let left = c.offsetLeft; left = Math.max(4, Math.min(left, month.clientWidth - m.offsetWidth - 4));
    let top = c.offsetTop + 24; if (top + m.offsetHeight > month.clientHeight - 4) top = Math.max(4, c.offsetTop - m.offsetHeight + 6);
    m.style.left = left + 'px'; m.style.top = top + 'px';
  }
  // 고르는 즉시 칸에 반영하고, 메뉴는 열어 둬서 배경·테두리를 이어서 바꿀 수 있게
  async function setDayStyle(key, d, col) {
    const dc = Object.assign({}, S.cfg[key] || {}); if (col) dc[d] = col; else delete dc[d];
    S.cfg[key] = dc; render();
    const c = document.querySelector('.cell[data-d="' + d + '"]'); if (c) openTint(c); else closeTint();
    await setCfg({ [key]: dc });
  }
  document.addEventListener('mousedown', () => closeTint());

  function select(d, keepMonth) {
    S.sel = d;
    if (!keepMonth && d.slice(0, 7) !== S.ym) { S.ym = d.slice(0, 7); load(); }
    document.querySelectorAll('.cell.sel').forEach(c => c.classList.remove('sel'));
    const c = document.querySelector('.cell[data-d="' + d + '"]'); if (c) c.classList.add('sel');
    renderPanel();
  }

  function setPanel(mode, open) {
    S.cfg.panelMode = mode; if (open) S.cfg.panelOpen = true;
    api.setCfg({ panelMode: mode, panelOpen: S.cfg.panelOpen });
    applyPanel(); renderPanel();
    if (mode === 'search') setTimeout(() => $('searchInput').focus(), 0);
  }
  // ---------- 하단 메모(포스트잇) ----------
  const NOTE_COLORS = ['#fff1a1', '#ffd3df', '#d6f5c6', '#cfe7ff', '#e6d8ff', '#ffdfba'];
  let noteTimer = null;
  const notesOf = () => Array.isArray(S.cfg.notes) ? S.cfg.notes : [];
  function saveNotes(list, now) {
    S.cfg.notes = list; $('noteCount').textContent = list.length ? list.length : '';
    clearTimeout(noteTimer); const go = () => api.setCfg({ notes: list });
    if (now) go(); else noteTimer = setTimeout(go, 500);
  }
  // 다른 컴퓨터에서 바꾼 메모·칸 색 받아오기(같은 구글 계정)
  let syncBusy = false;
  async function syncNotes() {
    if (syncBusy || !api.syncPull) return; syncBusy = true;
    try {
      const r = await api.syncPull();
      if (r.ok && r.data.changed) {
        const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('.pnote');
        ['notes', 'dayColors', 'dayBorders', 'dayEmojis'].forEach(k => { if (!(k === 'notes' && typing)) S.cfg[k] = r.data.cfg[k]; });
        render(); applyFoot();
      }
    } finally { syncBusy = false; }
  }
  function applyFoot() {
    const open = S.cfg.footOpen !== false;
    // 메모는 하단 바에, 열기/닫기 버튼은 늘 하단 바 오른쪽 끝(캘린더 칸과 겹치지 않음)
    $('foot').classList.toggle('memo-closed', !open);
    const cnt = notesOf().length;
    $('footClose').firstChild.textContent = open ? '▾ 메모 접기 ' : '▴ 메모 ';
    $('noteCount').textContent = cnt || '';
    $('footClose').title = open ? '메모 접기' : '메모 펼치기';
    if (open) renderNotes();
  }
  function renderNotes() {
    const box = $('notes'); box.textContent = '';
    notesOf().forEach((n, i) => {
      const card = el('div', 'pnote'); card.style.setProperty('--nc', n.color || NOTE_COLORS[0]);
      card.style.setProperty('--rot', ((i * 37) % 5 - 2) * 0.6 + 'deg');
      const ta = el('textarea'); ta.value = n.text || ''; ta.placeholder = '메모'; ta.spellcheck = false;
      ta.addEventListener('input', () => { const list = notesOf().slice(); list[i] = Object.assign({}, list[i], { text: ta.value }); saveNotes(list); });
      const tools = el('div', 'note-tools');
      NOTE_COLORS.forEach(col => { const b = el('button', 'nc'); b.type = 'button'; b.style.setProperty('--sw', col); b.title = '색 바꾸기';
        b.onclick = () => { const list = notesOf().slice(); list[i] = Object.assign({}, list[i], { color: col }); saveNotes(list, true); renderNotes(); }; tools.appendChild(b); });
      const del = el('button', 'nd', '×'); del.type = 'button'; del.title = '메모 삭제';
      del.onclick = () => { const list = notesOf().slice(); list.splice(i, 1); saveNotes(list, true); renderNotes(); };
      tools.appendChild(del);
      card.append(ta, tools); box.appendChild(card);
    });
    const add = el('button', 'note-add', '+ 메모'); add.type = 'button';
    add.onclick = () => {
      const list = notesOf().concat([{ id: Date.now().toString(36), text: '', color: NOTE_COLORS[notesOf().length % NOTE_COLORS.length] }]);
      saveNotes(list, true); renderNotes();
      const tas = box.querySelectorAll('textarea'); const last = tas[tas.length - 1]; if (last) last.focus();
      box.scrollLeft = box.scrollWidth;
    };
    box.appendChild(add); box.classList.toggle('only-add', !notesOf().length);
  }
  function applyPanel() {
    $('panel').hidden = !S.cfg.panelOpen;
    $('panelBtn').classList.toggle('on', !!S.cfg.panelOpen);
    $('panelHandle').textContent = S.cfg.panelOpen ? '›' : '‹';
    $('panelHandle').title = S.cfg.panelOpen ? '오른쪽 목록 닫기' : '오른쪽 목록 열기';
    ['day', 'week', 'search'].forEach(m => $('tab' + m[0].toUpperCase() + m.slice(1)).setAttribute('aria-selected', String(S.cfg.panelMode === m)));
    $('searchbox').hidden = S.cfg.panelMode !== 'search';
    requestAnimationFrame(fitChips);
  }

  function pitem(ev, day) {
    const it = el('div', 'pitem'); it.style.setProperty('--cc', ev.color);
    let t = '종일';
    if (!ev.allDay) t = (ev.sd === day || !day) ? ev.st : '~' + ev.et;
    else if (ev.ed > ev.sd) t = '~' + md(ev.ed);
    it.appendChild(el('div', 't', t));
    it.appendChild(el('div', 'n', ev.title));
    const meta = [];
    if (!ev.allDay && ev.ed === ev.sd) meta.push(ev.st + '–' + ev.et);
    if (ev.loc) meta.push(ev.loc);
    if (meta.length) it.appendChild(el('div', 'm', meta.join(' · ')));
    it.addEventListener('click', () => openEditor(ev));
    return it;
  }
  function dayHeader(d) {
    const today = todayStr();
    const h = el('div', 'pday' + (d === today ? ' today' : ''), md(d) + ' (' + wd(d) + ')');
    if (d === today) h.appendChild(el('span', 'sub', '오늘'));
    else if (d === addDays(today, 1)) h.appendChild(el('span', 'sub', '내일'));
    return h;
  }
  async function setMini(on) {
    await api.win('mini', on); S.cfg.mini = on; applyMini();
    if (on) { const t = todayStr(); S.sel = t; if (t.slice(0, 7) !== S.ym) { S.ym = t.slice(0, 7); load(); } }
    render();
  }
  function applyMini() {
    const on = !!S.cfg.mini;
    $('app').classList.toggle('mini', on);
    $('miniBtn').title = on ? '달력 크게 보기' : '오늘 일정만 작게 보기';
    $('miniBtn').innerHTML = on
      ? '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M9 9.5v10M14.5 9.5v10"/></svg>'
      : '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/></svg>';
    const t = todayStr(); $('miniTitle').textContent = '오늘 ' + md(t) + ' (' + wd(t) + ')';
  }
  function renderPanel() {
    const box = $('plist'); box.textContent = '';
    const mode = S.cfg.mini ? 'today' : (S.cfg.panelMode || 'day');
    const map = S.dayMap || {};
    if (mode === 'today') {
      const t = todayStr(), tm = addDays(t, 1);
      const evs = map[t] || [];
      if (!evs.length) box.appendChild(el('div', 'pempty', '오늘은 등록된 일정이 없어요.'));
      evs.forEach(ev => box.appendChild(pitem(ev, t)));
      const h = dayHeader(tm); box.appendChild(h);
      const ev2 = map[tm] || [];
      if (!ev2.length) box.appendChild(el('div', 'pempty', '없음'));
      ev2.forEach(ev => box.appendChild(pitem(ev, tm)));
      const add = el('button', 'padd', '＋ 오늘 일정 추가'); add.type = 'button';
      add.addEventListener('click', () => openEditor(null, t)); box.appendChild(add);
      return;
    }
    if (mode === 'day') {
      box.appendChild(dayHeader(S.sel));
      const evs = map[S.sel] || [];
      if (!evs.length) box.appendChild(el('div', 'pempty', '등록된 일정이 없어요.'));
      evs.forEach(ev => box.appendChild(pitem(ev, S.sel)));
      const add = el('button', 'padd', '＋ 이 날 일정 추가'); add.type = 'button';
      add.addEventListener('click', () => openEditor(null, S.sel)); box.appendChild(add);
    } else if (mode === 'week') {
      const ws = +V().weekStart || 0; const sd = parse(S.sel);
      const off = (sd.getDay() - ws + 7) % 7; const w0 = addDays(S.sel, -off);
      for (let i = 0; i < 7; i++) {
        const d = addDays(w0, i); box.appendChild(dayHeader(d));
        const evs = map[d] || [];
        if (!evs.length) box.appendChild(el('div', 'pempty', '없음'));
        evs.forEach(ev => box.appendChild(pitem(ev, d)));
      }
    } else {
      const r = S.searchResults;
      if (r == null) { box.appendChild(el('div', 'pempty', '검색어를 입력하고 Enter를 누르세요.')); return; }
      if (r === 'loading') { box.appendChild(el('div', 'pempty', '찾는 중…')); return; }
      if (!r.length) { box.appendChild(el('div', 'pempty', '찾은 일정이 없어요.')); return; }
      let last = '';
      r.forEach(ev => {
        if (ev.sd !== last) { box.appendChild(dayHeader(ev.sd)); last = ev.sd; }
        const it = pitem(ev, ev.sd);
        it.addEventListener('click', () => { select(ev.sd, false); });
        box.appendChild(it);
      });
    }
  }

  function renderFoot() {
    let t = S.loading ? '동기화 중…' : (S.lastSync ? '동기화 ' + hm(S.lastSync) : '');
    $('syncText').textContent = t;
  }
  function banner(msg) { const b = $('banner'); if (msg) { b.hidden = false; b.textContent = msg; } else b.hidden = true; }

  // ---------- 불러오기 ----------
  async function load(opts) {
    opts = opts || {};
    if (!S.cfg.loggedIn) { $('onboard').hidden = false; render(); return; }
    $('onboard').hidden = true;
    if (!S.cals.length || opts.cals) {
      const r = await api.calendars();
      if (!r.ok) return fail(r);
      S.cals = r.data; S.calMap = {}; S.cals.forEach(c => S.calMap[c.id] = c);
    }
    syncNotes();
    const ym = S.ym, start = gridStart(ym), end = addDays(start, 42);
    S.loading = true; renderFoot();
    const r = await api.events(visibleCalIds(), parse(start).toISOString(), parse(end).toISOString());
    S.loading = false;
    if (ym !== S.ym) return;
    if (!r.ok) return fail(r);
    S.events = r.data.items; S.lastSync = new Date(); hidePeek();
    banner(r.data.errors.length ? '일부 캘린더를 불러오지 못했어요: ' + r.data.errors.map(e => (S.calMap[e.id] || {}).name || e.id).join(', ') : '');
    render();
  }
  function fail(r) {
    S.loading = false; renderFoot();
    if (r.code === 'NOT_LOGGED_IN') { S.cfg.loggedIn = false; S.events = []; $('onboard').hidden = false; render(); banner(r.message !== 'NOT_LOGGED_IN' ? r.message : ''); return; }
    if (/fetch failed|ENOTFOUND|network/i.test(r.message)) banner('인터넷 연결을 확인해 주세요. 연결되면 자동으로 다시 불러와요.');
    else banner('불러오기 실패: ' + r.message);
  }
  function startTimer() { clearInterval(S.timer); S.timer = setInterval(() => { if (!document.hidden) load(); }, 60 * 1000); }

  // ---------- 일정 옮기기 (끌어놓기) ----------
  async function moveEvent(ev, delta) {
    if (!delta || !ev.writable) return;
    const e = ev.raw; let body;
    if (ev.allDay) body = { start: { date: addDays(e.start.date, delta) }, end: { date: addDays(e.end.date, delta) } };
    else {
      const s = new Date(e.start.dateTime), en = new Date(e.end.dateTime);
      s.setDate(s.getDate() + delta); en.setDate(en.getDate() + delta);
      body = { start: { dateTime: localIso(ymd(s), hm(s)), timeZone: TZ }, end: { dateTime: localIso(ymd(en), hm(en)), timeZone: TZ } };
    }
    const r = await api.patch(ev.calId, ev.id, body);
    if (!r.ok) banner('옮기지 못했어요: ' + r.message); else banner('');
    load(); api.win('alarmRefresh');
  }

  // ---------- 편집창 ----------
  const ED = { ev: null, color: '', delArmed: false };
  // 이모지 뒤의 변형 선택자(FE0F)가 있든 없든 같은 분류로 본다
  function stripPrefix(t, p) {
    const P = p.trim(); let i = 0, j = 0;
    while (j < P.length) {
      if (i >= t.length) return null;
      if (t[i] === '\uFE0F' && P[j] !== '\uFE0F') { i++; continue; }
      if (P[j] === '\uFE0F' && t[i] !== '\uFE0F') { j++; continue; }
      if (t[i] !== P[j]) return null; i++; j++;
    }
    while (t[i] === '\uFE0F') i++;
    return t.slice(i);
  }
  function ruleOf(title) { return RULES.find(r => stripPrefix(title, r.prefix) !== null); }
  function buildCats() {
    const box = $('edCats'); box.textContent = '';
    RULES.forEach(r => {
      const b = el('button', null, r.label); b.type = 'button';
      b.addEventListener('click', () => applyRule(r)); box.appendChild(b);
    });
  }
  function markCat() {
    const r = ruleOf($('edSummary').value);
    Array.from($('edCats').children).forEach((b, i) => b.setAttribute('aria-pressed', String(RULES[i] === r)));
  }
  function applyRule(r) {
    let t = $('edSummary').value;
    const old = ruleOf(t); if (old) t = stripPrefix(t, old.prefix).replace(/^\s+/, '');
    $('edSummary').value = r.prefix + t;
    if (r.color !== undefined) setColor(r.color);
    if (r.allDay !== undefined) { $('edAllDay').checked = r.allDay; syncAllDay(); }
    if (r.time) { $('edST').value = r.time[0]; if (r.time[1] === '24:00') { $('edET').value = '00:00'; $('edED').value = addDays($('edSD').value, 1); } else $('edET').value = r.time[1]; }
    if (r.remind) $('edRemind').value = r.remind;
    markCat(); $('edSummary').focus();
  }
  function buildColors() {
    const box = $('edColors'); box.textContent = '';
    const d = el('button', 'def', '캘린더 색'); d.type = 'button'; d.dataset.c = ''; box.appendChild(d);
    Object.keys(GCOLORS).forEach(k => {
      const b = el('button'); b.type = 'button'; b.dataset.c = k; b.title = GCOLOR_NAMES[k]; b.setAttribute('aria-label', GCOLOR_NAMES[k]);
      b.style.setProperty('--sw', GCOLORS[k]); box.appendChild(b);
    });
    box.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setColor(b.dataset.c); });
  }
  function setColor(c) { ED.color = c || ''; Array.from($('edColors').children).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.c === ED.color))); }
  function syncAllDay() { document.querySelector('.row.when').classList.toggle('allday', $('edAllDay').checked); $('edAlarmWrap').hidden = $('edAllDay').checked; }

  function openEditor(ev, date) {
    ED.ev = ev || null; ED.delArmed = false;
    const am = S.cfg.alarmMinutes == null ? 30 : +S.cfg.alarmMinutes;
    $('edAlarm').options[0].textContent = S.cfg.alarm === false ? '기본값 (꺼짐)' : '기본값 (' + (am ? (am >= 60 ? am / 60 + '시간' : am + '분') + ' 전' : '시작할 때') + ')';
    $('edErr').hidden = true;
    $('edTitle').textContent = ev ? '일정 수정' : '일정 추가';
    const cs = $('edCal'); cs.textContent = '';
    S.cals.filter(c => c.writable || (ev && c.id === ev.calId)).forEach(c => {
      const o = el('option', null, c.name + (c.primary ? ' (기본)' : '')); o.value = c.id; cs.appendChild(o);
    });
    cs.disabled = !!ev;
    $('edDelete').hidden = !ev; $('edDelete').textContent = '삭제';
    $('edOpen').hidden = !(ev && ev.link);
    if (ev) {
      const e = ev.raw;
      cs.value = ev.calId;
      $('edSummary').value = ev.title === '(제목 없음)' ? '' : ev.title;
      $('edAllDay').checked = ev.allDay;
      $('edSD').value = ev.sd; $('edED').value = ev.ed;
      if (ev.allDay) { $('edST').value = '09:00'; $('edET').value = '10:00'; }
      else { const s = new Date(e.start.dateTime), en = new Date(e.end.dateTime); $('edST').value = hm(s); $('edET').value = hm(en); $('edED').value = ymd(en); }
      $('edLoc').value = ev.loc; $('edDesc').value = ev.desc;
      setColor(ev.colorId);
      const rm = e.reminders || {};
      if (rm.useDefault) $('edRemind').value = 'default';
      else if (rm.overrides && rm.overrides.length) { const m = String(rm.overrides[0].minutes); $('edRemind').value = ['10', '30', '60', '1440'].includes(m) ? m : 'default'; }
      else $('edRemind').value = 'none';
      const xp = (e.extendedProperties && e.extendedProperties.private) || {};
      $('edAlarm').value = xp.ramAlarm != null && [...$('edAlarm').options].some(o => o.value === String(xp.ramAlarm)) ? String(xp.ramAlarm) : '';
      $('edRepeat').value = '';
      $('edRepeatWrap').hidden = ev.recurring; $('edRecurNote').hidden = !ev.recurring;
      ['edSummary', 'edAllDay', 'edSD', 'edST', 'edED', 'edET', 'edLoc', 'edDesc', 'edRemind', 'edAlarm', 'edSave', 'edDelete'].forEach(id => $(id).disabled = !ev.writable);
    } else {
      const primary = S.cals.find(c => c.primary && c.writable) || S.cals.find(c => c.writable);
      if (primary) cs.value = primary.id;
      const d = date || S.sel || todayStr();
      $('edSummary').value = ''; $('edAllDay').checked = true;
      $('edSD').value = d; $('edED').value = d; $('edST').value = '09:00'; $('edET').value = '10:00';
      $('edLoc').value = ''; $('edDesc').value = ''; setColor(''); $('edRemind').value = 'none'; $('edAlarm').value = ''; $('edRepeat').value = '';
      $('edRepeatWrap').hidden = false; $('edRecurNote').hidden = true;
      ['edSummary', 'edAllDay', 'edSD', 'edST', 'edED', 'edET', 'edLoc', 'edDesc', 'edRemind', 'edSave'].forEach(id => $(id).disabled = false);
    }
    syncAllDay(); markCat();
    $('editor').showModal();
    setTimeout(() => $('edSummary').focus(), 0);
  }

  async function saveEditor() {
    const err = (m) => { $('edErr').textContent = m; $('edErr').hidden = false; };
    const title = $('edSummary').value.trim();
    if (!title) return err('제목을 입력해 주세요.');
    const allDay = $('edAllDay').checked;
    let sd = $('edSD').value, ed = $('edED').value || sd;
    if (!sd) return err('시작 날짜를 골라 주세요.');
    const body = { summary: title, location: $('edLoc').value, description: $('edDesc').value };
    if (allDay) {
      if (ed < sd) ed = sd;
      body.start = { date: sd, dateTime: null, timeZone: null }; body.end = { date: addDays(ed, 1), dateTime: null, timeZone: null };
    } else {
      const st = $('edST').value || '09:00'; let et = $('edET').value || st;
      if (ed + 'T' + et <= sd + 'T' + st) { const d = new Date(localIso(sd, st)); d.setHours(d.getHours() + 1); ed = ymd(d); et = hm(d); }
      body.start = { dateTime: localIso(sd, st), timeZone: TZ, date: null }; body.end = { dateTime: localIso(ed, et), timeZone: TZ, date: null };
    }
    const rm = $('edRemind').value;
    if (rm === 'default') body.reminders = { useDefault: true };
    else if (rm === 'none') body.reminders = { useDefault: false, overrides: [] };
    else body.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: +rm }] };
    // 컴퓨터 알림: 이 앱만 읽는 값이라 휴대폰은 울리지 않아요
    const al = allDay ? '' : $('edAlarm').value;
    if (al) body.extendedProperties = { private: { ramAlarm: al } };
    else if (ED.ev) body.extendedProperties = { private: { ramAlarm: null } };
    const rep = $('edRepeat').value;
    $('edSave').disabled = true;
    let r;
    if (ED.ev) {
      body.colorId = ED.color || null;
      if (rep && !ED.ev.recurring) body.recurrence = ['RRULE:FREQ=' + rep];
      r = await api.patch(ED.ev.calId, ED.ev.id, body);
    } else {
      ['start', 'end'].forEach(k => Object.keys(body[k]).forEach(x => body[k][x] == null && delete body[k][x]));
      if (ED.color) body.colorId = ED.color;
      if (rep) body.recurrence = ['RRULE:FREQ=' + rep];
      r = await api.create($('edCal').value, body);
    }
    $('edSave').disabled = false;
    if (!r.ok) return err('저장하지 못했어요: ' + r.message);
    $('editor').close();
    S.sel = sd; if (sd.slice(0, 7) !== S.ym) S.ym = sd.slice(0, 7);
    load(); api.win('alarmRefresh');
  }

  async function deleteEditor() {
    if (!ED.ev) return;
    if (!ED.delArmed) { ED.delArmed = true; $('edDelete').textContent = '한 번 더 누르면 삭제'; return; }
    const r = await api.remove(ED.ev.calId, ED.ev.id);
    if (!r.ok) { $('edErr').textContent = '삭제하지 못했어요: ' + r.message; $('edErr').hidden = false; return; }
    $('editor').close(); load(); api.win('alarmRefresh');
  }

  // ---------- 검색 ----------
  async function doSearch() {
    const q = $('searchInput').value.trim(); if (!q) return;
    S.searchResults = 'loading'; renderPanel();
    const now = new Date(); const a = new Date(now); a.setFullYear(a.getFullYear() - 1); const b = new Date(now); b.setFullYear(b.getFullYear() + 1);
    const r = await api.search(visibleCalIds(), q, a.toISOString(), b.toISOString());
    S.searchResults = r.ok ? r.data.map(norm).sort((x, y) => x.sd < y.sd ? -1 : x.sd > y.sd ? 1 : sortEv(x, y)) : [];
    if (!r.ok) banner('검색 실패: ' + r.message);
    renderPanel();
  }

  // ---------- 설정창 ----------
  // ---------- 테마 ----------
  // 초판처럼 파스텔 빛이 네 귀퉁이에서 번지는 배경(블롭) + 칸·글자·포인트 색 한 벌. stars/galaxy만 코드로 별빛을 더한다.
  const BLOB_AT = ['42% 52% at 12% 18%', '40% 48% at 88% 12%', '46% 56% at 72% 92%', '36% 42% at 18% 90%'];
  const blobBg = (base, blobs, a) => blobs.map((c, i) => c ? 'radial-gradient(' + BLOB_AT[i] + ',' + c + a + ',transparent 70%)' : null).filter(Boolean).concat(base).join(',');
  const LP = (bg, accent, fg, muted, line) => ({ bg, surface: '#ffffff', surface2: '#ffffff', fg: fg || '#1d2330', muted: muted || '#5f687c', line: line || '#e2e5eb', accent });
  const DP = (bg, surface, accent, fg, muted, line) => ({ bg, surface, surface2: surface, fg: fg || '#eef0f6', muted: muted || '#a9b0c4', line: line || '#2c3246', accent });
  const L = (name, base, blobs, pal) => ({ name, bg: blobBg(base, blobs, 'b0'), pal });
  const D = (name, base, blobs, a, pal, fx) => ({ name, dark: true, fx, bg: blobBg(base, blobs, a), pal });
  const SCENES = {
    // 밝은 파스텔(초판)
    pastel: L('파스텔', '#eef1f8', ['#7b9cff', '#ff8cbe', '#6edcc8', '#ffc86e'], LP('#eef1f8', '#2f5bd3')),
    sunset: L('노을', '#fbeee8', ['#ff9a6b', '#ff6f91', '#ffc371', '#c47dff'], LP('#fbeee8', '#e8577a', '#33232a', '#80656e', '#f0dcd8')),
    ocean: L('바다', '#e9f3fb', ['#3fa9f5', '#6ee7f2', '#4f7cff', '#9fe3c4'], LP('#e9f3fb', '#1e7fd6', '#1b2a3a', '#5d7085', '#d8e6f2')),
    forest: L('숲', '#edf5ec', ['#58c48a', '#a6d96a', '#2fa38f', '#e8d36b'], LP('#edf5ec', '#23945f', '#1f2d24', '#5e7465', '#dbe8d9')),
    lilac: L('라벤더', '#f2eefb', ['#a78bfa', '#f0abfc', '#818cf8', '#c4b5fd'], LP('#f2eefb', '#7c5cd6', '#2a2440', '#6f6890', '#e3dcf3')),
    peach: L('복숭아', '#fdf1ea', ['#ffb38a', '#ffd6a5', '#ff8fab', '#fdffb6'], LP('#fdf1ea', '#ec6a4c', '#35261f', '#856d62', '#f1ded3')),
    sky: L('맑은 하늘', '#eaf4ff', ['#8cc8ff', '#c9e6ff', '#6fa8ff', '#ffe7a3'], LP('#eaf4ff', '#2563eb', '#1d2b45', '#5d6f90', '#d6e4f5')),
    monet: L('모네 수련', '#e9edf6', ['#a9bdf0', '#f2bfd8', '#93d6bb', '#d5c3f2'], LP('#e9edf6', '#6b7fd7', '#26304a', '#68718e', '#dde2ef')),
    sakura: L('벚꽃', '#fff3f6', ['#ffb0c6', '#ffd3df', '#f79bb5', '#fff0b8'], LP('#fff3f6', '#e05a8a', '#3a2530', '#8a6b79', '#f3d8e2')),
    lemon: L('레몬 소다', '#f5fbef', ['#ffe36e', '#9ef0d0', '#c3f27c', '#7fdbe6'], LP('#f5fbef', '#0f9f96', '#22332e', '#617770', '#e1ecda')),
    paper: L('아이보리', '#f8f3e8', ['#f1dca8', '#e9d6c0', '#e6cfa6', '#d9e3cf'], LP('#f8f3e8', '#2f4a8a', '#2b2a33', '#756f63', '#e5dbc7')),
    plain: L('단색', '#eef0f4', [null, null, null, null], LP('#eef0f4', '#2f5bd3')),
    // 어두운 테마 — 같은 번짐을 어두운 바탕 위에
    pastelnight: D('파스텔 나이트', '#15161d', ['#7b9cff', '#ff8cbe', '#6edcc8', '#ffc86e'], '5c', DP('#15161d', '#20222c', '#9db3ff')),
    starry: D('별이 빛나는 밤', '#0a1844', ['#f6d14a', '#3d7be0', '#2a4fb0', '#6fa8ff'], '66', DP('#0e2154', '#16295c', '#f6d14a', '#eef2ff', '#a9b7dd', '#2b437c'), 'oilSoft'),
    galaxy: D('은하수', '#04050f', ['#3b2a7a', '#1d3a7a', '#5a2a6a', '#16305a'], '80', DP('#070816', '#141629', '#c9b8ff', '#f1eeff', '#a9a6ca', '#272b4e'), 'galaxy'),
    aurora: D('오로라', '#041a20', ['#2ff3a0', '#b06cff', '#1fb5c9', '#3d8bff'], '5c', DP('#071c22', '#0f262d', '#45f0b0', '#e6fbf4', '#95bdb4', '#1e3e45'), 'stars'),
    deepsea: D('깊은 바다', '#031d2e', ['#1f8fc4', '#ff8a6b', '#0e6f9a', '#3fd0d0'], '5c', DP('#04243a', '#0b2b3e', '#ff8a6b', '#e6f6ff', '#93b4c6', '#18425a')),
    wine: D('와인 & 골드', '#220b15', ['#e8c26a', '#b0305a', '#8a2450', '#ff8a7a'], '55', DP('#2c101c', '#381624', '#e8c26a', '#fbeef2', '#c9a3b0', '#55253a')),
    // 새 스킨 후보
    cotton: Object.assign(L('솜사탕 하늘', '#f7eefc', ['#ffb3d6', '#a8d6ff', '#d2b6ff', '#ffd0b5'], LP('#f7eefc', '#d4589a', '#2f2338', '#7d6a88', '#ecdcf1')), { fx: 'grain' }),
    holo: Object.assign(L('홀로그램', '#f2f1fb', ['#8eeeff', '#ffaee9', '#c4b2ff', '#b2ffd6'], LP('#f2f1fb', '#7a5cf0', '#262540', '#6c6a8e', '#e0def2')), { fx: 'grain' }),
    peachfuzz: Object.assign(L('피치 퍼즈', '#fdf0e8', ['#ffbe98', '#ffd9b8', '#f4a38c', '#ffe7c7'], LP('#fdf0e8', '#e2725b', '#3a2722', '#8a6a5f', '#f2dccf')), { fx: 'grain' }),
    sunsetwave: { name: '노을 물결', fx: 'wavesSunset', bg: 'linear-gradient(180deg,#fff1e6,#ffe3dc)', pal: LP('#fff1e6', '#e85d8a', '#33222b', '#7f6670', '#f0dcd8') },
    mintwave: { name: '민트 물결', fx: 'wavesMint', bg: 'linear-gradient(180deg,#f2fbf8,#e9f6fb)', pal: LP('#f2fbf8', '#159c84', '#1d302b', '#5f7771', '#d8ebe5') },
    softaurora: D('소프트 오로라', '#090b18', ['#19c9a8', '#6f55ff', '#2a66ff', '#c04bd8'], '99', DP('#0c0e1d', '#151829', '#5ef0c8', '#eef1fb', '#a6adc6', '#262b44'), 'starsGrain'),
    nightwave: { name: '밤 물결', dark: true, fx: 'wavesNight', bg: 'linear-gradient(180deg,#0b0d22,#14123a)', pal: DP('#0e1030', '#181a3c', '#b49cff', '#f0eeff', '#aaa8cc', '#2b2c58') },
    neon: D('네온 시티', '#0b0614', ['#ff3cac', '#2bd2ff', '#784ba0', '#ff8a3c'], '8c', DP('#0d0818', '#171124', '#ff5cbc', '#f7eefb', '#b5a7c4', '#2e2340'), 'grain'),
    mocha: D('모카 라떼', '#1a120e', ['#f2a27c', '#a0623e', '#d9a066', '#7a5240'], '4d', DP('#211813', '#2b201a', '#f2a27c', '#f4ebe3', '#c0aa9a', '#44342b'))
  };
  // ---------- 입체(3D) 스킨: 바탕·카드·그림자·하이라이트 한 벌 ----------
  const K = (name, dark, bg, bgCss, surface, fg, muted, line, accent, hl, sh, sh2) => ({ name, dark, bgCss, pal: { bg, surface, surface2: surface, fg, muted, line, accent }, hl, sh, sh2 });
  const SKINS3D = {
    clay: K('클레이 라벤더', false, '#efe6fb', 'linear-gradient(160deg,#f4ecff,#e6dcf7)', '#fbf7ff', '#2d2540', '#7a6f92', '#e3d8f3', '#9b6cf0', 'rgba(255,255,255,.95)', 'rgba(110,80,170,.16)', 'rgba(110,80,170,.26)'),
    neu: K('뉴모피즘 그레이', false, '#e4e8ef', 'linear-gradient(160deg,#eceff4,#dde2ea)', '#eef1f6', '#26303f', '#6b7586', '#d6dbe4', '#4f74f0', 'rgba(255,255,255,1)', 'rgba(80,95,125,.2)', 'rgba(80,95,125,.3)'),
    macaron: K('마카롱', false, '#ffe8ee', 'linear-gradient(160deg,#fff0f3,#ffe0e8 55%,#e8f3ff)', '#fffafb', '#3a2630', '#8d6c7a', '#f3dbe3', '#ff6f91', 'rgba(255,255,255,.95)', 'rgba(190,90,120,.15)', 'rgba(190,90,120,.25)'),
    retro: K('레트로 키보드', false, '#e8e0cf', 'linear-gradient(160deg,#efe8d8,#ddd3bf)', '#f8f3e7', '#3b342a', '#7c7262', '#ddd2bc', '#e0653a', 'rgba(255,255,255,.85)', 'rgba(90,70,40,.18)', 'rgba(90,70,40,.3)'),
    mintcandy: K('민트 캔디', false, '#dcf4ec', 'linear-gradient(160deg,#e6fbf4,#d3efe6)', '#f7fffb', '#1f3530', '#62807a', '#cfeae1', '#14a585', 'rgba(255,255,255,.95)', 'rgba(30,120,100,.15)', 'rgba(30,120,100,.25)'),
    darkclay: K('다크 클레이', true, '#1c1a25', 'linear-gradient(160deg,#23202e,#16141d)', '#2a2737', '#ece8f6', '#a59fba', '#3a3649', '#b39cff', 'rgba(255,255,255,.08)', 'rgba(0,0,0,.4)', 'rgba(0,0,0,.55)'),
    navygold: K('네이비 골드', true, '#121c33', 'linear-gradient(160deg,#18264a,#0e1628)', '#1d2b4b', '#edf1fa', '#9fb0d0', '#2c3d63', '#f2c14e', 'rgba(255,255,255,.07)', 'rgba(0,0,0,.42)', 'rgba(0,0,0,.58)'),
    espresso: K('에스프레소', true, '#1d1613', 'linear-gradient(160deg,#261d18,#15100e)', '#2d231e', '#f3e9e1', '#bba495', '#43352d', '#e79a5f', 'rgba(255,255,255,.07)', 'rgba(0,0,0,.42)', 'rgba(0,0,0,.58)')
  };
  // 평면(기본) 스킨: 그림자 없이 바탕·카드·선·포인트 색만
  const F = (name, dark, bg, surface, fg, muted, line, accent) => K(name, dark, bg, bg, surface, fg, muted, line, accent, 'transparent', 'transparent', 'rgba(0,0,0,.12)');
  const SKINSFLAT = {
    paper: F('종이', false, '#f4f1ea', '#fffdf8', '#2b2a26', '#7a756a', '#e6e0d3', '#2f4a8a'),
    notion: F('노트 그레이', false, '#f7f7f5', '#ffffff', '#37352f', '#787774', '#e9e9e7', '#2383e2'),
    sky: F('하늘', false, '#eaf3fd', '#ffffff', '#1d2b45', '#5d6f90', '#d4e3f5', '#2563eb'),
    blossom: F('벚꽃', false, '#fdf0f3', '#ffffff', '#3a2530', '#8a6b79', '#f3dbe3', '#e05a8a'),
    sage: F('세이지', false, '#eef3ec', '#fbfdf9', '#24302a', '#66776b', '#dbe5d6', '#3f8f5f'),
    butter: F('버터', false, '#fbf6e4', '#fffdf3', '#33301f', '#7d7660', '#ece4c6', '#d08a10'),
    lilacflat: F('라일락', false, '#f3f0fb', '#ffffff', '#2d2640', '#76708f', '#e3ddf3', '#7c5cd6'),
    graphite: F('그래파이트', true, '#191a1d', '#232428', '#ececee', '#9fa1a8', '#33353b', '#6aa8ff'),
    midnight: F('미드나잇', true, '#0f1422', '#182033', '#e8edf8', '#99a6c2', '#27314a', '#7aa2ff'),
    forestdk: F('밤의 숲', true, '#121a16', '#1a2620', '#e5f1ea', '#97b3a4', '#2a3b32', '#5fd49a'),
    plum: F('플럼', true, '#1c1420', '#271c2d', '#f2e9f6', '#b6a2c0', '#3a2b42', '#e28ad6')
  };
  const skin3dOf = (c) => (c.style === '3d' && SKINS3D[c.skin3d]) || (c.style === 'flat' && SKINSFLAT[c.skinFlat]) || null;
  const DEFAULT_SCENE = 'pastel';
  const SCENE_ALIAS = { lavender: 'lilac', apricot: 'peach', charcoal: 'pastelnight', hud: 'galaxy', moonlight: 'galaxy', medieval: 'pastelnight' };
  function photoScene(c) {
    const dk = !!c.bgImageDark, dim = (c.bgImageDim == null ? 15 : +c.bgImageDim) / 100;
    const ov = dk ? 'rgba(0,0,0,' + dim + ')' : 'rgba(255,255,255,' + dim + ')';
    return { name: '내 사진', dark: dk, photo: true, bg: 'linear-gradient(' + ov + ',' + ov + '),url("' + c.bgImage + '") center/cover no-repeat fixed',
      pal: dk ? DP('#14161d', '#1c1f29', '#9db3ff') : LP('#eef0f4', '#2f5bd3') };
  }
  const sceneOf = (c) => (c.scene === 'photo' && c.bgImage ? photoScene(c) : null) || SCENES[c.scene] || SCENES[SCENE_ALIAS[c.scene]] || (c.scene === 'desktop' ? null : SCENES[DEFAULT_SCENE]);
  const glassOn = (c) => (c.style || 'glass') === 'glass';
  function sceneIsDark(c) { const sc = sceneOf(c); return glassOn(c) && !!(sc && sc.dark); }
  function themeApply() {
    const c = V(), sc = sceneOf(c);
    let t = c.theme;
    if (glassOn(c) && sc) t = sc.dark ? 'dark' : 'light';
    const k3 = skin3dOf(c); if (k3) t = k3.dark ? 'dark' : 'light';
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    lookApply();
  }
  // ---------- 글꼴·색 ----------
  const FONT_PRESETS = ['맑은 고딕', 'Pretendard', '나눔고딕', '나눔바른고딕', '나눔스퀘어', '나눔스퀘어라운드', 'Noto Sans KR', '에스코어 드림', 'G마켓 산스', '카페24 써라운드', '함초롬돋움', '굴림', '돋움', '바탕', '궁서'];
  const ACCENTS = ['#2f5bd3', '#039be5', '#0b8043', '#33b679', '#8e24aa', '#d81b60', '#e67c73', '#f4511e', '#f6bf26', '#616161'];
  const BGS = ['#ffffff', '#fbf7ef', '#f3f7f2', '#f2f5fb', '#fbf2f5', '#f6f2fb', '#1c2029', '#20262a', '#2a2027'];
  const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const lum = (h) => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v || '');
  function lookApply() {
    const root = document.documentElement, s = root.style, c = V();
    if (c.fontFamily) s.setProperty('--font', '"' + c.fontFamily.replace(/"/g, '') + '","Malgun Gothic","Segoe UI",sans-serif'); else s.removeProperty('--font');
    document.body.style.zoom = String((c.fontSize || 13) / 13);
    root.dataset.style = c.style || 'glass';
    ['--hl', '--sh', '--sh2', '--glass', '--glass2', '--gline', '--accent', '--accent-soft', '--sat', '--surface', '--bg', '--surface2', '--fg', '--muted', '--line'].forEach(k => s.removeProperty(k));
    document.body.style.background = '';
    const see = c.acrylic && glassOn(c) && c.scene === 'desktop';
    if (see) root.dataset.acrylic = '1'; else delete root.dataset.acrylic;
    const sc = glassOn(c) ? sceneOf(c) : null;
    // 1) 테마 팔레트
    if (sc) {
      const P = sc.pal, set = (k, v) => s.setProperty(k, v);
      set('--bg', P.bg); set('--surface', P.surface); set('--surface2', P.surface2); set('--fg', P.fg); set('--muted', P.muted); set('--line', P.line);
      set('--accent', P.accent); set('--sat', P.accent); set('--accent-soft', 'color-mix(in srgb,' + P.accent + ' 18%, ' + P.surface + ')');
      set('--glass', P.surface + (sc.dark ? '80' : '57')); set('--glass2', P.surface2 + (sc.dark ? 'bf' : '9e'));
      set('--gline', sc.dark ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.7)');
      document.body.style.background = sc.bg;
      if (sc.gline) set('--gline', sc.gline);
      if (sc.font && !c.fontFamily) set('--font', sc.font);
    }
    const k3 = skin3dOf(c);
    if (k3) {
      const P = k3.pal, set = (k, v) => s.setProperty(k, v);
      set('--bg', P.bg); set('--surface', P.surface); set('--surface2', P.surface2); set('--fg', P.fg); set('--muted', P.muted); set('--line', P.line);
      set('--accent', P.accent); set('--sat', P.accent); set('--accent-soft', 'color-mix(in srgb,' + P.accent + ' 18%, ' + P.surface + ')');
      set('--hl', k3.hl); set('--sh', k3.sh); set('--sh2', k3.sh2);
      document.body.style.background = k3.bgCss;
    }
    // 2) 직접 고른 포인트 색·카드 색이 있으면 우선
    if (isHex(c.accent)) { s.setProperty('--accent', c.accent); s.setProperty('--sat', c.accent); s.setProperty('--accent-soft', 'color-mix(in srgb,' + c.accent + ' 16%, var(--surface))'); }
    if (isHex(c.bgColor)) {
      const dark = lum(c.bgColor) < 0.25;
      s.setProperty('--surface', c.bgColor);
      s.setProperty('--surface2', mix(c.bgColor, dark ? '#ffffff' : '#5a6070', 0.08));
      s.setProperty('--line', mix(c.bgColor, dark ? '#ffffff' : '#5a6070', dark ? 0.14 : 0.18));
      s.setProperty('--fg', dark ? '#e9ecf2' : '#1d2330'); s.setProperty('--muted', dark ? '#a2aabb' : '#666e80');
      if (!sc) s.setProperty('--bg', mix(c.bgColor, dark ? '#000000' : '#5a6070', dark ? 0.25 : 0.06));
      s.setProperty('--glass', c.bgColor + 'b8'); s.setProperty('--glass2', c.bgColor + 'e8');
      root.style.colorScheme = dark ? 'dark' : 'light';
    } else root.style.colorScheme = '';
    // 3) 별빛 효과(은하수·별밤·오로라)
    if (sc && sc.fx) { root.dataset.art = '1'; paintArt(sc.fx); } else delete root.dataset.art;
    requestAnimationFrame(fitChips);
  }
  // ---------- 별빛 효과 그리기 ----------
  let artKey = '';
  function paintArt(name) {
    const cv = $('art'); if (!cv || !window.YeramArt) return;
    const z = parseFloat(document.body.style.zoom || '1') || 1;
    const w = cv.clientWidth || window.innerWidth, h = cv.clientHeight || window.innerHeight;
    const key = name + ':' + w + 'x' + h + ':' + z;
    if (key === artKey) return; artKey = key;
    window.YeramArt.draw(name, cv, w, h, (window.devicePixelRatio || 1) * z);
  }
  let artTimer = null;
  window.addEventListener('resize', () => { clearTimeout(artTimer); artTimer = setTimeout(() => { const sc = sceneOf(V()); if (document.documentElement.dataset.art && sc && sc.fx) { artKey = ''; paintArt(sc.fx); } }, 180); });
  let fontList = null;
  async function loadFonts() {
    if (fontList) return fontList;
    let names = [];
    try { if (window.queryLocalFonts) { const fs = await Promise.race([window.queryLocalFonts(), new Promise(r => setTimeout(() => r([]), 2500))]); names = Array.from(new Set(fs.map(f => f.family))); } } catch {}
    const korean = /[가-힣]|Nanum|Noto Sans KR|Noto Serif KR|Pretendard|Gmarket|Spoqa|S-Core|Cafe24|BM |Jalnan|Gowun|IBM Plex Sans KR|HY|Malgun/i;
    const ko = names.filter(n => korean.test(n)).sort((a, b) => a.localeCompare(b, 'ko'));
    const rest = names.filter(n => !korean.test(n)).sort((a, b) => a.localeCompare(b));
    fontList = names.length ? { ko, rest } : { ko: FONT_PRESETS, rest: [] };
    return fontList;
  }
  async function renderLook() {
    const c = V(), fsel = $('stFont');
    const fl = await loadFonts();
    fsel.textContent = '';
    const add = (parent, v, label) => { const o = el('option', null, label || v); o.value = v; if (v) o.style.fontFamily = '"' + v + '"'; parent.appendChild(o); };
    add(fsel, '', '기본 (맑은 고딕)');
    const g1 = el('optgroup'); g1.label = '한글 글꼴'; fl.ko.forEach(n => add(g1, n)); fsel.appendChild(g1);
    if (fl.rest.length) { const g2 = el('optgroup'); g2.label = '기타 글꼴'; fl.rest.forEach(n => add(g2, n)); fsel.appendChild(g2); }
    if (c.fontFamily && !fl.ko.includes(c.fontFamily) && !fl.rest.includes(c.fontFamily)) add(fsel, c.fontFamily);
    fsel.value = c.fontFamily || '';
    $('stStyle').value = c.style || 'glass';
    $('stFontSize').value = c.fontSize || 13; $('stFsVal').textContent = $('stFontSize').value;
    swatchRow($('stAccent'), ACCENTS, c.accent, '기본', (v) => setDraft({ accent: v }));
    swatchRow($('stBg'), BGS, c.bgColor, '테마 기본', (v) => setDraft({ bgColor: v }));
    const sb = $('stScene'); sb.textContent = '';
    const style = c.style || 'glass';
    const label = (t) => sb.appendChild(el('div', 'scene-label', t));
    const addBtn = (cur, key, text, bgCss, dark, accent, onPick) => {
      const b = el('button', 'scene' + (dark ? ' dk' : ''), text); b.type = 'button'; b.setAttribute('aria-pressed', String(cur === key));
      if (bgCss) b.style.background = bgCss;
      if (accent) b.style.setProperty('--dot', accent);
      b.onclick = () => { onPick(key); renderLook(); }; sb.appendChild(b);
    };
    Array.from(document.querySelectorAll('#stStyleSeg button')).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === style)));
    if (style === 'flat') {
      const cur = SKINSFLAT[c.skinFlat] ? c.skinFlat : '';
      const pick = (k) => setDraft({ skinFlat: k });
      const btnF = (k, v) => addBtn(cur, k, v.name, 'linear-gradient(180deg,' + v.pal.surface + ' 0 52%,' + v.pal.bg + ' 52%)', v.dark, v.pal.accent, pick);
      label('라이트'); addBtn(cur, '', '기본', '', false, '', pick);
      Object.entries(SKINSFLAT).filter(([, v]) => !v.dark).forEach(([k, v]) => btnF(k, v));
      label('다크'); Object.entries(SKINSFLAT).filter(([, v]) => v.dark).forEach(([k, v]) => btnF(k, v));
    } else if (style === '3d') {
      const cur = SKINS3D[c.skin3d] ? c.skin3d : '';
      const pick = (k) => setDraft({ skin3d: k });
      const btn3 = (k, v) => addBtn(cur, k, v.name, 'linear-gradient(180deg,' + v.pal.surface + ' 0 52%,' + v.pal.bg + ' 52%)', v.dark, v.pal.accent, pick);
      label('라이트'); addBtn(cur, '', '기본', '', false, '', pick);
      Object.entries(SKINS3D).filter(([, v]) => !v.dark).forEach(([k, v]) => btn3(k, v));
      label('다크'); Object.entries(SKINS3D).filter(([, v]) => v.dark).forEach(([k, v]) => btn3(k, v));
    } else if (style === 'glass') {
      const cur = c.scene === 'desktop' ? 'desktop' : (c.scene === 'photo' && c.bgImage ? 'photo' : SCENES[c.scene] ? c.scene : (SCENE_ALIAS[c.scene] || DEFAULT_SCENE));
      const pick = (k) => setDraft({ scene: k });
      label('라이트');
      if (c.acrylic) addBtn(cur, 'desktop', '바탕화면 비침', '', false, '', pick);
      Object.entries(SCENES).filter(([, v]) => !v.dark).forEach(([k, v]) => addBtn(cur, k, v.name, v.bg, false, v.pal.accent, pick));
      label('다크');
      Object.entries(SCENES).filter(([, v]) => v.dark).forEach(([k, v]) => addBtn(cur, k, v.name, v.bg, true, v.pal.accent, pick));
      label('내 사진');
      if (c.bgImage) { const ps = photoScene(c); addBtn(cur, 'photo', '내 사진', ps.bg.replace(' fixed', ''), ps.dark, '', pick); }
      const pickB = el('button', 'scene photo-pick', c.bgImage ? '사진 바꾸기' : '+ 사진으로'); pickB.type = 'button';
      pickB.onclick = () => pickPhoto(); sb.appendChild(pickB);
      if (cur === 'photo') {
        const dimRow = el('div', 'photo-dim'); dimRow.appendChild(el('span', null, c.bgImageDark ? '사진 어둡게' : '사진 흐리게'));
        const rg = el('input'); rg.type = 'range'; rg.min = 0; rg.max = 75; rg.value = c.bgImageDim == null ? 15 : c.bgImageDim;
        rg.oninput = () => setDraft({ bgImageDim: +rg.value });
        dimRow.appendChild(rg);
        const tg = el('button', null, c.bgImageDark ? '밝은 글자 → 어두운 글자' : '어두운 글자 → 밝은 글자'); tg.type = 'button';
        tg.onclick = () => { setDraft({ bgImageDark: !c.bgImageDark }); renderLook(); };
        dimRow.appendChild(tg); sb.appendChild(dimRow);
      }
    }

  }
  // 사진 배경: 긴 변 2400px JPEG로 줄여 저장, 평균 밝기로 글자색(밝은/어두운) 자동 선택
  function pickPhoto() {
    const inp = el('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      const url = URL.createObjectURL(f), im = new Image();
      im.onload = () => {
        const k = Math.min(1, 2400 / Math.max(im.naturalWidth, im.naturalHeight));
        const cv = document.createElement('canvas'); cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        const sm = document.createElement('canvas'); sm.width = 32; sm.height = 32; const sx = sm.getContext('2d'); sx.drawImage(im, 0, 0, 32, 32);
        const px = sx.getImageData(0, 0, 32, 32).data; let L = 0; for (let i = 0; i < px.length; i += 4) L += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        L /= (px.length / 4) * 255;
        URL.revokeObjectURL(url);
        setDraft({ bgImage: cv.toDataURL('image/jpeg', 0.86), bgImageDark: L < 0.5, bgImageDim: L < 0.5 ? 25 : 20, scene: 'photo' });
        renderLook();
      };
      im.onerror = () => { URL.revokeObjectURL(url); banner('사진을 열 수 없어요'); };
      im.src = url;
    };
    inp.click();
  }
  function swatchRow(box, colors, cur, defLabel, onPick) {
    box.textContent = '';
    const d = el('button', 'def', defLabel); d.type = 'button'; d.setAttribute('aria-pressed', String(!cur)); d.onclick = () => { onPick(''); mark(''); }; box.appendChild(d);
    colors.forEach(col => {
      const b = el('button'); b.type = 'button'; b.dataset.c = col; b.style.setProperty('--sw', col); b.title = col;
      b.setAttribute('aria-pressed', String((cur || '').toLowerCase() === col)); b.onclick = () => { onPick(col); mark(col); }; box.appendChild(b);
    });
    const pick = el('input', 'colorpick'); pick.type = 'color'; pick.title = '직접 고르기'; pick.value = /^#[0-9a-f]{6}$/i.test(cur || '') ? cur : colors[0];
    pick.addEventListener('input', () => { onPick(pick.value); mark(pick.value); }); box.appendChild(pick);
    function mark(v) { Array.from(box.querySelectorAll('button')).forEach(x => x.setAttribute('aria-pressed', String((x.dataset.c || '') === (v || '').toLowerCase() || (!v && x.classList.contains('def'))))); }
  }
  function lockApply() { $('lockBtn').classList.toggle('on', !!S.cfg.locked); $('titlebar').classList.toggle('drag', !S.cfg.locked); }
  function showStPage(pg) {
    Array.from(document.querySelectorAll('#stNav button')).forEach(b => b.setAttribute('aria-selected', String(b.dataset.page === pg)));
    Array.from(document.querySelectorAll('.st-page')).forEach(x => { x.hidden = x.dataset.page !== pg; });
    const f = $('stForm'); if (f && f.parentElement) f.parentElement.scrollTop = 0; window.scrollTo(0, 0);
  }
  function renderSettings() {
    const c = V();
    $('stClientId').value = c.clientId || '';
    $('stAdv').open = !c.builtIn && !c.loggedIn;
    $('stVer').textContent = c.version ? 'v' + c.version : '';
    $('stSecret').value = ''; $('stSecret').placeholder = c.hasSecret ? '저장됨 (바꾸려면 새로 입력)' : 'GOCSPX-...';
    $('stStatus').textContent = c.loggedIn ? '✅ 로그인됨' : '로그인 안 됨'; $('stStatus').className = 'status-text' + (c.loggedIn ? ' ok' : '');
    $('stLogin').hidden = !!c.loggedIn; $('stLogout').hidden = !c.loggedIn;
    $('stOpacity').value = Math.round((c.opacity || 1) * 100); $('stOpVal').textContent = $('stOpacity').value + '%';
    $('stTheme').value = c.theme || 'system'; $('stWeek').value = String(c.weekStart || 0);
    $('stPeek').checked = c.hoverZoom !== false;
    $('stAlarm').checked = c.alarm !== false; $('stAlarmMin').value = String(c.alarmMinutes == null ? 30 : c.alarmMinutes); $('stAlarmSound').checked = c.alarmSound !== false;
    $('stAlarmMin').disabled = $('stAlarmSound').disabled = !$('stAlarm').checked;
    [...$('edAlarm').options][0].textContent = '기본값 (' + $('stAlarmMin').selectedOptions[0].textContent + ')';
    $('stTop').checked = !!c.alwaysOnTop; $('stLock').checked = !!c.locked; $('stAuto').checked = !!c.autoStart;
    renderLook();
    const box = $('stCals'); box.textContent = '';
    if (!S.cals.length) { box.appendChild(el('span', 'muted', c.loggedIn ? '불러오는 중…' : '로그인하면 목록이 나와요.')); return; }
    const hidden = new Set(c.hiddenCalendars || []);
    S.cals.forEach(cal => {
      const l = el('label'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !hidden.has(cal.id);
      cb.addEventListener('change', async () => {
        const h = new Set(V().hiddenCalendars || []); cb.checked ? h.delete(cal.id) : h.add(cal.id);
        setDraft({ hiddenCalendars: Array.from(h) }); load();
      });
      const sq = el('span', 'sq'); sq.style.setProperty('--sw', cal.color || '#999');
      l.append(cb, sq, document.createTextNode(cal.name)); box.appendChild(l);
    });
  }
  // ---------- 설정 미리보기 → 저장/취소 ----------
  // 설정은 따로 뜨는 창(SET_MODE)에서 고르고, 바뀐 값은 달력 창으로 보내 미리보기한다
  const SET_MODE = new URLSearchParams(location.search).has('settings');
  function setDraft(patch) {
    if (!S.draft) S.draft = {};
    Object.assign(S.draft, patch);
    if (SET_MODE) { themeApply(); api.win('draft', patch); return; }
    if ('opacity' in patch) api.win('opacity', patch.opacity);
    if ('scene' in patch || 'style' in patch) { const v = V(); api.win('material', (v.style || 'glass') === 'glass' && v.scene === 'desktop'); }
    themeApply();
    if ('weekStart' in patch) render();
  }
  async function saveSettings(remote) {
    if (SET_MODE) { await saveCreds(); api.win('settingsDone', 'save'); return; }
    const d = S.draft || {}; S.draft = null;
    if (!remote) await saveCreds();
    if (Object.keys(d).length) await setCfg(d);
    $('settings').close();
    if ('weekStart' in d || 'hiddenCalendars' in d) load(); else render();
  }
  function cancelSettings() {
    if (SET_MODE) { api.win('settingsDone', 'cancel'); return; }
    const had = S.draft && Object.keys(S.draft).length; const d = S.draft || {};
    S.draft = null;
    if ('opacity' in d) api.win('opacity', S.cfg.opacity || 1);
    if ('scene' in d || 'style' in d) api.win('material', (S.cfg.style || 'glass') === 'glass' && S.cfg.scene === 'desktop');
    themeApply();
    if ($('settings').open) $('settings').close();
    if (had && ('weekStart' in d || 'hiddenCalendars' in d)) load(); else if (had) render();
  }
  async function setCfg(patch) { const r = await api.setCfg(patch); if (r.ok) { S.cfg = r.data; themeApply(); lockApply(); } return r; }
  async function saveCreds() {
    const patch = { clientId: $('stClientId').value.trim() };
    if ($('stSecret').value.trim()) patch.clientSecret = $('stSecret').value.trim();
    await setCfg(patch);
  }

  // ---------- 이벤트 연결 ----------
  function bind() {
    $('monthTitle').onclick = (e) => { e.stopPropagation(); openJump(); };
    $('monthTitle').addEventListener('mousedown', (e) => e.stopPropagation());
    $('monthTitle').title = '눌러서 다른 달·날짜로 가기';
    $('prev').onclick = () => shiftMonth(-1); $('next').onclick = () => shiftMonth(1);
    $('todayBtn').onclick = () => { const t = todayStr(); S.sel = t; if (t.slice(0, 7) !== S.ym) { S.ym = t.slice(0, 7); load(); } else render(); };
    $('addBtn').onclick = () => openEditor(null, S.sel);
    $('searchBtn').onclick = () => setPanel('search', true);
    $('refreshBtn').onclick = () => load({ cals: true });
    $('panelBtn').onclick = () => { S.cfg.panelOpen = !S.cfg.panelOpen; api.setCfg({ panelOpen: S.cfg.panelOpen }); applyPanel(); };
    $('lockBtn').onclick = () => setCfg({ locked: !S.cfg.locked });
    $('settingsBtn').onclick = openSettings; $('onboardBtn').onclick = openSettings;
    $('miniBtn').onclick = () => setMini(!S.cfg.mini);
    $('minBtn').onclick = () => api.win('minimize'); $('closeBtn').onclick = () => api.win('hide');
    $('tabDay').onclick = () => setPanel('day'); $('tabWeek').onclick = () => setPanel('week'); $('tabSearch').onclick = () => setPanel('search');
    $('searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

    buildCats(); buildColors();
    $('edSummary').addEventListener('input', markCat);
    $('edAllDay').addEventListener('change', syncAllDay);
    $('edSD').addEventListener('change', () => { if (!$('edED').value || $('edED').value < $('edSD').value) $('edED').value = $('edSD').value; });
    $('edForm').addEventListener('submit', (e) => { e.preventDefault(); saveEditor(); });
    $('edCancel').onclick = () => $('editor').close(); $('edClose').onclick = () => $('editor').close();
    $('edDelete').onclick = deleteEditor;
    $('edOpen').onclick = () => { if (ED.ev && ED.ev.link) api.win('open', ED.ev.link); };

    $('stClose').onclick = cancelSettings;
    $('stCancel').onclick = cancelSettings;
    $('stForm').addEventListener('submit', (e) => { e.preventDefault(); saveSettings(); });
    $('settings').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); cancelSettings(); } });
    // 설정창 제목을 잡고 끌어서 옮기기
    (function () {
      const dlg = $('settings'), head = dlg.querySelector('.dlg-head'); let sx, sy, ox, oy, dragging = false;
      head.addEventListener('mousedown', (e) => { if (e.target.closest('button')) return; dragging = true; const r = dlg.getBoundingClientRect(); sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; e.preventDefault(); });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const z = parseFloat(document.body.style.zoom || '1') || 1;
        let nx = ox + (e.clientX - sx), ny = oy + (e.clientY - sy);
        nx = Math.max(-dlg.offsetWidth * z + 80, Math.min(nx, window.innerWidth - 80)); ny = Math.max(0, Math.min(ny, window.innerHeight - 40));
        dlg.style.left = (nx / z) + 'px'; dlg.style.top = (ny / z) + 'px';
      });
      window.addEventListener('mouseup', () => { dragging = false; });
    })();
    $('stClientId').addEventListener('change', saveCreds); $('stSecret').addEventListener('change', saveCreds);
    $('stLogin').onclick = async () => {
      await saveCreds();
      if (!S.cfg.builtIn && (!S.cfg.clientId || !S.cfg.hasSecret)) { $('stStatus').textContent = '고급에서 클라이언트 ID와 보안 비밀번호를 먼저 넣어 주세요.'; $('stAdv').open = true; return; }
      $('stStatus').textContent = '브라우저에서 구글 로그인을 마쳐 주세요…';
      const r = await api.login();
      if (!r.ok) { $('stStatus').textContent = '로그인 실패: ' + r.message; return; }
      S.cfg = r.data; S.cals = [];
      if (SET_MODE) { const c = await api.calendars(); if (c.ok) S.cals = c.data; renderSettings(); return; }
      renderSettings(); await load({ cals: true }); renderSettings();
    };
    $('stLogout').onclick = async () => { const r = await api.logout(); if (r.ok) { S.cfg = r.data; S.cals = []; S.events = []; renderSettings(); if (!SET_MODE) load(); } };
    $('stOpacity').addEventListener('input', () => { $('stOpVal').textContent = $('stOpacity').value + '%'; $('tbOpacity').value = $('stOpacity').value; setDraft({ opacity: +$('stOpacity').value / 100 }); });
    $('stTheme').onchange = () => setDraft({ theme: $('stTheme').value });
    $('stWeek').onchange = () => setDraft({ weekStart: +$('stWeek').value });
    $('stFont').onchange = () => setDraft({ fontFamily: $('stFont').value });
    $('stStyle').onchange = () => { setDraft({ style: $('stStyle').value }); renderLook(); };
    $('tbOpacity').addEventListener('input', () => { const v = +$('tbOpacity').value; $('stOpacity').value = v; $('stOpVal').textContent = v + '%'; setCfg({ opacity: v / 100 }); });
    Array.from(document.querySelectorAll('#stNav button')).forEach(b => b.onclick = () => showStPage(b.dataset.page));
    Array.from(document.querySelectorAll('#stStyleSeg button')).forEach(b => b.onclick = () => { $('stStyle').value = b.dataset.v; setDraft({ style: b.dataset.v }); renderLook(); });
    $('footClose').onclick = () => { S.cfg.footOpen = S.cfg.footOpen === false; api.setCfg({ footOpen: S.cfg.footOpen }); applyFoot(); };
    $('panelHandle').onclick = () => { S.cfg.panelOpen = !S.cfg.panelOpen; api.setCfg({ panelOpen: S.cfg.panelOpen }); applyPanel(); };
    $('stFontSize').addEventListener('input', () => { $('stFsVal').textContent = $('stFontSize').value; setDraft({ fontSize: +$('stFontSize').value }); });
    $('stTop').onchange = () => setDraft({ alwaysOnTop: $('stTop').checked });
    $('stPeek').onchange = () => setDraft({ hoverZoom: $('stPeek').checked });
    $('stAlarm').onchange = () => { setDraft({ alarm: $('stAlarm').checked }); $('stAlarmMin').disabled = $('stAlarmSound').disabled = !$('stAlarm').checked; };
    $('stAlarmMin').onchange = () => setDraft({ alarmMinutes: +$('stAlarmMin').value });
    $('stAlarmSound').onchange = () => setDraft({ alarmSound: $('stAlarmSound').checked });
    $('stAlarmTest').onclick = () => api.win('alarmTest');
    $('stMuteGoogle').onclick = async () => {
      $('stMuteGoogle').disabled = true; $('stMuteMsg').textContent = '끄는 중…';
      const r = await api.muteGoogleDefaults();
      $('stMuteMsg').textContent = r.ok ? (r.data ? '캘린더 ' + r.data + '개의 기본 알림을 껐어요.' : '이미 꺼져 있어요.') : '실패: ' + r.message;
      $('stMuteGoogle').disabled = false;
    };
    $('stLock').onchange = () => setDraft({ locked: $('stLock').checked });
    $('stAuto').onchange = () => setDraft({ autoStart: $('stAuto').checked });
    $('stQuit').onclick = () => api.win('quit');

    document.addEventListener('keydown', (e) => {
      if (document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (e.key === 'ArrowLeft') shiftMonth(-1);
      if (e.key === 'ArrowRight') shiftMonth(1);
      if (e.key === 'F5') load({ cals: true });
    });
    new ResizeObserver(() => fitChips()).observe($('grid'));
    api.on('app:focus', () => { if (Date.now() - S.lastFocusLoad > 15000) { S.lastFocusLoad = Date.now(); load(); } });
    api.on('app:refresh', () => load({ cals: true }));
    api.on('app:goto', (d) => { if (typeof d !== 'string') return; if (d.slice(0, 7) !== S.ym) { S.ym = d.slice(0, 7); S.sel = d; S.events = []; render(); load(); } else select(d); });
    api.on('app:update', (msg) => banner(msg));
    api.on('app:settings', (m) => {
      if (!m) return;
      if (m.type === 'draft') { setDraft(m.patch || {}); if (m.patch && 'hiddenCalendars' in m.patch) load(); }
      else if (m.type === 'save') saveSettings(true);
      else if (m.type === 'cancel') cancelSettings();
    });
    api.on('app:cfg', async () => { const r = await api.getCfg(); if (r.ok) { S.cfg = Object.assign(S.cfg, r.data); themeApply(); lockApply(); if (typeof asApply === 'function' && !SET_MODE) asApply(); stAiRender(); } });
    // 자정이 지나면 오늘 표시 갱신
    let lastDay = todayStr();
    setInterval(() => { if (todayStr() !== lastDay) { lastDay = todayStr(); applyMini(); if (S.cfg.mini) { S.sel = lastDay; S.ym = lastDay.slice(0, 7); load(); } else render(); } }, 60 * 1000);
  }
  function openSettings() {
    if (!SET_MODE) { S.draft = {}; api.win('openSettings'); return; }
    const dlg = $('settings');
    if (dlg.open) return;
    S.draft = {}; renderSettings(); dlg.show();
    if (!dlg.style.left) { const z = parseFloat(document.body.style.zoom || '1') || 1; dlg.style.left = Math.max(8, (window.innerWidth / z - dlg.offsetWidth) / 2) + 'px'; dlg.style.top = '48px'; }
  }
  // ---------- 제목 눌러 월·날짜로 바로 가기 ----------
  let jumpEl = null;
  function closeJump() { if (jumpEl) { jumpEl.remove(); jumpEl = null; } }
  function openJump() {
    if (jumpEl) { closeJump(); return; }
    let year = +S.ym.slice(0, 4), shown = S.ym;
    const box = el('div', 'jump'); jumpEl = box;
    box.addEventListener('mousedown', (e) => e.stopPropagation());
    const draw = () => {
      box.textContent = '';
      const head = el('div', 'jump-head');
      const yp = el('button', 'ib', '‹'), yn = el('button', 'ib', '›'); yp.type = yn.type = 'button';
      yp.onclick = () => { year--; shown = year + shown.slice(4); draw(); }; yn.onclick = () => { year++; shown = year + shown.slice(4); draw(); };
      head.append(yp, el('b', null, year + '년'), yn); box.appendChild(head);
      const months = el('div', 'jump-months');
      for (let m = 1; m <= 12; m++) {
        const key = year + '-' + pad(m), b = el('button', 'jm', m + '월'); b.type = 'button';
        if (key === shown) b.classList.add('cur');
        if (key === S.ym) b.classList.add('viewing');
        if (key === todayStr().slice(0, 7)) b.classList.add('now');
        // 달을 누르면 아래 작은 달력만 그 달로 바뀌고, 날짜를 눌러야 큰 달력이 이동
        b.onclick = () => { shown = key; draw(); };
        months.appendChild(b);
      }
      box.appendChild(months);
      const mini = el('div', 'jump-mini'); mini.id = 'jumpMini'; box.appendChild(mini); drawMini();
      const foot = el('div', 'jump-foot'); const tb = el('button', null, '오늘로'); tb.type = 'button';
      tb.onclick = () => { closeJump(); $('todayBtn').click(); }; foot.appendChild(tb); box.appendChild(foot);
    };
    const drawMini = () => {
      const mini = box.querySelector('.jump-mini'); if (!mini) return; mini.textContent = '';
      mini.appendChild(el('div', 'jmini-t', (+shown.slice(0, 4)) + '년 ' + (+shown.slice(5)) + '월'));
      const g = el('div', 'jmini-g'), ws = S.cfg.weekStart || 0;
      for (let i = 0; i < 7; i++) g.appendChild(el('span', 'jdow', '일월화수목금토'[(i + ws) % 7]));
      const first = parse(shown + '-01'), off = (first.getDay() - ws + 7) % 7, days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      for (let i = 0; i < off; i++) g.appendChild(el('span'));
      for (let dd = 1; dd <= days; dd++) {
        const ds = shown + '-' + pad(dd), b = el('button', 'jd', String(dd)); b.type = 'button';
        const dw = (off + dd - 1 + ws) % 7; if (dw === 0) b.classList.add('sun'); else if (dw === 6) b.classList.add('sat');
        if (ds === todayStr()) b.classList.add('now'); if (ds === S.sel) b.classList.add('sel');
        b.onclick = () => { closeJump(); if (ds.slice(0, 7) !== S.ym) { S.ym = ds.slice(0, 7); S.sel = ds; S.events = []; render(); load(); } else select(ds); };
        g.appendChild(b);
      }
      mini.appendChild(g);
    };
    draw();
    document.body.appendChild(box);
    const r = $('monthTitle').getBoundingClientRect(), z = parseFloat(document.body.style.zoom || '1') || 1;
    box.style.left = Math.max(6, r.left / z - 10) + 'px'; box.style.top = (r.bottom / z + 6) + 'px';
  }
  document.addEventListener('mousedown', () => closeJump());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeJump(); });
  function shiftMonth(n) {
    const y = +S.ym.slice(0, 4), m = +S.ym.slice(5) - 1 + n;
    const d = new Date(y, m, 1); S.ym = ymd(d).slice(0, 7);
    S.sel = S.ym === todayStr().slice(0, 7) ? todayStr() : S.ym + '-01';
    S.events = []; render(); load();
  }


  // ---------- 일정 도우미 (챗봇) ----------
  // 붙여넣은 글에서 날짜·마감을 찾아 카드로 보여 주고, 고른 것만 구글 캘린더에 넣는다.
  const AS = { open: false, busy: false, keyOpen: false };
  const KIND_RULE = { 제출: '🔴 제출', 할일: '✔️ 할 일', 출장: '⭐️ 출장', 출강: '⭐️ 출강', 회의: '🖥 회의', 연수: '🖥 연수', 촬영: '📽 촬영', 일정: '🗓 일정', 발표: '🟡 발표' };
  const ruleByLabel = (l) => RULES.find(r => r.label === l) || RULES.find(r => r.label === '🗓 일정');
  function asApply() {
    $('assist').hidden = !AS.open; $('assistBtn').classList.toggle('on', AS.open);
    $('asMode').textContent = S.cfg.hasAiKey ? 'AI 켜짐' : 'AI 연결';
    $('asMode').classList.toggle('on', !!S.cfg.hasAiKey);
    $('asKey').hidden = !AS.keyOpen; $('asKeyDel').hidden = !S.cfg.hasAiKey;
    if (AS.open && !$('asLog').children.length) asBot('메신저·공문·메일 글을 <b>그대로 붙여넣어</b> 주세요. 날짜와 마감을 찾아 일정으로 만들어 드릴게요.<br><span class="as-ex">예) 학년말 평가계획을 11/14(금) 16시까지 제출해 주세요.</span>');
    if (AS.open) setTimeout(() => $('asText').focus(), 0);
  }
  function asScroll() { const l = $('asLog'); l.scrollTop = l.scrollHeight; }
  function asBot(html) { const m = el('div', 'as-msg bot'); m.innerHTML = html; $('asLog').appendChild(m); asScroll(); return m; }
  function asMe(text) { const m = el('div', 'as-msg me', text); $('asLog').appendChild(m); asScroll(); }
  const wdOf = (d) => '일월화수목금토'[parse(d).getDay()];
  const shortDate = (d) => (+d.slice(5, 7)) + '/' + (+d.slice(8)) + '(' + wdOf(d) + ')';

  function normAI(arr) {
    const today = todayStr();
    return arr.filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date || '')).map(x => ({
      kind: KIND_RULE[x.kind] ? x.kind : '일정', title: String(x.title || '일정').slice(0, 40),
      date: x.date, endDate: /^\d{4}-\d{2}-\d{2}$/.test(x.endDate || '') && x.endDate > x.date ? x.endDate : null,
      time: /^\d{2}:\d{2}$/.test(x.time || '') ? x.time : null, endTime: /^\d{2}:\d{2}$/.test(x.endTime || '') ? x.endTime : null,
      location: String(x.location || ''), src: '', past: x.date < today, checked: x.date >= today
    }));
  }

  async function asSend() {
    const text = $('asText').value.trim(); if (!text || AS.busy) return;
    $('asText').value = ''; asMe(text);
    if (!S.cfg.loggedIn) return asBot('먼저 <b>설정 → 계정</b>에서 구글 로그인을 해 주세요.');
    AS.busy = true; const wait = asBot('<span class="as-dots"><i></i><i></i><i></i></span> 날짜를 찾는 중이에요');
    let items = null, how = '날짜 규칙';
    if (S.cfg.hasAiKey) {
      const r = await api.assistAI(text, todayStr() + '(' + wdOf(todayStr()) + ')');
      if (r.ok) { items = normAI(r.data); how = 'AI'; }
      else if (r.code === 'BAD_KEY') asBot('AI 키가 맞지 않아요. 위쪽 <b>AI 켜짐</b>을 눌러 키를 다시 넣어 주세요. 이번에는 날짜 규칙으로 찾을게요.');
    }
    if (!items) items = window.RamAssist.parse(text, new Date()).items;
    wait.remove(); AS.busy = false;
    if (!items.length) return asBot('날짜를 찾지 못했어요. <b>11/14(금) 16시까지</b>처럼 날짜가 들어간 글을 붙여넣어 주세요.' + (S.cfg.hasAiKey ? '' : '<br><span class="as-ex">문장이 복잡하면 위쪽 <b>AI 연결</b>을 눌러 Gemini AI를 연결해 보세요.</span>'));
    await asMarkDup(items);
    asCards(items, how);
  }

  // 이미 캘린더에 있는 일정은 체크를 빼고 표시
  async function asMarkDup(items) {
    const ds = items.map(i => i.date).sort(); const a = ds[0], b = addDays(ds[ds.length - 1], 1);
    const r = await api.events(visibleCalIds(), parse(a).toISOString(), parse(b).toISOString());
    if (!r.ok) return;
    const key = (t) => String(t).replace(/^[^\p{L}\p{N}]*(\[[^\]]*\])?\s*/u, '').replace(/\s|\(\d{1,2}:\d{2}\)/g, '');
    items.forEach(it => {
      const k = key(it.title);
      const hit = r.data.items.find(e => { const d = (e.start.date || (e.start.dateTime || '').slice(0, 10)); const ek = key(e.summary || ''); return d === it.date && k && ek && (ek.includes(k) || k.includes(ek)); });
      if (hit) { it.dup = true; it.checked = false; }
    });
  }

  function asCards(items, how) {
    const m = asBot(`<b>${items.length}개</b>를 찾았어요. 맞는지 보고 고쳐서 등록해 주세요.<span class="as-how">${how}</span>`);
    const list = el('div', 'as-cards'); m.appendChild(list);
    items.forEach(it => {
      const c = el('div', 'as-card' + (it.past || it.dup ? ' dim' : ''));
      const top = el('div', 'as-ctop');
      const ck = el('input'); ck.type = 'checkbox'; ck.checked = it.checked; ck.title = '등록할 일정';
      const kind = el('select', 'as-kind'); RULES.forEach(r => { const o = el('option', null, r.label); o.value = r.label; kind.appendChild(o); });
      kind.value = KIND_RULE[it.kind] || '🗓 일정';
      top.append(ck, kind);
      if (it.dup) top.appendChild(el('span', 'as-tag', '이미 있음'));
      else if (it.past) top.appendChild(el('span', 'as-tag', '지난 날짜'));
      const title = el('input', 'as-title'); title.value = it.title; title.placeholder = '제목';
      const row = el('div', 'as-crow');
      const d = el('input'); d.type = 'date'; d.value = it.date; d.title = '날짜';
      const t = el('input'); t.type = 'time'; t.value = it.time || ''; t.title = '시각(비우면 종일)';
      row.append(d, t);
      if (it.endDate) row.appendChild(el('span', 'as-range', '~ ' + shortDate(it.endDate)));
      c.append(top, title, row);
      if (it.location) c.appendChild(el('div', 'as-loc', '📍 ' + it.location));
      c._get = () => ({ on: ck.checked, rule: ruleByLabel(kind.value), title: title.value.trim(), date: d.value, time: t.value, endDate: it.endDate, endTime: it.endTime, location: it.location, src: it.src });
      ck.onchange = () => c.classList.toggle('off', !ck.checked); c.classList.toggle('off', !ck.checked);
      list.appendChild(c);
    });
    const foot = el('div', 'as-foot');
    const cal = el('select', 'as-cal');
    S.cals.filter(c => c.writable).forEach(c => { const o = el('option', null, c.name + (c.primary ? ' (기본)' : '')); o.value = c.id; cal.appendChild(o); });
    const pri = S.cals.find(c => c.primary && c.writable); if (pri) cal.value = pri.id;
    const go = el('button', 'primary', '등록'); go.type = 'button';
    const upd = () => { const n = [...list.children].filter(c => c._get().on).length; go.textContent = n ? n + '개 등록' : '등록'; go.disabled = !n; };
    list.addEventListener('change', upd); upd();
    go.onclick = () => asRegister([...list.children].map(c => c._get()).filter(x => x.on), cal.value, m, go);
    foot.append(cal, go); m.appendChild(foot);
    if (!S.cfg.hasAiKey) {
      const tip = el('button', 'as-aitip', '빠진 게 있나요? Gemini AI를 연결하면 더 정확해요 →'); tip.type = 'button';
      tip.onclick = () => { AS.keyOpen = true; asApply(); $('asKeyInput').focus(); };
      m.appendChild(tip);
    }
    asScroll();
  }

  function asBody(x) {
    const r = x.rule; let title = x.title || '일정';
    const isDeadline = r.label === '🔴 제출';
    if (isDeadline && x.time && !/\(\d{1,2}:\d{2}\)$/.test(title)) title += ' (' + x.time + ')';
    const body = { summary: r.prefix + title, location: x.location || '', description: x.src ? '원문: ' + x.src + '\n(Ram Calendar 일정 도우미로 등록)' : '(Ram Calendar 일정 도우미로 등록)', reminders: { useDefault: false, overrides: [] } };
    if (r.color) body.colorId = r.color;
    const allDay = isDeadline || !x.time || r.allDay === true;
    if (r.time && !x.time) { // 할 일: 그날 23~24시
      body.start = { dateTime: localIso(x.date, r.time[0]), timeZone: TZ }; body.end = { dateTime: localIso(addDays(x.date, 1), '00:00'), timeZone: TZ };
    } else if (allDay) {
      body.start = { date: x.date }; body.end = { date: addDays(x.endDate && x.endDate > x.date ? x.endDate : x.date, 1) };
    } else {
      const ed = x.endDate && x.endDate > x.date ? x.endDate : x.date;
      let et = x.endTime;
      if (!et || (ed === x.date && et <= x.time)) { const z = new Date(localIso(x.date, x.time)); z.setHours(z.getHours() + 1); et = hm(z); }
      body.start = { dateTime: localIso(x.date, x.time), timeZone: TZ }; body.end = { dateTime: localIso(ed, et), timeZone: TZ };
    }
    return body;
  }

  async function asRegister(xs, calId, msg, btn) {
    if (!xs.length) return;
    btn.disabled = true; btn.textContent = '등록 중…';
    const ok = [], bad = [];
    for (const x of xs) {
      if (!x.date) { bad.push(x.title + ' (날짜 없음)'); continue; }
      const r = await api.create(calId, asBody(x));
      if (r.ok) ok.push(x); else bad.push(x.title + ' — ' + r.message);
    }
    msg.querySelectorAll('input,select,button').forEach(e => e.disabled = true);
    btn.textContent = ok.length ? '등록 완료' : '다시 시도';
    if (!ok.length) { msg.querySelectorAll('input,select,button').forEach(e => e.disabled = false); }
    if (ok.length) msg.classList.add('done');
    if (ok.length) {
      const b = asBot(`<b>${ok.length}개</b>를 등록했어요. 누르면 그 날짜로 가요.`);
      const ul = el('div', 'as-done');
      ok.sort((a, b) => a.date < b.date ? -1 : 1).forEach(x => {
        const a = el('button', 'as-go', shortDate(x.date) + '  ' + x.rule.prefix + x.title); a.type = 'button';
        a.onclick = () => { S.sel = x.date; if (x.date.slice(0, 7) !== S.ym) { S.ym = x.date.slice(0, 7); S.events = []; } render(); load(); };
        ul.appendChild(a);
      });
      b.appendChild(ul);
      const first = ok[0].date; if (first.slice(0, 7) === S.ym) load(); api.win('alarmRefresh');
    }
    if (bad.length) asBot('등록하지 못한 것: <br>' + bad.map(x => '· ' + x.replace(/</g, '&lt;')).join('<br>'));
  }

  function asBind() {
    $('assistBtn').onclick = () => { AS.open = !AS.open; asApply(); };
    $('asClose').onclick = () => { AS.open = false; asApply(); };
    $('asMode').onclick = () => { AS.keyOpen = !AS.keyOpen; asApply(); if (AS.keyOpen) $('asKeyInput').focus(); };
    $('asKeyLink').onclick = (e) => { e.preventDefault(); api.win('open', 'https://aistudio.google.com/apikey'); };
    $('asKeySave').onclick = async () => {
      const k = $('asKeyInput').value.trim(); if (!k) return;
      const r = await api.assistKey(k); $('asKeyInput').value = '';
      if (r.ok) { S.cfg.hasAiKey = true; AS.keyOpen = false; asApply(); asBot('AI를 연결했어요. 이제 복잡한 문장도 알아들어요.'); }
    };
    $('asKeyDel').onclick = async () => { const r = await api.assistKey(''); if (r.ok) { S.cfg.hasAiKey = false; AS.keyOpen = false; asApply(); asBot('AI 연결을 끊었어요. 날짜 규칙으로 찾을게요.'); } };
    $('asForm').addEventListener('submit', (e) => { e.preventDefault(); asSend(); });
    $('asText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); asSend(); } });
  }


  // ---------- 설정: AI 연결 ----------
  function stAiRender() {
    if (!$('stAiState')) return;
    const on = !!S.cfg.hasAiKey;
    $('stAiState').textContent = on ? '✅ Gemini AI 연결됨' : '연결 안 됨 — 날짜 규칙으로 찾는 중';
    $('stAiSave').textContent = on ? '키 바꾸기' : '연결'; $('stAiDel').hidden = !on;
  }
  function stAiBind() {
    if (!$('stAiSave')) return;
    $('stAiLink').onclick = (e) => { e.preventDefault(); api.win('open', 'https://aistudio.google.com/apikey'); };
    $('stAiSave').onclick = async () => {
      const k = $('stAiKey').value.trim(); if (!k) { $('stAiKey').focus(); return; }
      const r = await api.assistKey(k); $('stAiKey').value = '';
      if (r.ok) { S.cfg.hasAiKey = true; stAiRender(); }
    };
    $('stAiDel').onclick = async () => { const r = await api.assistKey(''); if (r.ok) { S.cfg.hasAiKey = false; stAiRender(); } };
    stAiRender();
  }

  async function initSettingsWindow() {
    document.body.classList.add('settings-mode'); document.title = 'Ram Calendar 설정';
    const r = await api.getCfg(); S.cfg = r.ok ? r.data : {};
    themeApply(); bind(); stAiBind();
    if (S.cfg.loggedIn) { const c = await api.calendars(); if (c.ok) S.cals = c.data; }
    S.draft = {}; renderSettings(); $('settings').show();
  }
  async function init() {
    if (SET_MODE) return initSettingsWindow();
    const r = await api.getCfg(); S.cfg = r.ok ? r.data : {};
    themeApply(); lockApply(); applyPanel(); applyFoot(); bind(); asBind(); asApply(); applyMini(); render();
    $('tbOpacity').value = Math.round((S.cfg.opacity || 1) * 100);
    await load({ cals: true }); startTimer();
  }
  init();
})();
