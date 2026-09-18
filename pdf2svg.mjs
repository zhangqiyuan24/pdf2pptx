// pdf2svg.mjs — 将单页矢量 PDF 转成可编辑 SVG（路径保持矢量、文字保持文本、位图内嵌 PNG）
// 用法: node pdf2svg.mjs <input.pdf> <output.svg>
import * as mupdf from "mupdf";
import fs from "fs";

/* ---------- 矩阵工具（PDF 约定 [a,b,c,d,e,f]） ---------- */
const MA = (m) => (m.a !== undefined ? [m.a, m.b, m.c, m.d, m.e, m.f] : [m[0], m[1], m[2], m[3], m[4], m[5]]);
// comp(m1, m2)：先应用 m2，再应用 m1（与 apply() 语义一致）
function comp(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function inv(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return [1, 0, 0, 1, 0, 0];
  return [
    m[3] / det, -m[1] / det,
    -m[2] / det, m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}
const R = (v) => Math.round(v * 100) / 100;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fx = (n) => (Number.isInteger(n) ? String(n) : String(R(n)));

/* ---------- 颜色 ---------- */
function toRGB(cs, color) {
  const name = cs?.getName?.() ?? "";
  const n = color?.length ?? 0;
  if (n === 3) return `rgb(${color.map((v) => Math.round(v * 255)).join(",")})`;
  if (n === 1) { const g = Math.round(color[0] * 255); return `rgb(${g},${g},${g})`; }
  if (n === 4) { // CMYK 近似
    const [c, m, y, k] = color;
    return `rgb(${Math.round(255 * (1 - c) * (1 - k))},${Math.round(255 * (1 - m) * (1 - k))},${Math.round(255 * (1 - y) * (1 - k))})`;
  }
  return "rgb(0,0,0)";
}

/* ---------- 字体族映射 ---------- */
function fontFamily(font) {
  let name = (font?.getName?.() ?? "").replace(/^[A-Z]{6}\+/, "");
  const base = name.replace(/(PS|MT)?(-?Bold|[-,]Ita?lic|,Bold|Oblique)?$/i, "").replace(/PSMT$/, "");
  const map = {
    TimesNewRoman: "Times New Roman", TimesNewRomanPS: "Times New Roman",
    Arial: "Arial", ArialMT: "Arial", Helvetica: "Arial", HelveticaNeue: "Arial",
    SimSun: "SimSun", 宋体: "SimSun", SimHei: "SimHei", 黑体: "SimHei",
    MicrosoftYaHei: "Microsoft YaHei", 微软雅黑: "Microsoft YaHei",
    KaiTi: "KaiTi", 楷体: "KaiTi", FangSong: "FangSong", 仿宋: "FangSong",
    STKaiti: "KaiTi", CambriaMath: "Cambria Math", STSong: "SimSun", STFangsong: "FangSong",
  };
  const fam = map[base] ?? map[name] ?? name.replace(/[-,]/g, " ");
  const serif = /Times|Serif|SimSun|宋|KaiTi|楷|FangSong|仿|Song/i.test(fam) ? ", serif" : ", sans-serif";
  return { family: `"${fam}"${serif}`, isBold: !!font?.isBold?.() || /bold/i.test(name), isItalic: !!font?.isItalic?.() || /ital|oblique/i.test(name) };
}

/* ---------- 路径收集 ---------- */
function pathToD(path, ctm, flip) {
  let d = "";
  path.walk({
    moveTo(x, y) { const [X, Y] = flip(apply(ctm, x, y)); d += `M${fx(X)} ${fx(Y)}`; },
    lineTo(x, y) { const [X, Y] = flip(apply(ctm, x, y)); d += `L${fx(X)} ${fx(Y)}`; },
    curveTo(x1, y1, x2, y2, x3, y3) {
      const [a, b] = flip(apply(ctm, x1, y1)), [c, e] = flip(apply(ctm, x2, y2)), [g, h] = flip(apply(ctm, x3, y3));
      d += `C${fx(a)} ${fx(b)} ${fx(c)} ${fx(e)} ${fx(g)} ${fx(h)}`;
    },
    closePath() { d += "Z"; },
  });
  return d;
}
function strokeAttrs(stroke, ctm) {
  const s = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) || 1;
  const w = stroke.getLineWidth();
  let a = `fill="none" stroke-width="${fx(w * s)}"`;
  const cap = stroke.getLineCap(), join = stroke.getLineJoin();
  if (cap) a += ` stroke-linecap="${["butt", "round", "square", "butt"][cap] ?? "butt"}"`;
  if (join) a += ` stroke-linejoin="${["miter", "round", "bevel", "miter"][join] ?? "miter"}"`;
  const dashes = stroke.getDashes?.() ?? [];
  if (dashes.length) a += ` stroke-dasharray="${dashes.map((v) => fx(v * s)).join(" ")}"`;
  return { s, attrs: a };
}

/* ---------- 主流程 ---------- */
const [,, inPath, outPath] = process.argv;
const buf = fs.readFileSync(inPath);
const doc = mupdf.Document.openDocument(buf, "application/pdf");
const page = doc.loadPage(0);
const bounds = page.getBounds();
const bx0 = bounds.x0 ?? bounds[0], by0 = bounds.y0 ?? bounds[1], bx1 = bounds.x1 ?? bounds[2], by1 = bounds.y1 ?? bounds[3];
const W = R(bx1 - bx0), H = R(by1 - by0);
// 注意：page.run 交给 Device 的 ctm 已是 y-down 设备空间（MATLAB/PPT 导出的 PDF 内容按 y-down 绘制），
// 与 SVG 坐标约定一致，直接平移原点即可，不能再做 y 翻转（否则整体垂直镜像）。
const flip = (p) => [p[0] - bx0, p[1] - by0];

const defs = [];
let out = [];
let maskBuf = null;      // 非 null 时内容进 mask
const clipStack = [];    // 每项: 'g'（clip/mask 组）| 'og'（普通 group）
let idN = 0;
const nid = (p) => `${p}${++idN}`;
const stats = { fillPath: 0, strokePath: 0, text: 0, glyph: 0, image: 0, imageMask: 0, shade: 0, tile: 0, mask: 0, clipPath: 0, clipStrokePath: 0, clipText: 0, group: 0, warnings: [] };

function target() { return maskBuf ? maskBuf.body : out; }

function emitTextRun(run, color, alpha) {
  // run: { glyphs: [{uni, M(设备空间)}], font }；M = comp(ctm, trm)，ctm 已 y-down，trm 的 d=-fs 同为 y-down，直接平移
  const { family, isBold, isItalic } = fontFamily(run.font);
  const V = [1, 0, 0, 1, -bx0, -by0];
  const Ts = run.glyphs.map((g) => comp(V, g.M)); // 屏幕空间文字矩阵
  const T0 = Ts[0];
  const fsz = Math.hypot(T0[2], T0[3]) || Math.hypot(T0[0], T0[1]) || 1;
  const rot = Math.atan2(T0[1], T0[0]); // 屏幕空间基线角
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const body = run.glyphs.map((g, i) => {
    const dx = Ts[i][4] - T0[4], dy = Ts[i][5] - T0[5];
    const lx = cos * dx + sin * dy, ly = -sin * dx + cos * dy;
    return `<tspan x="${fx(lx)}" y="${fx(ly)}">${esc(g.uni ?? "")}</tspan>`;
  }).join("");
  const deg = R(rot * 180 / Math.PI);
  const tr = `translate(${fx(T0[4])},${fx(T0[5])})${deg ? ` rotate(${deg})` : ""}`;
  const fw = isBold ? ` font-weight="bold"` : "";
  const fi = isItalic ? ` font-style="italic"` : "";
  const op = alpha < 1 ? ` opacity="${R(alpha)}"` : "";
  target().push(`<text transform="${tr}" font-family='${family}' font-size="${fx(fsz)}" fill="${color}"${fw}${fi}${op}>${body}</text>`);
}

function drawImageEl(image, ctm, alpha, color, isMask, maskId) {
  const pix = image.toPixmap(mupdf.ColorSpace.DeviceRGB, true);
  const b64 = Buffer.from(pix.asPNG()).toString("base64");
  pix.destroy?.();
  // 实测：mupdf 将位图行0画在 ctm 的 y=0 端（与设备空间 y-down 一致），
  // SVG <image> 也是行0在元素顶部 → 直接用 ctm（仅平移页面原点），无需翻转
  const full = comp([1, 0, 0, 1, -bx0, -by0], MA(ctm));
  const op = alpha < 1 ? ` opacity="${R(alpha)}"` : "";
  return `<image x="0" y="0" width="1" height="1" transform="matrix(${full.map(fx).join(" ")})" preserveAspectRatio="none" href="data:image/png;base64,${b64}"${op}/>`;
}

const device = new mupdf.Device({
  fillPath(path, evenOdd, ctm, cs, color, alpha) {
    stats.fillPath++;
    const d = pathToD(path, MA(ctm), flip);
    const op = alpha < 1 ? ` fill-opacity="${R(alpha)}"` : "";
    target().push(`<path d="${d}" fill="${toRGB(cs, color)}"${evenOdd ? ' fill-rule="evenodd"' : ""}${op}/>`);
  },
  strokePath(path, stroke, ctm, cs, color, alpha) {
    stats.strokePath++;
    const d = pathToD(path, MA(ctm), flip);
    const { attrs } = strokeAttrs(stroke, MA(ctm));
    const op = alpha < 1 ? ` stroke-opacity="${R(alpha)}"` : "";
    target().push(`<path d="${d}" stroke="${toRGB(cs, color)}" ${attrs}${op}/>`);
  },
  clipPath(path, evenOdd, ctm) {
    stats.clipPath++;
    const id = nid("c");
    defs.push(`<clipPath id="${id}"><path d="${pathToD(path, MA(ctm), flip)}"${evenOdd ? ' fill-rule="evenodd"' : ""}/></clipPath>`);
    target().push(`<g clip-path="url(#${id})">`);
    clipStack.push("g");
    return true;
  },
  clipStrokePath(path, stroke, ctm) {
    stats.clipStrokePath++;
    const id = nid("m");
    const { attrs } = strokeAttrs(stroke, MA(ctm));
    defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="${0}" y="${0}" width="${W}" height="${H}"><path d="${pathToD(path, MA(ctm), flip)}" stroke="#fff" ${attrs}/></mask>`);
    target().push(`<g mask="url(#${id})">`);
    clipStack.push("g");
    return true;
  },
  clipText(text, ctm) {
    stats.clipText++;
    const id = nid("m");
    const save = out; out = [];
    collectText(text, ctm, "#fff", 1);
    defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">${out.join("")}</mask>`);
    out = save;
    target().push(`<g mask="url(#${id})">`);
    clipStack.push("g");
    return true;
  },
  clipImageMask(image, ctm) { stats.warnings.push("clipImageMask 未实现"); return true; },
  fillText(text, ctm, cs, color, alpha) {
    stats.text++;
    collectText(text, ctm, toRGB(cs, color), alpha);
  },
  strokeText(text, stroke, ctm, cs, color, alpha) {
    stats.text++;
    // 描边文字：近似为填充（学术图中罕见）
    stats.warnings.push("strokeText 按填充处理");
    collectText(text, ctm, toRGB(cs, color), 1);
  },
  ignoreText() {},
  fillShade(shade, ctm, alpha) {
    stats.shade++;
    stats.warnings.push("含 shade 渐变");
  },
  fillImage(image, ctm, alpha) {
    stats.image++;
    target().push(drawImageEl(image, ctm, alpha));
  },
  fillImageMask(image, ctm, cs, color, alpha) {
    stats.imageMask++;
    const mid = nid("m");
    const el = drawImageEl(image, ctm, 1);
    defs.push(`<mask id="${mid}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">${el}</mask>`);
    const [x0, y0] = flip(apply(MA(ctm), 0, 0)), [x1, y1] = flip(apply(MA(ctm), 1, 1));
    const op = alpha < 1 ? ` opacity="${R(alpha)}"` : "";
    target().push(`<rect x="${fx(Math.min(x0, x1))}" y="${fx(Math.min(y0, y1))}" width="${fx(Math.abs(x1 - x0))}" height="${fx(Math.abs(y1 - y0))}" fill="${toRGB(cs, color)}" mask="url(#${mid})"${op}/>`);
  },
  popClip() { target().push(`</g>`); clipStack.pop(); },
  beginMask(bbox, luminosity, cs, color) {
    stats.mask++;
    maskBuf = { body: [], luminosity };
    return true;
  },
  endMask() {
    const id = nid("m");
    const lc = maskBuf.luminosity ? ' mask-type="luminance"' : "";
    defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"${lc}>${maskBuf.body.join("")}</mask>`);
    maskBuf = null;
    out.push(`<g mask="url(#${id})">`);
    clipStack.push("g");
  },
  beginGroup(bbox, cs, isolated, knockout, blendmode, alpha) {
    stats.group++;
    let a = "";
    if (alpha < 1) a += ` opacity="${R(alpha)}"`;
    if (blendmode && blendmode !== "Normal") a += ` style="mix-blend-mode:${blendmode.toLowerCase().replace(/[^a-z]/g, "")}"`;
    target().push(`<g${a}>`);
    clipStack.push("og");
    return true;
  },
  endGroup() { target().push(`</g>`); clipStack.pop(); },
  beginTile() { stats.tile++; stats.warnings.push("含 pattern tile"); return 0; },
  endTile() {},
});

function collectText(text, ctm, color, alpha) {
  const M = MA(ctm);
  let run = null;
  text.walk({
    beginSpan(font, trm, wmode, bidi, dir) { run = { font, wmode, glyphs: [] }; },
    showGlyph(font, trm, glyph, unicode, wmode, bidi) {
      stats.glyph++;
      const m = comp(M, MA(trm));
      run.glyphs.push({ uni: unicode >= 32 ? String.fromCodePoint(unicode) : "", M: m });
    },
    endSpan() {
      if (run && run.glyphs.length) emitTextRun(run, color, alpha);
      run = null;
    },
  });
}

page.run(device, mupdf.Matrix.identity);
for (const t of clipStack) out.push(`</g>`);
out.push(`</g>`.repeat(0));

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>${defs.join("")}</defs>
<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>
${out.join("\n")}
</svg>`;
fs.writeFileSync(outPath, svg);
console.log(JSON.stringify({ file: inPath.split(/[\\/]/).pop(), size: svg.length, ...stats }));
