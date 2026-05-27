/* ============================================================
   IBBA Graduation Credit Audit — app logic
   Pure front-end. Reads data/courses.json, parses uploaded
   review-form PDFs with pdf.js, audits against IBBA rules.
   ============================================================ */
"use strict";

/* ---- pdf.js worker ---- */
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const TG = {};       // thresholds, filled from JSON
let CAT = null;      // course catalogue from courses.json

/* status: 0 = 未修, 1 = 已修畢, 2 = 修課中 */
const state = {
  status: "intl",
  req: [], core: [], adv: [],
  extra: [],            // {code,name,cr,g}
  cnCr: 0, cnState: "prog",
  enState: "none",
  geCr: 0,
  peState: "none",
  autoFlags: { req: [], core: [], adv: [] }, // which rows were auto-filled
};

/* ============================================================
   LOAD CATALOGUE
   ============================================================ */
async function loadCatalogue() {
  const res = await fetch("data/courses.json");
  CAT = await res.json();
  Object.assign(TG, CAT.thresholds);
  state.req  = CAT.required.map(() => ({ s: 0, g: "" }));
  state.core = CAT.core.map(()    => ({ s: 0, g: "" }));
  state.adv  = CAT.advanced.map(()=> ({ s: 0, g: "" }));
  state.autoFlags = {
    req:  CAT.required.map(() => false),
    core: CAT.core.map(()     => false),
    adv:  CAT.advanced.map(() => false),
  };
}

/* ============================================================
   TEXT NORMALISATION + MATCHING
   ============================================================ */
function norm(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[（）()]/g, " ")
    .replace(/[．。、,，:：;；\-_/&]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(i)\b/g, "1").replace(/\b(ii)\b/g, "2")
    .replace(/\b(iii)\b/g, "3")
    .trim();
}
/* token-overlap similarity 0..1 — uses containment so a short
   catalogue name fully present in a longer parsed line scores high */
function sim(a, b) {
  const ta = norm(a).split(" ").filter(Boolean);
  const tb = norm(b).split(" ").filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  const setA = new Set(ta), setB = new Set(tb);
  let hit = 0;
  setA.forEach(t => { if (setB.has(t)) hit++; });
  // containment: fraction of the SHORTER token set that is matched
  const shorter = Math.min(setA.size, setB.size);
  const longer = Math.max(setA.size, setB.size);
  const containment = hit / shorter;
  const jaccardish = hit / longer;
  // weight containment but penalise large length mismatch a little
  return containment * 0.75 + jaccardish * 0.25;
}
/* best match of a parsed course name against a catalogue group */
function bestMatch(name, list) {
  let best = -1, score = 0;
  list.forEach((c, i) => {
    let s = sim(name, c.name);
    (c.aliases || []).forEach(al => { s = Math.max(s, sim(name, al)); });
    if (s > score) { score = s; best = i; }
  });
  return { idx: best, score };
}
/* exact code match against a catalogue group (returns idx or -1) */
function codeMatch(code, list) {
  if (!code) return -1;
  const cc = code.replace(/\s+/g, "").toUpperCase();
  return list.findIndex(c =>
    c.code && c.code.replace(/\s+/g, "").toUpperCase() === cc);
}

/* identify whether a parsed course is a known IBP GE course.
   Matches by IBP code or by name/alias similarity. Returns the
   catalogue entry or null. IBP codes look like "IBP 1xxxxx".     */
function identifyIbp(c) {
  const list = (CAT.ibpCourses || []);
  const codeM = (c.code || "").match(/IBP\s?\d{6}/i);
  if (codeM) {
    const cc = codeM[0].replace(/\s+/g, "").toUpperCase();
    const hit = list.find(x => {
      const codes = [x.code, ...(x.aliases || [])]
        .filter(s => /IBP/i.test(s))
        .map(s => s.replace(/\s+/g, "").toUpperCase());
      return codes.includes(cc);
    });
    if (hit) return hit;
  }
  let best = null, score = 0;
  list.forEach(x => {
    let s = sim(c.name, x.name);
    (x.aliases || []).forEach(al => { if (!/IBP/i.test(al)) s = Math.max(s, sim(c.name, al)); });
    if (s > score) { score = s; best = x; }
  });
  return score >= 0.72 ? best : null;
}

