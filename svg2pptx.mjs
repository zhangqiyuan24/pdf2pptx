// svg2pptx.mjs — 把 pdf2svg.mjs 产出的 SVG 直接转成原生可编辑 .pptx（不经 PowerPoint）
// 路径→custGeom 自由形状 | 文字→文本框 | 位图→嵌入 PNG 图片
// 用法: node svg2pptx.mjs <输入.svg 可多个或目录> -o 输出.pptx
import fs from "fs";
import path from "path";

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
let out = "out.pptx";
let SPLIT = false; // --split: 每个 SVG 一个独立 pptx，页面尺寸严格等于图尺寸（-o 为输出目录）
const inputs = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "-o") out = argv[++i];
  else if (argv[i] === "--split") SPLIT = true;
  else inputs.push(argv[i]);
}
if (!inputs.length) { console.error("用法: node svg2pptx.mjs <svg...|目录> -o out.pptx [--split]"); process.exit(1); }
const files = [];
for (const p of inputs) {
  const ap = path.resolve(p);
  if (fs.statSync(ap).isDirectory()) files.push(...fs.readdirSync(ap).filter(f => f.endsWith(".svg")).sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true })).map(f => path.join(ap, f)));
  else files.push(ap);
}

/* ---------- 常量 ---------- */
const EMU = 12700;                 // 1pt = 12700 EMU
const SLIDE_W = 13.333 * 72;       // pt
const SLIDE_H = 7.5 * 72;
const MARGIN = 18;                 // pt
const slideWemu = Math.round(SLIDE_W * EMU), slideHemu = Math.round(SLIDE_H * EMU);

/* ---------- 极简 XML 解析（解析自己生成的受控 SVG 足够） ---------- */
function parseXML(src) {
  let i = 0;
  function parseNode() {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== "<") throw new Error("期望 < 于 " + i + " 附近: " + src.slice(Math.max(0, i - 40), i + 20));
    i++; // '<'
    if (src[i] === "?") { i = src.indexOf("?>", i) + 2; return parseNode(); }
    if (src[i] === "!") { i = src.indexOf(">", i) + 1; return parseNode(); }
    let tag = "";
    while (i < src.length && !/[\s/>]/.test(src[i])) tag += src[i++];
    const attrs = {};
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] === ">" || src[i] === "/" || i >= src.length) break;
      let k = "";
      while (i < src.length && !/[\s=/>]/.test(src[i])) k += src[i++];
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] === "=") {
        i++;
        while (i < src.length && /\s/.test(src[i])) i++;
        const q = src[i]; i++;
        let v = "";
        while (src[i] !== q) v += src[i++];
        i++;
        attrs[k] = v.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
      } else attrs[k] = "";
    }
    const node = { tag, attrs, children: [], texts: [] };
    if (src[i] === "/") { i += 2; return node; }
    i++; // '>'
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (i >= src.length) return node;
      if (src[i] === "<" && src[i + 1] === "/") { i = src.indexOf(">", i) + 1; return node; }
      if (src[i] === "<") node.children.push(parseNode());
      else { // 裸文本
        let t = "";
        while (i < src.length && src[i] !== "<") t += src[i++];
        node.texts.push(t);
      }
    }
  }
  return parseNode();
}

