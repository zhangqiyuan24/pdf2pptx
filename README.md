# pdf2pptx — 把"只剩 PDF"的图表复原成可编辑 PPT

画图的代码 / PPT 工程丢了，只留下投稿导出的 PDF 图？这个工具把**单页矢量 PDF 图**逆向复原成**原生可编辑的 PowerPoint**——不是截图贴图，而是真正的矢量形状、文本框和图片对象，Office 2007 及以上直接打开编辑。

```
PDF ──pdf2svg──▶ 可编辑 SVG ──svg2pptx──▶ 原生 PPTX（custGeom 自由图形 / 文本框 / 嵌入 PNG）
```

- **曲线、坐标轴、刻度** → 矢量自由图形（可改线宽颜色、可编辑顶点拖动数据点）
- **所有文字**（轴标签、刻度数字、图例）→ 真实文本框（双击改字、字号、字体；多行标签按行精确就位）
- **热图 / 声图 / 照片** → 无损导出的 PNG 图片对象（可替换、可缩放）
- 转换**不依赖本机装有 PowerPoint**，直接生成 OOXML；已用 PowerPoint 2016 全量渲染核对

## 快速开始

需要 [Node.js](https://nodejs.org) ≥ 18。

```bash
git clone https://github.com/zhangqiyuan24/pdf2pptx.git
cd pdf2pptx
npm install          # 只装一个依赖：mupdf
npm run demo         # 生成 demo/demo.pptx，双击用 PowerPoint 打开看看
```

## 用法

**单个 PDF**（输出 `<名字>_editable.pptx`，一页一图）：

```bash
node pdf2svg.mjs  figure.pdf  figure.svg
node svg2pptx.mjs figure.svg  -o figure_editable.pptx
```

**整个文件夹**（每个 PDF 一页，按文件名自然排序，图 2 排在图 10 前面）：

```bash
node pdf2svg.mjs  figs/图1.pdf  tmp/图1.svg   # 逐个转出 SVG 到 tmp/
node svg2pptx.mjs tmp/ -o all_editable.pptx
```

**一张图一个 PPT，页面尺寸严格等于图尺寸**（无留白无缩放，改完全选导出即成品）：

```bash
node svg2pptx.mjs tmp/ --split -o 单图输出目录/
```

**Windows 双击**：把 PDF 文件或文件夹拖到 `pdf2pptx.bat` 上（或双击后输入路径），在 PDF 同目录生成 `<名字>_editable.pptx`。

## 精度与已知近似

在 44 张学术图（流程图 / 折线图 / 热图 / 箱线图 / 等值线图，共 5000+ 形状、1000+ 文本框）上与原稿逐张渲染比对：

- 图形宽高比偏差 ≤ 1.1%；模糊降采样结构差异中位数 ≈ 3%（残余差异来自字体渲染与抗锯齿）
- 嵌入位图逐点采样颜色一致

已知近似（均视觉无差异或差异极小）：

1. **文字按行摆放**：原 PDF 逐字记坐标，输出为"每行一个文本框、行首位置精确"；西文宽度按 0.55 em 估算，个别长标签的文本框偏宽（文本框无填充无描边，不影响显示）
2. **描边文字**按实心字近似（学术图罕见）
3. **镜像位图**用垂直翻转近似
4. **PDF 裁剪未带入**：绝大多数裁剪框内内容本就不出界；个别被坐标框截断的曲线会完整显示
5. 字体用系统字体名（Times New Roman、宋体等），与原 PDF 嵌入字体的笔画粗细有微小差异

## 限制

- 每个 PDF 只转换**第 1 页**（面向"一张图一个 PDF"的场景；多页 PDF 请先拆页）
- shade 渐变、pattern tile 不支持（会缺失，转换日志有 warning）
- Type3 字体、clipImageMask 未实现

## English

**pdf2pptx** recovers a single-page vector PDF figure into a fully editable PowerPoint file — native freeform shapes for curves/axes, real text boxes for every label (multi-line labels split per line, each anchored at its exact PDF position), and lossless PNG objects for embedded images. Conversion generates OOXML directly and does not require PowerPoint to be installed.

```bash
npm install
node pdf2svg.mjs figure.pdf figure.svg   # PDF → editable SVG
node svg2pptx.mjs figure.svg -o out.pptx # SVG → native PPTX
node svg2pptx.mjs dir/ --split -o out/   # one PPTX per figure, page size == figure size
```

## License

[MIT](LICENSE)
