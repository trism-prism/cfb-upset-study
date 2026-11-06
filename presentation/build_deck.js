// Builds presentation/cfb-upset-study.pptx from results/results.json.
// Every study number on a slide is read from results.json (see the V object below); the few facts
// that only exist in the report text are listed in DOC with their source.
"use strict";
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const sharp = require("sharp");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const SKILL = "C:/Users/trist/AppData/Local/Claude-Data/claude_pzs8sxrjxfjjc/local-agent-mode-sessions/skills-plugin/30bf4654-e8f9-444a-9dba-1e7b39737eb7/d25d8312-1d45-4c40-93cd-32c5dc228bab/skills/pptx";
const { applyTheme } = require(SKILL + "/scripts/apply_theme.js");
const si = require("react-icons/si");
const fa = require("react-icons/fa");

const ROOT = path.resolve(__dirname, "..");
const R = JSON.parse(fs.readFileSync(path.join(ROOT, "results", "results.json"), "utf8"));
const OUT = path.join(__dirname, "cfb-upset-study.pptx");

// ---------------------------------------------------------------- facts not in results.json
const DOC = {
  covid2020Games: 534, // report.md 2.1, docs/methodology.md: usable games in 2020
  tests: 20, // report/pipeline-walkthrough.md: pytest count
  sternSD: 14, // Stern (1991), NFL: SD of outcome minus spread, approximately
};

// ---------------------------------------------------------------- number formatting
const MINUS = "\u2212";
const num = (x, d) => (x < 0 ? MINUS : "") + Math.abs(x).toFixed(d);
const sgn = (x, d) => (x < 0 ? MINUS : "+") + Math.abs(x).toFixed(d);
const int = (n) => Math.round(n).toLocaleString("en-US");
const pct1 = (x) => (x * 100).toFixed(1) + "%";
const pv = (p, d = 2) => (p < 0.001 ? "< 0.001" : p.toFixed(d));
const ci = (a, d, signed) => "[" + a.map((x) => (signed ? sgn(x, d) : num(x, d))).join(", ") + "]";
const rng = (a, d) => a[0].toFixed(d) + "\u2013" + a[1].toFixed(d);
const expit = (z) => 1 / (1 + Math.exp(-z));
const seasonsText = (ss) => {
  const out = [];
  let i = 0;
  while (i < ss.length) {
    let j = i;
    while (j + 1 < ss.length && ss[j + 1] === ss[j] + 1) j++;
    out.push(j - i >= 2 ? `${ss[i]}\u2013${ss[j]}` : ss.slice(i, j + 1).join(", "));
    i = j + 1;
  }
  return out.join(", ");
};

// ---------------------------------------------------------------- study values
const A = R.audit, CFG = R.config, E = R.models.evaluation, H1 = R.models.h1, H2 = R.models.h2, H3 = R.models.h3, H4 = R.models.h4;
const SIM = R.simulation, BUG = R.bug_impact, LEAK = R.leakage_impact;
const LK = LEAK.leaky_same_season_sp, CL = LEAK.clean_prior_season_sp;

const funnel = {
  raw: A.raw_game_rows,
  fbs: A.raw_game_rows - A.non_fbs_leakage_removed,
};
funnel.complete = funnel.fbs - A.incomplete_or_missing_scores_removed - A.no_valid_line_removed;
funnel.final = funnel.complete - A.pickem_excluded;
if (funnel.final !== A.final_games) throw new Error("funnel does not reconcile with audit.final_games");

const h1se = Math.abs(H1.coef / H1.z);
const slopeSE = H4.spread_only_coefs.spread_home.se;
const slopeCoef = H4.spread_only_coefs.spread_home.coef;
const interSE = H4.spread_only_coefs.const.se;
const interCoef = H4.spread_only_coefs.const.coef;
const p7 = expit(H1.intercept + H1.coef * -7); // 7-point home favourite wins
const p14 = expit(H1.intercept + H1.coef * -14);
const calSlopeCI = [H3.calibration_slope - 1.96 * H3.calibration_slope_se, H3.calibration_slope + 1.96 * H3.calibration_slope_se];
const relGap = Math.max(...R.models.reliability.full.prob_pred.map((x, i) => Math.abs(x - R.models.reliability.spread_only.prob_pred[i])));
const buckets = R.models.upset_by_spread_bucket;
const bucketLabel = (b) => b.replace("-", "\u2013");
const worstBucket = buckets.reduce((m, b) => (Math.abs(b.observed_upset_rate - b.mean_predicted_upset_rate) > Math.abs(m.observed_upset_rate - m.mean_predicted_upset_rate) ? b : m));
const closeBucket = buckets[0], farBucket = buckets[buckets.length - 1];
const skillInflation = (BUG.buggy.brier_skill_spread_vs_naive - BUG.fixed.brier_skill_spread_vs_naive) * 100;
const seasonsStr = seasonsText(CFG.seasons);

const V = {
  nGames: int(CFG.n_games_total), nTrain: int(CFG.n_games_train), nTest: int(CFG.n_games_test),
  nComplete: int(E.n_test_complete), nWeeks: E.n_bootstrap_clusters, nBoot: int(E.n_bootstrap),
  brierNaive: num(E.naive.brier, 3), brierSpread: num(E.spread_only.brier, 3), brierFull: num(E.full.brier, 3),
  skillSpread: pct1(E.brier_skill_spread_vs_naive), skillFull: pct1(E.brier_skill_full_vs_naive),
  dBrier: sgn(E.brier_diff_full_minus_spread, 3), dCI: ci(E.brier_diff_ci95, 3, true),
  aucSpread: num(E.spread_only.auc, 3), aucFull: num(E.full.auc, 3),
  upsetRate: pct1(BUG.fixed.upset_rate_all_seasons), upsetTest: pct1(BUG.fixed.upset_rate_test),
  mcUpsetP: pv(SIM.bernoulli.upsets.p_value), mcResidP: pv(SIM.normal_margin.resid_sd.p_value),
  mcObsUpsets: int(SIM.bernoulli.upsets.observed), mcTrials: int(SIM.n_trials),
  oracle: num(SIM.oracle_brier.mean, 3), oracleCI: rng(SIM.oracle_brier.ci95, 3), mcBrierObs: num(SIM.bernoulli.brier.observed, 3),
  sd: num(H4.spread_only_resid_sd, 1), sd2: num(H4.spread_only_resid_sd, 2), sdObs: num(SIM.normal_margin.resid_sd.observed, 2),
};
const SEED = CFG.seed;

// ---------------------------------------------------------------- theme
const THEME = {
  name: "Turf and Scoreboard",
  headFontFace: "Cambria",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "222222", lt1: "FFFFFF", dk2: "1F4D2B", lt2: "F4F6F3",
    accent1: "1F4D2B", accent2: "F2A900", accent3: "8A9A8E", accent4: "3E7C52", accent5: "B5473B", accent6: "D5E0D7",
    hlink: "1F4D2B", folHlink: "8A9A8E",
  },
};
const HEX = THEME.colors; // hex-only options (chart colors, borders) read from here

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = "Predicting College Football Upsets";
pres.author = "Tristan Morton";
pres.subject = "An independent statistical research study";
const C = pres.SchemeColor;
const SH = pres.ShapeType;

const W = 13.333, MX = 0.6, CW = W - 2 * MX;
const FOOT = "Predicting College Football Upsets";
const HEADF = "+mj-lt";

function contentMaster(title, bg, titleColor, footColor, footText) {
  pres.defineSlideMaster({
    title,
    background: { color: bg },
    objects: [
      { placeholder: { options: { name: "title", type: "title", x: MX, y: 0.4, w: CW, h: 1.1, fontSize: 28, bold: true, color: titleColor, align: "left", valign: "top", margin: 0 }, text: "Slide headline" } },
      { text: { text: footText, options: { x: MX, y: 7.0, w: 7, h: 0.3, fontSize: 10, color: footColor, margin: 0, valign: "middle" } } },
    ],
    slideNumber: { x: W - MX - 0.8, y: 7.0, w: 0.8, h: 0.3, fontSize: 10, color: footColor, align: "right" },
  });
}
contentMaster("CONTENT", C.background1, C.text2, C.text2, FOOT);
contentMaster("APPENDIX", C.background1, C.text2, C.text2, FOOT + "  \u00b7  Backup");
contentMaster("CLOSING_DARK", C.text2, C.background1, C.background2, FOOT);
pres.defineSlideMaster({
  title: "TITLE_DARK",
  background: { color: C.text2 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.8, y: 1.7, w: 7.2, h: 2.1, fontSize: 44, bold: true, color: C.background1, align: "left", valign: "bottom", margin: 0 }, text: "Deck title" } },
    { placeholder: { options: { name: "subtitle", type: "body", x: 0.8, y: 4.0, w: 7.2, h: 0.6, fontSize: 22, color: C.background2, align: "left", valign: "top", margin: 0 }, text: "Subtitle" } },
    { placeholder: { options: { name: "meta", type: "body", x: 0.8, y: 5.0, w: 7.2, h: 1.2, fontSize: 16, color: C.accent6, align: "left", valign: "top", margin: 0 }, text: "Author and scope" } },
  ],
});
pres.defineSlideMaster({
  title: "SECTION_DARK",
  background: { color: C.text2 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 2.5, y: 2.75, w: 9.8, h: 1.0, fontSize: 40, bold: true, color: C.background1, align: "left", valign: "middle", margin: 0 }, text: "Section title" } },
    { placeholder: { options: { name: "subtitle", type: "body", x: 2.5, y: 3.85, w: 9.8, h: 0.8, fontSize: 20, color: C.background2, align: "left", valign: "top", margin: 0 }, text: "Section subtitle" } },
  ],
});

// ---------------------------------------------------------------- helpers
const SECTIONS = {};
function section(title) { pres.addSection({ title }); SECTIONS.current = title; }

let MAIN_MINUTES = 0;
function cue(min) { return min < 1 ? `[~${Math.round(min * 60)} sec]` : `[~${min} min]`; }
const NOTE_LOG = [];
function cueSec(sec) {
  if (sec < 60) return `[~${sec} sec]`;
  const m = Math.floor(sec / 60), r = sec % 60;
  return r ? `[~${m} min ${r} sec]` : `[~${m} min]`;
}
function note(text, min, isMain = true) {
  const body = text.replace(/−/g, "minus ").replace(/–/g, " to ").replace(/\s+/g, " ").trim();
  let sec = Math.round(min * 60);
  if (isMain) sec = Math.max(30, Math.round((body.split(" ").length / 150) * 4) * 15); // 150 words per minute, to the nearest 15 s
  NOTE_LOG.push({ isMain, sec });
  if (isMain) MAIN_MINUTES += sec / 60;
  return body + " " + cueSec(sec);
}
function addSlide(layout, title, notes) {
  const s = pres.addSlide({ masterName: layout, sectionTitle: SECTIONS.current });
  if (title) s.addText(title, { placeholder: "title" });
  s.addNotes(notes);
  return s;
}
function T(s, text, x, y, w, h, o = {}) {
  const { name, ...rest } = o;
  s.addText(text, { x, y, w, h, margin: 0, valign: "top", fontSize: 14, color: C.text1, isTextBox: true, objectName: name || "Text", ...rest });
}
function card(s, x, y, w, h, o = {}) {
  s.addShape(SH.roundRect, { x, y, w, h, rectRadius: 0.12, fill: { color: o.fill || C.background2 }, line: { type: "none" }, objectName: o.name || "Card" });
}
function chip(s, x, y, d, content, o = {}) {
  s.addText(content, {
    x, y, w: d, h: d, shape: SH.ellipse, fill: { color: o.fill || C.accent1 }, color: o.color || C.background1,
    fontSize: o.size || 16, bold: true, fontFace: HEADF, align: "center", valign: "middle", margin: 0, isTextBox: true, objectName: o.name || "Chip",
  });
}
const h0 = (n) => [{ text: "H" }, { text: "0" + n, options: { subscript: true } }];
const runs = (...parts) => parts.flat();
const bold = (t) => ({ text: t, options: { bold: true } });

// Stat callout: card + big value + label + detail. key=true makes it the slide's single amber element.
const textLen = (t) => (Array.isArray(t) ? t.map((r) => r.text).join("").length : String(t).length);
// estimated wrapped line count for Calibri at `size` pt in a box `widthIn` wide
const nLines = (t, widthIn, size, isBold) => Math.ceil(textLen(t) / Math.max(1, Math.floor(widthIn / (size * (isBold ? 0.0069 : 0.0064)))));
function stat(s, o) {
  const { x, y, w, h, value, label, detail, key, chipText, valueSize = 40, labelSize = 15, detailSize = 14, dark } = o;
  const pad = 0.24, iw = w - 2 * pad;
  card(s, x, y, w, h, { fill: key ? C.accent2 : dark ? C.accent4 : C.background2, name: "Stat card" });
  const vH = (valueSize * 1.2) / 72;
  const lH = (nLines(label, iw, labelSize, true) * labelSize * 1.22) / 72;
  const dH = detail ? (nLines(detail, iw, detailSize, false) * detailSize * 1.22) / 72 : 0;
  const valueColor = key ? C.text1 : dark ? C.background1 : C.text2;
  let vy;
  if (chipText !== undefined) {
    vy = y + 0.22;
    const rowH = Math.max(0.5, vH);
    chip(s, x + pad, vy + (rowH - 0.5) / 2, 0.5, chipText, { fill: key ? C.text2 : C.accent1, size: 14, name: "Step chip" });
    T(s, value, x + pad + 0.65, vy, iw - 0.65, rowH, { fontSize: valueSize, bold: true, fontFace: HEADF, color: valueColor, valign: "middle", name: "Stat value" });
    vy += rowH + 0.18;
  } else {
    const total = vH + 0.06 + lH + (detail ? 0.04 + dH : 0);
    vy = y + Math.max(0.1, (h - total) / 2);
    T(s, value, x + pad, vy, iw, vH, { fontSize: valueSize, bold: true, fontFace: HEADF, color: valueColor, valign: "middle", name: "Stat value" });
    vy += vH + 0.06;
    if (total > h - 0.1) console.warn(`stat card may overflow: "${textLen(label)}-char label" at y=${y.toFixed(2)} (need ${total.toFixed(2)}, have ${h})`);
  }
  T(s, label, x + pad, vy, iw, lH, { fontSize: labelSize, bold: true, color: key ? C.text1 : dark ? C.background1 : C.text1, name: "Stat label" });
  if (detail) T(s, detail, x + pad, vy + lH + 0.04, iw, dH, { fontSize: detailSize, color: key ? C.text1 : dark ? C.background2 : C.text1, name: "Stat detail" });
}

