// gen_demo.cjs — 生成合成示例 demo.pdf（纯英文，无第三方内容），用于安装自检
const fs = require("fs");

// 内容流：坐标轴 + 网格 + 两条曲线 + 图例 + 标题/轴标签
let c = "";
c += "1 1 1 rg 0 0 480 300 re f\n";                      // 白底
c += "0.85 0.85 0.85 RG [2 2] 0 d 0.5 w\n";
for (let gx = 60; gx <= 440; gx += 38) c += `${gx} 40 m ${gx} 250 l S\n`;
for (let gy = 40; gy <= 250; gy += 42) c += `60 ${gy} m 440 ${gy} l S\n`;
c += "0 0 0 RG [] 0 d 1 w 60 40 m 60 250 l S 60 40 m 440 40 l S\n"; // 轴
const sin = (x, a, ph) => a * Math.sin(x / 30 + ph);
let p1 = "", p2 = "";
for (let x = 60; x <= 440; x += 4) {
  const y1 = 145 + sin(x, 80, 0), y2 = 145 + sin(x, 50, 1.2);
  p1 += `${x.toFixed(1)} ${y1.toFixed(1)} ${x === 60 ? "m" : "l"} `;
  p2 += `${x.toFixed(1)} ${y2.toFixed(1)} ${x === 60 ? "m" : "l"} `;
}
c += `1 0 0 RG ${p1}S\n`;
c += `0 0.4 1 RG [6 3] 0 d ${p2}S\n`;
c += "0 0 0 RG [] 0 d 0.8 w 330 210 100 34 re S\n";       // 图例框
c += "1 0 0 rg 1 1 1 RG 338 231 m 358 231 l S\n0 0.4 1 rg [6 3] 0 d 338 222 m 358 222 l S [] 0 d\n";
c += "BT /F1 16 Tf 150 272 Td (Demo figure) Tj ET\n";
c += "BT /F1 10 Tf 338 268 Td (signal A) Tj ET\nBT /F1 10 Tf 338 259 Td (signal B) Tj ET\n";
c += "BT /F1 10 Tf 235 22 Td (time / s) Tj ET\n";
c += "BT /F1 10 Tf 14 150 Td (amp) Tj ET\n";
for (let i = 0; i <= 4; i++) {
  const x = 60 + i * 95;
  c += `BT /F1 9 Tf ${x - 8} 28 Td (${i}) Tj ET\n`;
}

const objs = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 480 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${c.length} >>\nstream\n${c}endstream`,
];

let pdf = "%PDF-1.4\n";
const offs = [];
objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
const xref = pdf.length;
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
for (const o of offs) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
fs.writeFileSync(__dirname + "/demo.pdf", pdf, "binary");
console.log("demo.pdf", pdf.length, "bytes");
