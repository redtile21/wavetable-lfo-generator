document.addEventListener('DOMContentLoaded', () => {
    // --- Constants ---
    const TOTAL_FRAMES = 256;
    const SAMPLES_PER_FRAME = 256;
    const STEPS_PER_FRAME = 16;
    const SAMPLES_PER_STEP = SAMPLES_PER_FRAME / STEPS_PER_FRAME; // 16

    // --- UI Elements ---
    const numEventsSlider = document.getElementById('numEvents');
    const numEventsValue = document.getElementById('numEventsValue');
    const shapeSelect = document.getElementById('eventShape');
    const combineSlider = document.getElementById('combineChance');
    const combineValue = document.getElementById('combineChanceValue');
    const generateButton = document.getElementById('generateButton');
    const downloadLink = document.getElementById('downloadLink');
    // **CHANGED:** Added status message element
    const statusMessage = document.getElementById('statusMessage');

    let wavBlobUrl = null; // Store the blob URL to revoke it later

    // --- UI Event Listeners ---
    numEventsSlider.addEventListener('input', () => {
        numEventsValue.textContent = numEventsSlider.value;
    });

    combineSlider.addEventListener('input', () => {
        combineValue.textContent = `${combineSlider.value}%`;
    });

    generateButton.addEventListener('click', () => {
        // **CHANGED:** Update UI to show feedback
        statusMessage.textContent = 'Generating...';
        downloadLink.classList.add('hidden');
        
        // Get settings from UI
        const numEvents = parseInt(numEventsSlider.value, 10);
        const eventShape = shapeSelect.value;
        const combineChance = parseInt(combineSlider.value, 10) / 100.0;
        const combinePercent = parseInt(combineSlider.value, 10); // For filename

        console.log(`Generating ${TOTAL_FRAMES} frames...`);
        console.log(`Settings: Events=${numEvents}, Shape=${eventShape}, Combine=${combineChance}`);
        
        // Use a small timeout to allow the "Generating..." message to render
        setTimeout(() => {
            generateWavetable(numEvents, eventShape, combineChance, combinePercent);
        }, 50); // 50ms delay
    });

    // --- Generation Logic ---

    function generateWavetable(numEvents, eventShape, combineChance, combinePercent) {
        // 1. Generate the base "random" shape if needed
        const randomShape = eventShape === 'random' ? generateRandomShape(SAMPLES_PER_STEP) : null;

        // 2. Generate all 256 unique patterns
        let patterns = generatePatterns(TOTAL_FRAMES, STEPS_PER_FRAME, numEvents);

        // 3. Apply "combine" logic to the patterns
        let combinedPatterns = applyCombineLogic(patterns, combineChance);

        // 4. Render the audio data
        const audioData = renderAudioData(combinedPatterns, eventShape, randomShape);

        // 5. Create the WAV file blob
        const wavBlob = createWavBlob(audioData, 44100, SAMPLES_PER_FRAME * TOTAL_FRAMES);

        // 6. Set up the download link
        if (wavBlobUrl) {
            URL.revokeObjectURL(wavBlobUrl); // Clean up old blob URL
        }
        wavBlobUrl = URL.createObjectURL(wavBlob);
        downloadLink.href = wavBlobUrl;
        
        // **CHANGED:** Set dynamic filename
        downloadLink.download = `WT_${numEvents}_${eventShape}_${combinePercent}.wav`;
        
        downloadLink.classList.remove('hidden');
        
        // **CHANGED:** Update status message
        statusMessage.textContent = 'Wavetable Generated!';
        
        console.log("Wavetable generated and ready for download.");
    }

    /**
     * Generates a 1D array (table) for a random single-cycle waveform.
     */
    function generateRandomShape(length) {
        let shape = new Float32Array(length);
        // Simple random points, slightly smoothed
        let randVal = Math.random();
        let lastVal = randVal;
        for (let i = 0; i < length; i++) {
            if (i % 4 === 0) { // Change value every 4 samples
                randVal = Math.random();
            }
            // Linear interpolation between points
            let t = (i % 4) / 4.0;
            shape[i] = lastVal * (1 - t) + randVal * t;
        }
        // Ensure it starts and ends at 0 for a clean loop (optional, but good)
        // For this unipolar case, we just taper the ends.
        let fadeSamples = Math.floor(length / 8);
        for(let i = 0; i < fadeSamples; i++) {
            let t = i / fadeSamples;
            shape[i] *= t;
            shape[length - 1 - i] *= t;
        }
        return shape;
    }

    /**
     * Generates an array of 256 unique, random 16-step patterns.
     */
    function generatePatterns(frameCount, stepCount, eventCount) {
        let patterns = new Set(); // Use a Set to easily check for uniqueness
        let finalPatterns = [];

        while (patterns.size < frameCount) {
            let pattern = new Uint8Array(stepCount).fill(0);
            let eventsPlaced = 0;
            while (eventsPlaced < eventCount) {
                let pos = Math.floor(Math.random() * stepCount);
                if (pattern[pos] === 0) {
                    pattern[pos] = 1;
                    eventsPlaced++;
                }
            }
            // Add to Set as a string to ensure uniqueness check works
            patterns.add(pattern.join(''));
        }
        
        // Convert the Set of strings back to arrays of numbers
        patterns.forEach(pStr => {
            finalPatterns.push(pStr.split('').map(Number));
        });
        
        return finalPatterns;
    }

    /**
     * Modifies patterns based on combine logic.
     * Replaces [1, 1] with [2, 0] based on probability.
     */
    function applyCombineLogic(patterns, chance) {
        return patterns.map(pattern => {
            let newPattern = [...pattern]; // Work on a copy
            for (let i = 0; i < newPattern.length - 1; i++) {
                // Check for adjacent events
                if (newPattern[i] === 1 && newPattern[i + 1] === 1) {
                    // Check probability
                    if (Math.random() < chance) {
                        newPattern[i] = 2;   // Mark as double-length event
                        newPattern[i + 1] = 0; // Clear the next event
                        i++; // Skip the next event since we just processed it
                    }
                }
            }
            return newPattern;
        });
    }

    /**
     * Renders the full wavetable audio data from the patterns.
     */
    function renderAudioData(patterns, shape, randomShape) {
        const totalSamples = TOTAL_FRAMES * SAMPLES_PER_FRAME;
        // Initialize buffer to -1.0 (silence)
        let audio = new Float32Array(totalSamples).fill(-1.0);
        let audioPos = 0;

        for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
            const pattern = patterns[frame];
            
            for (let step = 0; step < STEPS_PER_FRAME; step++) {
                const eventType = pattern[step];
                let duration = SAMPLES_PER_STEP; // Default 16 samples
                
                if (eventType === 0) {
                    // Silence. Buffer is already -1.0, so just advance position.
                    audioPos += duration;
                } else {
                    if (eventType === 2) {
                        duration = SAMPLES_PER_STEP * 2; // 32 samples
                    }

                    // Render the shape
                    renderShape(audio, audioPos, duration, shape, randomShape);

                    audioPos += duration; // Advance by the duration
                    
                    if (eventType === 2) {
                        step++; // Skip the next step index
                    }
                }
            }
        }
        return audio;
    }

    /**
     * Writes a single shape into the audio buffer at a given position.
     * All shapes are 0.0 to 1.0 (unipolar).
     */
    function renderShape(buffer, startPos, duration, shape, randomShape) {
        for (let i = 0; i < duration; i++) {
            // 't' is the phase, from 0.0 to 1.0
            let t = (i / (duration - 1)); 
            if (duration === 1) t = 1.0; // Avoid divide by zero if duration is 1
            
            let sample = 0.0; // This is the [0.0, 1.0] unipolar sample

            switch (shape) {
                case 'sine':
                    // Half-cycle (positive portion of sine wave)
                    sample = Math.sin(t * Math.PI);
                    break;
                case 'triangle':
                    // Full triangle cycle (0 -> 1 -> 0)
                    sample = 1.0 - Math.abs((t * 2.0) - 1.0);
                    break;
                case 'saw':
                    // Ramp up
                    sample = t;
                    break;
                case 'pulse':
                    // 50% pulse
                    sample = t < 0.5 ? 1.0 : 0.0;
                    break;
                case 'random':
                    // Stretch the pre-generated random shape to fit
                    let randIdx = Math.floor(t * (randomShape.length - 1));
                    sample = randomShape[randIdx];
                    break;
            }
            
            // Remap from [0.0, 1.0] unipolar to [-1.0, 1.0] bipolar
            let bipolarSample = (sample * 2.0) - 1.0;
            
            // Ensure sample is within bounds (prevents clicks)
            buffer[startPos + i] = Math.max(-1.0, Math.min(1.0, bipolarSample));
        }
    }


    // --- WAV File Creation ---
    // This is boilerplate code to create a valid 16-bit PCM WAV file.

    function createWavBlob(audioData, sampleRate, totalSamples) {
        const dataSize = totalSamples * 2; // 16-bit (2 bytes)
        const fileSize = 44 + dataSize; // 44 bytes for header
        
        const buffer = new ArrayBuffer(fileSize);
        const view = new DataView(buffer);

        // RIFF chunk descriptor
        writeString(view, 0, 'RIFF');
        view.setUint32(4, fileSize - 8, true); // file-size - 8
        writeString(view, 8, 'WAVE');
        
        // "fmt " sub-chunk
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true); // chunk size
        view.setUint16(20, 1, true); // audio format (1 = PCM)
        view.setUint16(22, 1, true); // num channels
        view.setUint32(24, sampleRate, true); // sample rate
        view.setUint32(28, sampleRate * 2, true); // byte rate (SampleRate * NumChannels * BitsPerSample/8)
        view.setUint16(32, 2, true); // block align (NumChannels * BitsPerSample/8)
        view.setUint16(34, 16, true); // bits per sample
        
        // "data" sub-chunk
        writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true); // sub-chunk size

        // Write the audio data (converting float -1 to 1 to 16-bit int -32767 to 32767)
        let offset = 44;
        for (let i = 0; i < totalSamples; i++) {
            // Clamp to [-1.0, 1.0]
            let s = Math.max(-1.0, Math.min(1.0, audioData[i]));
            // Map to bipolar 16-bit range
            let val = Math.floor(s * 32767.0);
            view.setInt16(offset, val, true);
            offset += 2;
        }

        return new Blob([view], { type: 'audio/wav' });
    }

    function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }
});