function cell(c, ri, ci_, spec) {
  const isH = ri === 0;
  const opt = {
    fontSize: spec.fs, bold: isH || (spec.boldFirst && ci_ === 0), color: isH ? C.background1 : C.text1,
    fill: { color: isH ? C.text2 : ri % 2 === 1 ? C.background2 : C.background1 },
    align: (spec.align && spec.align[ci_]) || "left", valign: "middle", margin: [0.04, 0.1, 0.04, 0.1],
    border: { type: "solid", pt: 0.5, color: HEX.accent6 },
  };
  if (c && typeof c === "object" && !Array.isArray(c)) return { text: c.text, options: { ...opt, ...c.options } };
  return { text: c, options: opt };
}
function table(s, rows, spec) {
  const body = rows.map((r, ri) => r.map((c, ci_) => cell(c, ri, ci_, spec)));
  s.addTable(body, { x: spec.x, y: spec.y, w: spec.w, colW: spec.colW, rowH: spec.rowH, objectName: spec.name || "Table" });
}

async function icon(Comp, color) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { color, size: "256" }));
  const buf = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}
function iconInCircle(s, data, x, y, d, o = {}) {
  chip(s, x, y, d, "", { fill: o.fill || C.accent1, name: "Icon circle" });
  const pad = d * 0.25;
  s.addImage({ data, x: x + pad, y: y + pad, w: d - 2 * pad, h: d - 2 * pad, altText: o.alt || "decorative icon" });
}

// ---------------------------------------------------------------- chart styling (same on every chart)
function chartBase(extra) {
  return {
    showTitle: true, titleFontFace: "+mn-lt", titleFontSize: 14, titleColor: HEX.dk2, titleBold: true,
    catAxisLabelFontFace: "+mn-lt", catAxisLabelFontSize: 12, catAxisLabelColor: HEX.dk1,
    valAxisLabelFontFace: "+mn-lt", valAxisLabelFontSize: 12, valAxisLabelColor: HEX.dk1,
    dataLabelFontFace: "+mn-lt", dataLabelFontSize: 12, dataLabelColor: HEX.dk1,
    legendFontFace: "+mn-lt", legendFontSize: 12, legendColor: HEX.dk1,
    catAxisTitleFontFace: "+mn-lt", catAxisTitleFontSize: 12, catAxisTitleColor: HEX.dk1,
    valAxisTitleFontFace: "+mn-lt", valAxisTitleFontSize: 12, valAxisTitleColor: HEX.dk1,
    valGridLine: { color: HEX.accent6, size: 0.75 }, catGridLine: { style: "none" },
    ...extra,
  };
}

