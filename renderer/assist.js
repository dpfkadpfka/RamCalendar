// 일정 도우미 — 붙여넣은 글(메신저·공문·메일)에서 날짜·마감을 찾아 일정 후보로 만든다.
// AI 없이 규칙으로 찾는다(무료·오프라인). AI 키가 있으면 app.js가 AI 결과를 먼저 쓰고, 실패하면 이 규칙으로 돌아온다.
(function (root) {
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const WD = '일월화수목금토';

  // 분류 — app.js의 RULES 라벨과 같은 이름
  const KINDS = [
    { kind: '제출', re: /(제출|마감|회신|신청|입력|접수|기한|보고서|응답|설문|등록\s*마감|올려\s*주|보내\s*주)/ },
    { kind: '출장', re: /출장/ },
    { kind: '연수', re: /연수/ },
    { kind: '촬영', re: /촬영/ },
    { kind: '회의', re: /(회의|협의회|협의|위원회|간담회|워크숍)/ },
    { kind: '발표', re: /(발표|공개수업|수업\s*공개)/ }
  ];

  function kindOf(seg, subject) {
    if (/까지/.test(seg) && !/부터|~/.test(seg)) return '제출';
    for (const k of KINDS) if (k.re.test(seg)) return k.kind;
    for (const k of KINDS) if (k.re.test(subject || '')) return k.kind;
    return '일정';
  }

  // 연도 없는 날짜: 올해로 보되 두 달 넘게 지난 날짜면 내년으로 본다
  function guessYear(m, d, now) {
    let y = now.getFullYear();
    const t = new Date(y, m - 1, d);
    const back = new Date(now); back.setDate(back.getDate() - 60);
    if (t < back) y++;
    return y;
  }
  function valid(y, m, d) { const t = new Date(y, m - 1, d); return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d; }

  function findDates(seg, now) {
    const out = [];
    const push = (i, len, y, m, d, src) => { if (valid(y, m, d)) out.push({ i, len, date: ymd(new Date(y, m - 1, d)), src }); };
    let m;
    const full = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?\.?(?:\s*\(\s*[월화수목금토일]\s*\))?/g;
    while ((m = full.exec(seg))) push(m.index, m[0].length, +m[1], +m[2], +m[3], m[0]);
    const taken = (i) => out.some(o => i >= o.i && i < o.i + o.len);
    const kor = /(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*\(\s*[월화수목금토일]\s*\))?/g;
    while ((m = kor.exec(seg))) if (!taken(m.index)) push(m.index, m[0].length, guessYear(+m[1], +m[2], now), +m[1], +m[2], m[0]);
    const num = /(?<![\d.:])(\d{1,2})\s*[./]\s*(\d{1,2})(?![\d%:])(?!\s*\.\s*\d)\.?(?:\s*\(\s*([월화수목금토일])\s*\))?/g;
    while ((m = num.exec(seg))) {
      if (taken(m.index)) continue;
      const mo = +m[1], da = +m[2];
      if (mo < 1 || mo > 12 || da < 1 || da > 31) continue;
      // 소수(3.5점)와 헷갈리지 않게: 요일 괄호나 날짜다운 말이 붙어 있을 때만
      const after = seg.slice(m.index + m[0].length, m.index + m[0].length + 6);
      const before = seg.slice(Math.max(0, m.index - 6), m.index);
      if (!m[3] && !/^\s*(까지|부터|~|-|–|일|\(|오전|오후|\d{1,2}\s*[:시])/.test(after) && !/(기한|일시|날짜|마감|일자|기간|~|-|–)\s*[:：]?\s*$/.test(before) && !/[/]/.test(m[0])) continue;
      push(m.index, m[0].length, guessYear(mo, da, now), mo, da, m[0]);
    }
    // "11월 18일부터 20일까지"의 20일처럼 달이 빠진 끝 날짜
    const bare = /(부터|~|-|–)\s*(\d{1,2})\s*일/g;
    while ((m = bare.exec(seg))) {
      const prev = out.filter(o => o.i < m.index).sort((a, b) => b.i - a.i)[0];
      if (!prev) continue;
      const [py, pm] = prev.date.split('-').map(Number);
      const i = m.index + m[0].indexOf(m[2]);
      if (!taken(i)) push(i, m[0].length - m[0].indexOf(m[2]), py, pm, +m[2], m[0]);
    }
    const rel = /(오늘|금일|내일|명일|모레)|(?:(이번\s*주|금주|다음\s*주|차주|담주|다다음\s*주)\s*)?([월화수목금토일])요일/g;
    while ((m = rel.exec(seg))) {
      if (taken(m.index)) continue;
      const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (m[1]) t.setDate(t.getDate() + ({ 오늘: 0, 금일: 0, 내일: 1, 명일: 1, 모레: 2 })[m[1]]);
      else {
        const want = WD.indexOf(m[3]); const cur = t.getDay();
        const wk = (m[2] || '').replace(/\s/g, '');
        let diff = (want - cur + 7) % 7;
        if (/다음주|차주|담주/.test(wk)) diff = (want === 0 ? 7 : want) - (cur === 0 ? 7 : cur) + 7;
        else if (/다다음주/.test(wk)) diff = (want === 0 ? 7 : want) - (cur === 0 ? 7 : cur) + 14;
        else if (/이번주|금주/.test(wk)) diff = (want === 0 ? 7 : want) - (cur === 0 ? 7 : cur);
        t.setDate(t.getDate() + diff);
      }
      out.push({ i: m.index, len: m[0].length, date: ymd(t), src: m[0] });
    }
    return out.sort((a, b) => a.i - b.i);
  }

  function findTimes(seg) {
    const out = [];
    const re = /(오전|오후|낮|저녁|밤|아침)?\s*(\d{1,2})\s*(?::\s*(\d{2})|시(?!간)\s*(?:(\d{1,2})\s*분|(반))?)/g;
    let m;
    while ((m = re.exec(seg))) {
      let h = +m[2]; const mi = m[3] ? +m[3] : m[4] ? +m[4] : m[5] ? 30 : 0;
      if (h > 24 || mi > 59) continue;
      if (/오후|저녁|밤/.test(m[1] || '') && h < 12) h += 12;
      if (m[1] === '낮' && h < 6) h += 12;
      out.push({ i: m.index, len: m[0].length, hm: pad(h % 24) + ':' + pad(mi), h, ampm: !!m[1] || !!m[3] });
    }
    return out;
  }

  const CLEAN = [
    /^(변경|연기|조정)된\s*/g,
    /\s*(기한|일정|날짜|일시|장소|시간)?\s*(이|가|을|를)?\s*(변경|연기|조정|앞당겨|당겨)(되었습니다|됐습니다|되었어요|됐어요|됩니다|돼요|되어|됨|된|했습니다|합니다)?[.!]?/g,
    /(은|는|도)?\s*그대로(\s*(진행|운영|실시))?/g,
    /^(안녕하세요|안녕하십니까)[^.!?]*[.!?]?\s*/g, /^\s*선생님(들)?\s*[,.]?\s*/g,
    /(제출\s*)?(기한|마감(일|일시)?|일시|일자|날짜|기간|시간|때)\s*[:：]?/g,
    /\(\s*[월화수목금토일]\s*\)/g,
    /(까지|부터)(입니다|이에요|예요|이며|이고)?/g,
    /(에서|에|中)(?=\s|$|[,.)])/g,
    /(해\s*)?(주시기\s*)?(바랍니다|부탁드립니다|부탁합니다|부탁드려요|부탁해요|드립니다|드려요|합니다|입니다|하세요|해\s*주세요|주세요|예정입니다|예정이에요|있습니다|있어요|됩니다|돼요|하겠습니다|요망)[.!~]*/g,
    /^(또한|그리고|아울러|및|그리고요)\s+/g,
    /(안내|알림|공지)(\s*(드립니다|합니다))?$/g
  ];
  const TAIL = /\s*(이|가)?\s*(진행|실시|개최|운영)(될|할|됩)?\s*(예정)?\s*$/;
  function tidy(s) {
    let t = s.replace(/[★☆□■◆◇○●◎※▶▷►☞→✔✓]+/g, ' ');
    CLEAN.forEach(r => { t = t.replace(r, ' '); });
    t = t.replace(/^\s*\d{1,2}[.)]\s+/, '').replace(/^[\s\-•·*>~)\]]+/, '').replace(/^(또한|그리고|아울러)\s+/, '');
    t = t.replace(/\s*~\s*/g, ' ').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
    for (let k = 0; k < 3; k++) t = t.replace(TAIL, '').replace(/\s+일정$/, '').replace(/[\s\-–:：,.!]+$/, '').replace(/(이|가|은|는|을|를|에|로|으로|와|과|에서)$/, '').trim();
    return t;
  }
  function subjectOf(lines) {
    for (const l of lines) {
      let s = l.replace(/^(re|fw|fwd)\s*[:：]\s*/i, '').replace(/^\s*(\[[^\]]{1,12}\]\s*)+/, '').trim();
      s = s.replace(/\s*(안내|알림|공지|협조\s*요청|요청|협조)(\s*(드립니다|합니다))?\s*$/, '').trim();
      s = tidy(s) || s;
      if (s && !/^(안녕하세요|선생님|수고|감사)/.test(s) && /[가-힣A-Za-z]/.test(s)) return s.slice(0, 40);
    }
    return '';
  }

  // 메신저·카톡·메일에서 복사할 때 딸려 오는 머리글(보낸 사람·보낸 시각·날짜 구분선)을 지운다.
  // 보낸 시각을 일정으로 잘못 잡지 않게 하려는 것.
  const META = /^(보낸\s*사람|받는\s*사람|보낸\s*날짜|받은\s*날짜|보낸\s*시간|받은\s*시간|발신(자|인|일시|시간)?|수신(자|인|일시|시간)?|참조|숨은\s*참조|전송\s*일시|전달\s*일시|작성\s*일(시)?|등록\s*일(시)?|게시\s*일(시)?|from|to|cc|sent|date)\s*[:：]/i;
  const STAMP = /(20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?\.?\s*(\(\s*[월화수목금토일]\s*\)|[월화수목금토일]요일)?\s*)?(오전|오후|AM|PM)?\s*\d{1,2}:\d{2}(:\d{2})?\s*(오전|오후|AM|PM)?\s*$/i;
  function cleanLines(text) {
    return String(text || '').replace(/\r/g, '').split('\n').map(l => {
      let s = l.trim();
      // 카톡: [이름] [오후 3:20] 내용 / 2026. 11. 13. 오후 3:20, 이름 : 내용
      s = s.replace(/^\[[^\]]{1,30}\]\s*\[(오전|오후)\s*\d{1,2}:\d{2}\]\s*/, '');
      s = s.replace(/^20\d{2}\.\s*\d{1,2}\.\s*\d{1,2}\.?\s*(오전|오후)\s*\d{1,2}:\d{2},\s*[^:]{1,30}\s*:\s*/, '');
      return s;
    }).filter(s => {
      if (!s) return false;
      if (META.test(s) || META.test(s.replace(/^([가-힣])\s(?=[가-힣](\s[가-힣])*\s*[:：])/, '$1').replace(/(?<=^[가-힣\s]{1,8})\s+(?=[가-힣:：])/g, ''))) return false;
      if (/^(메시지|쪽지|메일)\s*[-=─━]{3,}\s*$/.test(s)) return false;
      if (/^[-=─━\s]*20\d{2}년\s*\d{1,2}월\s*\d{1,2}일\s*[월화수목금토일]요일[-=─━\s]*$/.test(s)) return false; // 카톡 날짜 구분선
      const m = s.match(STAMP);
      if (m && /\d{1,2}:\d{2}/.test(m[0])) {
        const head = s.slice(0, m.index).trim();
        // 시각만 있는 줄, 또는 "이름 2026-11-13 09:50"처럼 짧은 머리글 + 보낸 시각
        if (!head || (head.length <= 25 && !/(까지|부터|마감|제출|회의|연수|협의|행사|일시|시간|시작|모임|예정|[다요]\.?$)/.test(head) && (/:\d{2}:\d{2}/.test(m[0]) || /20\d{2}/.test(m[0])))) return false;
      }
      return true;
    });
  }

  function parse(text, now) {
    now = now || new Date();
    const lines = cleanLines(text);
    const subject = lines.length > 1 ? subjectOf(lines) : '';
    const segs = [];
    lines.forEach(l => l.split(/(?<=[다요]\.)\s+|(?<=\.)\s+(?=[가-힣])(?<![\d]\.\s+)/).forEach(s => s.trim() && segs.push(s.trim())));
    const locLine = (lines.find(l => /^(장소|위치|회의실)\s*[:：]/.test(l.replace(/^[\s\-•·*○●▶※◎□■]+/, ''))) || '').replace(/^.*?[:：]\s*/, '');
    const today = ymd(now);
    const items = [];
    segs.forEach(seg => {
      const ds = findDates(seg, now);
      if (!ds.length) return;
      const ts = findTimes(seg.replace(/\d{4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}/g, m => ' '.repeat(m.length)));
      // 날짜 범위(11/12~11/14, 11월 12일부터 14일까지)
      let date = ds[0].date, endDate = null;
      if (ds[1]) {
        const between = seg.slice(ds[0].i + ds[0].len, ds[1].i);
        if (/^\s*(~|-|–|부터|에서)\s*$/.test(between) && ds[1].date >= ds[0].date) endDate = ds[1].date;
      }
      const kind = kindOf(seg, subject);
      let time = null, endTime = null;
      if (ts.length) {
        let t0 = ts[0];
        // 오전/오후 표시가 없는 1~7시는 학교 일과상 오후로 본다
        if (!t0.ampm && t0.h >= 1 && t0.h <= 7) t0 = Object.assign({}, t0, { hm: pad(t0.h + 12) + t0.hm.slice(2) });
        time = t0.hm;
        if (ts[1]) {
          const between = seg.slice(ts[0].i + ts[0].len, ts[1].i);
          if (/^\s*(~|-|–|부터)\s*$/.test(between)) { let t1 = ts[1]; if (!t1.ampm && t1.h >= 1 && t1.h <= 9) t1 = Object.assign({}, t1, { hm: pad(t1.h + 12) + t1.hm.slice(2) }); endTime = t1.hm; }
        }
      }
      // 제목: 날짜·시간·군더더기를 지운 나머지. 너무 짧으면 글의 제목을 쓴다
      let rest = seg;
      [...ds, ...ts].sort((a, b) => b.i - a.i).forEach(x => { rest = rest.slice(0, x.i) + ' ' + rest.slice(x.i + x.len); });
      rest = rest.replace(/(장소|위치)\s*[:：].*$/, '');
      let title = tidy(rest);
      const generic = /^(제출|회신|신청|마감|입력|보고|등록|접수|회의|연수|일정|행사|협의회)?$/;
      if (title.length < 4 || generic.test(title)) title = subject ? subject + (title && !subject.includes(title) ? ' ' + title : '') : (title || (kind === '일정' ? '일정' : kind));
      const ob = title.match(/^(.{2,30}?)\s*(을|를)\s+.*?(제출|회신|신청|입력|응답|등록|보고|작성|보내|올려|업로드|탑재)/);
      if (ob && /보내|올려|업로드|탑재/.test(ob[3])) ob[3] = '제출';
      if (ob) title = ob[1] + ' ' + ob[3];
      let ploc = '';
      title = title.replace(/\s*\(([^()]{2,15})$/, (m, x) => { ploc = x; return ''; }).replace(/\s*\(([^()]{2,15})\)$/, (m, x) => { ploc = x; return ''; });
      if (!title) title = kind === '일정' ? (subject || '일정') : kind;
      title = title.slice(0, 40).trim();
      const loc = (seg.match(/(장소|위치)\s*[:：]\s*(.+)$/) || [])[2] || ploc || (kind !== '제출' ? locLine : '') || '';
      const hm = pad(now.getHours()) + ':' + pad(now.getMinutes());
      const past = date < today || (date === today && !endDate && time && (endTime || time) < hm);
      items.push({ kind, title, date, endDate, time, endTime, location: loc.trim(), src: seg, past, checked: !past });
    });
    // 같은 날 같은 제목은 하나로
    const seen = new Set();
    return { subject, items: items.filter(it => { const k = it.date + '|' + it.title; if (seen.has(k)) return false; seen.add(k); return true; }) };
  }

  const api = { parse, findDates, findTimes, cleanLines, subjectOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RamAssist = api;
})(typeof window !== 'undefined' ? window : globalThis);