/* ---------- 路径 d → pathLst（坐标已减去自身 bbox 原点） ---------- */
function dToPath(d, px, py) {
  // px/py: SVG页面坐标 → path 局部坐标 的映射（含 bbox 平移与缩放）
  const toks = d.match(/[MLCZ]|-?\d+(?:\.\d+)?/g);
  if (!toks) return null;
  const subs = []; let cur = null; let p = 0;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const track = (x, y) => { if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y; };
  // 第一遍：bbox（含控制点，足够）
  { let q = 0;
    while (q < toks.length) {
      const t = toks[q++];
      if (t === "M" || t === "L") { track(+toks[q], +toks[q + 1]); q += 2; }
      else if (t === "C") { for (let k = 0; k < 6; k += 2) track(+toks[q + k], +toks[q + k + 1]); q += 6; }
    }
  }
  if (minx === Infinity) return null;
  const bbox = [minx, miny, maxx, maxy];
  // 第二遍：局部坐标 pathLst
  const pt = (x, y) => `<a:pt x="${Math.round(px(x - minx))}" y="${Math.round(py(y - miny))}"/>`;
  while (p < toks.length) {
    const t = toks[p++];
    if (t === "M") { cur = [`<a:moveTo>${pt(+toks[p], +toks[p + 1])}</a:moveTo>`]; subs.push(cur); p += 2; }
    else if (t === "L") { cur.push(`<a:lnTo>${pt(+toks[p], +toks[p + 1])}</a:lnTo>`); p += 2; }
    else if (t === "C") { cur.push(`<a:cubicBezTo>${pt(+toks[p], +toks[p + 1])}${pt(+toks[p + 2], +toks[p + 3])}${pt(+toks[p + 4], +toks[p + 5])}</a:cubicBezTo>`); p += 6; }
    else if (t === "Z") cur.push(`<a:close/>`);
  }
  return { xml: subs.map(s => s.join("")).join(""), bbox };
}

