document.addEventListener('DOMContentLoaded', () => {
  // --- Constants ---
  const TOTAL_FRAMES = 256;
  const SAMPLES_PER_FRAME = 2048;     // industry standard frame size
  const MAX_UNIQUE_FRAMES = 64;       // cap of unique (key) sequences

  // --- UI Elements ---
  const stepsSlider     = document.getElementById('stepsPerFrame');
  const stepsValue      = document.getElementById('stepsPerFrameValue');
  const numEventsSlider = document.getElementById('numEvents');
  const numEventsValue  = document.getElementById('numEventsValue');
  const shapeSelect     = document.getElementById('eventShape');
  const combineSlider   = document.getElementById('combineChance');
  const combineValue    = document.getElementById('combineChanceValue');
  const exportSelect    = document.getElementById('exportFormat');     // NEW
  const generateButton  = document.getElementById('generateButton');
  const downloadLink    = document.getElementById('downloadLink');
  const statusMessage   = document.getElementById('statusMessage');

  let fileBlobUrl = null;

  // --- UI wiring ---
  stepsSlider.addEventListener('input', () => {
    stepsValue.textContent = stepsSlider.value;
    syncEventSliderMax();
  });
  numEventsSlider.addEventListener('input', () => {
    numEventsValue.textContent = numEventsSlider.value;
  });
  combineSlider.addEventListener('input', () => {
    combineValue.textContent = `${combineSlider.value}%`;
  });

  generateButton.addEventListener('click', () => {
    statusMessage.textContent = 'Generating...';
    downloadLink.classList.add('hidden');

    const steps          = clamp(parseInt(stepsSlider.value, 10), 4, 32);
    const maxEventsHere  = Math.min(24, steps);
    const numEvents      = clamp(parseInt(numEventsSlider.value, 10), 1, maxEventsHere);
    const eventShape     = shapeSelect.value;
    const combineChance  = parseInt(combineSlider.value, 10) / 100.0;
    const combinePercent = parseInt(combineSlider.value, 10);
    const exportFormat   = exportSelect.value; // "wav" | "wt"

    setTimeout(() => {
      const stepSizes = computeStepSizes(SAMPLES_PER_FRAME, steps);
      generateAndExport(stepSizes, numEvents, eventShape, combineChance, combinePercent, exportFormat);
    }, 50);
  });

  function syncEventSliderMax() {
    const steps = clamp(parseInt(stepsSlider.value, 10), 4, 32);
    const maxEventsHere = Math.min(24, steps);
    numEventsSlider.max = String(maxEventsHere);
    if (parseInt(numEventsSlider.value, 10) > maxEventsHere) {
      numEventsSlider.value = String(maxEventsHere);
      numEventsValue.textContent = numEventsSlider.value;
    }
  }
  syncEventSliderMax();

  // --- Orchestration ---
  function generateAndExport(stepSizes, numEvents, eventShape, combineChance, combinePercent, exportFormat) {
    const randomShape = eventShape === 'random' ? generateRandomShape(512) : null;

    // 0/1 patterns → combine some into 2s → dedupe → order by similarity
    const steps = stepSizes.length;
    const unique01     = generateUniquePatterns(MAX_UNIQUE_FRAMES, steps, numEvents);
    const combined     = applyCombineLogic(unique01, combineChance);
    const uniqueCombined = dedupePatterns(combined);
    const ordered      = orderBySimilarity(uniqueCombined);

    // --- MODIFICATION START ---
    // Assign a random amplitude to each unique frame/pattern
    // 0.25 to 1.0
    const orderedWithAmps = ordered.map(p => ({
        pattern: p,
        amplitude: 0.25 + (Math.random() * 0.75) 
    }));

    // Render key frames using the assigned amplitude
    const keyFrames = orderedWithAmps.map(item => 
        renderPatternToFrame(item.pattern, stepSizes, eventShape, randomShape, item.amplitude)
    );
    // --- MODIFICATION END ---

    // Interpolate to fill 256 frames
    const allFrames = insertInterpolatedFrames(keyFrames, TOTAL_FRAMES);

    // Flatten samples into a single Float32 buffer
    const audioData = flattenFrames(allFrames, SAMPLES_PER_FRAME);

    // Create the requested file format
    let blob, filenameBase =
      `WT_${steps}steps_${numEvents}ev_${eventShape}_${combinePercent}pct_2048spf_${TOTAL_FRAMES}f`;

    if (exportFormat === 'wt') {
      blob = createWtBlob(audioData, SAMPLES_PER_FRAME, TOTAL_FRAMES);
      setDownload(blob, `${filenameBase}.wt`);
    } else {
      blob = createWavBlob(audioData, 44100, SAMPLES_PER_FRAME * TOTAL_FRAMES);
      setDownload(blob, `${filenameBase}.wav`);
    }

    statusMessage.textContent = 'Wavetable Generated!';
  }

  function setDownload(blob, filename) {
    if (fileBlobUrl) URL.revokeObjectURL(fileBlobUrl);
    fileBlobUrl = URL.createObjectURL(blob);
    downloadLink.href = fileBlobUrl;
    downloadLink.download = filename;
    downloadLink.classList.remove('hidden');
  }

  // --- Math / helpers ---
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function computeStepSizes(total, steps) {
    const sizes = new Array(steps);
    for (let i = 0; i < steps; i++) {
      const a = Math.floor((i * total) / steps);
      const b = Math.floor(((i + 1) * total) / steps);
      sizes[i] = b - a;
    }
    return sizes;
  }

  function generateRandomShape(length) {
    const shape = new Float32Array(length);
    let current = Math.random(), next = current;
    for (let i = 0; i < length; i++) {
      if (i % 4 === 0) { current = next; next = Math.random(); }
      const t = (i % 4) / 4;
      shape[i] = current * (1 - t) + next * t;
    }
    const fade = Math.floor(length / 8);
    for (let i = 0; i < fade; i++) {
      const a = i / fade;
      shape[i] *= a;
      shape[length - 1 - i] *= a;
    }
    return shape;
  }

  function binomial(n, k) {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    k = Math.min(k, n - k);
    let res = 1;
    for (let i = 1; i <= k; i++) res = (res * (n - k + i)) / i;
    return Math.round(res);
  }
  function generateUniquePatterns(desiredCount, stepCount, eventCount) {
    const e = Math.min(eventCount, stepCount);
    const theoreticalMax = binomial(stepCount, e);
    const target = Math.min(desiredCount, theoreticalMax || 1);
    const seen = new Set(), out = [];
    if (e === 0) { out.push(new Uint8Array(stepCount).fill(0)); return out; }
    while (out.length < target) {
      const p = new Uint8Array(stepCount).fill(0);
      let placed = 0;
      while (placed < e) {
        const pos = Math.floor(Math.random() * stepCount);
        if (p[pos] === 0) { p[pos] = 1; placed++; }
      }
      const key = p.join('');
      if (!seen.has(key)) { seen.add(key); out.push(p); }
    }
    return out;
  }

  function applyCombineLogic(patterns, chance) {
    return patterns.map(src => {
      const p = [...src];
      for (let i = 0; i < p.length - 1; i++) {
        if (p[i] === 1 && p[i + 1] === 1 && Math.random() < chance) {
          p[i] = 2; p[i + 1] = 0; i++;
        }
      }
      return p;
    });
  }

  function dedupePatterns(patterns) {
    const out = [], seen = new Set();
    for (const p of patterns) {
      const key = p.join('');
      if (!seen.has(key)) { seen.add(key); out.push(p); }
      if (out.length === MAX_UNIQUE_FRAMES) break;
    }
    return out;
  }

  function patternToBinaryMask(p) {
    const m = new Uint8Array(p.length);
    for (let i = 0; i < p.length; i++) {
      if (p[i] === 1) m[i] = 1;
      else if (p[i] === 2) { m[i] = 1; if (i + 1 < p.length) m[i + 1] = 1; }
    }
    return m;
  }
  function hamming(a, b) { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; }
  function orderBySimilarity(patterns) {
    const N = patterns.length;
    if (N <= 1) return patterns.slice();
    const masks = patterns.map(patternToBinaryMask);
    const dist = Array.from({ length: N }, () => new Array(N).fill(0));
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const d = hamming(masks[i], masks[j]); dist[i][j] = dist[j][i] = d;
    }
    let start = 0, bestAvg = Infinity;
    for (let i = 0; i < N; i++) {
      const avg = dist[i].reduce((a, b) => a + b, 0) / (N - 1 || 1);
      if (avg < bestAvg) { bestAvg = avg; start = i; }
    }
    const visited = new Array(N).fill(false);
    const order = [start]; visited[start] = true;
    for (let k = 1; k < N; k++) {
      const last = order[order.length - 1];
      let best = -1, bestD = Infinity;
      for (let j = 0; j < N; j++) if (!visited[j] && dist[last][j] < bestD) { bestD = dist[last][j]; best = j; }
      order.push(best); visited[best] = true;
    }
    return order.map(i => patterns[i]);
  }

  // --- MODIFIED Rendering ---
  function renderPatternToFrame(pattern, stepSizes, shape, randomShape, amplitude) {
    // Fill with -1.0 (wavetable "silence" or floor for this engine)
    const buf = new Float32Array(SAMPLES_PER_FRAME).fill(-1.0);
    const steps = stepSizes.length;
    let pos = 0;
    for (let s = 0; s < steps; s++) {
      const type = pattern[s];
      if (type === 0) {
        pos += stepSizes[s];
      } else {
        let duration = stepSizes[s];
        if (type === 2) duration += stepSizes[s + 1] || 0;
        // Pass amplitude to shape renderer
        renderShape(buf, pos, duration, shape, randomShape, amplitude);
        pos += duration;
        if (type === 2) s++;
      }
    }
    return buf;
  }

  function renderShape(buffer, startPos, duration, shape, randomShape, amplitude) {
    // Basic shape generators (output range [0.0, 1.0] for t in [0, 1])
    const shapeGenerators = {
        sine: (t) => Math.sin(t * Math.PI),
        triangle: (t) => 1.0 - Math.abs((t * 2.0) - 1.0),
        saw: (t) => t,
        reversesaw: (t) => 1.0 - t,
        pulse: (t) => (t < 1.0) ? 1.0 : 0.0, 
        quarter_sine: (t) => Math.sin(t * (Math.PI / 2.0)), 
        quarter_cosine: (t) => Math.cos(t * (Math.PI / 2.0)),
        high: () => 1.0,
    };
    
    function getSampleFromFirstHalf(generatorName, t_half) {
        switch (generatorName) {
            case 'sine':     return shapeGenerators.quarter_sine(t_half);
            case 'triangle': return t_half;
            case 'saw':      return t_half;
            case 'reversesaw': return 1.0 - t_half;
            case 'pulse':    return shapeGenerators.high(t_half);
            default:         return 0.0;
        }
    }
    
    function getSampleFromSecondHalf(generatorName, t_half) {
        switch (generatorName) {
            case 'sine':     return shapeGenerators.quarter_cosine(t_half);
            case 'triangle': return 1.0 - t_half;
            case 'saw':      return 1.0 - t_half;
            case 'reversesaw': return t_half;
            case 'pulse':    return (t_half < 1.0) ? 1.0 : 0.0;
            default:         return 0.0;
        }
    }

    for (let i = 0; i < duration; i++) {
        const t = (duration === 1) ? 1.0 : (i / (duration - 1));
        let sample = 0.0;

        const parts = shape.split('_');

        if (parts.length === 2) {
            const firstShape = parts[0];
            const secondShape = parts[1];
            const isFirstHalf = t < 0.5;
            const t_half = isFirstHalf ? (t * 2.0) : ((t - 0.5) * 2.0);

            if (isFirstHalf) {
                sample = getSampleFromFirstHalf(firstShape, t_half);
            } else {
                sample = getSampleFromSecondHalf(secondShape, t_half);
            }
        } else {
            switch (shape) {
                case 'sine':
                case 'triangle':
                case 'saw':
                case 'reversesaw':
                case 'pulse':
                    sample = shapeGenerators[shape](t);
                    break;
                case 'shark':
                    const peakTime = 0.5;
                    if (t <= peakTime) {
                        const t_rise = t / peakTime;
                        sample = shapeGenerators.quarter_sine(t_rise);
                    } else {
                        const fallDuration = 1.0 - peakTime;
                        const t_fall = (t - peakTime) / fallDuration;
                        sample = 1.0 - t_fall;
                    }
                    break;
                case 'random':
                    sample = randomShape[Math.floor(t * (randomShape.length - 1))];
                    break;
            }
        }
        
        // --- MODIFIED Amplitude Scaling ---
        // Scale the unipolar sample (0 to 1) by amplitude (0 to A)
        // Then convert to bipolar -1 to 1 range (where -1 is floor)
        const scaledSample = sample * amplitude;
        
        // Final normalization and clipping
        // (0.0 -> -1.0) and (1.0 -> 1.0) IF amplitude is 1.0.
        // If amplitude is 0.5: (0.0 -> -1.0) and (0.5 -> 0.0).
        buffer[startPos + i] = Math.max(-1.0, Math.min(1.0, (scaledSample * 2.0) - 1.0));
    }
  }

  function insertInterpolatedFrames(keyFrames, totalTarget) {
    const U = keyFrames.length;