/* Parse the "Compulsory courses" summary block at the bottom of
   the review form. Lines look like:
     "College Chinese 0 0"
     "English III 4 4 0"
     "Elective English 2 2 0"
     "GE Course IBP Courses: 6"   (annotation)
     "Total 20 21 0"              <- GE 校定必修: required/passed/missing
     "Mandarin Course 8 12 0 ..."
   Returns {geReq,gePassed, cnReq,cnPassed, enPassed, peDone}.    */
function parseRequirementsSummary(lines) {
  const out = {};
  const blob = lines.join(" \n ");
  lines.forEach(l => {
    let m = l.match(/^Total\s+(\d+)\s+(\d+)\s+(\d+)/i);
    if (m) { out.geReq = +m[1]; out.gePassed = +m[2]; out.geMissing = +m[3]; }
    m = l.match(/Mandarin Course\s+(\d+)\s+(\d+)/i);
    if (m) { out.cnReq = +m[1]; out.cnPassed = +m[2]; }
    m = l.match(/English\s+III\s+(\d+)\s+(\d+)/i);
    if (m) { out.enPassed = (out.enPassed || 0) + (+m[2]); }
    m = l.match(/Elective English\s+(\d+)\s+(\d+)/i);
    if (m) { out.enPassed = (out.enPassed || 0) + (+m[2]); }
  });
  // PE: rows are often fragmented — search the whole text blob
  if (/fulfilled the graduation requirements in P\.?E/i.test(blob)) {
    out.peDone = true;
  } else if (/Missing\s+\d+[\s\S]{0,12}semester/i.test(blob)) {
    out.peDone = false;
  }
  return out;
}

/* ============================================================
   PDF PARSING
   ============================================================ */
/* Extract lines from the PDF: each line = {y, text} reconstructed
   by grouping text items on similar vertical positions.          */
async function pdfToLines(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const rows = {};
    tc.items.forEach(it => {
      const y = Math.round(it.transform[5]);
      const key = Math.round(y / 3); // bucket close y-values
      (rows[key] = rows[key] || []).push({ x: it.transform[4], s: it.str });
    });
    Object.keys(rows).forEach(k => {
      const txt = rows[k].sort((a, b) => a.x - b.x).map(o => o.s).join(" ")
        .replace(/\s+/g, " ").trim();
      if (txt) lines.push(txt);
    });
  }
  return lines;
}

/* Grade tokens: A+, A, A-, B+, ... F, In progress, 通過, Pass     */
const GRADE_RE = /\b([ABCDF][+\-]?|In ?progress|通過|Pass)\b/i;
const CODE_RE = /\b([A-Z]{2,4}\s?\d{6})\b/;