/* ---------- 颜色 / 虚线 / 转义 ---------- */
const rgb6 = (c) => { const m = String(c).match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/); if (!m) return "000000"; const h = (v) => (+v).toString(16).padStart(2, "0"); return h(m[1]) + h(m[2]) + h(m[3]); };
function prstDash(arr) {
  if (!arr || !arr.length) return "";
  const [a, b] = arr;
  const r = a / (b || a);
  if (r < 0.55) return "sysDash";
  if (r > 1.8) return "lgDash";
  return "dash";
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------- 单个 SVG → slide XML（media/rels 为全局/页级累积器） ---------- */
let shapeId = 0;
function convertFigure(svgPath, media, rels, exact = false) {
  shapeId = 1; // id=1 是 spTree 根
  const nid = (name) => `id="${++shapeId}" name="${esc(name)}"`;
  const src = fs.readFileSync(svgPath, "utf8");
  const root = parseXML(src);
  const W = +root.attrs.width, H = +root.attrs.height;
  // exact=true（--split）：页面尺寸严格等于图尺寸，不缩放不平移
  let s, ox, oy, slideWemu, slideHemu;
  if (exact) {
    s = 1; ox = 0; oy = 0;
    slideWemu = Math.max(1, Math.round(W * EMU)); slideHemu = Math.max(1, Math.round(H * EMU));
  } else {
    s = Math.min((SLIDE_W - 2 * MARGIN) / W, (SLIDE_H - 2 * MARGIN) / H, 1.5);
    ox = (SLIDE_W - W * s) / 2; oy = (SLIDE_H - H * s) / 2;
    slideWemu = Math.round(SLIDE_W * EMU); slideHemu = Math.round(SLIDE_H * EMU);
  }
  const X = (x) => (ox + x * s) * EMU;   // SVG pt → 页面 EMU
  const Y = (y) => (oy + y * s) * EMU;
  const S = (v) => v * s * EMU;          // 长度 → EMU
  const stats = { sp: 0, text: 0, pic: 0 };
  const shapes = [];

  function walk(node) {
    for (const el of node.children) {
      if (el.tag === "g") { walk(el); continue; }
      if (el.tag === "defs" || el.tag === "rect") continue;   // 白底矩形由幻灯片背景承担
      if (el.tag === "path") { emitPath(el); continue; }
      if (el.tag === "text") { emitText(el); continue; }
      if (el.tag === "image") { emitImage(el); continue; }
    }
  }

  function emitPath(el) {
    const d = dToPath(el.attrs.d, S, S);
    if (!d) return;
    const fill = el.attrs.fill, stroke = el.attrs.stroke;
    const isFill = fill && fill !== "none";
    const [bx, by, bx2, by2] = d.bbox;
    const offx = Math.round(X(bx)), offy = Math.round(Y(by));
    const extx = Math.max(3175, Math.round(S(bx2 - bx))), exty = Math.max(3175, Math.round(S(by2 - by)));
    let fillXml = "<a:noFill/>";
    if (isFill) {
      const fo = +(el.attrs["fill-opacity"] ?? 1);
      fillXml = `<a:solidFill><a:srgbClr val="${rgb6(fill)}">${fo < 1 ? `<a:alpha val="${Math.round(fo * 100000)}"/>` : ""}</a:srgbClr></a:solidFill>`;
    }
    let lnXml = "";
    if (stroke && stroke !== "none") {
      const w = Math.max(317, Math.round(S(+(el.attrs["stroke-width"] ?? 1))));
      const cap = { butt: "flat", round: "rnd", square: "sq" }[el.attrs["stroke-linecap"] ?? "butt"] ?? "flat";
      const dash = prstDash((el.attrs["stroke-dasharray"] ?? "").split(/[\s,]+/).filter(Boolean).map(Number));
      const so = +(el.attrs["stroke-opacity"] ?? 1);
      lnXml = `<a:ln w="${w}" cap="${cap}"><a:solidFill><a:srgbClr val="${rgb6(stroke)}">${so < 1 ? `<a:alpha val="${Math.round(so * 100000)}"/>` : ""}</a:srgbClr></a:solidFill>${dash ? `<a:prstDash val="${dash}"/>` : ""}</a:ln>`;
    }
    stats.sp++;
    shapes.push(`<p:sp><p:nvSpPr><p:cNvPr ${nid(isFill ? "填充" : "线条")}/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${offx}" y="${offy}"/><a:ext cx="${extx}" cy="${exty}"/></a:xfrm><a:custGeom><a:avLst/><a:gdLst/><a:rect l="0" t="0" r="0" b="0"/><a:pathLst><a:path w="${extx}" h="${exty}"${isFill ? "" : ' fill="none"'}>${d.xml}</a:path></a:pathLst></a:custGeom>${fillXml}${lnXml}</p:spPr></p:sp>`);
  }

  function emitText(el) {
    // <text transform="translate(x,y)[ rotate(deg)]" font-size=f fill=c> <tspan x dx y dy>字</tspan>... </text>
    // 一个 <text> 可能含多行（tspan 的 y 不同）甚至多个不相邻标签（x 有大空隙）：
    // 先按 y 聚簇分行（容差 0.55fsz），行内按 x 排序、空隙 >1.2fsz 分段，每段独立文本框
    const tr = el.attrs.transform ?? "";
    const m1 = tr.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
    const m2 = tr.match(/rotate\(([-\d.]+)\)/);
    const x0 = +(m1?.[1] ?? 0), y0 = +(m1?.[2] ?? 0), deg = +(m2?.[1] ?? 0);
    const fsz = +el.attrs["font-size"] || 12;
    const color = rgb6(el.attrs.fill ?? "rgb(0,0,0)");
    const famAttr = (el.attrs["font-family"] ?? "").replace(/['"]/g, "");
    const fam = famAttr.split(",")[0].trim();
    const isCJK = /SimSun|SimHei|KaiTi|FangSong|YaHei|Song|Hei/i.test(fam);
    const op = +(el.attrs.opacity ?? 1);
    const spans = el.children.filter(c => c.tag === "tspan");
    if (!spans.length) return;
    const glyphTxt = (sp) => (sp.texts.join("") || "");
    const estW = (ch) => ch.codePointAt(0) > 0x2e7f ? fsz : fsz * 0.55;

    // 分行：y 相近（≤0.55fsz）的 tspan 归为同一行（上下标偏移 ~0.35fsz 不会被拆开）
    const glyphs = spans.map(sp => ({ x: +sp.attrs.x, y: +sp.attrs.y, t: glyphTxt(sp) })).filter(g => g.t);
    if (!glyphs.length) return;
    glyphs.sort((a, b) => a.y - b.y || a.x - b.x);
    const tol = 0.55 * fsz;
    const rows = [];
    for (const g of glyphs) {
      const r = rows[rows.length - 1];
      if (r && g.y - r.yMax <= tol) { r.items.push(g); r.yMax = Math.max(r.yMax, g.y); }
      else rows.push({ items: [g], yMax: g.y });
    }
    // 行内分段：与当前段末尾 x 距离 >1.2fsz 视为另一个标签
    const runs = [];
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let cur = null;
      for (const g of r.items) {
        if (cur && Math.abs(g.x - cur.endX) <= 1.2 * fsz) {
          cur.text += g.t;
          if (g.x < cur.minX) cur.minX = g.x;
          if (g.x > cur.maxX) cur.maxX = g.x;
          cur.endX = g.x + estW(g.t.slice(-1));
          cur.ySum += g.y; cur.n++;
        } else {
          cur = { text: g.t, x0: g.x, minX: g.x, maxX: g.x, endX: g.x + estW(g.t.slice(-1)), ySum: g.y, n: 1 };
          runs.push(cur);
        }
      }
    }

    const bold = el.attrs["font-weight"] === "bold" ? ' b="1"' : "";
    const ital = el.attrs["font-style"] === "italic" ? ' i="1"' : "";
    const sz = Math.max(100, Math.round(fsz * s * 100));
    const rot = Math.abs(deg) < 0.1 ? 0 : Math.round((((deg % 360) + 360) % 360) * 60000);
    const rad = deg * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);

    for (const run of runs) {
      const text = run.text;
      if (!text.trim()) continue;
      // 宽度估算：CJK 1em / ASCII 0.55em；多字时用实际 x 跨度兜底
      let wpt = 0;
      for (const ch of text) wpt += estW(ch);
      if (run.n > 1) wpt = Math.max(wpt, run.maxX - run.minX + fsz * 0.6);
      // 文本框角点：基线在框顶 0.85*fsz 处。(lx,ly) 是局部坐标锚点，须与角点偏移一起整体旋转
      const lx = run.x0, ly = run.ySum / run.n;
      const corners = [[0, -0.85 * fsz], [wpt, -0.85 * fsz], [wpt, 0.25 * fsz], [0, 0.25 * fsz]];
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const [cx0, cy0] of corners) {
        const px = x0 + (lx + cx0) * cos - (ly + cy0) * sin, py = y0 + (lx + cx0) * sin + (ly + cy0) * cos;
        if (px < minx) minx = px; if (py < miny) miny = py; if (px > maxx) maxx = px; if (py > maxy) maxy = py;
      }
      // OOXML 语义: off/ext 是旋转前的矩形，PowerPoint 绕其中心旋转 → 用视觉 aabbox 中心 + 旋转前宽高
      const vcx = (minx + maxx) / 2, vcy = (miny + maxy) / 2;
      const offx = Math.round(X(vcx - wpt / 2)), offy = Math.round(Y(vcy - 1.1 * fsz / 2));
      const extx = Math.max(3175, Math.round(S(wpt))), exty = Math.max(3175, Math.round(S(1.1 * fsz)));
      stats.text++;
      shapes.push(`<p:sp><p:nvSpPr><p:cNvPr ${nid("文本")}/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm${rot ? ` rot="${rot}"` : ""}><a:off x="${offx}" y="${offy}"/><a:ext cx="${extx}" cy="${exty}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"/><a:lstStyle/><a:p><a:pPr algn="l"/><a:r><a:rPr lang="zh-CN" sz="${sz}"${bold}${ital} dirty="0"><a:solidFill><a:srgbClr val="${color}">${op < 1 ? `<a:alpha val="${Math.round(op * 100000)}"/>` : ""}</a:srgbClr></a:solidFill><a:latin typeface="${esc(fam)}"/><a:ea typeface="${esc(isCJK ? fam : "SimSun")}"/></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></p:txBody></p:sp>`);
    }
  }

  function emitImage(el) {
    const m = el.attrs.transform.match(/matrix\(([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\)/);
    const href = el.attrs.href ?? el.attrs["xlink:href"] ?? "";
    if (!m || !href.startsWith("data:")) return;
    const [a, b, c, dd, e, f] = m.slice(1).map(Number);
    const buf = Buffer.from(href.slice(href.indexOf("base64,") + 7), "base64");
    const fn = `image${media.length + 1}.png`;
    media.push({ name: fn, buf });
    const rId = `rId${rels.length + 2}`; // rId1 已被 slideLayout 占用
    rels.push({ id: rId, target: `../media/${fn}` });
    const alpha = +(el.attrs.opacity ?? 1);
    // 单位方形四角经矩阵映射
    const corners = [[0, 0], [a, b], [a + c, b + dd], [c, dd]].map(([dx0, dy0]) => [e + dx0, f + dy0]);
    const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
    const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    const theta = Math.atan2(b, a);          // u 向量角
    const phi = Math.atan2(dd, c);           // v 向量角
    let skew = Math.abs(((phi - theta) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI / 2);
    skew = Math.min(skew, Math.PI - skew);   // 折到 [0,90°]
    let offx = Math.round(X(minx)), offy = Math.round(Y(miny));
    let extx = Math.max(3175, Math.round(S(maxx - minx))), exty = Math.max(3175, Math.round(S(maxy - miny)));
    let rot = 0, flipH = "", flipV = "";
    if (skew < 0.05) {
      // 纯旋转/缩放/翻转：off/ext 用旋转前矩形（视觉 aabbox 中心 ± 旋转前宽高一半），PowerPoint 绕中心转
      const preW = Math.hypot(a, b), preH = Math.hypot(c, dd);
      offx = Math.round(X((minx + maxx) / 2 - preW / 2));
      offy = Math.round(Y((miny + maxy) / 2 - preH / 2));
      extx = Math.max(3175, Math.round(S(preW)));
      exty = Math.max(3175, Math.round(S(preH)));
      const deg = theta * 180 / Math.PI;
      if (Math.abs(deg) > 0.05) rot = Math.round((((deg % 360) + 360) % 360) * 60000);
      if (a * dd - b * c < 0) flipV = ' flipV="1"'; // 行列式<0：镜像（近似用垂直翻转）
    }
    stats.pic++;
    shapes.push(`<p:pic><p:nvPicPr><p:cNvPr ${nid("位图")}/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rId}"${alpha < 1 ? `><a:alphaModFix amt="${Math.round(alpha * 100000)}"/></a:blip>` : "/>"}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm${rot ? ` rot="${rot}"` : ""}${flipH}${flipV}><a:off x="${offx}" y="${offy}"/><a:ext cx="${extx}" cy="${exty}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
  }

  walk(root);
  return { wemu: slideWemu, hemu: slideHemu, slide: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${slideWemu}" cy="${slideHemu}"/><a:chOff x="0" y="0"/><a:chExt cx="${slideWemu}" cy="${slideHemu}"/></a:xfrm></p:grpSpPr>${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`, stats };
}

/* ---------- store-only zip ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
class ZipWriter {
  constructor() { this.entries = []; }
  add(name, data) { this.entries.push({ name, buf: Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8") }); }
  buffer() {
    const parts = [], central = [];
    let offset = 0;
    for (const e of this.entries) {
      const nameB = Buffer.from(e.name, "utf8");
      const crc = crc32(e.buf);
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
      lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(e.buf.length, 18); lh.writeUInt32LE(e.buf.length, 22);
      lh.writeUInt16LE(nameB.length, 26);
      parts.push(lh, nameB, e.buf);
      central.push({ nameB, crc, size: e.buf.length, offset });
      offset += 30 + nameB.length + e.buf.length;
    }
    let cdSize = 0;
    for (const c of central) {
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
      ch.writeUInt32LE(c.crc, 16); ch.writeUInt32LE(c.size, 20); ch.writeUInt32LE(c.size, 24);
      ch.writeUInt16LE(c.nameB.length, 28); ch.writeUInt32LE(c.offset, 42);
      parts.push(ch, c.nameB);
      cdSize += 46 + c.nameB.length;
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(central.length, 8); eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(offset, 16);
    parts.push(eocd);
    return Buffer.concat(parts);
  }
}

/* ---------- 静态部件 ---------- */
const CT = (slides) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`;

const RELS_ROOT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`;

const presentationXml = (n, cx, cy) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${Array.from({ length: n }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="${cy}" cy="${cx}"/></p:presentation>`;

const presRels = (n) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${Array.from({ length: n }, (_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`;

const masterXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

const masterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`;

const layoutXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="空白"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const layoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;

const themeXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="空白"><a:themeElements><a:clrScheme name="办公室"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="办公室"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="办公室"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

/* ---------- 主流程 ---------- */
function buildPptx(slides, slidesRels, media, cx, cy, outFile) {
  const zip = new ZipWriter();
  const n = slides.length;
  zip.add("[Content_Types].xml", CT(slides));
  zip.add("_rels/.rels", RELS_ROOT);
  zip.add("ppt/presentation.xml", presentationXml(n, cx, cy));
  zip.add("ppt/_rels/presentation.xml.rels", presRels(n));
  zip.add("ppt/theme/theme1.xml", themeXml);
  zip.add("ppt/slideMasters/slideMaster1.xml", masterXml);
  zip.add("ppt/slideMasters/_rels/slideMaster1.xml.rels", masterRels);
  zip.add("ppt/slideLayouts/slideLayout1.xml", layoutXml);
  zip.add("ppt/slideLayouts/_rels/slideLayout1.xml.rels", layoutRels);
  slides.forEach((s, i) => zip.add(`ppt/slides/slide${i + 1}.xml`, s));
  slidesRels.forEach((r, i) => zip.add(`ppt/slides/_rels/slide${i + 1}.xml.rels`, r));
  for (const m of media) zip.add(`ppt/media/${m.name}`, m.buf);
  fs.writeFileSync(outFile, zip.buffer());
}

const relsXml = (rels) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${rels.map(r => `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${r.target}"/>`).join("")}</Relationships>`;

if (SPLIT) {
  // --split: 每个 SVG 一个独立 pptx，页面尺寸 = 图尺寸（1pt→12700EMU，不缩放）
  fs.mkdirSync(out, { recursive: true });
  const statLines = [];
  for (const f of files) {
    const media = [], rels = [];
    const { slide, stats, wemu, hemu } = convertFigure(f, media, rels, true);
    const outFile = path.join(out, path.basename(f).replace(/\.svg$/i, "") + ".pptx");
    buildPptx([slide], [relsXml(rels)], media, wemu, hemu, outFile);
    statLines.push({ file: path.basename(outFile), ...stats });
    console.log(JSON.stringify({ out: outFile, szEMU: [wemu, hemu], media: media.length, MB: +(fs.statSync(outFile).size / 1048576).toFixed(2) }));
  }
  const t = statLines.reduce((a, l) => ({ sp: a.sp + l.sp, text: a.text + l.text, pic: a.pic + l.pic }), { sp: 0, text: 0, pic: 0 });
  console.log(`合计 ${statLines.length} 个文件: 形状${t.sp} 文本${t.text} 位图${t.pic}`);
  process.exit(0);
}

const media = [], slideParts = [], slideRelsParts = [], statLines = [];
let deckW = 0, deckH = 0;
for (const f of files) {
  const rels = [];
  const { slide, stats, wemu, hemu } = convertFigure(f, media, rels);
  slideParts.push(slide);
  slideRelsParts.push(relsXml(rels));
  deckW = wemu; deckH = hemu;
  statLines.push({ file: path.basename(f), ...stats });
}
buildPptx(slideParts, slideRelsParts, media, deckW, deckH, out);
console.log(JSON.stringify({ out, slides: slideParts.length, media: media.length, MB: +(fs.statSync(out).size / 1048576).toFixed(1) }));
for (const l of statLines) console.log(`${l.file}\t形状${l.sp}\t文本${l.text}\t位图${l.pic}`);
