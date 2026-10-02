/* Intensity Transformations Lab
 * All processing is done in plain JavaScript on <canvas> pixel arrays.
 * Every transformation is a point operation s = T(r), applied through a
 * 256-entry lookup table (LUT).
 */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const MAX_DIM = 1024;                                   // larger images are downscaled for speed
  const C_LOG = +(255 / Math.log(256)).toFixed(2);        // 45.99 → maps 255 to 255
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const nextFrame = () => new Promise((res) => requestAnimationFrame(res));
  const num = (v) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(2)));
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Piecewise formula layout: rows of [expression, condition]
  const pw = (rows) =>
    `<span class="pw"><span><i>s</i> =</span><span class="brace">{</span><span class="pw-rows">${rows
      .map(([e, c]) => `<span>${e}</span><span class="pw-c">${c}</span>`)
      .join('')}</span></span>`;

  const sortedStretch = (p) => {
    let { r1, s1, r2, s2 } = p;
    if (r1 > r2) [r1, s1, r2, s2] = [r2, s2, r1, s1];
    return { r1, s1, r2, s2 };
  };
  const sortedRange = (p) => ({ A: Math.min(p.A, p.B), B: Math.max(p.A, p.B) });

  // Bit-plane helpers
  const maskOf = (planes) => planes.reduce((m, k) => m | (1 << k), 0);
  const planesDesc = (planes) => [...planes].sort((a, b) => b - a);
  const bin8 = (v) => v.toString(2).padStart(8, '0');
  const BIT_PRESETS = [['MSB', [7]], ['7–4', [7, 6, 5, 4]], ['3–0', [3, 2, 1, 0]], ['All', [7, 6, 5, 4, 3, 2, 1, 0]]];

  // Image statistics used by the data-driven stretches. Before an image is
  // loaded, example values are used so the curve can still be previewed.
  const EXAMPLE_STATS = { min: 40, max: 210, hist: null, total: 0, example: true };

  // a = gray level below which `low`% of the pixels lie, b = level above which `high`% lie
  function percentileRange(st, low, high) {
    if (!st.hist) return { a: st.min, b: st.max };
    const lowN = (low / 100) * st.total;
    const highN = (1 - high / 100) * st.total;
    let cum = 0, a = 0, b = 255, foundA = false;
    for (let v = 0; v < 256; v++) {
      cum += st.hist[v];
      if (!foundA && cum > lowN) { a = v; foundA = true; }
      if (cum >= highN) { b = v; break; }
    }
    return { a, b: Math.max(b, a + 1) };
  }

  const ordinal = (v) => {
    const t = num(v);
    if (!Number.isInteger(v) || (v % 100 >= 11 && v % 100 <= 13)) return `${t}th`;
    return t + ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th');
  };
  const linearMap = (a, b) => (r) => ((r - a) * 255) / (b - a);
  const exampleNote = (st) => (st.example ? ' &nbsp;<span class="muted">(example values — upload an image)</span>' : '');
  const rangeLines = (a, b, la, lb, X, Y) => ({
    under: `<line class="vline" x1="${X(a)}" y1="${Y(0)}" x2="${X(a)}" y2="${Y(255)}"/>` +
      `<line class="vline" x1="${X(b)}" y1="${Y(0)}" x2="${X(b)}" y2="${Y(255)}"/>` +
      `<text class="ctrl-label" x="${X(a) + 4}" y="${Y(240)}">${la} = ${a}</text>` +
      `<text class="ctrl-label" x="${X(b) - 4}" y="${Y(20)}" text-anchor="end">${lb} = ${b}</text>`,
  });

  // The functions offered under "Contrast stretching"
  const STRETCH = {
    piecewise: {
      fnName: 'contrastStretch',
      fn: (p) => {
        const { r1, s1, r2, s2 } = sortedStretch(p);
        return (r) => {
          if (r <= r1) return r1 === 0 ? s1 : (s1 / r1) * r;
          if (r <= r2) return s1 + ((s2 - s1) * (r - r1)) / (r2 - r1);
          return r2 === 255 ? s2 : s2 + ((255 - s2) * (r - r2)) / (255 - r2);
        };
      },
      formula: () => pw([
        ['(s₁ / r₁) · r', '0 ≤ r ≤ r₁'],
        ['s₁ + (s₂ − s₁)(r − r₁) / (r₂ − r₁)', 'r₁ < r ≤ r₂'],
        ['s₂ + (L − 1 − s₂)(r − r₂) / (L − 1 − r₂)', 'r₂ < r ≤ L − 1'],
      ]),
      where: (p) => `(r₁, s₁) = (${p.r1}, ${p.s1}) &nbsp;·&nbsp; (r₂, s₂) = (${p.r2}, ${p.s2})`,
      subst: (r, p) => {
        const { r1, s1, r2, s2 } = sortedStretch(p);
        if (r <= r1) return `(${s1}/${r1}) · ${r}`;
        if (r <= r2) return `${s1} + (${s2}−${s1})·(${r}−${r1})/(${r2}−${r1})`;
        return `${s2} + (255−${s2})·(${r}−${r2})/(255−${r2})`;
      },
      desc: 'A piecewise-linear function through the control points (r₁, s₁) and (r₂, s₂). Levels between r₁ and r₂ are spread over a wider output range, so a low-contrast image uses more of the 0–255 scale. "Auto" sets (r₁, s₁) = (r_min, 0) and (r₂, s₂) = (r_max, 255).',
      code: (p) =>
`function contrastStretch(r, r1 = ${p.r1}, s1 = ${p.s1}, r2 = ${p.r2}, s2 = ${p.s2}) {
  const L = 256;
  if (r <= r1) return (s1 / r1) * r;                           // segment 1
  if (r <= r2) return s1 + (s2 - s1) * (r - r1) / (r2 - r1);    // segment 2
  return s2 + (L - 1 - s2) * (r - r2) / (L - 1 - r2);          // segment 3
}`,
      overlay: (p, X, Y) => {
        const { r1, s1, r2, s2 } = sortedStretch(p);
        const pt = (r, s, lab, dx) =>
          `<circle class="ctrl" cx="${X(r)}" cy="${Y(s)}" r="5"/><text class="ctrl-label" x="${X(r) + dx}" y="${Y(s) - 9}" text-anchor="${dx < 0 ? 'end' : 'start'}">${lab} (${r}, ${s})</text>`;
        return { over: pt(r1, s1, 'P₁', 8) + pt(r2, s2, 'P₂', -8) };
      },
    },

    minmax: {
      fnName: 'minMaxStretch',
      fn: (p, st) => linearMap(st.min, Math.max(st.max, st.min + 1)),
      formula: () => `<i>s</i> = (<i>r</i> − <i>r</i><sub>min</sub>) · (<i>L</i> − 1) / (<i>r</i><sub>max</sub> − <i>r</i><sub>min</sub>)`,
      where: (p, st) => `r<sub>min</sub> = ${st.min}, r<sub>max</sub> = ${st.max} (darkest and brightest level in the image)${exampleNote(st)}`,
      subst: (r, p, st) => `(${r} − ${st.min}) · 255 / (${st.max} − ${st.min})`,
      desc: 'Linear normalisation: the darkest level in the image is mapped to 0 and the brightest to 255, so the image uses the full gray-level range. It is the piecewise function with (r₁, s₁) = (r_min, 0) and (r₂, s₂) = (r_max, 255). A single very dark or very bright pixel can limit the effect.',
      code: (p, st) =>
`function minMaxStretch(r, rMin = ${st.min}, rMax = ${st.max}) {
  const L = 256;
  // rMin, rMax = darkest / brightest gray level in the image
  // map [rMin, rMax] linearly onto the full range [0, L - 1]
  return (r - rMin) * (L - 1) / (rMax - rMin);
}`,
      overlay: (p, X, Y, st) => rangeLines(st.min, st.max, 'r_min', 'r_max', X, Y),
    },

    percentile: {
      fnName: 'percentileStretch',
      fn: (p, st) => {
        const { a, b } = percentileRange(st, p.low, p.high);
        return linearMap(a, b);
      },
      formula: () => pw([
        ['0', 'r < a'],
        ['(r − a) · (L − 1) / (b − a)', 'a ≤ r ≤ b'],
        ['L − 1', 'r > b'],
      ]),
      where: (p, st) => {
        const { a, b } = percentileRange(st, p.low, p.high);
        return `a = ${ordinal(p.low)} percentile = ${a}, &nbsp;b = ${ordinal(100 - p.high)} percentile = ${b}${exampleNote(st)}`;
      },
      subst: (r, p, st) => {
        const { a, b } = percentileRange(st, p.low, p.high);
        if (r < a) return `${r} < ${a} → 0`;
        if (r > b) return `${r} > ${b} → 255`;
        return `(${r} − ${a}) · 255 / (${b} − ${a})`;
      },
      desc: 'A robust version of min–max stretching. The limits a and b are read from the cumulative histogram so that a small percentage of the darkest and brightest pixels is saturated (clipped). Outliers no longer limit the stretch, so the contrast gain is larger.',
      code: (p, st) => {
        const { a, b } = percentileRange(st, p.low, p.high);
        return `function percentileStretch(r, a = ${a}, b = ${b}) {
  const L = 256;
  // a = ${ordinal(p.low)} and b = ${ordinal(100 - p.high)} percentile of the cumulative histogram
  if (r < a) return 0;                    // darkest ${num(p.low)}% saturate to black
  if (r > b) return L - 1;                // brightest ${num(p.high)}% saturate to white
  return (r - a) * (L - 1) / (b - a);
}`;
      },
      overlay: (p, X, Y, st) => {
        const { a, b } = percentileRange(st, p.low, p.high);
        return rangeLines(a, b, 'a', 'b', X, Y);
      },
    },

    sigmoid: {
      fnName: 'sigmoidStretch',
      fn: (p) => (r) => 255 / (1 + Math.pow(p.m / r, p.E)),
      formula: () => `<i>s</i> = (<i>L</i> − 1) / ( 1 + (<i>m</i> / <i>r</i>)<sup><i>E</i></sup> )`,
      where: (p) => `m = ${p.m}, E = ${num(p.E)}`,
      subst: (r, p) => `255 / (1 + (${p.m}/${r})^${num(p.E)})`,
      desc: 'The smooth contrast-stretching function from Gonzalez & Woods. Levels below m are compressed towards black and levels above m towards white, which raises the contrast around m. As E grows the curve approaches thresholding at m.',
      code: (p) =>
`function sigmoidStretch(r, m = ${p.m}, E = ${num(p.E)}) {
  const L = 256;
  // S-shaped curve: darker below m, brighter above m
  return (L - 1) / (1 + Math.pow(m / r, E));
}`,
      overlay: (p, X, Y) => ({
        under: `<line class="vline" x1="${X(p.m)}" y1="${Y(0)}" x2="${X(p.m)}" y2="${Y(255)}"/>` +
          `<text class="ctrl-label" x="${X(p.m) + (p.m > 200 ? -6 : 6)}" y="${Y(230)}" text-anchor="${p.m > 200 ? 'end' : 'start'}">m = ${p.m}</text>`,
      }),
    },
  };

  /* ================= Transformation definitions ================= */
  const TRANSFORMS = {
    negative: {
      name: 'Negative', tag: 'Linear', fnName: 'negative', params: [],
      fn: () => (r) => 255 - r,
      formula: () => `<i>s</i> = (<i>L</i> − 1) − <i>r</i>`,
      where: () => `L = 256 gray levels &nbsp;⇒&nbsp; s = 255 − r`,
      subst: (r) => `255 − ${r}`,
      desc: 'Reverses the order of intensities: dark becomes light and light becomes dark, producing the photographic negative. Useful for enhancing white or gray detail embedded in large dark regions (e.g. mammograms).',
      code: () =>
`function negative(r) {
  const L = 256;              // number of gray levels
  return (L - 1) - r;         // s = (L - 1) - r
}`,
    },

    identity: {
      name: 'Identity', tag: 'Linear', fnName: 'identity', params: [],
      fn: () => (r) => r,
      formula: () => `<i>s</i> = <i>r</i>`,
      where: () => `the transfer curve is the 45° diagonal`,
      subst: (r) => `${r}`,
      desc: 'Output equals input, so the image is unchanged. It is the reference line on the transfer curve: every other transformation is understood by how it bends away from it.',
      code: () =>
`function identity(r) {
  return r;                   // s = r  (output = input)
}`,
    },

    log: {
      name: 'Log', tag: 'Logarithmic', fnName: 'logTransform',
      params: [{ id: 'c', label: 'Scale constant c', min: 1, max: 100, step: 0.01, value: C_LOG, hint: 'c = 255 / ln(256) ≈ 45.99 maps r = 255 to s = 255.' }],
      fn: (p) => (r) => p.c * Math.log(1 + r),
      formula: () => `<i>s</i> = <i>c</i> · log(1 + <i>r</i>)`,
      where: (p) => `c = ${num(p.c)}${p.c === C_LOG ? ' = (L − 1) / ln L' : ''}`,
      subst: (r, p) => `${num(p.c)} · ln(1 + ${r})`,
      desc: 'Maps a narrow range of dark input levels to a wide range of output levels and compresses the bright ones. Classic use: displaying images with a huge dynamic range, such as Fourier spectra.',
      code: (p) =>
`function logTransform(r, c = ${num(p.c)}) {
  // c = (L - 1) / ln(L) maps r = 255 to s = 255
  return c * Math.log(1 + r);
}`,
    },

    invlog: {
      name: 'Inverse log', tag: 'Logarithmic', fnName: 'inverseLog',
      params: [{ id: 'c', label: 'Scale constant c', min: 20, max: 150, step: 0.01, value: C_LOG, hint: 'With c ≈ 45.99, r = 255 maps to 255. Larger c → darker result.' }],
      fn: (p) => (r) => Math.exp(r / p.c) - 1,
      formula: () => `<i>s</i> = e<sup><i>r</i> / <i>c</i></sup> − 1`,
      where: (p) => `c = ${num(p.c)} &nbsp;(inverse of s = c · ln(1 + r))`,
      subst: (r, p) => `e^(${r} / ${num(p.c)}) − 1`,
      desc: 'The inverse of the log transform: compresses dark levels and expands the bright ones, so detail in bright regions gains contrast while the image darkens overall.',
      code: (p) =>
`function inverseLog(r, c = ${num(p.c)}) {
  // inverse of s = c * ln(1 + r)
  return Math.exp(r / c) - 1;
}`,
    },

    power: {
      name: 'nth power', tag: 'Power-law', fnName: 'nthPower',
      params: [{ id: 'n', label: 'Exponent n (γ)', min: 1, max: 10, step: 0.1, value: 2, hint: 'n > 1 darkens the image and expands the bright levels.' }],
      fn: (p) => (r) => 255 * Math.pow(r / 255, p.n),
      formula: () => `<i>s</i> = <i>c</i> · <i>r</i><sup><i>n</i></sup>`,
      where: (p) => `c = (L − 1)<sup>1 − n</sup> &nbsp;⇒&nbsp; s = 255 · (r / 255)<sup>${num(p.n)}</sup>`,
      subst: (r, p) => `255 · (${r}/255)^${num(p.n)}`,
      desc: 'Power-law (gamma) curve with n > 1: compresses dark levels and expands bright ones, darkening the image. Good for washed-out, over-exposed images.',
      code: (p) =>
`function nthPower(r, n = ${num(p.n)}) {
  const L = 256;
  // normalise r to [0, 1], raise to n, rescale to [0, L - 1]
  return (L - 1) * Math.pow(r / (L - 1), n);
}`,
    },

    root: {
      name: 'nth root', tag: 'Power-law', fnName: 'nthRoot',
      params: [{ id: 'n', label: 'Root n', min: 1, max: 10, step: 0.1, value: 2, hint: 'Exponent 1/n < 1 brightens the image and expands the dark levels.' }],
      fn: (p) => (r) => 255 * Math.pow(r / 255, 1 / p.n),
      formula: () => `<i>s</i> = <i>c</i> · <i>r</i><sup>1/<i>n</i></sup>`,
      where: (p) => `c = (L − 1)<sup>1 − 1/n</sup> &nbsp;⇒&nbsp; s = 255 · (r / 255)<sup>1/${num(p.n)}</sup>`,
      subst: (r, p) => `255 · (${r}/255)^(1/${num(p.n)})`,
      desc: 'Power-law curve with exponent 1/n < 1: expands dark levels and compresses bright ones, brightening the image and revealing detail in shadows (the same family as display gamma correction).',
      code: (p) =>
`function nthRoot(r, n = ${num(p.n)}) {
  const L = 256;
  // r^(1/n): expands the dark levels
  return (L - 1) * Math.pow(r / (L - 1), 1 / n);
}`,
    },

    stretch: {
      name: 'Contrast stretching', tag: 'Piecewise-linear',
      fnName: (p) => STRETCH[p.fn].fnName,
      params: [
        { id: 'fn', label: 'Stretching function', type: 'select', value: 'piecewise', options: [
          ['piecewise', 'Piecewise linear — (r₁, s₁), (r₂, s₂)'],
          ['minmax', 'Min–max (full-range) linear'],
          ['percentile', 'Percentile (saturated) linear'],
          ['sigmoid', 'Sigmoid S-curve'],
        ] },
        { id: 'r1', label: 'r₁ (input)', min: 0, max: 255, step: 1, value: 70, showIf: (v) => v.fn === 'piecewise' },
        { id: 's1', label: 's₁ (output)', min: 0, max: 255, step: 1, value: 20, showIf: (v) => v.fn === 'piecewise' },
        { id: 'r2', label: 'r₂ (input)', min: 0, max: 255, step: 1, value: 180, showIf: (v) => v.fn === 'piecewise' },
        { id: 's2', label: 's₂ (output)', min: 0, max: 255, step: 1, value: 235, showIf: (v) => v.fn === 'piecewise' },
        { id: 'low', label: 'Clip darkest (%)', min: 0, max: 20, step: 0.5, value: 2, showIf: (v) => v.fn === 'percentile', hint: 'This share of pixels is saturated to 0.' },
        { id: 'high', label: 'Clip brightest (%)', min: 0, max: 20, step: 0.5, value: 2, showIf: (v) => v.fn === 'percentile', hint: 'This share of pixels is saturated to 255.' },
        { id: 'm', label: 'Midpoint m', min: 1, max: 254, step: 1, value: 128, showIf: (v) => v.fn === 'sigmoid', hint: 'Levels below m get darker, levels above m get brighter.' },
        { id: 'E', label: 'Slope E', min: 1, max: 20, step: 0.5, value: 4, showIf: (v) => v.fn === 'sigmoid', hint: 'Larger E → steeper curve; E → ∞ becomes thresholding at m.' },
      ],
      autoStretch: (v) => v.fn === 'piecewise',
      fn: (p, st) => STRETCH[p.fn].fn(p, st),
      formula: (p, st) => STRETCH[p.fn].formula(p, st),
      where: (p, st) => STRETCH[p.fn].where(p, st),
      subst: (r, p, st) => STRETCH[p.fn].subst(r, p, st),
      desc: (p) => STRETCH[p.fn].desc,
      code: (p, st) => STRETCH[p.fn].code(p, st),
      overlay: (p, X, Y, st) => STRETCH[p.fn].overlay(p, X, Y, st),
    },

    threshold: {
      name: 'Thresholding', tag: 'Piecewise-linear', fnName: 'threshold',
      params: [{ id: 'T', label: 'Threshold T', min: 0, max: 255, step: 1, value: 128, hint: 'Pixels ≥ T become white, the rest black.' }],
      fn: (p) => (r) => (r >= p.T ? 255 : 0),
      formula: () => pw([['L − 1 = 255', 'r ≥ T'], ['0', 'r < T']]),
      where: (p) => `T = ${p.T} &nbsp;(r₁ = r₂ = T, s₁ = 0, s₂ = L − 1)`,
      subst: (r, p) => `${r} ≥ ${p.T} ? 255 : 0`,
      desc: 'The limiting case of contrast stretching where r₁ = r₂ = T, s₁ = 0 and s₂ = L − 1. The result is a binary (black-and-white) image that separates objects from the background.',
      code: (p) =>
`function threshold(r, T = ${p.T}) {
  const L = 256;
  // limiting case of contrast stretching: r1 = r2 = T
  return r >= T ? L - 1 : 0;
}`,
      overlay: (p, X, Y) => ({
        under: `<line class="vline" x1="${X(p.T)}" y1="${Y(0)}" x2="${X(p.T)}" y2="${Y(255)}"/><text class="ctrl-label" x="${X(p.T) + (p.T > 200 ? -6 : 6)}" y="${Y(128)}" text-anchor="${p.T > 200 ? 'end' : 'start'}">T = ${p.T}</text>`,
      }),
    },

    slicing: {
      name: 'Gray-level slicing', tag: 'Piecewise-linear', fnName: 'grayLevelSlice',
      params: [
        { id: 'mode', label: 'Approach', type: 'select', value: 'binary', options: [['binary', 'Binary — other levels → constant'], ['preserve', 'Preserve other levels']] },
        { id: 'A', label: 'Range start A', min: 0, max: 255, step: 1, value: 100 },
        { id: 'B', label: 'Range end B', min: 0, max: 255, step: 1, value: 180 },
        { id: 'level', label: 'Highlight level', min: 0, max: 255, step: 1, value: 255 },
        { id: 'bg', label: 'Background level', min: 0, max: 255, step: 1, value: 30, showIf: (v) => v.mode === 'binary' },
      ],
      fn: (p) => {
        const { A, B } = sortedRange(p);
        return (r) => (r >= A && r <= B ? p.level : p.mode === 'binary' ? p.bg : r);
      },
      formula: (p) => pw([
        ['highlight', 'A ≤ r ≤ B'],
        [p.mode === 'binary' ? 'background' : 'r', 'otherwise'],
      ]),
      where: (p) => {
        const { A, B } = sortedRange(p);
        return `[A, B] = [${A}, ${B}] · highlight = ${p.level}${p.mode === 'binary' ? ` · background = ${p.bg}` : ' · other levels preserved'}`;
      },
      subst: (r, p) => {
        const { A, B } = sortedRange(p);
        return `${r} ∈ [${A}, ${B}] ? ${p.level} : ${p.mode === 'binary' ? p.bg : r}`;
      },
      desc: 'Highlights a specific range [A, B] of gray levels — for example bodies of water in satellite images or flaws in X-ray images. Approach 1 sets all other levels to a constant (binary-like output); approach 2 brightens the range and preserves every other level.',
      code: (p) => {
        const { A, B } = sortedRange(p);
        return p.mode === 'binary'
          ? `function grayLevelSlice(r, A = ${A}, B = ${B}, high = ${p.level}, low = ${p.bg}) {
  // approach 1: highlight [A, B], everything else -> constant
  return (r >= A && r <= B) ? high : low;
}`
          : `function grayLevelSlice(r, A = ${A}, B = ${B}, high = ${p.level}) {
  // approach 2: highlight [A, B], preserve all other levels
  return (r >= A && r <= B) ? high : r;
}`;
      },
      overlay: (p, X, Y) => {
        const { A, B } = sortedRange(p);
        return {
          under: `<rect class="band" x="${X(A)}" y="${Y(255)}" width="${Math.max(1, X(B) - X(A))}" height="${Y(0) - Y(255)}"/>` +
            `<text class="ctrl-label" x="${X(A)}" y="${Y(255) - 2}" text-anchor="middle">A</text>` +
            `<text class="ctrl-label" x="${X(B)}" y="${Y(255) - 2}" text-anchor="middle">B</text>`,
        };
      },
    },

    bitplane: {
      name: 'Bit-plane slicing', tag: 'Piecewise-linear', fnName: 'bitPlanes',
      params: [
        { id: 'planes', type: 'bits', label: 'Bit planes to combine', value: [7], hint: 'Click planes to add or remove them (7 = MSB, 0 = LSB). One plane shows that plane alone.' },
        { id: 'scale', type: 'check', label: 'Scale result to the full 0–255 range', value: true, hint: 'Off shows the raw sum Σ bₖ·2ᵏ, which is dark when only low planes are kept.' },
      ],
      fn: (p) => {
        const M = maskOf(p.planes);
        return (r) => (p.scale ? ((r & M) * 255) / M : r & M);
      },
      formula: (p) => (p.scale
        ? `<i>s</i> = <span class="frac"><span>L − 1</span><span>M</span></span> · Σ<sub><i>k</i> ∈ <i>S</i></sub> <i>b<sub>k</sub></i> · 2<sup><i>k</i></sup>`
        : `<i>s</i> = Σ<sub><i>k</i> ∈ <i>S</i></sub> <i>b<sub>k</sub></i> · 2<sup><i>k</i></sup> = <i>r</i> AND <i>M</i>`),
      where: (p) => {
        const M = maskOf(p.planes);
        return `S = {${planesDesc(p.planes).join(', ')}} &nbsp;·&nbsp; M = Σ<sub>k∈S</sub> 2<sup>k</sup> = ${bin8(M)}₂ = ${M} &nbsp;·&nbsp; b<sub>k</sub> = ⌊r / 2<sup>k</sup>⌋ mod 2`;
      },
      subst: (r, p) => {
        const M = maskOf(p.planes);
        return p.scale ? `(${r} AND ${M}) · 255 / ${M} = ${r & M} · 255 / ${M}` : `${r} AND ${M}`;
      },
      desc: 'An 8-bit pixel is the sum of eight bit planes: r = Σ bₖ·2ᵏ. Choose one plane to see it as a black-and-white image, or several planes (e.g. 3, 4 or 5, 6, 7) to rebuild the image from those planes only. The high planes (7, 6, 5) carry most of the visual information; the low planes mostly hold fine detail and noise. Rebuilding from planes 7–4 already looks close to the original, which is the idea behind bit-plane compression.',
      code: (p) =>
`function bitPlanes(r, planes = [${planesDesc(p.planes).join(', ')}], scale = ${p.scale}) {
  // mask with a 1 in every selected plane, e.g. [7, 6] -> 11000000b = 192
  let mask = 0;
  for (const k of planes) mask |= 1 << k;
  const s = r & mask;                     // = sum of b_k * 2^k over the selected planes
  return scale ? s * 255 / mask : s;      // optionally stretch to [0, 255]
}`,
    },
  };

  const GROUPS = [
    { title: 'Basic transformations', items: ['negative', 'identity', 'log', 'invlog', 'power', 'root'] },
    { title: 'Piecewise-linear', items: ['stretch', 'threshold', 'slicing', 'bitplane'] },
  ];

  /* ================= State & elements ================= */
  const state = {
    key: 'negative',
    mode: 'gray',
    params: {},
    orig: null,      // ImageData of the uploaded image (color)
    input: null,     // ImageData fed to the transform (gray or RGB)
    hasOutput: false,
    fileName: 'image',
    running: false,
    runId: 0,
    hist: { in: null, out: null },
    stats: null,     // { min, max, hist, total } of the input gray levels
  };
  for (const [k, def] of Object.entries(TRANSFORMS)) {
    state.params[k] = Object.fromEntries(def.params.map((p) => [p.id, p.value]));
  }

  const el = {
    fs: $('#controlsFs'), file: $('#fileInput'), drop: $('#dropzone'), sample: $('#sampleBtn'), info: $('#fileInfo'),
    modeSeg: $('#modeSeg'), list: $('#transformList'), params: $('#paramsBox'), animate: $('#animateChk'),
    ok: $('#okBtn'), okHint: $('#okHint'), download: $('#downloadBtn'), progress: $('#progressBar'),
    inCanvas: $('#inCanvas'), outCanvas: $('#outCanvas'), inWrap: $('#inWrap'), outWrap: $('#outWrap'),
    inCaption: $('#inCaption'), outCaption: $('#outCaption'), scan: $('#scanline'), resultTag: $('#resultTag'),
    explainTitle: $('#explainTitle'), formula: $('#formula'), where: $('#formulaWhere'), desc: $('#description'),
    steps: $('#steps'), code: $('#code'), curve: $('#curve'), flow: $('#pixelFlow'), swatches: $('#swatches'),
    histIn: $('#histIn'), histOut: $('#histOut'), inMean: $('#inMean'), outMean: $('#outMean'),
    bitCard: $('#bitCard'), bitGrid: $('#bitGrid'), theme: $('#themeBtn'),
  };
  const inCtx = el.inCanvas.getContext('2d', { willReadFrequently: true });
  const outCtx = el.outCanvas.getContext('2d');

  const cur = () => TRANSFORMS[state.key];
  const vals = () => state.params[state.key];

  const stats = () => state.stats || EXAMPLE_STATS;
  const fnNameOf = (def, p) => (typeof def.fnName === 'function' ? def.fnName(p) : def.fnName);
  const descOf = (def, p) => (typeof def.desc === 'function' ? def.desc(p) : def.desc);

  function buildLUT(def, p) {
    const T = def.fn(p, stats());
    const lut = new Uint8ClampedArray(256);         // clamps to [0, 255]
    for (let r = 0; r < 256; r++) lut[r] = Math.round(T(r));
    return lut;
  }

  /* ================= Transform list & params UI ================= */
  function miniPath(key) {
    const def = TRANSFORMS[key];
    const lut = buildLUT(def, Object.fromEntries(def.params.map((p) => [p.id, p.value])));
    return 'M' + Array.from(lut, (s, r) => `${(3 + (r / 255) * 28).toFixed(1)},${(31 - (s / 255) * 28).toFixed(1)}`).join('L');
  }

  function renderTransformList() {
    el.list.innerHTML = GROUPS.map((g) => `
      <div>
        <div class="t-group-title">${g.title}</div>
        <div class="t-grid">${g.items.map((k) => `
          <label class="t-card">
            <input type="radio" name="transform" value="${k}">
            <svg class="mini" viewBox="0 0 34 34" aria-hidden="true"><path d="${miniPath(k)}"/></svg>
            <span class="t-text"><span class="t-name">${TRANSFORMS[k].name}</span><span class="t-tag">${TRANSFORMS[k].tag}</span></span>
          </label>`).join('')}
        </div>
      </div>`).join('');
    el.list.addEventListener('change', (e) => {
      if (e.target.name === 'transform') selectTransform(e.target.value);
    });
  }

  function renderParams() {
    const def = cur();
    const v = vals();
    if (!def.params.length) {
      el.params.innerHTML = `<p class="hint" style="margin:0">This transformation has no parameters.</p>`;
      return;
    }
    let html = def.params.map((p) => {
      const hint = p.hint ? `<div class="hint">${p.hint}</div>` : '';
      if (p.type === 'select') {
        return `<div class="param" data-id="${p.id}">
          <div class="param-head"><label for="p-${p.id}">${p.label}</label></div>
          <select id="p-${p.id}" data-id="${p.id}">${p.options.map(([val, lab]) => `<option value="${val}"${v[p.id] === val ? ' selected' : ''}>${lab}</option>`).join('')}</select>${hint}</div>`;
      }
      if (p.type === 'bits') {
        const sel = v[p.id];
        return `<div class="param" data-id="${p.id}">
          <div class="param-head"><label>${p.label}</label><output>S = {${planesDesc(sel).join(', ')}}</output></div>
          <div class="bit-toggles" role="group" aria-label="${p.label}">${[7, 6, 5, 4, 3, 2, 1, 0].map((k) =>
            `<button type="button" class="bit-toggle" data-bit="${k}" aria-pressed="${sel.includes(k)}"><b>${k}</b><span>${1 << k}</span></button>`).join('')}</div>
          <div class="bit-presets">${BIT_PRESETS.map(([lab], i) => `<button type="button" class="chip-btn" data-preset="${i}">${lab}</button>`).join('')}</div>${hint}</div>`;
      }
      if (p.type === 'check') {
        return `<div class="param" data-id="${p.id}">
          <label class="check" style="margin:0"><input type="checkbox" id="p-${p.id}" data-check="${p.id}"${v[p.id] ? ' checked' : ''}> ${p.label}</label>${hint}</div>`;
      }
      return `<div class="param" data-id="${p.id}">
        <div class="param-head"><label for="p-${p.id}">${p.label}</label><output id="o-${p.id}">${num(v[p.id])}</output></div>
        <input type="range" id="p-${p.id}" data-id="${p.id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v[p.id]}">${hint}</div>`;
    }).join('');
    if (def.autoStretch) {
      html += `<button type="button" class="ghost-btn" id="autoStretch">Auto: (r_min, 0) and (r_max, 255)</button>`;
    }
    el.params.innerHTML = html;
    applyShowIf();

    el.params.querySelectorAll('[data-id]').forEach((input) => {
      if (input.classList.contains('param')) return;
      input.addEventListener('input', () => {
        const id = input.dataset.id;
        v[id] = input.tagName === 'SELECT' ? input.value : +input.value;
        const out = $(`#o-${id}`);
        if (out) out.textContent = num(v[id]);
        applyShowIf();
        updateExplanation();
        if (state.key === 'bitplane') markBitThumb();
      });
    });
    el.params.querySelectorAll('[data-check]').forEach((box) => {
      box.addEventListener('change', () => {
        v[box.dataset.check] = box.checked;
        updateExplanation();
      });
    });
    el.params.querySelectorAll('[data-bit]').forEach((btn) => {
      btn.addEventListener('click', () => toggleBitPlane(+btn.dataset.bit));
    });
    el.params.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => setBitPlanes(BIT_PRESETS[+btn.dataset.preset][1]));
    });
    const auto = $('#autoStretch');
    if (auto) auto.addEventListener('click', autoStretch);
  }

  function setBitPlanes(planes) {
    state.params.bitplane.planes = planesDesc(planes);
    renderParams();
    updateExplanation();
    markBitThumb();
  }

  // Add or remove one plane; at least one plane always stays selected.
  function toggleBitPlane(k) {
    const cur = state.params.bitplane.planes;
    if (cur.includes(k)) {
      if (cur.length > 1) setBitPlanes(cur.filter((x) => x !== k));
    } else {
      setBitPlanes([...cur, k]);
    }
  }

  function applyShowIf() {
    const v = vals();
    for (const p of cur().params) {
      if (!p.showIf) continue;
      const box = el.params.querySelector(`.param[data-id="${p.id}"]`);
      if (box) box.hidden = !p.showIf(v);
    }
    const auto = $('#autoStretch');
    if (auto && typeof cur().autoStretch === 'function') auto.hidden = !cur().autoStretch(v);
  }

  function autoStretch() {
    if (!state.stats) { el.okHint.textContent = 'Upload an image first to compute its min / max.'; return; }
    Object.assign(state.params.stretch, { r1: state.stats.min, s1: 0, r2: state.stats.max, s2: 255 });
    renderParams();
    updateExplanation();
  }

  function selectTransform(key) {
    state.key = key;
    const radio = el.list.querySelector(`input[value="${key}"]`);
    if (radio) radio.checked = true;
    renderParams();
    updateExplanation();
    el.bitCard.hidden = key !== 'bitplane';
    if (key === 'bitplane') renderBitGrid();
  }

  /* ================= Explanation / infographic ================= */
  function fullCode() {
    const def = cur();
    const head = def.code(vals(), stats());
    const fnName = fnNameOf(def, vals());
    const apply = state.mode === 'gray'
      ? `// apply T to every pixel through a 256-entry lookup table
const LUT = new Uint8ClampedArray(256);
for (let r = 0; r < 256; r++) LUT[r] = Math.round(${fnName}(r));

const px = ctx.getImageData(0, 0, W, H).data;     // RGBA bytes
for (let i = 0; i < px.length; i += 4) {
  // grayscale: Y = 0.299 R + 0.587 G + 0.114 B
  const r = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
  px[i] = px[i + 1] = px[i + 2] = LUT[r];         // s = T(r)
}`
      : `// apply T to every pixel through a 256-entry lookup table
const LUT = new Uint8ClampedArray(256);
for (let r = 0; r < 256; r++) LUT[r] = Math.round(${fnName}(r));

const px = ctx.getImageData(0, 0, W, H).data;     // RGBA bytes
for (let i = 0; i < px.length; i += 4) {
  px[i]     = LUT[px[i]];                          // R channel
  px[i + 1] = LUT[px[i + 1]];                      // G channel
  px[i + 2] = LUT[px[i + 2]];                      // B channel
}`;
    return `${head}\n\n${apply}`;
  }

  function highlight(src) {
    return esc(src).replace(
      /(\/\/[^\n]*)|('[^'\n]*')|\b(function|return|const|let|for|of|if|else|new|true|false)\b|\b(Math\.\w+|Uint8ClampedArray)|\b(\d+(?:\.\d+)?)\b/g,
      (m, com, str, kw, fn, n) =>
        com ? `<span class="tk-com">${com}</span>`
        : str ? `<span class="tk-str">${str}</span>`
        : kw ? `<span class="tk-kw">${kw}</span>`
        : fn ? `<span class="tk-fn">${fn}</span>`
        : `<span class="tk-num">${n}</span>`,
    );
  }

  function stepDefs() {
    const gray = state.mode === 'gray';
    return [
      { t: 'Read the pixels', d: 'getImageData() returns a W × H × 4 array of RGBA bytes (0–255).' },
      gray
        ? { t: 'Convert to grayscale', d: 'r = 0.299·R + 0.587·G + 0.114·B (ITU-R BT.601 luminance).' }
        : { t: 'Split the RGB channels', d: 'R, G and B are each treated as a gray level r and transformed with the same T.' },
      { t: 'Build the lookup table', d: 'LUT[r] = T(r) for r = 0 … 255 — only 256 evaluations instead of one per pixel.' },
      { t: 'Map every pixel', d: 's = LUT[r], scanned row by row (watch the output canvas).' },
      { t: 'Display & compare', d: 'Draw the output image and its histogram next to the input.' },
    ];
  }

  function renderSteps() {
    el.steps.innerHTML = stepDefs().map((s, i) => `
      <li data-i="${i}">
        <span class="st-icon" data-n="${i + 1}"></span>
        <div><div class="st-title">${s.t}</div><div class="st-desc">${s.d}</div><div class="st-live"></div></div>
      </li>`).join('');
  }

  function setStep(i, live) {
    el.steps.querySelectorAll('li').forEach((li, j) => {
      li.classList.toggle('done', j < i);
      li.classList.toggle('active', j === i);
    });
    if (live != null) setLive(i, live);
  }
  const setLive = (i, text) => {
    const li = el.steps.querySelector(`li[data-i="${i}"] .st-live`);
    if (li) li.textContent = text;
  };

  // ---- transfer curve ----
  const PL = 40, PT = 14, PW = 246, PH = 246;
  const X = (r) => +(PL + (r / 255) * PW).toFixed(1);
  const Y = (s) => +(PT + PH - (s / 255) * PH).toFixed(1);

  function drawCurve(lut, animate) {
    const def = cur();
    const ov = def.overlay ? def.overlay(vals(), X, Y, stats()) : {};
    let g = '';
    for (const v of [0, 64, 128, 192, 255]) {
      g += `<line class="grid" x1="${X(v)}" y1="${Y(0)}" x2="${X(v)}" y2="${Y(255)}"/>`;
      g += `<line class="grid" x1="${X(0)}" y1="${Y(v)}" x2="${X(255)}" y2="${Y(v)}"/>`;
      g += `<text class="tick" x="${X(v)}" y="${Y(0) + 14}" text-anchor="middle">${v}</text>`;
      g += `<text class="tick" x="${X(0) - 6}" y="${Y(v) + 3.5}" text-anchor="end">${v}</text>`;
    }
    g += ov.under || '';
    g += `<line class="axis" x1="${X(0)}" y1="${Y(0)}" x2="${X(255)}" y2="${Y(0)}"/>`;
    g += `<line class="axis" x1="${X(0)}" y1="${Y(0)}" x2="${X(0)}" y2="${Y(255)}"/>`;
    g += `<text class="ax-title" x="${X(127.5)}" y="297" text-anchor="middle">input gray level r</text>`;
    g += `<text class="ax-title" transform="translate(10 ${Y(127.5)}) rotate(-90)" text-anchor="middle">output s</text>`;
    g += `<line class="ref" x1="${X(0)}" y1="${Y(0)}" x2="${X(255)}" y2="${Y(255)}"/>`;
    const d = 'M' + Array.from(lut, (s, r) => `${X(r)},${Y(s)}`).join('L');
    g += `<path class="curve" d="${d}"/>`;
    g += ov.over || '';
    g += `<g id="markers"></g>`;
    el.curve.innerHTML = g;

    if (animate) {
      const path = el.curve.querySelector('.curve');
      const len = path.getTotalLength();
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
      path.getBoundingClientRect();
      path.style.transition = 'stroke-dashoffset .7s ease-out';
      path.style.strokeDashoffset = 0;
    }
  }

  function setMarkers(points) {
    const g = el.curve.querySelector('#markers');
    if (!g) return;
    g.innerHTML = points.map(({ r, s, cls }) =>
      `<line class="guide ${cls}" x1="${X(r)}" y1="${Y(0)}" x2="${X(r)}" y2="${Y(s)}"/>` +
      `<line class="guide ${cls}" x1="${X(0)}" y1="${Y(s)}" x2="${X(r)}" y2="${Y(s)}"/>` +
      `<circle class="mk ${cls}" cx="${X(r)}" cy="${Y(s)}" r="5.5"/>`).join('');
  }

  // ---- live pixel flow ----
  function renderPixelFlow(px, lut) {
    const def = cur();
    const p = vals();
    const gray = state.mode === 'gray';
    const rgb = (a) => `rgb(${a[0]},${a[1]},${a[2]})`;
    const where = px.x == null ? 'example level' : `pixel (${px.x}, ${px.y})`;
    let op;
    if (gray) {
      const r = px.rin[0];
      const raw = def.fn(p, stats())(r);
      const exact = Math.abs(raw - px.sout[0]) < 1e-9;
      op = `<span class="mono">${esc(def.subst(r, p, stats()))}</span><span class="mono eq">= ${exact ? px.sout[0] : `${num(raw)} → ${px.sout[0]}`}</span>`;
    } else {
      op = ['R', 'G', 'B'].map((c, i) => `<span class="mono">${c}: T(${px.rin[i]}) = <b>${px.sout[i]}</b></span>`).join('');
    }
    let html = `<div class="flow">
      <div class="node"><div class="chip" style="background:${rgb(px.rin)}"></div><div class="v">${gray ? `r = ${px.rin[0]}` : `(${px.rin.join(', ')})`}</div><div class="sub">${where}</div></div>
      <div class="arrow">→</div>
      <div class="node op"><div class="op-title">T(r)</div>${op}</div>
      <div class="arrow">→</div>
      <div class="node"><div class="chip" style="background:${rgb(px.sout)}"></div><div class="v">${gray ? `s = ${px.sout[0]}` : `(${px.sout.join(', ')})`}</div><div class="sub">output</div></div>
    </div>`;

    if (state.key === 'bitplane') {
      const v = px.rin[0];
      const planes = planesDesc(p.planes);
      const M = maskOf(planes);
      const kept = v & M;
      const terms = planes.map((k) => `${(v >> k) & 1}·${1 << k}`).join(' + ');
      html += `<div class="bits">
        <div class="bits-title">${gray ? 'r' : 'R'} = ${v} = ${bin8(v)}₂ — highlighted planes are kept</div>
        <div class="bits-row">${[7, 6, 5, 4, 3, 2, 1, 0].map((b) => {
          const on = (v >> b) & 1;
          return `<div class="bit${on ? ' one' : ''}${planes.includes(b) ? ' sel' : ''}"><span class="b-val">${on}</span><span class="b-idx">b${b}</span></div>`;
        }).join('')}</div>
        <div class="hint">Σ b<sub>k</sub>·2<sup>k</sup> = ${terms} = ${kept}${p.scale ? ` &nbsp;⇒&nbsp; s = ${kept} · 255 / ${M} = ${Math.round((kept * 255) / M)}` : ` &nbsp;⇒&nbsp; s = ${kept}`}</div>
      </div>`;
    }
    el.flow.innerHTML = html;

    setMarkers(gray
      ? [{ r: px.rin[0], s: lut[px.rin[0]], cls: 'm-gray' }]
      : [0, 1, 2].map((i) => ({ r: px.rin[i], s: lut[px.rin[i]], cls: ['m-r', 'm-g', 'm-b'][i] })));
  }

  function examplePixel(lut) {
    if (state.input) {
      const { width: w, height: h, data } = state.input;
      const x = Math.floor(w / 2), y = Math.floor(h / 2);
      const i = (y * w + x) * 4;
      const rin = [data[i], data[i + 1], data[i + 2]];
      return { x, y, rin, sout: rin.map((v) => lut[v]) };
    }
    return { rin: [100, 100, 100], sout: [lut[100], lut[100], lut[100]] };
  }

  function renderSwatches(lut) {
    const levels = [0, 32, 64, 96, 128, 160, 192, 224, 255];
    const chip = (v) => `<div class="sw-chip" style="background:rgb(${v},${v},${v})" title="${v}"></div>`;
    el.swatches.innerHTML = `<div class="sw-grid">
      <div class="sw-lab">r</div>${levels.map(chip).join('')}
      <div></div>${levels.map((v) => `<div class="sw-num">${v}</div>`).join('')}
      <div></div>${levels.map(() => `<div class="sw-arrow">↓ T</div>`).join('')}
      <div class="sw-lab">s</div>${levels.map((v) => chip(lut[v])).join('')}
      <div></div>${levels.map((v) => `<div class="sw-num">${lut[v]}</div>`).join('')}
    </div>`;
  }

  function updateExplanation() {
    if (state.running) return;
    const def = cur();
    const p = vals();
    const lut = buildLUT(def, p);
    el.explainTitle.textContent = `· ${def.name}`;
    el.formula.innerHTML = def.formula(p, stats());
    el.where.innerHTML = def.where ? def.where(p, stats()) : '';
    el.desc.textContent = descOf(def, p);
    el.code.innerHTML = highlight(fullCode());
    renderSteps();
    drawCurve(lut, false);
    renderSwatches(lut);
    renderPixelFlow(examplePixel(lut), lut);
  }

  /* ================= Histograms ================= */
  function histogram(img, gray) {
    const d = img.data;
    const ch = gray ? [new Uint32Array(256)] : [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (gray) { ch[0][d[i]]++; sum += d[i]; }
      else { ch[0][d[i]]++; ch[1][d[i + 1]]++; ch[2][d[i + 2]]++; sum += (d[i] + d[i + 1] + d[i + 2]) / 3; }
      n++;
    }
    return { gray, ch, mean: n ? sum / n : 0 };
  }

  function drawHist(canvas, hist) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 280, H = canvas.clientHeight || 96;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(document.documentElement);
    const css = (v) => cs.getPropertyValue(v).trim();
    ctx.fillStyle = css('--surface-2');
    ctx.fillRect(0, 0, W, H);
    if (!hist) {
      ctx.fillStyle = css('--muted');
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('no data yet', W / 2, H / 2 + 4);
      return;
    }
    const colors = hist.gray ? [css('--accent')] : [css('--ch-r'), css('--ch-g'), css('--ch-b')];
    let max = 1;
    for (const arr of hist.ch) for (let i = 0; i < 256; i++) if (arr[i] > max) max = arr[i];
    const bw = W / 256;
    ctx.globalAlpha = hist.gray ? 1 : 0.5;
    hist.ch.forEach((arr, c) => {
      ctx.fillStyle = colors[c];
      for (let i = 0; i < 256; i++) {
        const bh = (arr[i] / max) * (H - 6);
        if (bh > 0) ctx.fillRect(i * bw, H - bh, Math.max(bw, 1), bh);
      }
    });
    ctx.globalAlpha = 1;
  }

  function drawHists() {
    drawHist(el.histIn, state.hist.in);
    drawHist(el.histOut, state.hist.out);
    el.inMean.textContent = state.hist.in ? `· mean ${state.hist.in.mean.toFixed(1)}` : '';
    el.outMean.textContent = state.hist.out ? `· mean ${state.hist.out.mean.toFixed(1)}` : '';
  }

  /* ================= Bit-plane thumbnails ================= */
  function renderBitGrid() {
    if (!state.input) {
      el.bitGrid.innerHTML = `<p class="hint" style="grid-column:1/-1;margin:0">Upload an image to see all eight planes.</p>`;
      return;
    }
    const { width: w, height: h, data: s } = state.input;
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const oc = off.getContext('2d');
    const img = oc.createImageData(w, h);
    const d = img.data;
    const tw = 200, th = Math.max(1, Math.round((h / w) * tw));
    el.bitGrid.innerHTML = '';
    for (let k = 7; k >= 0; k--) {
      for (let i = 0; i < s.length; i += 4) {
        d[i] = ((s[i] >> k) & 1) * 255;
        d[i + 1] = ((s[i + 1] >> k) & 1) * 255;
        d[i + 2] = ((s[i + 2] >> k) & 1) * 255;
        d[i + 3] = 255;
      }
      oc.putImageData(img, 0, 0);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bit-thumb';
      btn.dataset.k = k;
      const cv = document.createElement('canvas');
      cv.width = tw; cv.height = th;
      cv.getContext('2d').drawImage(off, 0, 0, tw, th);
      const lab = document.createElement('span');
      lab.textContent = `Bit ${k}${k === 7 ? ' · MSB' : k === 0 ? ' · LSB' : ''}`;
      btn.append(cv, lab);
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => {
        if (!state.running) toggleBitPlane(k);
      });
      el.bitGrid.append(btn);
    }
    markBitThumb();
  }
  function markBitThumb() {
    el.bitGrid.querySelectorAll('.bit-thumb').forEach((b) => {
      const on = state.params.bitplane.planes.includes(+b.dataset.k);
      b.classList.toggle('sel', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  /* ================= Image loading ================= */
  function loadFile(file) {
    if (state.running || !file) return;
    if (!file.type.startsWith('image/')) {
      showInfo(`<div><b>Unsupported file</b>“${esc(file.name)}” is not an image.</div>`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => setImage(img, file.name, img.naturalWidth, img.naturalHeight, reader.result);
      img.onerror = () => showInfo(`<div><b>Could not read image</b>The browser cannot decode “${esc(file.name)}”.</div>`);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function showInfo(html) {
    el.info.innerHTML = html;
    el.info.hidden = false;
  }

  function setImage(source, name, natW, natH, thumbSrc) {
    const scale = Math.min(1, MAX_DIM / Math.max(natW, natH));
    const w = Math.max(1, Math.round(natW * scale));
    const h = Math.max(1, Math.round(natH * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.drawImage(source, 0, 0, w, h);
    state.orig = x.getImageData(0, 0, w, h);
    state.fileName = name.replace(/\.[^.]+$/, '') || 'image';

    const thumb = thumbSrc || c.toDataURL();
    showInfo(`<img src="${thumb}" alt="">
      <div><b>${esc(name)}</b>${natW} × ${natH} px${scale < 1 ? ` · processed at ${w} × ${h}` : ''}</div>`);

    computeInput();
    clearOutput();
    el.ok.disabled = false;
    el.okHint.textContent = 'Ready — press OK to produce the output.';
    updateExplanation();
    if (state.key === 'bitplane') renderBitGrid();
  }

  // Histogram of all gray levels fed to T (all three channels in RGB mode).
  function grayStats(img, gray) {
    const d = img.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      hist[d[i]]++;
      if (!gray) { hist[d[i + 1]]++; hist[d[i + 2]]++; }
    }
    let min = 0, max = 255, total = 0;
    while (min < 255 && !hist[min]) min++;
    while (max > 0 && !hist[max]) max--;
    for (let v = 0; v < 256; v++) total += hist[v];
    return { min, max, hist, total, example: false };
  }

  // Build the image that is fed to T: grayscale luminance or untouched RGB.
  function computeInput() {
    if (!state.orig) return;
    const { width: w, height: h, data: s } = state.orig;
    const out = new ImageData(w, h);
    const d = out.data;
    if (state.mode === 'gray') {
      for (let i = 0; i < s.length; i += 4) {
        const y = Math.round(0.299 * s[i] + 0.587 * s[i + 1] + 0.114 * s[i + 2]);
        d[i] = d[i + 1] = d[i + 2] = y;
        d[i + 3] = s[i + 3];
      }
    } else {
      d.set(s);
    }
    state.input = out;
    state.stats = grayStats(out, state.mode === 'gray');
    el.inCanvas.width = w;
    el.inCanvas.height = h;
    inCtx.putImageData(out, 0, 0);
    el.inWrap.classList.remove('is-empty');
    el.inCaption.textContent = state.mode === 'gray' ? 'Input · grayscale' : 'Input · RGB';
    state.hist.in = histogram(out, state.mode === 'gray');
    drawHists();
  }

  function clearOutput() {
    state.hasOutput = false;
    state.hist.out = null;
    el.outWrap.classList.add('is-empty');
    el.download.disabled = true;
    el.resultTag.hidden = true;
    el.outCaption.textContent = 'Output';
    el.progress.style.width = '0';
    drawHists();
  }

  function makeSample() {
    const w = 640, h = 420;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    // sky
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#1d2b53');
    sky.addColorStop(0.55, '#7e5a9b');
    sky.addColorStop(1, '#f2a65a');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    // sun
    const sun = g.createRadialGradient(470, 165, 8, 470, 165, 95);
    sun.addColorStop(0, '#fff8dc');
    sun.addColorStop(0.35, '#ffd166');
    sun.addColorStop(1, 'rgba(255,209,102,0)');
    g.fillStyle = sun;
    g.beginPath(); g.arc(470, 165, 95, 0, Math.PI * 2); g.fill();
    // mountains
    const ridge = (color, pts) => {
      g.fillStyle = color;
      g.beginPath(); g.moveTo(0, h);
      pts.forEach(([x, y]) => g.lineTo(x, y));
      g.lineTo(w, h); g.closePath(); g.fill();
    };
    ridge('#4a3b5c', [[0, 260], [90, 200], [170, 245], [260, 170], [350, 240], [430, 205], [520, 255], [640, 190]]);
    ridge('#26303d', [[0, 320], [120, 270], [210, 305], [320, 255], [430, 310], [540, 275], [640, 300]]);
    // low-contrast detail hidden in the shadows
    g.fillStyle = '#2f3b4a';
    g.font = 'bold 30px Segoe UI, Arial, sans-serif';
    g.fillText('hidden detail in the shadows', 36, 370);
    // additive RGB circles
    g.globalCompositeOperation = 'lighter';
    [['#d03030', 95, 105], ['#30b040', 145, 105], ['#3050e0', 120, 148]].forEach(([col, x, y]) => {
      g.fillStyle = col;
      g.beginPath(); g.arc(x, y, 44, 0, Math.PI * 2); g.fill();
    });
    g.globalCompositeOperation = 'source-over';
    // gray ramp 0 → 255
    const ramp = g.createLinearGradient(0, 0, w, 0);
    ramp.addColorStop(0, '#000');
    ramp.addColorStop(1, '#fff');
    g.fillStyle = ramp;
    g.fillRect(0, h - 28, w, 28);
    return c;
  }

  /* ================= Processing ================= */
  let typingId = 0;
  async function typeCode(text, duration) {
    const id = ++typingId;
    const start = performance.now();
    while (id === typingId) {
      const t = Math.min(1, (performance.now() - start) / duration);
      const n = Math.floor(text.length * t);
      el.code.innerHTML = highlight(text.slice(0, n)) + (t < 1 ? '<span class="caret"></span>' : '');
      if (t >= 1) break;
      await nextFrame();
    }
  }

  async function run() {
    if (!state.input || state.running) return;
    state.running = true;
    const runId = ++state.runId;
    el.fs.disabled = true;
    el.download.disabled = true;

    const def = cur();
    const p = { ...vals() };
    const anim = el.animate.checked;
    const wait = (ms) => (anim ? sleep(ms) : Promise.resolve());
    const { width: w, height: h, data: inPx } = state.input;

    // reset explanation panels for this run
    el.formula.innerHTML = def.formula(p, stats());
    el.where.innerHTML = def.where ? def.where(p, stats()) : '';
    el.desc.textContent = descOf(def, p);
    renderSteps();
    el.okHint.textContent = `Processing with ${def.name}…`;
    const code = fullCode();
    if (anim) typeCode(code, 1500); else el.code.innerHTML = highlight(code);

    el.outCanvas.width = w;
    el.outCanvas.height = h;
    outCtx.clearRect(0, 0, w, h);
    el.outWrap.classList.remove('is-empty');
    el.outCaption.textContent = `Output · ${def.name}`;
    el.resultTag.textContent = def.name;
    el.resultTag.hidden = false;
    el.progress.style.width = '0';
    state.hist.out = null;
    drawHists();

    // Step 1 — read pixels
    setStep(0, `${w} × ${h} × 4 = ${(w * h * 4).toLocaleString()} values`);
    await wait(500);

    // Step 2 — grayscale / channels
    setStep(1, state.mode === 'gray' ? `${(w * h).toLocaleString()} luminance values ready` : `3 channels × ${(w * h).toLocaleString()} pixels`);
    await wait(550);

    // Step 3 — LUT
    const t0 = performance.now();
    const lut = buildLUT(def, p);
    let computeMs = performance.now() - t0;
    setStep(2, `LUT[0] = ${lut[0]} · LUT[128] = ${lut[128]} · LUT[255] = ${lut[255]}`);
    drawCurve(lut, anim);
    renderSwatches(lut);
    await wait(800);

    // Step 4 — map pixels row by row
    setStep(3, '');
    const out = outCtx.createImageData(w, h);
    const o = out.data;
    const rowsPer = anim ? Math.max(1, Math.ceil(h / 90)) : h;
    if (anim) el.scan.classList.add('on');
    for (let y0 = 0; y0 < h; y0 += rowsPer) {
      if (runId !== state.runId) return;
      const y1 = Math.min(h, y0 + rowsPer);
      const t1 = performance.now();
      for (let i = y0 * w * 4, end = y1 * w * 4; i < end; i += 4) {
        o[i] = lut[inPx[i]];
        o[i + 1] = lut[inPx[i + 1]];
        o[i + 2] = lut[inPx[i + 2]];
        o[i + 3] = inPx[i + 3];
      }
      computeMs += performance.now() - t1;
      outCtx.putImageData(out, 0, 0, 0, y0, w, y1 - y0);
      const frac = y1 / h;
      el.progress.style.width = `${(frac * 100).toFixed(1)}%`;
      el.scan.style.top = `${(frac * 100).toFixed(2)}%`;
      setLive(3, `row ${y1} / ${h} · ${(y1 * w).toLocaleString()} pixels mapped`);
      if (anim) {
        // show one pixel from the current row travelling through T
        const x = Math.floor((0.5 + 0.45 * Math.sin(y0 * 0.11)) * (w - 1));
        const y = y1 - 1;
        const i = (y * w + x) * 4;
        const rin = [inPx[i], inPx[i + 1], inPx[i + 2]];
        renderPixelFlow({ x, y, rin, sout: rin.map((v) => lut[v]) }, lut);
        await nextFrame();
      }
    }
    el.scan.classList.remove('on');

    // Step 5 — display & compare
    setStep(4, '');
    state.hist.out = histogram(out, state.mode === 'gray');
    drawHists();
    if (!anim) renderPixelFlow(examplePixel(lut), lut);
    if (state.key === 'bitplane') { renderBitGrid(); }
    await wait(400);
    setStep(5);
    setLive(4, `done · pure compute time ${computeMs.toFixed(1)} ms`);

    typingId++;
    el.code.innerHTML = highlight(code);
    state.hasOutput = true;
    state.running = false;
    el.fs.disabled = false;
    el.download.disabled = false;
    el.okHint.textContent = 'Done. Change the transformation or parameters and press OK again.';
  }

  function download() {
    if (!state.hasOutput) return;
    el.outCanvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${state.fileName}_${state.key}.png`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  }

  /* ================= Theme ================= */
  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('itl-theme'); } catch (e) { /* storage unavailable */ }
    if (saved) document.documentElement.dataset.theme = saved;
    el.theme.addEventListener('click', () => {
      const isDark = document.documentElement.dataset.theme
        ? document.documentElement.dataset.theme === 'dark'
        : matchMedia('(prefers-color-scheme: dark)').matches;
      const next = isDark ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('itl-theme', next); } catch (e) { /* ignore */ }
      drawHists();
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawHists);
  }

  /* ================= Wire-up ================= */
  function init() {
    renderTransformList();
    selectTransform(state.key);
    drawHists();
    initTheme();

    el.file.addEventListener('change', () => { loadFile(el.file.files[0]); el.file.value = ''; });
    el.drop.addEventListener('dragover', (e) => { e.preventDefault(); el.drop.classList.add('drag'); });
    el.drop.addEventListener('dragleave', () => el.drop.classList.remove('drag'));
    el.drop.addEventListener('drop', (e) => {
      e.preventDefault();
      el.drop.classList.remove('drag');
      loadFile(e.dataTransfer.files[0]);
    });
    el.sample.addEventListener('click', () => {
      if (state.running) return;
      const c = makeSample();
      setImage(c, 'sample-landscape.png', c.width, c.height);
    });

    el.modeSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (!btn || btn.dataset.mode === state.mode) return;
      state.mode = btn.dataset.mode;
      el.modeSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      computeInput();
      if (state.orig) {
        clearOutput();
        el.okHint.textContent = 'Color mode changed — press OK to produce the output.';
      }
      updateExplanation();
      if (state.key === 'bitplane') renderBitGrid();
    });

    el.ok.addEventListener('click', run);
    el.download.addEventListener('click', download);

    let resizeT;
    window.addEventListener('resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(drawHists, 150);
    });
  }

  init();
})();