/* clean a raw name fragment (remove code/grade/category/digits)   */
function cleanName(raw) {
  return raw
    .replace(CODE_RE, " ")
    .replace(/基礎\s*Basic|核心\s*Core|進階\s*Advanced/gi, " ")
    .replace(/\bBasic\b|\bCore\b|\bAdvanced\b/gi, " ")
    .replace(GRADE_RE, " ")
    .replace(/[&＆]/g, " ")
    .replace(/[_*]{2,}/g, " ")
    .replace(/\s\d(\s\d)*\s*$/, " ")
    .replace(/\b\d\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* Merge wrapped rows: the review form sometimes puts the course
   name on one line and "CODE cr cr grade 類別" on the next, or
   vice-versa. Stitch a name-bearing line with an adjacent
   code/grade-bearing line when one of them lacks the other part. */
function mergeRows(lines) {
  const out = [];
  // count name-bearing letters only (exclude code, grade, category words)
  const nameLetters = s => {
    const stripped = s
      .replace(CODE_RE, " ")
      .replace(GRADE_RE, " ")
      .replace(/基礎|核心|進階|Basic|Core|Advanced/gi, " ");
    return (stripped.match(/[A-Za-z]/g) || []).length;
  };
  for (let i = 0; i < lines.length; i++) {
    const l = (lines[i] || "").replace(/\s+/g, " ").trim();
    if (!l) continue;
    const hasCode = CODE_RE.test(l);
    const hasGrade = GRADE_RE.test(l);
    const letters = nameLetters(l);
    const nextL = (lines[i + 1] || "").replace(/\s+/g, " ").trim();
    const prevOut = out[out.length - 1] || "";

    // case A: code row with few name letters -> attach preceding name line
    if (hasCode && letters < 10 && prevOut &&
        !CODE_RE.test(prevOut) && !GRADE_RE.test(prevOut)) {
      out[out.length - 1] = prevOut + " " + l;
      continue;
    }
    // case B: pure name line, next line is a sparse code row -> merge forward
    if (!hasCode && !hasGrade && nextL && CODE_RE.test(nextL) &&
        nameLetters(nextL) < 10) {
      out.push(l + " " + nextL);
      i++;
      continue;
    }
    // case C: name line whose plain continuation follows
    if (!hasCode && !hasGrade && nextL && !CODE_RE.test(nextL) &&
        !GRADE_RE.test(nextL) && /[a-z)]$/.test(l) &&
        /^[A-Z(]/.test(nextL) && nextL.length < 40 &&
        !/^(Basic|Core|Advanced|GE|IBP|Total|Course)/i.test(nextL)) {
      out.push(l + " " + nextL);
      i++;
      continue;
    }
    out.push(l);
  }
  return out;
}

function parseCourseLine(line) {
  if (/^[\u4e00-\u9fff\s、。：:_*]+$/.test(line)) return null;
  if (/Course No|Course name|Field category|Signature of|Minimum Credits|review form/i.test(line))
    return null;

  const codeM = line.match(CODE_RE);
  const code = codeM ? codeM[1].replace(/\s+/g, " ").trim() : "";
  const gM = line.match(GRADE_RE);
  let grade = gM ? gM[1].replace(/\s+/g, " ") : "";
  if (/in ?progress/i.test(grade)) grade = "In progress";

  const name = cleanName(line);
  if (name.length < 3) return null;
  return { name, code, grade };
}

/* Main parse: given pdf lines, returns assignments + leftovers   */
function auditFromLines(rawLines) {
  const lines = mergeRows(rawLines);
  const result = {
    req:  CAT.required.map(() => null),
    core: CAT.core.map(()     => null),
    adv:  CAT.advanced.map(() => null),
    extra: [],
    unmatched: [],
    meta: {},
  };

  // pull student id / name / status if present
  lines.forEach(l => {
    let m;
    if ((m = l.match(/Student ID No\.?:?\s*([0-9]{6,})/i))) result.meta.sid = m[1];
    if ((m = l.match(/Name:?\s*([A-Za-z .]+?)\s*[（(]/))) result.meta.name = m[1].trim();
    if (/International student|國際生/i.test(l)) result.meta.status = "intl";
    if (/僑生|Overseas/i.test(l)) result.meta.status = result.meta.status || "overseas";
  });

  /* The review form has a "Free Elective Course" / 通識 section.
     Anything after that marker is NOT a major course and must not
     auto-fill core/advanced slots. We still try to recognise IBP /
     GE courses here so they can be tagged as 通識 automatically. */
  const FREE_MARKER = /Free Elective Course|通識課程因為外籍生|Compulsory courses/i;

  const MATCH_TH = 0.66;   // name-similarity threshold to auto-accept
  let inFreeSection = false;
  result.geAuto = [];      // courses auto-identified as General Education

  lines.forEach(line => {
    if (FREE_MARKER.test(line)) { inFreeSection = true; }

    const c = parseCourseLine(line);
    if (!c) return;
    if (!c.grade) return;             // no grade -> not yet taken; skip

    if (inFreeSection) {
      // try to recognise an IBP course (by code or name)
      const ibp = identifyIbp(c);
      if (ibp) {
        c.geKind = "IBP";
        c.cr = ibp.cr;
        result.geAuto.push(c);
      } else if (/\bIBP\s?\d/.test(line) || /\bGEC?\s?\d/.test(line)) {
        // GE-coded but not in IBP table -> still treat as GE candidate
        c.geKind = "GE";
        result.geAuto.push(c);
      } else {
        result.unmatched.push(c);
      }
      return;
    }

    // 1) exact course-code match first (most reliable)
    let codeHit = false;
    for (const g of ["req", "core", "adv"]) {
      const list = g === "req" ? CAT.required : g === "core" ? CAT.core : CAT.advanced;
      const ci = codeMatch(c.code, list);
      if (ci !== -1 && result[g][ci] === null) { result[g][ci] = c; codeHit = true; break; }
    }
    if (codeHit) return;

    // 2) name similarity fallback
    const cand = [
      { g: "req",  m: bestMatch(c.name, CAT.required) },
      { g: "core", m: bestMatch(c.name, CAT.core) },
      { g: "adv",  m: bestMatch(c.name, CAT.advanced) },
    ].sort((a, b) => b.m.score - a.m.score)[0];

    if (cand.m.score >= MATCH_TH && result[cand.g][cand.m.idx] === null) {
      result[cand.g][cand.m.idx] = c;
    } else if (cand.m.score >= MATCH_TH) {
      result.extra.push(c);          // slot taken -> spill to extra
    } else {
      result.unmatched.push(c);
    }
  });

  // parse the compulsory-courses summary block (校定必修)
  result.summary = parseRequirementsSummary(lines);

  // extract IBP / GE courses listed in the packed bottom format:
  //   "Course Name(credits)grade Another Course(credits)grade"
  const PACKED = /([A-Za-z][A-Za-z ,:\-&']+?)\((\d)\)\s*([ABCDF][+\-]?)/g;
  let onlyInGE = false;
  lines.forEach(line => {
    if (/IBP Courses:|通識自然|通識社會|通識人文|GE Core course/i.test(line)) onlyInGE = true;
    if (!onlyInGE) return;
    let m;
    while ((m = PACKED.exec(line)) !== null) {
      const nm = m[1].trim();
      if (nm.length < 5) continue;
      const c = { name: nm, cr: +m[2], grade: m[3], code: "" };
      const ibp = identifyIbp(c);
      c.geKind = ibp ? "IBP" : "GE";
      // de-dup against existing geAuto entries
      if (!result.geAuto.some(x => x.name === c.name && x.grade === c.grade)) {
        result.geAuto.push(c);
      }
    }
  });

  return result;
}

/* Apply a parse result onto the live state                       */
function applyParse(res) {
  ["req", "core", "adv"].forEach(g => {
    res[g].forEach((c, i) => {
      if (c) {
        const prog = /in ?progress/i.test(c.grade);
        state[g][i].s = prog ? 2 : 1;
        state[g][i].g = c.grade;
        state.autoFlags[g][i] = true;
      }
    });
  });
  res.extra.forEach(c => {
    state.extra.push({ code: c.code, name: c.name, cr: 3, g: c.grade });
  });
  if (res.meta.sid)  document.getElementById("sid").value = res.meta.sid;
  if (res.meta.name) document.getElementById("sname").value = res.meta.name;
  if (res.meta.status) setStatus(res.meta.status);

  // ---- 校定必修：use the form's own summary numbers when present ----
  const sm = res.summary || {};
  if (typeof sm.gePassed === "number") {
    state.geCr = sm.gePassed;
    document.getElementById("geCr").value = sm.gePassed;
  }
  if (typeof sm.cnPassed === "number") {
    state.cnCr = sm.cnPassed;
    document.getElementById("cnCr").value = sm.cnPassed;
    // intl 8 學分 / overseas 2 學分 達標即視為抵免
    const cnNeed = state.status === "intl" ? TG.chineseIntl : TG.chineseOverseas;
    if (sm.cnPassed >= cnNeed) setSeg("cnSeg", "cnState", "ok");
  }
  if (sm.enPassed && sm.enPassed > 0) setSeg("enSeg", "enState", "ok");
  if (sm.peDone === true)  setSeg("peSeg", "peState", "ok");
  if (sm.peDone === false) setSeg("peSeg", "peState", "prog");

  // ---- IBP / GE courses auto-identified in the free section ----
  state.geAuto = res.geAuto || [];
  renderUnmatched(res.unmatched);
  renderGeAuto(state.geAuto);
}

/* programmatically set a segmented control */
function setSeg(segId, key, val) {
  state[key] = val;
  const seg = document.getElementById(segId);
  seg.querySelectorAll("button").forEach(b =>
    b.classList.toggle("on", b.dataset.v === val));
}

/* show the IBP/GE courses the parser recognised */
function renderGeAuto(list) {
  const box = document.getElementById("geAutoBox");
  if (!box) return;
  if (!list || !list.length) { box.innerHTML = ""; box.style.display = "none"; return; }
  box.style.display = "block";
  box.innerHTML =
    `<h3>✓ 自動辨識為通識的 IBP / GE 課程（${list.length} 門，已併入上方通識學分）</h3>
     <ul>${list.map(c =>
        `<li><span class="nm">${c.name}</span>
         <span class="pill ok">${c.geKind || "GE"} · ${c.grade}</span></li>`).join("")}</ul>
     <p style="margin-top:6px;color:var(--muted);">注：通識總學分以審查表「Total」欄為準，此清單僅供核對。</p>`;
}

/* ============================================================
   UNMATCHED COURSES — let the user assign manually
   ============================================================ */
let UNMATCHED = [];
function renderUnmatched(list) {
  UNMATCHED = list.slice();
  const box = document.getElementById("unmatchedBox");
  if (!UNMATCHED.length) { box.innerHTML = ""; box.style.display = "none"; return; }
  box.style.display = "block";
  box.innerHTML = `
    <h3>⚠ 有 ${UNMATCHED.length} 門課程未能自動對應，請人工指派</h3>
    <ul>${UNMATCHED.map((c, i) => `
      <li>
        <span class="nm">${c.name} ${c.code ? "（" + c.code + "）" : ""} — ${c.grade}</span>
        <select data-u="${i}">
          <option value="">忽略 / 不認列</option>
          <option value="adv">計入進階選修（其他科號）</option>
          <option value="ge">計入通識（3 學分）</option>
        </select>
      </li>`).join("")}</ul>`;
  box.querySelectorAll("select").forEach(sel => {
    sel.onchange = () => {
      const c = UNMATCHED[+sel.dataset.u];
      if (sel.value === "adv") {
        state.extra.push({ code: c.code, name: c.name, cr: 3, g: c.grade });
        renderAll();
      } else if (sel.value === "ge") {
        state.geCr = Number(state.geCr || 0) + 3;
        document.getElementById("geCr").value = state.geCr;
        update();
      }
    };
  });
}

/* ============================================================
   RENDER COURSE TABLES
   ============================================================ */
function statusCell(group, idx) {
  const cur = state[group][idx].s;
  return `<div class="statusbtns" data-g="${group}" data-i="${idx}">
    <button class="${cur === 1 ? "done" : ""}" data-s="1">已修畢</button>
    <button class="${cur === 2 ? "prog" : ""}" data-s="2">修課中</button>
    <button class="${cur === 0 ? "none" : ""}" data-s="0">未修</button>
  </div>`;
}
function gradeCell(group, idx) {
  return `<input class="grade-in" data-g="${group}" data-i="${idx}"
    value="${state[group][idx].g}" placeholder="—">`;
}
function nameCell(c, group, idx) {
  let s = `<div class="cname">${c.name}`;
  if (c.note) s += `<small>${c.note}</small>`;
  s += `</div>`;
  return s;
}
function rowClass(group, idx) {
  const st = state[group][idx].s;
  let cls = st === 1 ? "r-done" : st === 2 ? "r-prog" : "";
  if (state.autoFlags[group][idx]) cls += " r-auto";
  return cls.trim();
}
function renderTable(group, list, tbId) {
  document.getElementById(tbId).innerHTML = list.map((c, i) => `
    <tr class="${rowClass(group, i)}">
      <td class="code">${c.code}</td>
      <td>${nameCell(c, group, i)}</td>
      <td class="cr">${c.cr}</td>
      <td class="grade">${gradeCell(group, i)}</td>
      <td class="act">${statusCell(group, i)}</td>
    </tr>`).join("");
}
function renderExtra() {
  const ul = document.getElementById("adList");
  if (!state.extra.length) { ul.innerHTML = ""; return; }
  ul.innerHTML = state.extra.map((e, i) => `
    <li style="display:flex;align-items:center;gap:10px;padding:6px 8px;
      border-bottom:1px solid #ece7da;font-family:'Noto Sans TC',sans-serif;font-size:12.5px;">
      <span style="color:var(--muted);min-width:84px;">${e.code || "—"}</span>
      <span style="flex:1;">${e.name}</span>
      <span style="color:var(--gold);font-weight:700;">${e.cr} 學分</span>
      <span class="pill ${e.g && !/in ?progress/i.test(e.g) ? "ok" : "warn"}">${e.g || "修課中"}</span>
      <button class="x-del" data-x="${i}">×</button>
    </li>`).join("");
}

/* ============================================================
   AUDIT COMPUTATION
   ============================================================ */
function sumGroup(group, list) {
  let done = 0, prog = 0;
  state[group].forEach((st, i) => {
    if (st.s === 1) done += list[i].cr;
    else if (st.s === 2) prog += list[i].cr;
  });
  return { done, prog };
}
function detectExclusive() {
  const warns = [];
  ["mkt", "scm"].forEach(g => {
    const idxs = [];
    CAT.core.forEach((c, i) => {
      if (c.exclusiveGroup === g && state.core[i].s !== 0) idxs.push(i);
    });
    if (idxs.length > 1) warns.push({ g, names: idxs.map(i => CAT.core[i].name) });
  });
  return warns;
}
function compute() {
  const req = sumGroup("req", CAT.required);
  const coreRaw = sumGroup("core", CAT.core);
  const adv = sumGroup("adv", CAT.advanced);

  // core: only first 9 completed courses count; rest spill to advanced
  let n = 0, coreDoneCr = 0, coreSpillCr = 0, coreDoneN = 0;
  CAT.core.forEach((c, i) => {
    if (state.core[i].s === 1) {
      n++; coreDoneN++;
      if (n <= TG.coreCourseCount) coreDoneCr += c.cr;
      else coreSpillCr += c.cr;
    }
  });

  let extraDone = 0, extraProg = 0;
  state.extra.forEach(e => {
    const cr = Number(e.cr) || 0;
    if (e.g && e.g.trim() && !/in ?progress/i.test(e.g)) extraDone += cr;
    else extraProg += cr;
  });

  const advDone = adv.done + coreSpillCr + extraDone;
  const advProg = adv.prog + extraProg;

  const cnReqVal = state.status === "intl" ? TG.chineseIntl : TG.chineseOverseas;
  const cnOK = state.cnState === "ok" || Number(state.cnCr) >= cnReqVal;
  const enOK = state.enState === "ok";
  const geOK = Number(state.geCr) >= TG.generalEducation;
  const peOK = state.peState === "ok";
  const genCount = [cnOK, enOK, geOK, peOK].filter(Boolean).length;

  const totalDone = req.done + Math.min(coreDoneCr, TG.core) + advDone
    + Number(state.geCr || 0);
  const totalProg = req.prog + coreRaw.prog + advProg
    + (cnOK ? 0 : Number(state.cnCr || 0));

  return {
    req,
    core: { done: coreDoneCr, prog: coreRaw.prog, n: coreDoneN },
    adv: { done: advDone, prog: advProg, spill: coreSpillCr },
    cnReqVal, cnOK, enOK, geOK, peOK, genCount,
    totalDone, totalProg,
  };
}

/* ============================================================
   UI UPDATE
   ============================================================ */
const pct = (v, g) => Math.min(100, Math.round(v / g * 100));
function setMeter(key, val, goal) {
  document.getElementById("m" + key + "V").textContent = val + " / " + goal;
  document.getElementById("m" + key).style.width = pct(val, goal) + "%";
}
function update() {
  const c = compute();

  setMeter("Req", c.req.done, TG.required);
  setMeter("Core", c.core.done, TG.core);
  setMeter("Adv", c.adv.done, TG.advanced);
  document.getElementById("mTotV").textContent = c.totalDone + " / " + TG.total;
  document.getElementById("mTot").style.width = pct(c.totalDone, TG.total) + "%";
  document.getElementById("mGenV").textContent = c.genCount + " / 4 項";
  document.getElementById("mGen").style.width = pct(c.genCount, 4) + "%";

  const reqN = state.req.filter(s => s.s === 1).length;
  document.getElementById("tallyReq").textContent =
    reqN + " / 10 門 · " + c.req.done + " 學分";
  document.getElementById("tallyCore").textContent =
    c.core.n + " / " + TG.coreCourseCount + " 門 · " + c.core.done + " / 27 學分"
    + (c.adv.spill > 0 ? `（溢出 ${c.adv.spill} → 進階）` : "");
  document.getElementById("tallyAdv").textContent =
    c.adv.done + " 學分 / 27"
    + (c.adv.spill > 0 ? `（含核心溢出 ${c.adv.spill}）` : "");
  document.getElementById("tallyGen").textContent = c.genCount + " / 4 項";

  document.getElementById("footTot").textContent = c.totalDone;
  document.getElementById("footProg").textContent = c.totalDone + c.totalProg;

  const exWarn = detectExclusive();
  const checks = {
    req: c.req.done >= TG.required,
    core: c.core.done >= TG.core,
    adv: c.adv.done >= TG.advanced,
    total: c.totalDone >= TG.total,
    gen: c.genCount === 4,
    ex: exWarn.length === 0,
  };
  const v = document.getElementById("verdict");
  const big = document.getElementById("verdictBig");
  const sub = document.getElementById("verdictSub");
  if (Object.values(checks).every(Boolean)) {
    v.className = "verdict pass";
    big.textContent = "✓ 符合畢業資格";
    sub.textContent = "所有學分與校定必修皆已達標";
  } else {
    v.className = "verdict fail";
    big.textContent = "尚未達標";
    const miss = [];
    if (!checks.req) miss.push(`專業必修缺 ${TG.required - c.req.done}`);
    if (!checks.core) miss.push(`核心缺 ${TG.core - c.core.done}`);
    if (!checks.adv) miss.push(`進階缺 ${TG.advanced - c.adv.done}`);
    if (!checks.total) miss.push(`總學分缺 ${TG.total - c.totalDone}`);
    if (!checks.gen) miss.push(`校定必修缺 ${4 - c.genCount} 項`);
    if (!checks.ex) miss.push("擇一規則衝突");
    sub.textContent = miss.join("　·　");
  }

  const eb = document.querySelector(".either-box");
  if (exWarn.length) {
    eb.style.background = "var(--red-soft)";
    eb.style.borderColor = "var(--red)";
    eb.style.color = "var(--red)";
    eb.innerHTML = "⚠ <b>擇一規則衝突：</b>" +
      exWarn.map(w => w.names.join(" 與 ") +
        " 不可同時列為核心，請將其一改列進階選修或取消勾選").join("；");
  } else {
    eb.style.background = "#faf6ec";
    eb.style.borderColor = "var(--gold)";
    eb.style.color = "var(--amber)";
    eb.innerHTML = '⚖ <b>擇一規則：</b> Technology Marketing 與 Marketing in Daily Life ' +
      '僅一門可列核心；Supply Chain Management 與 Strategic Supply Chain Management ' +
      '僅能擇一認列。系統會自動偵測並提示。';
  }

  document.getElementById("cnReq").textContent = c.cnReqVal;
  document.getElementById("cnNote").textContent = state.status === "intl"
    ? "國際生：修畢 8 學分華語課即抵免（僅認列初級／中級／中高級／高級華語一二三）"
    : "僑生：大學中文 2 學分，或大學中文僑生專班 4 學分";
}

/* ============================================================
   EVENT BINDING
   ============================================================ */
function bindStatusBtns() {
  document.querySelectorAll(".statusbtns").forEach(box => {
    box.querySelectorAll("button").forEach(b => {
      b.onclick = () => {
        state[box.dataset.g][+box.dataset.i].s = +b.dataset.s;
        state.autoFlags[box.dataset.g][+box.dataset.i] = false;
        renderAll();
      };
    });
  });
  document.querySelectorAll(".grade-in").forEach(inp => {
    inp.oninput = () => { state[inp.dataset.g][+inp.dataset.i].g = inp.value; };
    inp.onchange = () => {
      const st = state[inp.dataset.g][+inp.dataset.i];
      if (inp.value.trim() && st.s === 0) { st.s = 1; renderAll(); }
    };
  });
}
function bindSeg(id, key) {
  const seg = document.getElementById(id);
  seg.querySelectorAll("button").forEach(b => {
    b.onclick = () => {
      seg.querySelectorAll("button").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      state[key] = b.dataset.v;
      update();
    };
  });
}
function setStatus(v) {
  state.status = v;
  const seg = document.getElementById("segStatus");
  seg.querySelectorAll("button").forEach(x =>
    x.classList.toggle("on", x.dataset.v === v));
  update();
}

function renderAll() {
  renderTable("req", CAT.required, "tbReq");
  renderTable("core", CAT.core, "tbCore");
  renderTable("adv", CAT.advanced, "tbAdv");
  renderExtra();
  bindStatusBtns();
  document.querySelectorAll("#adList .x-del").forEach(b => {
    b.onclick = () => { state.extra.splice(+b.dataset.x, 1); renderAll(); };
  });
  update();
}

/* ============================================================
   PDF UPLOAD HANDLING
   ============================================================ */
async function handleFile(file) {
  const stat = document.getElementById("parseStatus");
  if (!file || !/\.pdf$/i.test(file.name)) {
    stat.innerHTML = '<span class="err">請上傳 PDF 檔</span>';
    return;
  }
  stat.innerHTML = '<span class="warn">解析中…</span>';
  try {
    const buf = await file.arrayBuffer();
    const lines = await pdfToLines(buf);
    const res = auditFromLines(lines);
    applyParse(res);
    renderAll();
    const auto = res.req.filter(Boolean).length
      + res.core.filter(Boolean).length
      + res.adv.filter(Boolean).length;
    const geN = (res.geAuto || []).length;
    stat.innerHTML = `<span class="ok">✓ 專業課程 ${auto} 門</span>`
      + (geN ? ` <span class="ok">· 通識 ${geN} 門</span>` : "")
      + (res.unmatched.length
        ? ` <span class="warn">· ${res.unmatched.length} 門待確認</span>` : "");
  } catch (e) {
    console.error(e);
    stat.innerHTML = '<span class="err">解析失敗，請改用手動勾選</span>';
  }
}

/* ============================================================
   INIT
   ============================================================ */
async function init() {
  try {
    await loadCatalogue();
  } catch (e) {
    document.body.innerHTML =
      '<p style="padding:40px;font-family:sans-serif">無法載入 data/courses.json，' +
      '請確認檔案存在且透過網頁伺服器（非 file://）開啟。</p>';
    return;
  }
  renderAll();

  // upload bar
  const dz = document.getElementById("dropzone");
  const fi = document.getElementById("fileInput");
  dz.onclick = () => fi.click();
  fi.onchange = () => handleFile(fi.files[0]);
  ["dragover", "dragenter"].forEach(ev =>
    dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach(ev =>
    dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", e => {
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  // add advanced course
  document.getElementById("adAdd").onclick = () => {
    const name = document.getElementById("adName").value.trim();
    if (!name) { document.getElementById("adName").focus(); return; }
    state.extra.push({
      code: document.getElementById("adCode").value.trim(),
      name,
      cr: Number(document.getElementById("adCr").value) || 3,
      g: document.getElementById("adGr").value.trim(),
    });
    ["adCode", "adName", "adGr"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("adCr").value = "3";
    renderAll();
  };

  document.getElementById("cnCr").oninput = e => { state.cnCr = e.target.value; update(); };
  document.getElementById("geCr").oninput = e => { state.geCr = e.target.value; update(); };

  document.getElementById("segStatus").querySelectorAll("button").forEach(b => {
    b.onclick = () => setStatus(b.dataset.v);
  });
  bindSeg("cnSeg", "cnState");
  bindSeg("enSeg", "enState");
  bindSeg("peSeg", "peState");

  document.getElementById("btnReset").onclick = () => {
    if (confirm("確定要清空所有修課狀態？")) location.reload();
  };
  document.getElementById("btnPrint").onclick = () => window.print();
}

document.addEventListener("DOMContentLoaded", init);
