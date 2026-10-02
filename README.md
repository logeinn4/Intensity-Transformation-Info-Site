# Intensity Transformations Lab

An interactive website for exploring the gray-level (intensity) transformations of digital image processing.
Upload an image, choose a transformation, press **OK**, and watch the output being produced while the
algorithm, the code, and an infographic explain what happens to every pixel.

**Live site:** https://logeinn4.github.io/Intensity-Transformation-Info-Site/

## Transformations

| Group | Transformation | Function |
|---|---|---|
| Linear | Negative | s = (L − 1) − r |
| Linear | Identity | s = r |
| Logarithmic | Log | s = c · log(1 + r) |
| Logarithmic | Inverse log | s = e^(r / c) − 1 |
| Power-law | nth power | s = c · rⁿ |
| Power-law | nth root | s = c · r^(1/n) |
| Piecewise-linear | Contrast stretching | piecewise linear, min–max, percentile, or sigmoid |
| Piecewise-linear | Thresholding | s = L − 1 if r ≥ T, else 0 |
| Piecewise-linear | Gray-level slicing | highlight [A, B], binary or preserve background |
| Piecewise-linear | Bit-plane slicing | s = (L − 1) · (⌊r / 2ᵏ⌋ mod 2) |

Images can be processed in **grayscale** (Y = 0.299R + 0.587G + 0.114B) or **per RGB channel**.

## How it works

Every transformation is a point operation `s = T(r)`. The site builds a 256-entry lookup table
`LUT[r] = T(r)` and then maps each pixel through it. While processing, it shows:

- the formula with the current parameter values
- the algorithm steps, each lighting up as it runs
- the JavaScript function being used
- the transfer curve with the current pixel marked
- a live pixel-mapping view (input value → T(r) → output value)
- gray-level mapping samples and input/output histograms
- all 8 bit planes (for bit-plane slicing)

## Run locally

It is a static site with no build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 8765
```

All processing happens in the browser. Images are never uploaded anywhere.