// ================================================================ BUILD
async function main() {
  const ICON = {};
  const specs = {
    python: [si.SiPython, "#FFFFFF"], requests: [fa.FaCloudDownloadAlt, "#FFFFFF"], pandas: [si.SiPandas, "#FFFFFF"],
    statsmodels: [fa.FaChartLine, "#FFFFFF"], sklearn: [si.SiScikitlearn, "#FFFFFF"], numpy: [si.SiNumpy, "#FFFFFF"],
    mpl: [fa.FaChartBar, "#FFFFFF"], pytest: [si.SiPytest, "#FFFFFF"], git: [si.SiGithub, "#FFFFFF"],
    search: [fa.FaSearch, "#FFFFFF"], dice: [fa.FaDice, "#FFFFFF"],
    clock: [fa.FaClock, "#FFFFFF"], users: [fa.FaUsers, "#FFFFFF"], cloud: [fa.FaCloudSun, "#FFFFFF"], map: [fa.FaMapMarkedAlt, "#FFFFFF"],
    dbDark: [fa.FaDatabase, "#222222"], flaskDark: [fa.FaFlask, "#222222"], chartDark: [fa.FaChartBar, "#222222"], checkDark: [fa.FaCheckDouble, "#222222"], fileDark: [fa.FaFileAlt, "#222222"],
  };
  for (const [k, [comp, col]] of Object.entries(specs)) ICON[k] = await icon(comp, col);

  // ------------------------------------------------------------ INTRODUCTION
  section("Introduction");

  // 1 Title
  {
    const s = addSlide("TITLE_DARK", null, note(
      `Thanks for being here. I'm Tristan Morton, and this is an independent statistical study of college football upsets. I looked at ${V.nGames} FBS games across five seasons and asked one question: can anyone see upsets coming, or are they simply the dice? Over the next twenty or so minutes I'll show you where the data came from, how I tested the question, what I found, and the two traps hiding in the data that would have given me a very different and wrong answer.`, 0.5));
    s.addText("Predicting College Football Upsets", { placeholder: "title" });
    s.addText("An independent statistical research study", { placeholder: "subtitle" });
    s.addText([{ text: "Tristan Morton \u00b7 November 2026", options: { breakLine: true } }, { text: `${V.nGames} NCAA FBS games \u00b7 ${seasonsStr}` }], { placeholder: "meta" });
    chip(s, 9.0, 1.7, 3.9, "", { fill: C.accent4, name: "Motif circle" });
    T(s, V.upsetRate, 9.0, 2.75, 3.9, 1.0, { fontSize: 54, bold: true, fontFace: HEADF, color: C.accent2, align: "center", valign: "middle", name: "Motif value" });
    T(s, "of FBS games end in an upset", 9.3, 3.8, 3.3, 0.8, { fontSize: 18, color: C.background1, align: "center", name: "Motif caption" });
  }

  // 2 Answer up front
  {
    const s = addSlide("CONTENT", "The closing spread captures nearly all predictive signal; what remains is consistent with irreducible randomness", note(
      `Let me give you the answer first, then spend the rest of the talk earning it. Three numbers. One: the betting market's closing point spread produces a forecast with a Brier score of ${V.brierSpread}. Brier score is just the average squared error of a probability forecast, lower is better, and a naive forecast that ignores the spread scores ${V.brierNaive}. So the spread cuts forecast error by ${V.skillSpread}. Two: when I add five more public features, things like team strength, venue and week, the Brier score moves by ${V.dBrier}, and the confidence interval ${V.dCI} includes zero, so no measurable gain. Three: a ${V.mcTrials}-trial Monte Carlo simulation says the ${V.mcObsUpsets} upsets we actually saw are consistent with what randomness around the line produces, with a p-value of ${V.mcUpsetP}. In plain terms: upsets look like the expected tail of a well-priced distribution. Now let me show you why.`, 1.5));
    const cw = 3.85, gap = (CW - 3 * cw) / 2, y = 1.95, h = 3.2;
    stat(s, { x: MX, y, w: cw, h, chipText: "1", value: V.brierSpread, label: "Spread forecast error (Brier)", detail: `versus ${V.brierNaive} for the naive baseline: ${V.skillSpread} lower error on the temporal holdout (n = ${V.nComplete} complete-case games)`, key: true, valueSize: 48, labelSize: 16, detailSize: 16 });
    stat(s, { x: MX + cw + gap, y, w: cw, h, chipText: "2", value: V.dBrier, label: "Gain from 5 extra features", detail: `Brier change vs the spread alone: 95% CI ${V.dCI} includes zero, so no out-of-sample gain`, valueSize: 48, labelSize: 16, detailSize: 16 });
    stat(s, { x: MX + 2 * (cw + gap), y, w: cw, h, chipText: "3", value: "p = " + V.mcUpsetP, label: "Monte Carlo upset-count test", detail: `${V.mcObsUpsets} observed upsets sit mid-distribution across ${V.mcTrials} simulated seasons`, valueSize: 48, labelSize: 16, detailSize: 16 });
    T(s, "Upsets look like the expected tail of a well-priced distribution.", MX, 5.55, CW, 0.5, { fontSize: 22, italic: true, fontFace: HEADF, color: C.text2, name: "Takeaway line" });
  }

  // 3 Problem and purpose
  {
    const s = addSlide("CONTENT", "About one FBS game in four is an upset, so the question is whether anyone can see them coming", note(
      `About ${V.upsetRate} of the ${V.nGames} games in this study ended with the betting underdog winning outright. Upsets drive the drama of the sport, the playoff chaos, and a large share of the betting market, so the natural question is whether there's a pattern a careful analyst could exploit. There are two competing explanations. The first says upsets are predictable: measurable things like team strength, venue, conference play or time of season mark games where the underdog is underrated. The second says upsets are randomness: the closing line already contains the public information, so once you know the spread, what's left over is just noise. Both views make a testable prediction. If the first is right, a model with extra features should beat the spread. If the second is right, nothing should, and outcomes around the line should look like random draws. That is the research question I put to the data.`, 1));
    const y = 1.85, h = 3.45;
    stat(s, { x: MX, y, w: 3.3, h, value: V.upsetRate, valueSize: 54, label: `of ${V.nGames} FBS games were upsets`, detail: "The closing-line underdog won outright", key: true });
    const cols = [
      { x: 4.2, icon: ICON.search, head: "Upsets are predictable", body: "Hypothesis: measurable factors the market underweights, such as team strength, venue, conference play or time of season, mark games where the underdog is underrated.", imp: "Implies: a model with public features beats the spread." },
      { x: 8.58, icon: ICON.dice, head: "Upsets are randomness", body: "Hypothesis: the closing line already holds the public information, so once the spread is known the leftover variation is noise, like dice.", imp: "Implies: no public-feature model beats the spread; outcomes look like random draws." },
    ];
    for (const c of cols) {
      card(s, c.x, y, 4.15, h);
      iconInCircle(s, c.icon, c.x + 0.25, y + 0.25, 0.62);
      T(s, c.head, c.x + 1.05, y + 0.25, 2.95, 0.62, { fontSize: 18, bold: true, color: C.text2, valign: "middle", name: "Column heading" });
      T(s, c.body, c.x + 0.25, y + 1.05, 3.65, 1.4, { fontSize: 14, name: "Column body" });
      T(s, c.imp, c.x + 0.25, y + 2.5, 3.65, 0.8, { fontSize: 14, italic: true, color: C.text2, name: "Column implication" });
    }
    s.addText([bold("Research question  "), { text: "Once the closing spread is known, do public features predict upsets, or is the remaining variation consistent with irreducible randomness?" }],
      { x: MX, y: 5.55, w: CW, h: 1.15, shape: SH.roundRect, rectRadius: 0.12, fill: { color: C.text2 }, color: C.background1, fontSize: 18, align: "left", valign: "middle", margin: 18, isTextBox: true, objectName: "Research question" });
  }

  // 4 Prior work
  {
    const s = addSlide("CONTENT", "The spread works like a market price: if it is efficient, outcomes around it should be random noise", note(
      `Two pieces of prior work frame this study, and I want to keep my claims modest about both. Hal Stern, in 1991, studied NFL games and found that the final margin minus the point spread is approximately normally distributed with a standard deviation of roughly ${DOC.sternSD} points. In other words, the spread is a good forecast, and what's left behaves like bell-curve noise. Steven Levitt, in 2004, treated the point spread as a market price, set by bookmakers and moved by bettors, which gives us an efficient-markets framing. If the spread is an efficient price, public information is already in it. So what this study tests is whether college football behaves the same way. Our own number, for FBS games in the training seasons, is a standard deviation of ${V.sd} points: the same kind of noise, a little wider than the NFL figure. The next section shows how the pipeline was built to test it.`, 1));
    const cw = 3.85, gap = (CW - 3 * cw) / 2, y = 1.85, h = 3.75;
    const items = [
      { n: "1", value: "\u2248 " + DOC.sternSD + " pts", vs: 36, label: "NFL: outcome minus spread is approximately normal, SD about 14 points", cite: "Stern, H. (1991). On the probability of winning a football game." },
      { n: "2", value: "A market price", vs: 30, label: "The point spread is a price set by bookmakers and moved by bettors", cite: "Levitt, S. D. (2004). Why are gambling markets organised so differently from financial markets?" },
      { n: "3", value: V.sd + " pts", vs: 36, label: "This study: SD of the margin around the closing line, FBS training seasons", cite: "This study: training seasons 2019, 2021 and 2022.", key: true },
    ];
    items.forEach((it, i) => {
      const x = MX + i * (cw + gap);
      card(s, x, y, cw, h, { fill: it.key ? C.accent2 : C.background2 });
      chip(s, x + 0.25, y + 0.25, 0.5, it.n, { fill: C.text2, size: 16 });
      T(s, it.value, x + 0.25, y + 0.95, cw - 0.5, 0.75, { fontSize: it.vs, bold: true, fontFace: HEADF, color: it.key ? C.text1 : C.text2, valign: "middle", name: "Stat value" });
      T(s, it.label, x + 0.25, y + 1.8, cw - 0.5, 1.0, { fontSize: 15, bold: true, name: "Stat label" });
      T(s, it.cite, x + 0.25, y + 2.95, cw - 0.5, 0.7, { fontSize: 11, italic: true, name: "Citation" });
    });
    s.addText([bold("What we test  "), { text: "If the spread is efficient, no public-feature model should beat it, and outcomes around it should behave like draws from a fixed distribution." }],
      { x: MX, y: 5.85, w: CW, h: 0.85, shape: SH.roundRect, rectRadius: 0.12, fill: { color: C.text2 }, color: C.background1, fontSize: 16, align: "left", valign: "middle", margin: 16, isTextBox: true, objectName: "Test statement" });
  }

  // ------------------------------------------------------------ DATA & PIPELINE
  section("Data & Pipeline");
  {
    const s = addSlide("SECTION_DARK", "Data & Pipeline", note("Section break: data and pipeline.", 5 / 60, false));
    chip(s, 0.9, 2.7, 1.3, "", { fill: C.accent2, name: "Section chip" });
    s.addImage({ data: ICON.dbDark, x: 1.25, y: 3.05, w: 0.6, h: 0.6, altText: "database icon" });
    s.addText("From API calls to an audited dataset", { placeholder: "subtitle" });
  }

  // 5 Study design overview
  {
    const s = addSlide("CONTENT", "The study runs as one reproducible pipeline, from raw API calls to the final report", note(
      `Here's the whole study on one slide. Six stages, and one command runs all of them. Stage one, extract: a small REST client pulls games, betting lines, official FBS membership and team ratings from the CollegeFootballData API, with retries, and caches every raw response so the study can rerun offline. Stage two, clean and audit: the data is flattened, validated and joined, and every build writes an audit that counts every record removed and why. Stage three, model: the four hypothesis tests, the forecast scoring and a cluster bootstrap. Stage four, simulate: ten thousand synthetic seasons. Stage five, controlled reruns: I deliberately switch the two data problems back on, to measure what each would have done. And stage six, the report: figures, a single results file and the written paper. Every headline number traces back to that one results file.`, 1));
    const steps = [
      ["1", "Extract", "REST client with retries and a raw response cache", "cfb/api.py"],
      ["2", "Clean & audit", "Verify FBS membership, build the consensus spread, count every exclusion", "cfb/etl.py"],
      ["3", "Model", "Hypothesis tests, Brier and calibration scoring, cluster bootstrap", "cfb/models.py"],
      ["4", "Simulate", `${V.mcTrials} Monte Carlo trials under two null models`, "cfb/simulate.py"],
      ["5", "Controlled reruns", "Switch the leak and the filter defect back on to measure their impact", "run_study.py"],
      ["6", "Report", "Figures, one results.json and the written report", "report/"],
    ];
    const cw = 3.55, gap = (CW - 3 * cw) / 2, h = 2.2;
    steps.forEach((st, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const x = MX + col * (cw + gap), y = 1.9 + row * (h + 0.35);
      card(s, x, y, cw, h);
      chip(s, x + 0.25, y + 0.22, 0.6, st[0], { fill: i === 4 ? C.accent2 : C.accent1, color: i === 4 ? C.text1 : C.background1, size: 20 });
      T(s, st[1], x + 1.0, y + 0.22, cw - 1.2, 0.6, { fontSize: 18, bold: true, color: C.text2, valign: "middle", name: "Step name" });
      T(s, st[2], x + 0.25, y + 1.0, cw - 0.5, 0.75, { fontSize: 14, name: "Step description" });
      T(s, st[3], x + 0.25, y + 1.83, cw - 0.5, 0.28, { fontSize: 12, fontFace: "Courier New", color: C.text2, name: "Module" });
      if (col < 2) s.addShape(SH.rightArrow, { x: x + cw + 0.04, y: y + h / 2 - 0.15, w: gap - 0.08, h: 0.3, fill: { color: C.accent3 }, line: { type: "none" }, objectName: "Flow arrow" });
    });
  }

  // 6 Data & provenance
  {
    const s = addSlide("CONTENT", `All data comes from one public API, filtered to ${V.nGames} FBS-vs-FBS games with a consensus closing line`, note(
      `All the data comes from one public source, the CollegeFootballData REST API, through four endpoints. The games endpoint gives scores, venue and conference. The lines endpoint gives point spreads from several sportsbooks. The teams endpoint gives the official FBS membership list for each season, which turns out to be important later. And the ratings endpoint gives SP-plus team-strength ratings. The population is FBS against FBS, regular season and bowls, completed games that have a closing line, and I take the median spread across sportsbooks so one stale line can't move it. Ten pick'em games with a spread of zero are excluded, because with no favorite there's no upset to define. The result is ${V.nGames} games over five seasons, 2019 and 2021 to 2024. I excluded 2020: COVID cut it to ${DOC.covid2020Games} usable games, many played without crowds, which distorts home-field advantage.`, 1));
    table(s, [
      ["Endpoint", "What it provides"],
      ["/games", "Scores, venue, conference, season type, team classification"],
      ["/lines", "Point spreads and over/unders by sportsbook"],
      ["/teams/fbs", "Official FBS membership for each season"],
      ["/ratings/sp", "SP+ team-strength ratings"],
    ], { x: MX, y: 1.85, w: 7.2, colW: [1.9, 5.3], rowH: 0.62, fs: 14, boldFirst: true, name: "Endpoints table" });
    card(s, 8.1, 1.85, 4.63, 3.1);
    T(s, "Inclusion rules", 8.35, 2.0, 4.1, 0.4, { fontSize: 16, bold: true, color: C.text2, name: "Card heading" });
    T(s, [
      { text: "FBS vs FBS: both teams on that season's /teams/fbs list", options: { bullet: true, breakLine: true } },
      { text: "Regular season and bowl games", options: { bullet: true, breakLine: true } },
      { text: "Completed, with a closing line", options: { bullet: true, breakLine: true } },
      { text: "Pick'em (spread 0) excluded: no underdog", options: { bullet: true } },
    ], 8.35, 2.5, 4.15, 2.3, { fontSize: 14, paraSpaceAfter: 6, name: "Inclusion rules list" });
    const cw = 1.5, gap = 0.15, y = 5.2;
    CFG.seasons.forEach((yr, i) => {
      const x = MX + i * (cw + gap);
      card(s, x, y, cw, 1.45);
      T(s, String(yr), x + 0.15, y + 0.15, cw - 0.3, 0.35, { fontSize: 16, bold: true, color: C.text2, name: "Season" });
      T(s, int(A.final_games_by_season[String(yr)]), x + 0.15, y + 0.55, cw - 0.3, 0.5, { fontSize: 26, bold: true, fontFace: HEADF, name: "Season games" });
      T(s, "games", x + 0.15, y + 1.07, cw - 0.3, 0.3, { fontSize: 13, name: "Season unit" });
    });
    const x2 = MX + 5 * (cw + gap);
    card(s, x2, y, 12.733 - x2, 1.45, { fill: C.accent2 });
    T(s, "2020 excluded", x2 + 0.25, y + 0.15, 12.733 - x2 - 0.5, 0.35, { fontSize: 16, bold: true, name: "Exclusion heading" });
    T(s, `COVID cut it to ${DOC.covid2020Games} usable games, many without crowds, which distorts home-field advantage`, x2 + 0.25, y + 0.55, 12.733 - x2 - 0.5, 0.85, { fontSize: 14, name: "Exclusion detail" });
  }

  // 7 ETL funnel
  {
    const removed = funnel.raw - funnel.final;
    const s = addSlide("CONTENT", `The audit removed ${int(removed)} records on the way from ${int(funnel.raw)} raw rows to ${int(funnel.final)} analysis games`, note(
      `This is the data funnel, and it's built from the audit file the pipeline writes on every build. We start with ${int(funnel.raw)} game rows from the API's FBS-classified games request. The first and biggest cut: ${A.non_fbs_leakage_removed} rows, ${pct1(BUG.leaked_share)} of the total, involved a team that is not actually on that season's FBS list. That's the filtering defect I'll come back to. One game had no final score, and ${A.pickem_excluded} were pick'em games with no underdog. That leaves ${int(funnel.final)} games. Also on this slide is a safety check I call the sign-check gate. Favorites should win roughly sixty to ninety percent of the time. If I had the spread's sign backwards, favorites would appear to win only about twenty-seven percent, and the build would stop before any analysis. They won ${pct1(A.favorite_win_share)}, so the gate passes. The point is that every exclusion is counted, not silently absorbed.`, 1));
    s.addChart(pres.charts.BAR, [{ name: "Games", labels: ["Raw API rows", `FBS vs FBS only (${MINUS}${A.non_fbs_leakage_removed})`, `Completed games (${MINUS}${A.incomplete_or_missing_scores_removed})`, `Final, no pick'em (${MINUS}${A.pickem_excluded})`], values: [funnel.raw, funnel.fbs, funnel.complete, funnel.final] }],
      chartBase({ x: MX, y: 1.8, w: 7.5, h: 4.9, barDir: "bar", chartColors: [HEX.accent3, HEX.accent4, HEX.accent4, HEX.accent1], title: "Games after each audit step", showLegend: false, showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "#,##0", valAxisHidden: true, valAxisMinVal: 0, valAxisMaxVal: 5400, valGridLine: { style: "none" }, catAxisOrientation: "maxMin", barGapWidthPct: 45 }));
    const x = 8.4, w = 4.33, h = 1.45;
    stat(s, { x, y: 1.85, w, h, value: String(A.non_fbs_leakage_removed), valueSize: 32, labelSize: 14, detailSize: 13, label: "non-FBS rows removed", detail: `${pct1(BUG.leaked_share)} of raw rows; the API filter keeps games with one FBS team`, key: true });
    stat(s, { x, y: 3.5, w, h, value: `${A.incomplete_or_missing_scores_removed} + ${A.pickem_excluded}`, valueSize: 32, labelSize: 14, detailSize: 13, label: "incomplete score + pick'em games", detail: "No result, or no underdog to define" });
    stat(s, { x, y: 5.15, w, h, value: pct1(A.favorite_win_share), valueSize: 32, labelSize: 14, detailSize: 13, label: "favorites won: sign-check gate passed", detail: "The build stops if this falls outside 60\u201390%" });
  }

  // 8 Tools
  {
    const ver = CFG.library_versions;
    const s = addSlide("CONTENT", "Each tool was chosen for one job: inference with statsmodels, scoring with scikit-learn, simulation with NumPy", note(
      `A quick tour of the toolbox, because each choice was deliberate. Python for everything, so one language runs from the API call to the final figure. The requests library for simple, dependable HTTP. Pandas and Parquet for cleaning and storage, so each cleaning rule is one readable line and the data types are preserved. The interesting pair is statsmodels and scikit-learn. They answer different questions. Statsmodels fits the models and gives inference, meaning standard errors and p-values, which hypothesis testing needs. Scikit-learn scores the forecasts on games the model never saw. A research study needs both. NumPy and SciPy run the Monte Carlo as fast array operations, matplotlib draws the figures, pytest pins ${DOC.tests} tests on the cleaning rules and the statistics, and Git with GitHub keeps every change a reviewed commit.`, 0.75));
    const tools = [
      ["python", "Python 3.12", "One language from API call to PDF"],
      ["requests", "requests", "Simple HTTP with timeouts, retries and a raw cache"],
      ["pandas", `pandas ${ver.pandas} + Parquet`, "Readable cleaning rules; typed, checksummed storage"],
      ["statsmodels", `statsmodels ${ver.statsmodels}`, "Standard errors and p-values for the hypothesis tests"],
      ["sklearn", `scikit-learn ${ver["scikit-learn"]}`, "Tested Brier, log-loss, AUC and calibration scoring"],
      ["numpy", `NumPy ${ver.numpy} + SciPy ${ver.scipy}`, "Vectorized Monte Carlo; chi-square and normal CDFs"],
      ["mpl", "matplotlib", "Static figures, rendered headless"],
      ["pytest", "pytest", `${DOC.tests} tests pin the cleaning rules, statistics and leak guard`],
      ["git", "Git + GitHub", "Every change is a reviewed commit and pull request"],
    ];
    const cw = (CW - 0.6) / 3, h = 1.4;
    tools.forEach((t, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const x = MX + col * (cw + 0.3), y = 1.85 + row * (h + 0.25);
      card(s, x, y, cw, h);
      iconInCircle(s, ICON[t[0]], x + 0.2, y + 0.35, 0.7);
      T(s, t[1], x + 1.1, y + 0.15, cw - 1.25, 0.32, { fontSize: 15, bold: true, color: C.text2, name: "Tool name" });
      T(s, t[2], x + 1.1, y + 0.5, cw - 1.25, 0.85, { fontSize: 14, name: "Tool reason" });
    });
  }

  // ------------------------------------------------------------ METHODS
  section("Methods");
  {
    const s = addSlide("SECTION_DARK", "Methods", note("Section break: methods.", 5 / 60, false));
    chip(s, 0.9, 2.7, 1.3, "", { fill: C.accent2, name: "Section chip" });
    s.addImage({ data: ICON.flaskDark, x: 1.25, y: 3.05, w: 0.6, h: 0.6, altText: "flask icon" });
    s.addText("Hypotheses and evaluation design", { placeholder: "subtitle" });
  }

  // 9 Hypotheses
  {
    const s = addSlide("CONTENT", "Four null hypotheses, each with a named test, ask whether the spread, or anything beyond it, carries signal", note(
      `Before looking at results, here are the four null hypotheses, stated up front, each with the test that goes with it. A null hypothesis is the boring default we try to knock down. H-zero-one: the spread does not predict who wins. We test it with a logistic regression of home win on the spread. H-zero-two: other public information adds nothing once the spread is known. That's a likelihood-ratio test comparing a spread-only model against one that adds prior-season team strength, neutral site, conference game, week and the over-under, five extra terms. H-zero-three: the spread's implied probabilities are calibrated, meaning that when it says seventy percent, favorites win about seventy percent. We check the calibration slope and intercept and a Hosmer-Lemeshow test on the holdout seasons. And H-zero-four: the spread is an unbiased forecast of the margin, checked with a linear regression where the ideal is intercept zero and slope minus one. Everything uses a significance level of five percent.`, 1));
    const rows = [
      [1, "The spread does not predict who wins", "Logistic regression of home win on the spread; Wald test on the slope"],
      [2, "Other public information adds nothing once the spread is known", "Likelihood-ratio test (df = 5): spread-only logit nested in a model adding prior-season SP+ difference, neutral site, conference game, week and over/under"],
      [3, "Spread-implied probabilities are calibrated", "Calibration intercept and slope plus Hosmer\u2013Lemeshow (10 bins) on the temporal holdout; reliability diagram"],
      [4, "The spread is an unbiased forecast of the margin", `OLS of margin on spread: ideal intercept 0 and slope ${MINUS}1; R\u00b2 against a multivariate OLS`],
    ];
    T(s, "Null hypothesis", MX + 1.1, 1.85, 4.8, 0.4, { fontSize: 14, bold: true, color: C.text2, valign: "middle", name: "Column header" });
    T(s, "Test", MX + 6.2, 1.85, 4.0, 0.4, { fontSize: 14, bold: true, color: C.text2, valign: "middle", name: "Column header" });
    s.addText("\u03b1 = 0.05", { x: 10.93, y: 1.82, w: 1.8, h: 0.46, shape: SH.roundRect, rectRadius: 0.23, fill: { color: C.accent2 }, color: C.text1, fontSize: 16, bold: true, align: "center", valign: "middle", margin: 0, isTextBox: true, objectName: "Alpha pill" });
    rows.forEach((r, i) => {
      const y = 2.45 + i * 1.07, h = 0.95;
      card(s, MX, y, CW, h);
      chip(s, MX + 0.2, y + 0.125, 0.7, h0(r[0]), { size: 15 });
      T(s, r[1], MX + 1.1, y + 0.1, 4.8, h - 0.2, { fontSize: 15, bold: true, valign: "middle", name: "Null hypothesis" });
      T(s, r[2], MX + 6.2, y + 0.1, CW - 6.4, h - 0.2, { fontSize: 14, valign: "middle", name: "Test" });
    });
  }

  // 10 Evaluation design
  {
    const s = addSlide("CONTENT", "A temporal holdout (out-of-sample) scores the models on seasons they never saw, against a named naive baseline", note(
      `Now the evaluation design. I split by season, never at random, so no future game can inform a prediction. The models are fit on 2019, 2021 and 2022, ${V.nTrain} games. They are then scored on 2023 and 2024, ${V.nTest} games they have never seen. That's a temporal holdout, an out-of-sample test. The naive baseline is stated explicitly: every game just gets the training home-win rate. A forecast only counts as skillful if it beats that. The scoring metrics are the Brier score, the mean squared error of the probability; the Brier skill score, which turns that into percent better than the baseline; log loss as a second check; and AUC for discrimination, how well forecasts rank winners above losers. Calibration, whether the stated probabilities are honest, is reported separately, with a slope, an intercept and a reliability diagram. Finally, the uncertainty comes from a cluster bootstrap over the ${V.nWeeks} season-weeks, because games in the same week aren't independent.`, 1.5));
    const y = 1.85, h = 1.5;
    card(s, MX, y, 5.0, h);
    T(s, `Train: ${V.nTrain} games`, MX + 0.25, y + 0.15, 4.5, 0.35, { fontSize: 16, bold: true, color: C.text2, name: "Block heading" });
    [2019, 2021, 2022].forEach((yr, i) => chip(s, MX + 0.25 + i * 1.55, y + 0.62, 0.72, String(yr), { size: 12, name: "Season chip" }));
    card(s, 5.85, y, 3.65, h);
    T(s, `Temporal holdout (out-of-sample): ${V.nTest} games`, 6.1, y + 0.12, 3.2, 0.5, { fontSize: 14, bold: true, color: C.text2, name: "Block heading" });
    [2023, 2024].forEach((yr, i) => chip(s, 6.1 + i * 1.0, y + 0.7, 0.72, String(yr), { fill: C.accent2, color: C.text1, size: 12, name: "Season chip" }));
    card(s, 9.75, y, 2.98, h, { fill: C.text2 });
    T(s, [bold("Naive baseline"), { text: ": every game gets the training home-win rate" }], 9.97, y + 0.15, 2.55, 1.2, { fontSize: 16, valign: "middle", color: C.background1, name: "Naive baseline definition" });
    const metrics = [
      ["Brier score", "Mean squared error of the probability; lower is better"],
      ["Brier skill score", "1 \u2212 Brier(model) / Brier(naive): percent better than baseline"],
      ["Log loss", "A second proper score; punishes confident misses"],
      ["AUC (discrimination)", "How well forecasts rank winners above losers"],
      ["Calibration", "Slope and intercept, Hosmer\u2013Lemeshow, reliability diagram"],
      ["Cluster bootstrap", `${V.nBoot} resamples over ${V.nWeeks} season-weeks; games in a week are not independent`],
    ];
    const cw = (CW - 0.6) / 3, mh = 1.35;
    metrics.forEach((m, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const x = MX + col * (cw + 0.3), yy = 3.6 + row * (mh + 0.2);
      card(s, x, yy, cw, mh);
      T(s, m[0], x + 0.25, yy + 0.15, cw - 0.5, 0.32, { fontSize: 15, bold: true, color: C.text2, name: "Metric name" });
      T(s, m[1], x + 0.25, yy + 0.52, cw - 0.5, 0.8, { fontSize: 14, name: "Metric definition" });
    });
    T(s, "Scoring: Brier (1950). Calibration and discrimination reported separately: Murphy (1973); Collins et al. (2024), TRIPOD+AI.", MX, 6.65, CW, 0.28, { fontSize: 11, italic: true, name: "Citation" });
  }

  // ------------------------------------------------------------ RESULTS
  section("Results");
  {
    const s = addSlide("SECTION_DARK", "Results", note("Section break: results.", 5 / 60, false));
    chip(s, 0.9, 2.7, 1.3, "", { fill: C.accent2, name: "Section chip" });
    s.addImage({ data: ICON.chartDark, x: 1.25, y: 3.05, w: 0.6, h: 0.6, altText: "chart icon" });
    s.addText("Hypothesis tests, then out-of-sample scoring", { placeholder: "subtitle" });
  }

  // 11 H1 / H4
  {
    const s = addSlide("CONTENT", "The spread strongly predicts winners and is an unbiased forecast of the final margin", note(
      `Start with the first and fourth hypotheses. For H-zero-one, each point of spread shifts the log-odds of a home win by ${num(H1.coef, 3)}, with a z-statistic of ${num(H1.z, 1)}, and a p-value far below one in a thousand. The spread predicts winners, and the null is rejected decisively. In plain terms, a seven-point home favorite wins about ${pct1(p7)} of the time in the model, and a fourteen-point favorite about ${pct1(p14)}. For H-zero-four, I regress the actual margin on the spread. If the market is unbiased, the slope should be exactly minus one and the intercept zero. The fitted slope is ${num(slopeCoef, 3)}, with a confidence interval of ${ci([slopeCoef - 1.96 * slopeSE, slopeCoef + 1.96 * slopeSE], 3)} that contains minus one, and the intercept is ${num(interCoef, 2)}, p equals ${pv(H4.spread_only_coefs.const.p)}. So we don't reject: the spread is an unbiased forecast of the margin. The plot shows residuals roughly normal and actual margins scattered symmetrically around the market line.`, 1));
    const iw = 7.6, ih = iw / (1430 / 585);
    s.addImage({ path: path.join(ROOT, "results", "figures", "residuals.png"), x: MX, y: 1.85, w: iw, h: ih, altText: "Left: histogram of margin residuals, actual minus market-implied margin, roughly normal with SD 15.30. Right: actual home margin against market-implied home margin, scattered symmetrically around the market line." });
    T(s, `Residuals are roughly normal (SD ${V.sdObs} on the holdout); actual margins scatter symmetrically around the market line.`, MX, 1.85 + ih + 0.1, iw, 0.5, { fontSize: 12, italic: true, name: "Figure caption" });
    const sy = 5.55, sw = (iw - 0.2) / 2;
    stat(s, { x: MX, y: sy, w: sw, h: 1.1, value: pct1(p7), valueSize: 26, label: "7-point home favorite wins", labelSize: 13 });
    stat(s, { x: MX + sw + 0.2, y: sy, w: sw, h: 1.1, value: pct1(p14), valueSize: 26, label: "14-point home favorite wins", labelSize: 13 });
    const x = 8.5, w = 4.23, h = 1.5;
    stat(s, { x, y: 1.85, w, h, value: "z = " + num(H1.z, 1), valueSize: 34, label: runs(h0(1), { text: ` rejected (p ${pv(H1.p)})` }), detail: `Slope ${num(H1.coef, 3)}/point, 95% CI ${ci([H1.coef - 1.96 * h1se, H1.coef + 1.96 * h1se], 3)}`, key: true, detailSize: 13 });
    stat(s, { x, y: 3.5, w, h, value: num(slopeCoef, 3), valueSize: 34, label: runs(h0(4), { text: " not rejected: unbiased margin" }), detail: `Slope 95% CI ${ci([slopeCoef - 1.96 * slopeSE, slopeCoef + 1.96 * slopeSE], 3)}; intercept ${num(interCoef, 2)} (p = ${pv(H4.spread_only_coefs.const.p)})`, detailSize: 13 });
    stat(s, { x, y: 5.15, w, h, value: "R\u00b2 = " + H4.spread_only_r2.toFixed(3), valueSize: 34, label: "Margin variance the spread explains", detail: `Five extra features lift it only to ${H4.full_r2.toFixed(3)}`, detailSize: 13 });
  }

  // 12 H2
  {
    const s = addSlide("CONTENT", `Five extra public features add nothing out of sample, and the p = ${pv(H2.p, 3)} signal seen in training does not survive`, note(
      `The second hypothesis is the one that decides whether public information beats the market. In-sample, on the training seasons, the likelihood-ratio test of the five extra features gives p equals ${pv(H2.p, 3)}, just under the five percent line. If I stopped there, I might claim a small edge. But the out-of-sample test is decisive. On the holdout seasons, the naive forecast scores a Brier of ${V.brierNaive}, the spread alone scores ${V.brierSpread}, and the full model with all the extra features scores ${V.brierFull}. The full model is slightly worse. The paired difference is ${V.dBrier}, with a cluster-bootstrap ninety-five percent interval of ${V.dCI}, which includes zero. AUC, the ranking measure, tells the same story: ${V.aucSpread} for the spread alone, ${V.aucFull} for the full model. A marginal in-sample result that fails on new seasons is the classic signature of fitting noise. The market spread alone captures nearly all the predictive signal in these public features.`, 1));
    s.addChart(pres.charts.BAR, [{ name: "Brier score", labels: ["Naive baseline", "Spread only", "Full model (spread + 5 features)"], values: [E.naive.brier, E.spread_only.brier, E.full.brier] }],
      chartBase({ x: MX, y: 1.8, w: 7.4, h: 4.9, barDir: "col", chartColors: [HEX.accent3, HEX.accent1, HEX.accent4], title: `Out-of-sample Brier score, n = ${V.nComplete} complete-case holdout games (lower is better)`, showLegend: false, showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "0.000", valAxisMinVal: 0, valAxisMaxVal: 0.3, valAxisMajorUnit: 0.05, valAxisLabelFormatCode: "0.00", barGapWidthPct: 60 }));
    const x = 8.3, w = 4.43, h = 1.5;
    stat(s, { x, y: 1.85, w, h, value: V.dBrier, valueSize: 36, label: "Brier change, full minus spread", detail: `95% CI ${V.dCI} includes zero (n = ${V.nComplete})`, key: true, detailSize: 13 });
    stat(s, { x, y: 3.5, w, h, value: "p = " + pv(H2.p, 3), valueSize: 36, label: runs(h0(2), { text: " in-sample LR test (df = 5)" }), detail: "Marginal in-sample; does not hold out of sample", detailSize: 13 });
    stat(s, { x, y: 5.15, w, h, value: `${V.aucSpread} vs ${V.aucFull}`, valueSize: 30, label: "AUC: spread only vs full model", detail: `Brier skill vs naive: ${V.skillSpread} vs ${V.skillFull}`, detailSize: 13 });
  }

  // 13 H3 calibration
  {
    const s = addSlide("CONTENT", "Spread-implied probabilities are well calibrated: when the spread says 70%, favorites win about 70%", note(
      `The third hypothesis asks whether the probabilities are honest. This chart is a reliability diagram. I sort the holdout games into ten groups by predicted probability, and for each group compare the average prediction to how often the home team actually won. A perfectly calibrated forecast sits on the gray reference line, where predicted equals observed. Both the spread-only and the full model track it closely across the whole range. The numbers back that up. The calibration slope is ${num(H3.calibration_slope, 2)} with a standard error of ${num(H3.calibration_slope_se, 2)}, and the ideal is one. The intercept is ${num(H3.calibration_intercept, 2)}, ideal zero. A Hosmer-Lemeshow test gives p equals ${pv(H3.hosmer_lemeshow_p, 3)}, so we don't reject the null of good calibration. Separately, because calibration and discrimination are different things, the AUC is ${V.aucSpread}: the forecast ranks winners above losers well. When the spread says seventy percent, the favorite wins about seventy percent of the time.`, 1));
    const rel = R.models.reliability;
    s.addChart(pres.charts.LINE, [
      { name: "Predicted rate (perfect calibration)", labels: rel.spread_only.prob_pred.map((p) => Math.round(p * 100) + "%"), values: rel.spread_only.prob_pred },
      { name: "Spread only (observed)", labels: rel.spread_only.prob_pred.map((p) => Math.round(p * 100) + "%"), values: rel.spread_only.prob_true },
      { name: "Full model (observed)", labels: rel.full.prob_pred.map((p) => Math.round(p * 100) + "%"), values: rel.full.prob_true },
    ], chartBase({ x: MX, y: 1.8, w: 7.0, h: 4.85, chartColors: [HEX.accent3, HEX.accent1, HEX.accent4], title: "Reliability diagram, temporal holdout", showLegend: true, legendPos: "b", lineSize: 2, lineDataSymbol: "circle", lineDataSymbolSize: 7, valAxisMinVal: 0, valAxisMaxVal: 1, valAxisMajorUnit: 0.2, valAxisLabelFormatCode: "0%", showCatAxisTitle: true, catAxisTitle: "Mean predicted home-win probability, by decile (spread only)", showValAxisTitle: true, valAxisTitle: "Observed home-win rate" }));
    const x = 7.9, w = 4.83, h = 1.5;
    stat(s, { x, y: 1.85, w, h, value: num(H3.calibration_slope, 2), valueSize: 36, label: "Calibration slope (ideal 1)", detail: `95% CI ${ci(calSlopeCI, 2)}; intercept ${num(H3.calibration_intercept, 2)} (SE ${num(H3.calibration_intercept_se, 2)}), ideal 0`, key: true, detailSize: 13 });
    stat(s, { x, y: 3.5, w, h, value: "p = " + pv(H3.hosmer_lemeshow_p, 3), valueSize: 36, label: runs(h0(3), { text: " not rejected (Hosmer\u2013Lemeshow)" }), detail: `\u03c7\u00b2 = ${H3.hosmer_lemeshow_stat.toFixed(1)} on ${H3.hosmer_lemeshow_df} df, 10 bins`, detailSize: 13 });
    stat(s, { x, y: 5.15, w, h, value: V.aucSpread, valueSize: 36, label: "AUC: discrimination, not calibration", labelSize: 14, detail: "How well forecasts rank winners above losers", detailSize: 13 });
    T(s, `Full-model deciles use its own predictions; mean predicted differs from spread-only by at most ${(relGap * 100).toFixed(1)} points.`, MX, 6.75, 7.0, 0.25, { fontSize: 10, italic: true, name: "Chart note" });
  }

  // 14 Upset rate by spread
  {
    const s = addSlide("CONTENT", `Close games are nearly coin flips, and upsets fall from ${Math.round(closeBucket.observed_upset_rate * 100)}% to ${Math.round(farBucket.observed_upset_rate * 100)}% as the spread grows`, note(
      `This slide turns calibration into the question the audience cares about: how often do underdogs actually win? I group the holdout games by the size of the spread. When the spread is under three points, the game is close to a coin flip: ${pct1(closeBucket.observed_upset_rate)} of those ${closeBucket.n} games ended in an upset. As the spread grows, upsets fall steadily, down to ${pct1(farBucket.observed_upset_rate)} for spreads of 21 or more. The predicted rates, in the lighter bars, come from the spread-only model and follow the same pattern. One bucket stands out: for spreads between 14 and 21, ${pct1(worstBucket.observed_upset_rate)} of games were upsets against ${pct1(worstBucket.mean_predicted_upset_rate)} predicted. That's the largest gap, but it's one bucket of six, so I'd treat it as something to watch, not as an edge. Overall the spread tracks the pattern closely, with one notable gap: in the 14 to 21 bucket, about 7 percent observed versus 14 percent predicted, roughly 3 standard errors. Overall calibration is not rejected, with a Hosmer-Lemeshow p of ${pv(H3.hosmer_lemeshow_p, 3)}.`, 0.75));
    s.addChart(pres.charts.BAR, [
      { name: "Observed upset rate", labels: buckets.map((b) => bucketLabel(b.bucket)), values: buckets.map((b) => b.observed_upset_rate) },
      { name: "Predicted upset rate", labels: buckets.map((b) => bucketLabel(b.bucket)), values: buckets.map((b) => b.mean_predicted_upset_rate) },
    ], chartBase({ x: MX, y: 1.8, w: 8.2, h: 4.9, barDir: "col", barGrouping: "clustered", chartColors: [HEX.accent1, HEX.accent3], title: "Upset rate by size of closing spread, temporal holdout", showLegend: true, legendPos: "b", showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "0.0%", dataLabelFontSize: 11, valAxisMinVal: 0, valAxisMaxVal: 0.6, valAxisMajorUnit: 0.1, valAxisLabelFormatCode: "0%", showCatAxisTitle: true, catAxisTitle: "Closing spread (points)", barGapWidthPct: 50 }));
    stat(s, { x: 9.1, y: 1.85, w: 3.63, h: 2.35, value: pct1(closeBucket.observed_upset_rate), valueSize: 38, label: "upset rate when the spread is under 3 points", detail: `n = ${closeBucket.n} holdout games`, key: true, detailSize: 13 });
    stat(s, { x: 9.1, y: 4.4, w: 3.63, h: 2.3, value: `${pct1(worstBucket.observed_upset_rate)} vs ${pct1(worstBucket.mean_predicted_upset_rate)}`, valueSize: 26, label: `Largest gap: ${bucketLabel(worstBucket.bucket)} point spreads`, detail: `n = ${worstBucket.n}; one of six buckets, so read with caution`, detailSize: 13 });
  }

  // ------------------------------------------------------------ VALIDATION
  section("Validation");
  {
    const s = addSlide("SECTION_DARK", "Validation", note("Section break: validation.", 5 / 60, false));
    chip(s, 0.9, 2.7, 1.3, "", { fill: C.accent2, name: "Section chip" });
    s.addImage({ data: ICON.checkDark, x: 1.25, y: 3.05, w: 0.6, h: 0.6, altText: "double check icon" });
    s.addText("Monte Carlo, controlled reruns and safeguards", { placeholder: "subtitle" });
  }

  // 15 Monte Carlo design
  {
    const s = addSlide("CONTENT", "A Monte Carlo asks whether the real seasons look any different from worlds that are only line plus noise", note(
      `The regression tests tell us the spread is good and extra features don't help. The Monte Carlo goes after the bigger claim: that what remains is randomness. The logic is simple. Build thousands of fake versions of the 2023 and 2024 seasons in which, by construction, outcomes are nothing but the market line plus chance, then see whether the real seasons look any different. I used two such worlds, both fit on training data only. In the outcome redraw, each game's winner is a weighted coin flip using the spread model's probability. In the margin redraw, each margin is the market-implied margin plus bell-curve noise with a standard deviation of ${num(SIM.normal_margin.train_resid_sd, 2)} points. Each world is run ${V.mcTrials} times with a fixed seed of ${SEED}. For each simulated season I record three things: the number of upsets, the residual spread of margins, and the Brier score. The margin model also gives an oracle Brier, the score of a forecaster who knows the true probabilities, which is what even a perfect forecaster would expect under line plus noise.`, 1));
    const lx = MX, lw = 4.4;
    card(s, lx, 1.85, lw, 2.3);
    chip(s, lx + 0.25, 2.05, 0.5, "1", { size: 16 });
    T(s, "Outcome redraw", lx + 0.95, 2.05, lw - 1.2, 0.5, { fontSize: 17, bold: true, color: C.text2, valign: "middle", name: "Null model name" });
    T(s, "Each holdout game's winner is a coin flip weighted by the spread-only model's probability", lx + 0.25, 2.8, lw - 0.5, 1.2, { fontSize: 14, name: "Null model description" });
    card(s, lx, 4.4, lw, 2.3);
    chip(s, lx + 0.25, 4.6, 0.5, "2", { size: 16 });
    T(s, "Margin redraw", lx + 0.95, 4.6, lw - 1.2, 0.5, { fontSize: 17, bold: true, color: C.text2, valign: "middle", name: "Null model name" });
    T(s, `Each margin is the market-implied margin plus Normal(0, \u03c3), \u03c3 = ${num(SIM.normal_margin.train_resid_sd, 2)} points (training SD)`, lx + 0.25, 5.35, lw - 0.5, 1.2, { fontSize: 14, name: "Null model description" });
    s.addShape(SH.rightArrow, { x: lx + lw + 0.1, y: 3.95, w: 0.4, h: 0.4, fill: { color: C.accent3 }, line: { type: "none" }, objectName: "Flow arrow" });
    const mx = 5.55, mw = 2.6;
    card(s, mx, 1.85, mw, 4.85, { fill: C.text2 });
    T(s, V.mcTrials, mx + 0.1, 2.4, mw - 0.2, 0.9, { fontSize: 44, bold: true, fontFace: HEADF, color: C.accent2, align: "center", valign: "middle", name: "Trials value" });
    T(s, "simulated 2023\u201324 seasons", mx + 0.25, 3.4, mw - 0.5, 0.7, { fontSize: 16, bold: true, color: C.background1, align: "center", name: "Trials label" });
    T(s, `${V.nTest} games per trial, fixed seed ${SEED}, fit on training data only`, mx + 0.25, 4.3, mw - 0.5, 1.2, { fontSize: 14, color: C.background2, align: "center", name: "Trials detail" });
    s.addShape(SH.rightArrow, { x: mx + mw + 0.1, y: 3.95, w: 0.4, h: 0.4, fill: { color: C.accent3 }, line: { type: "none" }, objectName: "Flow arrow" });
    const rx = 8.75, rw = W - MX - rx;
    [["Upset count", "Underdog wins in a simulated season"], ["Residual SD", "Spread of actual margins around the market line"], ["Brier score + oracle Brier", "Oracle (margin model): the Brier a forecaster with the true probabilities would expect"]].forEach((r, i) => {
      const y = 1.85 + i * 1.7;
      card(s, rx, y, rw, 1.45);
      T(s, r[0], rx + 0.25, y + 0.15, rw - 0.5, 0.35, { fontSize: 16, bold: true, color: C.text2, name: "Statistic name" });
      T(s, r[1], rx + 0.25, y + 0.55, rw - 0.5, 0.85, { fontSize: 14, name: "Statistic description" });
    });
  }

  // 16 Monte Carlo results
  {
    const s = addSlide("CONTENT", `Every observed statistic falls inside its simulated range, so the ${V.mcObsUpsets} observed upsets are ordinary`, note(
      `Here are the Monte Carlo results. The histogram shows the number of upsets across ${V.mcTrials} simulated seasons under the outcome-redraw world. The amber bar is where the real 2023 and 2024 seasons landed: ${V.mcObsUpsets} upsets, right in the middle of the distribution, at the ${SIM.bernoulli.upsets.percentile.toFixed(1)}th percentile. The empirical p-value is ${V.mcUpsetP}, so nothing unusual. The table gives the other two checks. The residual standard deviation of margins is ${V.sdObs} points observed against a simulated range of ${rng(SIM.normal_margin.resid_sd.sim_ci95, 2)}, p equals ${V.mcResidP}. And the market's Brier score of ${V.mcBrierObs} sits inside its simulated range too. On the right, the oracle Brier, the best score a forecaster with perfect knowledge of the probabilities could expect, averages ${V.oracle}. That is the margin-model oracle, with a 95% range of ${V.oracleCI}. The market's ${V.mcBrierObs} sits inside that range, which leaves little room for improvement. The careful way to say it: the residual variance is consistent with irreducible randomness. A simulation can fail to find a departure from the null, but it can't prove the null.`, 1.5));
    const counts = SIM.hist.bernoulli_upsets.counts, edges = SIM.hist.bernoulli_upsets.edges;
    const bw = 3, nb = Math.floor(counts.length / bw);
    const binCounts = [], binCenters = [];
    for (let i = 0; i < nb; i++) {
      let c = 0;
      for (let j = 0; j < bw; j++) c += counts[i * bw + j];
      binCounts.push(c);
      binCenters.push(edges[i * bw] + 1);
    }
    const obs = SIM.bernoulli.upsets.observed;
    const obsIdx = binCenters.findIndex((c) => Math.abs(c - obs) <= 1);
    const labels = binCenters.map((c, i) => ((i - obsIdx) % 5 === 0 ? String(c) : " "));
    s.addChart(pres.charts.BAR, [
      { name: "Simulated seasons", labels, values: binCounts.map((c, i) => (i === obsIdx ? 0 : c)) },
      { name: `Bin containing the observed ${V.mcObsUpsets} upsets`, labels, values: binCounts.map((c, i) => (i === obsIdx ? c : 0)) },
    ], chartBase({ x: MX, y: 1.8, w: 7.5, h: 4.45, barDir: "col", barGrouping: "stacked", chartColors: [HEX.accent4, HEX.accent2], title: `Upsets per simulated 2023\u201324 season (${V.mcTrials} trials, outcome redraw)`, showLegend: true, legendPos: "b", barGapWidthPct: 10, catAxisLabelFrequency: 1, showCatAxisTitle: true, catAxisTitle: "Upsets in a simulated season (bins of 3, labeled by center)", showValAxisTitle: true, valAxisTitle: "Simulated seasons", valAxisLabelFormatCode: "#,##0" }));
    T(s, `Observed ${V.mcObsUpsets} upsets: ${SIM.bernoulli.upsets.percentile.toFixed(1)}th percentile of the simulated distribution (p = ${V.mcUpsetP}).`, MX, 6.35, 7.5, 0.35, { fontSize: 12, italic: true, name: "Chart caption" });
    table(s, [
      ["Statistic", "Observed", "Simulated 95%", "p"],
      ["Upsets (outcome redraw)", V.mcObsUpsets, rng(SIM.bernoulli.upsets.sim_ci95, 0), V.mcUpsetP],
      ["Residual SD (points)", V.sdObs, rng(SIM.normal_margin.resid_sd.sim_ci95, 2), V.mcResidP],
      ["Brier, spread model", V.mcBrierObs, rng(SIM.bernoulli.brier.sim_ci95, 3), pv(SIM.bernoulli.brier.p_value)],
    ], { x: 8.4, y: 1.85, w: 4.33, colW: [1.6, 0.95, 1.25, 0.53], rowH: 0.58, fs: 12, align: ["left", "right", "right", "right"], name: "Monte Carlo summary table" });
    stat(s, { x: 8.4, y: 4.4, w: 4.33, h: 2.3, value: V.oracle, valueSize: 40, label: "Oracle Brier (margin model)", detail: `95% range ${V.oracleCI}; the market's ${V.mcBrierObs} sits inside it, leaving little room for any forecaster`, key: true });
  }

  // 17 Look-ahead bias
  {
    const s = addSlide("CONTENT", "Look-ahead bias would have reversed the central conclusion: the full model would appear to beat the market", note(
      `Now the first of the two data traps, and the more dangerous one. The API's SP-plus ratings for a season are computed after that season ends, from that season's own games. If you feed them to a model as pregame features, the model is partly being told the results it's supposed to predict. The technical name is look-ahead bias, or temporal leakage: features that aren't available at prediction time. I identified this at design time, before any data was pulled, and the pipeline uses prior-season ratings, so no reported result is affected. Then I measured what the leak would have done with a controlled rerun: same split, same seed, same ${int(LK.n_games)} matched games, only the rating's season changes. With the leak, the full model's Brier skill jumps from ${pct1(CL.brier_skill_full_vs_naive)} to ${pct1(LK.brier_skill_full_vs_naive)}, and it appears to beat the spread by ${num(LK.brier_diff_full_minus_spread, 3)} Brier, with an interval of ${ci(LK.brier_diff_ci95, 3, true)} nowhere near zero. We'd have confidently reported the opposite of the truth. Clean, the difference is ${sgn(CL.brier_diff_full_minus_spread, 3)}, interval including zero.`, 1.5));
    s.addText([bold("Look-ahead bias (temporal leakage): "), { text: "features not available at prediction time. Here, end-of-season SP+ ratings used as pregame features (cf. Kapoor & Narayanan, 2023)." }],
      { x: MX, y: 1.7, w: CW, h: 0.5, color: C.text1, fontSize: 14, valign: "middle", margin: 0, isTextBox: true, objectName: "Definition line" });
    const cw = 5.65, y = 2.35, h = 3.65, lx = MX, rx = W - MX - cw;
    const cols = [
      { x: lx, head: "Leaky: same-season SP+", fill: C.text1, panel: C.background2, key: true, vals: [pct1(LK.brier_skill_full_vs_naive), `${num(LK.brier_diff_full_minus_spread, 3)}`, "Yes (false)"], cis: [null, ci(LK.brier_diff_ci95, 3, true), null], valColor: C.text1 },
      { x: rx, head: "Clean: prior-season SP+ (as reported)", fill: C.text2, panel: C.background2, vals: [pct1(CL.brier_skill_full_vs_naive), sgn(CL.brier_diff_full_minus_spread, 3), "No"], cis: [null, ci(CL.brier_diff_ci95, 3, true), null], valColor: C.text2 },
    ];
    const rowLabels = ["Brier skill, full model vs naive", "Brier(full) \u2212 Brier(spread), 95% CI", "Does the full model beat the market?"];
    cols.forEach((c) => {
      card(s, c.x, y, cw, h, { fill: c.panel });
      s.addText(c.head, { x: c.x, y, w: cw, h: 0.6, shape: SH.roundRect, rectRadius: 0.12, fill: { color: c.fill }, color: C.background1, fontSize: 16, bold: true, align: "left", valign: "middle", margin: 14, isTextBox: true, objectName: "Column header" });
      rowLabels.forEach((rl, i) => {
        const ry = y + 0.8 + i * 0.95;
        T(s, rl, c.x + 0.25, ry, cw - 0.5, 0.28, { fontSize: 13, color: C.text1, name: "Row label" });
        const isKey = c.key && i === 1;
        if (isKey) s.addShape(SH.roundRect, { x: c.x + 0.15, y: ry + 0.28, w: 2.0, h: 0.52, rectRadius: 0.1, fill: { color: C.accent2 }, line: { type: "none" }, objectName: "Key number highlight" });
        T(s, c.vals[i], c.x + (isKey ? 0.15 : 0.25), ry + 0.28, isKey ? 2.0 : 2.0, 0.52, { fontSize: 28, bold: true, fontFace: HEADF, color: isKey ? C.text1 : c.valColor, valign: "middle", align: isKey ? "center" : "left", name: "Row value" });
        if (c.cis[i]) T(s, c.cis[i], c.x + 2.35, ry + 0.28, cw - 2.6, 0.52, { fontSize: 15, valign: "middle", name: "Row CI" });
      });
    });
    chip(s, 6.665 - 0.3, y + 1.65, 0.6, "vs", { fill: C.accent3, color: C.text1, size: 14, name: "Versus chip" });
    s.addText(`Identified at design time; impact measured by a controlled rerun on the same ${int(LK.n_games)} matched games (same split, same seed).`, { x: MX, y: 6.15, w: CW, h: 0.55, shape: SH.roundRect, rectRadius: 0.12, fill: { color: C.text2 }, color: C.background1, fontSize: 14, align: "left", valign: "middle", margin: 14, isTextBox: true, objectName: "Method note" });
  }

  // 18 API filtering defect
  {
    const s = addSlide("CONTENT", `An API filtering defect inflated measured skill by ${skillInflation.toFixed(1)} points and faked a miscalibration finding`, note(
      `The second trap was a data-provenance defect, a filtering bug in the API. My first audit flagged ${BUG.leaked_rows} of ${int(BUG.api_filter_rows)} returned records, ${pct1(BUG.leaked_share)}, as involving a team that isn't on the official FBS list. The cause: the request asking for FBS games keeps any game with at least one FBS team, not games where both are FBS. 589 of the 590 were FBS teams hosting FCS opponents. ${BUG.leaked_with_lines} of them even had betting lines, so a pipeline that trusted the filter would have kept almost all of them. The pipeline now checks both teams against the official list and a regression test guards it. To measure the damage, I rebuilt the dataset trusting the filter. Lopsided FBS-versus-FCS games are easy to call, so they make the market look ${skillInflation.toFixed(1)} points more skillful, they understate the upset rate, and they push the calibration test to p equals ${pv(BUG.buggy.hosmer_lemeshow_p, 3)}, a false rejection. The key check: on the same ${int(BUG.matched_test_rows.n_games)} matched games, models trained either way score the same. The bug corrupted the evaluation, not the model.`, 1));
    const b = BUG.buggy, f = BUG.fixed;
    table(s, [
      ["Metric", "Trusting the API filter", "After the fix"],
      ["Games analyzed", int(b.n_games), int(f.n_games)],
      ["Brier skill vs naive", pct1(b.brier_skill_spread_vs_naive), pct1(f.brier_skill_spread_vs_naive)],
      ["Test-season upset rate", pct1(b.upset_rate_test), pct1(f.upset_rate_test)],
      ["Hosmer\u2013Lemeshow p", { text: `${pv(b.hosmer_lemeshow_p, 3)} (rejects H0\u2083)`, options: { bold: true } }, `${pv(f.hosmer_lemeshow_p, 3)} (does not reject)`],
      ["Mean |spread| (points)", b.mean_abs_spread_all_seasons.toFixed(1), f.mean_abs_spread_all_seasons.toFixed(1)],
    ], { x: MX, y: 1.85, w: 7.3, colW: [2.7, 2.4, 2.2], rowH: 0.6, fs: 14, boldFirst: true, name: "Filter defect table" });
    T(s, [bold("Defect: "), { text: `/games?classification=fbs returns games with at least one FBS team, not both. ${BUG.leaked_rows} of ${int(BUG.api_filter_rows)} rows (${pct1(BUG.leaked_share)}) were non-FBS-vs-FBS, ${BUG.leaked_with_lines} of them with betting lines.` }], MX, 5.7, 7.3, 1.0, { fontSize: 14, name: "Defect description" });
    stat(s, { x: 8.2, y: 1.85, w: 4.53, h: 1.75, value: "+" + skillInflation.toFixed(1) + " pts", valueSize: 40, label: "Inflated Brier skill", detail: `${pct1(b.brier_skill_spread_vs_naive)} vs ${pct1(f.brier_skill_spread_vs_naive)}`, key: true });
    card(s, 8.2, 3.8, 4.53, 2.9);

    T(s, "Matched-rows check", 8.45, 3.95, 4.0, 0.35, { fontSize: 16, bold: true, color: C.text2, name: "Card heading" });
    T(s, [
      { text: `On the ${int(BUG.matched_test_rows.n_games)} test games in both datasets, a model trained on contaminated data scores the same as one trained on clean data: \u0394 Brier ${sgn(BUG.matched_test_rows.brier_diff_buggy_minus_fixed, 5)}, 95% CI ${ci(BUG.matched_test_rows.brier_diff_ci95, 5, true)}. `, options: { breakLine: false } },
      { text: "The defect corrupted the evaluation, not the model.", options: { bold: true } },
    ], 8.45, 4.4, 4.05, 2.25, { fontSize: 15, name: "Matched-rows text" });
  }

  // 19 Verification
  {
    const s = addSlide("CONTENT", "Eight safeguards make the result checkable, repeatable and robust to the two threats we found", note(
      `Beyond the two big traps, here are the safeguards that make this study checkable by someone else. One: ${DOC.tests} automated tests that pin the spread's sign convention, the median consensus, the FBS filter, the leak guard, the scoring formulas and an end-to-end run on synthetic data where the true answer is known. Two: byte-identical reruns, because every seed is fixed. Three: provenance is recorded, library versions and a SHA-256 checksum of the clean dataset, so anyone can confirm they analyze the same data. Four: the cluster bootstrap resamples whole weeks, so the intervals respect dependence. Five: every logistic fit asserts convergence, so a failed optimization can't produce a p-value. Six: independent code reviews, which caught among other things a wrong noise standard deviation in the margin model and mismatched rows between the arms of the leakage comparison. Seven: the sign-check gate. And eight: controlled reruns, so the impact of each threat is a number, not a guess.`, 1));
    const items = [
      [String(DOC.tests), "Automated tests", "Pin cleaning rules, statistics, leak guard and a synthetic end-to-end run", true],
      ["2", "Byte-identical reruns", `Fixed seed ${SEED}; same inputs give the same results.json`],
      ["3", "Recorded provenance", `Library versions and data SHA-256 (${CFG.games_parquet_sha256.slice(0, 8)}\u2026)`],
      ["4", "Cluster bootstrap", `Resamples ${V.nWeeks} season-weeks, not single games`],
      ["5", "Convergence checks", "Every logistic fit must converge before results are used"],
      ["6", "Independent code reviews", "Caught a wrong noise SD and mismatched rows between arms"],
      ["7", "Sign-check gate", "Build stops if favorites win outside 60\u201390%"],
      ["8", "Controlled reruns", "Leak and filter-defect impact measured, not assumed"],
    ];
    const cw = (CW - 0.9) / 4, h = 2.3;
    items.forEach((it, i) => {
      const col = i % 4, row = Math.floor(i / 4);
      const x = MX + col * (cw + 0.3), y = 1.85 + row * (h + 0.3);
      card(s, x, y, cw, h);
      chip(s, x + 0.25, y + 0.22, 0.6, it[0], { fill: it[3] ? C.accent2 : C.accent1, color: it[3] ? C.text1 : C.background1, size: it[0].length > 1 ? 16 : 18, name: "Safeguard chip" });
      T(s, it[1], x + 0.25, y + 1.0, cw - 0.5, 0.35, { fontSize: 15, bold: true, color: C.text2, name: "Safeguard name" });
      T(s, it[2], x + 0.25, y + 1.38, cw - 0.5, 0.85, { fontSize: 13, name: "Safeguard detail" });
    });
  }

  // ------------------------------------------------------------ CONCLUSION
  section("Conclusion");

  // 20 Limitations
  {
    const s = addSlide("CONTENT", "Four limitations bound the claim to public features, FBS-vs-FBS games and these five seasons", note(
      `Every study has limits, and I'd rather name them than have you find them. First, the closing line. The API reports a spread field and a separate opening-spread field, and I take the spread to be the closing line, but timestamps aren't available to verify that. Second, the test set spans only ${V.nWeeks} season-weeks, so the cluster-bootstrap interval is wide: the 95% interval ${V.dCI} rules out gains larger than about three thousandths of a Brier point, but smaller effects can't be ruled out. Third, public features only. Injury reports, weather, line movement and betting splits weren't available. A richer information set could carry some edge, but it would have to beat a market whose Brier already sits inside the oracle range. Fourth, scope: these are FBS-versus-FBS games from ${seasonsStr}. Finally, a word on language. I say the results are consistent with irreducible randomness, not that upsets are proven random. A Monte Carlo can only fail to find a departure from the null.`, 1));
    const lims = [
      [ICON.clock, "Closing-line definition", "The API's spread field is taken to be the closing line; timestamps cannot verify it"],
      [null, `${V.nWeeks} test weeks`, `The 95% CI ${V.dCI} rules out gains larger than about 0.003 Brier; smaller effects cannot be ruled out`, true],
      [ICON.cloud, "Public features only", "Injuries, weather, line movement and betting splits were not available"],
      [ICON.map, "Scope", `FBS-vs-FBS games, ${seasonsStr}; FCS matchups and earlier eras untested`],
    ];
    const cw = (CW - 0.3) / 2, h = 1.85;
    lims.forEach((l, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = MX + col * (cw + 0.3), y = 1.85 + row * (h + 0.25);
      card(s, x, y, cw, h);
      if (l[3]) chip(s, x + 0.3, y + 0.3, 0.8, String(V.nWeeks), { fill: C.accent2, color: C.text1, size: 24, name: "Weeks chip" });
      else iconInCircle(s, l[0], x + 0.3, y + 0.3, 0.8);
      T(s, l[1], x + 1.4, y + 0.3, cw - 1.65, 0.4, { fontSize: 18, bold: true, color: C.text2, name: "Limitation name" });
      T(s, l[2], x + 1.4, y + 0.8, cw - 1.65, 1.1, { fontSize: 14, name: "Limitation detail" });
    });
    s.addText([bold("Language discipline  "), { text: "\u201cConsistent with irreducible randomness\u201d is what the evidence supports. A Monte Carlo can fail to find a departure from the null; it cannot prove the null." }],
      { x: MX, y: 6.15, w: CW, h: 0.6, shape: SH.roundRect, rectRadius: 0.12, fill: { color: C.text2 }, color: C.background1, fontSize: 14, align: "left", valign: "middle", margin: 14, isTextBox: true, objectName: "Language note" });
  }

  // 21 Conclusion
  {
    const s = addSlide("CLOSING_DARK", "Upsets look like the expected tail of a well-priced distribution", note(
      `So, three takeaways. One: the spread is the signal. It cuts forecast error by ${V.skillSpread} against the naive baseline, a Brier of ${V.brierSpread} versus ${V.brierNaive}, and it is unbiased and well calibrated. Two: nothing public adds to it out of sample. Five extra features change the Brier score by ${V.dBrier}, with an interval that includes zero. Three: what's left looks like randomness. The upset count and the residual spread both sit inside their simulated ranges, with p-values of ${V.mcUpsetP} and ${V.mcResidP}. The implication is the headline of this slide. With a standard deviation of about ${V.sd} points around the line, the spread-only model implies a seven-point underdog wins about ${Math.round((1 - p7) * 100)} percent of the time. An upset rate of about 29 percent in 2024 isn't a sign something changed. And the methodological lesson matters as much: the biggest threats to a valid conclusion came from the data, not the model. The look-ahead leak was identified at design time and its impact measured by a rerun; the filter defect was found by the audit and then measured. Thank you.`, 1));
    const cw = 3.85, gap = (CW - 3 * cw) / 2, y = 1.85, h = 3.4;
    const tk = [
      ["1", V.skillSpread, "The spread is the signal", `Brier ${V.brierSpread} vs ${V.brierNaive} naive: lower error, unbiased and calibrated`],
      ["2", V.dBrier, "No extra feature adds to it", `Five extra features: 95% CI ${V.dCI} includes zero out of sample`],
      ["3", "p = " + V.mcUpsetP, "What remains looks random", `Upsets (p = ${V.mcUpsetP}) and residual SD (p = ${V.mcResidP}) sit inside simulated ranges`],
    ];
    tk.forEach((t, i) => {
      const x = MX + i * (cw + gap);
      chip(s, x, y, 0.6, t[0], { fill: C.accent4, size: 20 });
      T(s, t[1], x, y + 0.85, cw, 0.9, { fontSize: 44, bold: true, fontFace: HEADF, color: C.background1, valign: "middle", name: "Takeaway value" });
      T(s, t[2], x, y + 1.85, cw, 0.4, { fontSize: 18, bold: true, color: C.background1, name: "Takeaway heading" });
      T(s, t[3], x, y + 2.3, cw - 0.2, 1.1, { fontSize: 14, color: C.background2, name: "Takeaway detail" });
    });
    s.addText([bold("Implication  "), { text: `With a ${V.sd}-point SD around the line, the spread-only model implies a 7-point underdog wins about ${Math.round((1 - p7) * 100)}% of the time.` }],
      { x: MX, y: 5.5, w: CW, h: 1.15, shape: SH.roundRect, rectRadius: 0.12, fill: { color: C.accent2 }, color: C.text1, fontSize: 20, align: "left", valign: "middle", margin: 18, isTextBox: true, objectName: "Implication" });
  }

  // 22 Questions
  {
    const s = addSlide("TITLE_DARK", null, note(
      `That's the study. To recap in one sentence: the closing spread captures nearly all the predictive signal in public data, and what remains is consistent with irreducible randomness. The code, the audit log and every number are in the repository, and the backup slides after this one cover the full coefficient tables, the Monte Carlo and the two controlled reruns in detail, the reproducibility commands, and answers to the questions I expect. I'm happy to take questions now.`, 0.5));
    s.addText("Questions", { placeholder: "title" });
    s.addText("Thank you", { placeholder: "subtitle" });
    s.addText([{ text: "Tristan Morton", options: { breakLine: true } }, { text: "Repository: trism-prism/cfb-upset-study (private)" }], { placeholder: "meta" });
    chip(s, 9.0, 1.7, 3.9, "?", { fill: C.accent2, color: C.text1, size: 120, name: "Motif circle" });
  }

  // ------------------------------------------------------------ APPENDIX
  section("Appendix");
  {
    const s = addSlide("SECTION_DARK", "Appendix", note("Section break: appendix. Backup slides for questions.", 5 / 60, false));
    chip(s, 0.9, 2.7, 1.3, "", { fill: C.accent2, name: "Section chip" });
    s.addImage({ data: ICON.fileDark, x: 1.25, y: 3.05, w: 0.6, h: 0.6, altText: "document icon" });
    s.addText("Backup slides", { placeholder: "subtitle" });
  }

  // A1 coefficients
  {
    const s = addSlide("APPENDIX", "A1. In the full models the spread dominates; over/under is the only other feature with p < 0.05", note(
      `Backup: the full coefficient tables from the training seasons. The left pair of columns is the logistic model for a home win, the right pair is the linear model for the margin. The spread dominates both, with a p-value below one in a thousand. Over-under is the only other feature below five percent in both models, at p equals ${pv(H2.full_coefs.total.p, 3)} in the logit, but it doesn't survive the holdout. Prior-season team strength is borderline in the logit at ${pv(H2.full_coefs.sp_diff.p, 3)}. Its sign is negative once the spread is in the model, which reflects collinearity: the spread already prices team strength, so this is not a clean independent effect. Venue, conference and week are nowhere near significant.`, 1, false));
    const names = [["spread_home", "Spread (home)"], ["sp_diff", "Prior-season SP+ difference"], ["total", "Over/under"], ["neutral", "Neutral site"], ["conference_game", "Conference game"], ["week", "Week"], ["const", "Intercept"]];
    const fc = (x) => (Math.abs(x) < 0.05 ? num(x, 4) : num(x, 3));
    const rows = [["Feature", "Logit coef", "p", "OLS coef (margin)", "p"]];
    names.forEach(([k, label]) => rows.push([label, fc(H2.full_coefs[k].coef), pv(H2.full_coefs[k].p, 3), fc(H4.full_coefs[k].coef), pv(H4.full_coefs[k].p, 3)]));
    table(s, rows, { x: MX, y: 1.85, w: CW, colW: [4.2, 2.0, 1.5, 2.9, 1.533], rowH: 0.5, fs: 14, align: ["left", "right", "right", "right", "right"], boldFirst: true, name: "Coefficient table" });
    T(s, `Training seasons, n = ${int(H2.n_rows)} complete rows in both models. Negative sp_diff sign once the spread is included reflects collinearity: the spread already prices team strength.`, MX, 6.15, CW, 0.5, { fontSize: 12, italic: true, name: "Table note" });
  }

  // A2 Monte Carlo full table
  {
    const s = addSlide("APPENDIX", `A2. All five Monte Carlo statistics sit inside their simulated distributions (p \u2265 ${Math.min(SIM.bernoulli.upsets.p_value, SIM.normal_margin.upsets.p_value, SIM.normal_margin.resid_sd.p_value, SIM.bernoulli.brier.p_value).toFixed(2)})`, note(
      `Backup: the complete Monte Carlo table for the holdout seasons. Five rows. Upset counts under both null models: the outcome redraw gives a simulated mean of ${SIM.bernoulli.upsets.sim_mean.toFixed(1)} against ${V.mcObsUpsets} observed, and the margin redraw gives ${SIM.normal_margin.upsets.sim_mean.toFixed(1)}, with p-values of ${V.mcUpsetP} and ${pv(SIM.normal_margin.upsets.p_value)}. The residual standard deviation is ${V.sdObs} observed versus ${SIM.normal_margin.resid_sd.sim_mean.toFixed(2)} simulated. The market's Brier is ${SIM.bernoulli.brier.observed.toFixed(4)}, against a simulated mean of ${SIM.bernoulli.brier.sim_mean.toFixed(4)}. The last row is the margin-model oracle Brier, what a forecaster with the true probabilities would expect, at ${SIM.oracle_brier.mean.toFixed(4)}. All p-values are two-sided empirical p-values from ${V.mcTrials} trials.`, 1, false));
    const u = SIM.bernoulli.upsets, un = SIM.normal_margin.upsets, rs = SIM.normal_margin.resid_sd, br = SIM.bernoulli.brier, o = SIM.oracle_brier;
    table(s, [
      ["Statistic (2023\u201324)", "Observed", "Simulated mean", "Simulated 95% range", "Percentile", "Two-sided p"],
      ["Upsets (outcome redraw)", int(u.observed), u.sim_mean.toFixed(1), rng(u.sim_ci95, 0), u.percentile.toFixed(1), pv(u.p_value)],
      ["Upsets (margin redraw)", int(un.observed), un.sim_mean.toFixed(1), rng(un.sim_ci95, 0), un.percentile.toFixed(1), pv(un.p_value)],
      ["Residual SD (points)", rs.observed.toFixed(2), rs.sim_mean.toFixed(2), rng(rs.sim_ci95, 2), rs.percentile.toFixed(1), pv(rs.p_value)],
      ["Brier, spread model", br.observed.toFixed(4), br.sim_mean.toFixed(4), rng(br.sim_ci95, 4), br.percentile.toFixed(1), pv(br.p_value)],
      ["Oracle Brier (margin model)", "\u2014", o.mean.toFixed(4), rng(o.ci95, 4), "\u2014", "\u2014"],
    ], { x: MX, y: 1.85, w: CW, colW: [3.8, 1.5, 1.8, 2.3, 1.4, 1.333], rowH: 0.62, fs: 14, align: ["left", "right", "right", "right", "right", "right"], boldFirst: true, name: "Monte Carlo table" });
    T(s, `${V.mcTrials} trials per null model, seed ${SEED}, ${V.nTest} holdout games per trial. Both null models are fit on training seasons only.`, MX, 5.85, CW, 0.5, { fontSize: 12, italic: true, name: "Table note" });
  }

  // A3 filter bug table
  {
    const s = addSlide("APPENDIX", "A3. Filter defect, full before and after: the evaluation changes, the fitted model does not", note(
      `Backup: the full before-and-after table for the API filtering defect. Trusting the filter gives ${int(BUG.buggy.n_games)} games instead of ${int(BUG.fixed.n_games)}, a lower upset rate, a higher favorite win share, a larger average spread, and a spread-only Brier of ${num(BUG.buggy.spread_only_brier_all_test_rows, 3)} instead of ${num(BUG.fixed.spread_only_brier_all_test_rows, 3)}, which is the apparent skill inflation. The calibration slope barely moves, but the Hosmer-Lemeshow p-value drops from ${pv(BUG.fixed.hosmer_lemeshow_p, 3)} to ${pv(BUG.buggy.hosmer_lemeshow_p, 3)}, crossing the five percent line. The bottom line is the matched comparison on the ${int(BUG.matched_test_rows.n_games)} shared test games: a difference of ${sgn(BUG.matched_test_rows.brier_diff_buggy_minus_fixed, 5)} Brier, with a cluster-bootstrap interval around zero.`, 1, false));
    const b = BUG.buggy, f = BUG.fixed;
    table(s, [
      ["Metric", "Trusting the API filter", "After the fix"],
      ["Games (test games)", `${int(b.n_games)} (${int(b.n_test)})`, `${int(f.n_games)} (${int(f.n_test)})`],
      ["Upset rate, all seasons (test seasons)", `${pct1(b.upset_rate_all_seasons)} (${pct1(b.upset_rate_test)})`, `${pct1(f.upset_rate_all_seasons)} (${pct1(f.upset_rate_test)})`],
      ["Favorite win share", pct1(b.favorite_win_share_all_seasons), pct1(f.favorite_win_share_all_seasons)],
      ["Mean |spread| (points)", b.mean_abs_spread_all_seasons.toFixed(1), f.mean_abs_spread_all_seasons.toFixed(1)],
      ["Naive Brier (all test games)", `${num(b.naive_brier, 4)} (n = ${int(b.n_test)})`, `${num(f.naive_brier, 4)} (n = ${int(f.n_test)})`],
      ["Spread-only Brier (all test games)", `${num(b.spread_only_brier_all_test_rows, 4)} (n = ${int(b.n_test)})`, `${num(f.spread_only_brier_all_test_rows, 4)} (n = ${int(f.n_test)})`],
      ["Brier skill vs naive", pct1(b.brier_skill_spread_vs_naive), pct1(f.brier_skill_spread_vs_naive)],
      ["Calibration slope", num(b.calibration_slope, 3), num(f.calibration_slope, 3)],
      ["Hosmer\u2013Lemeshow p", pv(b.hosmer_lemeshow_p, 3), pv(f.hosmer_lemeshow_p, 3)],
    ], { x: MX, y: 1.85, w: CW, colW: [5.2, 3.5, 3.433], rowH: 0.4, fs: 13, align: ["left", "right", "right"], boldFirst: true, name: "Filter defect full table" });
    T(s, `Matched comparison, ${int(BUG.matched_test_rows.n_games)} shared test games: \u0394 Brier (contaminated minus clean model) ${sgn(BUG.matched_test_rows.brier_diff_buggy_minus_fixed, 5)}, 95% CI ${ci(BUG.matched_test_rows.brier_diff_ci95, 5, true)}. The defect corrupts the evaluation, not the model.`, MX, 6.0, CW, 0.7, { fontSize: 13, bold: true, color: C.text2, name: "Matched comparison" });
  }

  // A4 leakage table
  {
    const s = addSlide("APPENDIX", `A4. Same split, same seed, same ${int(LK.n_games)} games: only the rating's season changes, and the conclusion flips`, note(
      `Backup: the full leakage comparison. Both arms use the same split, the same seed and the same ${int(LK.n_games)} games, the ${CFG.n_games_total} minus the ${LEAK.clean_sp_diff_missing} with no prior-season rating, so the spread-only Brier is identical in both, ${num(CL.spread_only_brier, 3)}, and the entire gap comes from the rating feature. The likelihood-ratio statistic for the extra features is ${LK.h2_lr_stat.toFixed(1)} with the leak and ${CL.h2_lr_stat.toFixed(1)} without. The team-strength coefficient flips from strongly positive to borderline negative. Full-model AUC drops from ${num(LK.full_auc, 3)} to ${num(CL.full_auc, 3)}, and the multivariate R-squared from ${LK.h4_full_r2.toFixed(3)} to ${CL.h4_full_r2.toFixed(3)}. The decisive row: with the leak the full model beats the spread out of sample, without it, it does not.`, 1, false));
    table(s, [
      ["Metric (holdout unless noted)", "Leaky: same-season SP+", "Clean: prior-season SP+"],
      ["H0\u2082 likelihood-ratio statistic (df 5), train", `${LK.h2_lr_stat.toFixed(1)} (p ${pv(LK.h2_p, 3)})`, `${CL.h2_lr_stat.toFixed(1)} (p = ${pv(CL.h2_p, 3)})`],
      ["sp_diff logit coefficient (p)", `${num(LK.sp_diff_logit_coef, 3)} (p ${pv(LK.sp_diff_logit_p, 3)})`, `${num(CL.sp_diff_logit_coef, 4)} (p = ${pv(CL.sp_diff_logit_p, 3)})`],
      ["Spread-only Brier (both arms)", num(LK.spread_only_brier, 3), num(CL.spread_only_brier, 3)],
      ["Full-model Brier", num(LK.full_brier, 3), num(CL.full_brier, 3)],
      ["Full-model AUC", num(LK.full_auc, 3), num(CL.full_auc, 3)],
      ["Brier skill vs naive, full model", pct1(LK.brier_skill_full_vs_naive), pct1(CL.brier_skill_full_vs_naive)],
      ["Brier(full) \u2212 Brier(spread), 95% CI", `${sgn(LK.brier_diff_full_minus_spread, 3)} ${ci(LK.brier_diff_ci95, 3, true)}`, `${sgn(CL.brier_diff_full_minus_spread, 3)} ${ci(CL.brier_diff_ci95, 3, true)}`],
      ["Full model beats the spread out of sample?", LK.full_beats_spread_out_of_sample ? "Yes" : "No", CL.full_beats_spread_out_of_sample ? "Yes" : "No"],
      ["Multivariate OLS R\u00b2", LK.h4_full_r2.toFixed(3), CL.h4_full_r2.toFixed(3)],
    ], { x: MX, y: 1.85, w: CW, colW: [5.2, 3.5, 3.433], rowH: 0.43, fs: 13, align: ["left", "right", "right"], boldFirst: true, name: "Leakage full table" });
    T(s, `Both arms scored on ${int(LK.n_games)} matched games (${int(LK.n_test)} holdout, ${int(LK.n_train)} train); ${LEAK.n_games_dropped_by_matching} games with no prior-season rating dropped from both.`, MX, 6.25, CW, 0.4, { fontSize: 12, italic: true, name: "Table note" });
  }

  // A5 Reproducibility
  {
    const s = addSlide("APPENDIX", "A5. One command reproduces every number, and two runs give byte-identical output", note(
      `Backup: how to reproduce the study. Create a Python 3.12 virtual environment, install the pinned requirements, put your CollegeFootballData API key in a git-ignored dot-env file, and run the study script with the seasons, the seed and the number of trials. A second command runs the test suite, and a third builds the report PDF. The raw API responses are cached, so after the first run everything is offline. The run writes every reported number into one results file, plus an audit file with the data-integrity counts and the figures. The results file also records the seasons, the seed, the library versions and a SHA-256 checksum of the clean dataset, so two runs produce byte-identical output.`, 1, false));
    card(s, MX, 1.85, CW, 2.75, { fill: C.text2 });
    T(s, [
      { text: "py -3.12 -m venv .venv", options: { breakLine: true } },
      { text: ".venv/Scripts/pip install -r requirements.txt", options: { breakLine: true } },
      { text: "# put CFBD_API_KEY=<key> in .env", options: { breakLine: true } },
      { text: `.venv/Scripts/python run_study.py --seasons 2019,2021-2024 --seed ${SEED} --trials ${CFG.trials}`, options: { breakLine: true } },
      { text: ".venv/Scripts/python -m pytest -q", options: { breakLine: true } },
      { text: ".venv/Scripts/python report/build_pdf.py" },
    ], MX + 0.3, 2.05, CW - 0.6, 2.4, { fontSize: 14, fontFace: "Courier New", color: C.background1, paraSpaceAfter: 6, name: "Commands" });
    card(s, MX, 4.85, 5.9, 1.85);
    T(s, "Outputs", MX + 0.25, 5.0, 5.4, 0.35, { fontSize: 16, bold: true, color: C.text2, name: "Card heading" });
    T(s, [
      { text: "results/results.json: every number in the report", options: { bullet: true, breakLine: true } },
      { text: "results/audit.json: data-integrity counts", options: { bullet: true, breakLine: true } },
      { text: "results/figures/: the figures", options: { bullet: true } },
    ], MX + 0.25, 5.4, 5.4, 1.2, { fontSize: 14, paraSpaceAfter: 4, name: "Outputs list" });
    card(s, MX + 6.233, 4.85, 5.9, 1.85);
    T(s, "Recorded in results.json config", MX + 6.483, 5.0, 5.4, 0.35, { fontSize: 16, bold: true, color: C.text2, name: "Card heading" });
    T(s, [
      { text: `Seasons ${seasonsStr}, seed ${SEED}, ${V.mcTrials} trials`, options: { bullet: true, breakLine: true } },
      { text: "Library versions (NumPy, pandas, scikit-learn, SciPy, statsmodels)", options: { bullet: true, breakLine: true } },
      { text: `SHA-256 of the clean dataset (${CFG.games_parquet_sha256.slice(0, 8)}\u2026)`, options: { bullet: true } },
    ], MX + 6.483, 5.4, 5.4, 1.2, { fontSize: 14, paraSpaceAfter: 4, name: "Recorded list" });
  }

  // A6 Anticipated questions
  {
    const s = addSlide("APPENDIX", "A6. Anticipated questions, with short answers", note(
      `Backup: seven questions I expect, with short answers. On multiple testing: the in-sample p of ${pv(H2.p, 3)} for the extra features is marginal, and the decisive evidence is the out-of-sample Brier comparison and the Monte Carlo, not any single in-sample p-value. On why the spread is the baseline: it's the market's consensus forecast, so if public features can't beat it there's no exploitable edge. On 2020: only ${DOC.covid2020Games} usable games and many games without fans. On prior-season SP-plus: the same-season rating is computed after the games, which is look-ahead bias. On whether thirty-one test weeks is enough: the bootstrap interval is honestly wide: it rules out gains larger than about three thousandths of a Brier point, but not smaller ones. On the closing line: not timestamp-verified, but if some lines were earlier ones they would be easier to beat, and the extra features still did not beat them. Calibration is measured against whatever line the API reports. On injuries and weather: not available, and they'd have to beat a market whose Brier already sits inside the oracle range.`, 1, false));
    table(s, [
      ["Question", "Short answer"],
      ["Multiple testing? H0\u2082 p = " + pv(H2.p, 3) + " is marginal", `Agreed, and it fails out of sample (\u0394 Brier ${V.dBrier}, CI ${V.dCI}). The decisive evidence is the holdout and the Monte Carlo, not one in-sample p-value.`],
      ["Why is the spread the baseline?", "It is the market's consensus margin forecast. If public features cannot beat it, there is no exploitable edge to find."],
      ["Why exclude 2020?", `COVID cut it to ${DOC.covid2020Games} usable games, many played without crowds, which distorts home-field advantage.`],
      ["Why prior-season SP+?", `Same-season SP+ is computed after the games it would predict (look-ahead bias). ${A.sp_diff_missing} games lack a prior rating (teams with no prior-season rating) and are reported, not imputed.`],
      [`Are ${V.nWeeks} test weeks enough?`, `The cluster bootstrap resamples whole weeks, so the CI is honestly wide, ${V.dCI}. It rules out gains larger than about 0.003 Brier; smaller effects cannot be ruled out.`],
      ["Closing line not timestamp-verified?", "True. If some lines were earlier ones they would be easier to beat, and the extra features still did not beat them. Calibration is measured against whatever line the API reports."],
      ["Could injuries or weather add signal?", `Possibly; they were not available. They would have to beat a market whose Brier (${V.mcBrierObs}) already sits inside the oracle range (mean ${V.oracle}, 95% range ${V.oracleCI}).`],
    ], { x: MX, y: 1.8, w: CW, colW: [3.9, 8.233], rowH: [0.42, 0.7, 0.62, 0.62, 0.7, 0.62, 0.62, 0.7], fs: 13, boldFirst: true, name: "Anticipated questions table" });
  }

  // A7 References
  {
    const s = addSlide("APPENDIX", "A7. References", note(
      `Backup: the references. The reporting conventions follow the TRIPOD-plus-AI statement from Collins and colleagues, 2024, and Kapoor and Narayanan's 2023 paper on leakage and reproducibility in machine-learning-based science. The probability scoring uses Brier, 1950, and Murphy, 1973. The efficient-markets framing is Levitt, 2004, and Stern, 1991, for the normal approximation of margins around the spread. The slide design follows Alley's assertion-evidence approach, and the data is from CollegeFootballData.com.`, 1, false));
    card(s, MX, 1.85, CW, 4.5);
    const refs = [
      "Alley, M. The assertion-evidence approach to presentations. Pennsylvania State University.",
      "Brier, G. W. (1950). Verification of forecasts expressed in terms of probability. Monthly Weather Review.",
      "Collins, G. S., et al. (2024). TRIPOD+AI statement: updated guidance for reporting clinical prediction models that use regression or machine learning methods. BMJ.",
      "CollegeFootballData.com. College football data API. collegefootballdata.com",
      "Kapoor, S., & Narayanan, A. (2023). Leakage and the reproducibility crisis in machine-learning-based science. Patterns.",
      "Levitt, S. D. (2004). Why are gambling markets organised so differently from financial markets? The Economic Journal.",
      "Murphy, A. H. (1973). A new vector partition of the probability score. Journal of Applied Meteorology.",
      "Stern, H. (1991). On the probability of winning a football game. The American Statistician.",
    ];
    T(s, refs.map((r, i) => ({ text: r, options: i < refs.length - 1 ? { breakLine: true } : {} })), MX + 0.35, 2.1, CW - 0.7, 4.1, { fontSize: 16, paraSpaceAfter: 10, name: "Reference list" });
  }

  // ---------------------------------------------------------------- write
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log(`wrote ${OUT}; main-deck speaking time ~${MAIN_MINUTES.toFixed(1)} min`);
  for (const [a, b] of [[1, 4], [5, 9], [10, 12], [13, 17], [18, 23], [24, 26]]) console.log(`slides ${a}-${b}: ${(NOTE_LOG.slice(a - 1, b).reduce((t, n) => t + n.sec, 0) / 60).toFixed(2)} min`);
}

main().catch((e) => { console.error(e); process.exit(1); });
