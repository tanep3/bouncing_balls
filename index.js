import init, { World } from './pkg/bouncing_balls.js';
import { WebGPUBackend } from './webgpu-backend.js';
import { JSBackend } from './js-backend.js';

async function run() {
    // Setup Canvas
    let canvas = document.getElementById('canvas');
    let ctx = null;

    // Declare backend variables first
    let backend = null;
    let currentBackendType = null; // 'webgpu', 'wasm', or 'js'
    let wasmModule = null;
    let wasmMemory = null;
    let animationFrameId = null;

    // Recreate canvas (needed when switching between webgpu and 2d contexts)
    function recreateCanvas() {
        const oldCanvas = canvas;
        const newCanvas = document.createElement('canvas');
        newCanvas.id = 'canvas';
        newCanvas.width = window.innerWidth;
        newCanvas.height = window.innerHeight;
        oldCanvas.parentNode.replaceChild(newCanvas, oldCanvas);
        canvas = newCanvas;
        ctx = null;
    }

    // Resize canvas to fit window
    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        if (backend && currentBackendType === 'webgpu') {
            backend.updateResolution();
        }
    }
    window.addEventListener('resize', resize);
    resize();

    // Configuration
    const MAX_BALLS = 1000000;
    const SPLIT_RATIO = 0.8;
    let targetFPS = 60;
    let frameInterval = 1000 / targetFPS;

    // UI Elements
    const ballCountElem = document.getElementById('ball-count');
    const fpsElem = document.getElementById('fps');
    const targetFpsElem = document.getElementById('target-fps');
    const frameTimeElem = document.getElementById('frame-time');
    const timeUpdateElem = document.getElementById('time-update');
    const timeRenderElem = document.getElementById('time-render');
    const backendElem = document.getElementById('backend');
    const btnWebGPU = document.getElementById('btn-webgpu');
    const btnWASM = document.getElementById('btn-wasm');
    const btnJS = document.getElementById('btn-js');
    const btnFPS60 = document.getElementById('btn-fps-60');
    const btnFPS120 = document.getElementById('btn-fps-120');

    // Initialize WASM module once
    try {
        wasmModule = await init();
        wasmMemory = wasmModule.memory;
        console.log('✓ WASM module loaded');
    } catch (error) {
        console.warn('WASM module failed to load:', error);
    }

    // Stop current animation loop
    function stopAnimation() {
        if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    }

    // Backend initialization functions
    async function initWebGPU() {
        try {
            console.log('Initializing WebGPU...');
            stopAnimation();

            // Recreate canvas if switching from 2D context
            if (currentBackendType === 'wasm' || currentBackendType === 'js') {
                recreateCanvas();
            }

            backend = new WebGPUBackend(canvas, MAX_BALLS, SPLIT_RATIO);
            await backend.init();
            currentBackendType = 'webgpu';
            backendElem.textContent = 'WebGPU (GPU Rendering)';
            backendElem.style.color = '#4CAF50';
            console.log('✓ WebGPU initialized');
            startAnimation();
            return true;
        } catch (error) {
            console.error('WebGPU initialization failed:', error);
            return false;
        }
    }

    async function initWASM() {
        if (!wasmModule) {
            console.error('WASM module not available');
            return false;
        }
        try {
            console.log('Initializing WASM...');
            stopAnimation();

            // Recreate canvas if switching from WebGPU
            if (currentBackendType === 'webgpu') {
                recreateCanvas();
            }

            ctx = canvas.getContext('2d');
            if (!ctx) {
                throw new Error('Failed to get 2D context');
            }

            backend = World.new(canvas.width, canvas.height, MAX_BALLS, SPLIT_RATIO);
            currentBackendType = 'wasm';
            backendElem.textContent = 'WASM (Rust)';
            backendElem.style.color = '#FF9800';
            console.log('✓ WASM initialized');
            startAnimation();
            return true;
        } catch (error) {
            console.error('WASM initialization failed:', error);
            return false;
        }
    }

    async function initJS() {
        try {
            console.log('Initializing Pure JS...');
            stopAnimation();

            // Recreate canvas if switching from WebGPU
            if (currentBackendType === 'webgpu') {
                recreateCanvas();
            }

            ctx = canvas.getContext('2d');
            if (!ctx) {
                throw new Error('Failed to get 2D context');
            }

            backend = new JSBackend(canvas, MAX_BALLS, SPLIT_RATIO);
            currentBackendType = 'js';
            backendElem.textContent = 'Pure JavaScript';
            backendElem.style.color = '#2196F3';
            console.log('✓ Pure JS initialized');
            startAnimation();
            return true;
        } catch (error) {
            console.error('JS initialization failed:', error);
            return false;
        }
    }

    // Animation Loop
    let lastTime = performance.now();
    let lastRenderTime = lastTime;
    let frames = 0;
    let renderedFrames = 0;
    let lastFpsTime = lastTime;
    let lastBallCountUpdate = lastTime;
    let lastFrameTime = 0;

    function loop(currentTime) {
        animationFrameId = requestAnimationFrame(loop);

        // FPS limiting
        const deltaTime = currentTime - lastRenderTime;
        if (deltaTime < frameInterval) {
            return; // Skip rendering this frame
        }

        lastFrameTime = deltaTime;
        lastRenderTime = currentTime - (deltaTime % frameInterval);
        lastTime = currentTime;

        // Count rendered frames (not requestAnimationFrame calls)
        renderedFrames++;

        // Calculate FPS based on rendered frames
        frames++;
        if (currentTime - lastFpsTime >= 1000) {
            fpsElem.innerText = renderedFrames;
            frameTimeElem.innerText = lastFrameTime.toFixed(2);
            renderedFrames = 0;
            frames = 0;
            lastFpsTime = currentTime;
        }

        if (currentBackendType === 'webgpu') {
            // WebGPU path: Everything on GPU
            const t0 = performance.now();
            backend.update();
            const t1 = performance.now();
            backend.render();
            const t2 = performance.now();

            timeUpdateElem.innerText = (t1 - t0).toFixed(2);
            timeRenderElem.innerText = (t2 - t1).toFixed(2);

            // Update ball count display every 100ms
            if (currentTime - lastBallCountUpdate >= 100) {
                backend.readBallCount().then(count => {
                    ballCountElem.innerText = count;
                });
                lastBallCountUpdate = currentTime;
            } else {
                ballCountElem.innerText = backend.getBallCount();
            }
        } else if (currentBackendType === 'wasm') {
            // WASM path: Pixel buffer rendering (ultra-fast)
            const t0 = performance.now();
            backend.update();
            const t1 = performance.now();

            // Create ImageData if not exists or size changed
            if (!ctx.imageData || ctx.imageData.width !== canvas.width || ctx.imageData.height !== canvas.height) {
                ctx.imageData = ctx.createImageData(canvas.width, canvas.height);
            }

            // Get the pixel buffer from ImageData
            const pixelBuffer = ctx.imageData.data;

            // Call WASM to render directly to pixel buffer
            backend.render_to_buffer(pixelBuffer, canvas.width, canvas.height);

            // Put the entire image at once (super fast!)
            ctx.putImageData(ctx.imageData, 0, 0);

            const t2 = performance.now();
            timeUpdateElem.innerText = (t1 - t0).toFixed(2);
            timeRenderElem.innerText = (t2 - t1).toFixed(2);

            ballCountElem.innerText = backend.get_balls_len();
        } else if (currentBackendType === 'js') {
            // Pure JS path
            const t0 = performance.now();
            backend.update();
            const t1 = performance.now();
            backend.render(ctx);
            const t2 = performance.now();

            timeUpdateElem.innerText = (t1 - t0).toFixed(2);
            timeRenderElem.innerText = (t2 - t1).toFixed(2);
            ballCountElem.innerText = backend.getBallCount();
        }

        animationFrameId = requestAnimationFrame(loop);
    }

    function startAnimation() {
        lastTime = performance.now();
        frames = 0;
        lastFpsTime = lastTime;
        lastBallCountUpdate = lastTime;
        animationFrameId = requestAnimationFrame(loop);
    }

    // Button event handlers
    btnWebGPU.addEventListener('click', async () => {
        console.log('WebGPU button clicked');
        if (currentBackendType !== 'webgpu') {
            const success = await initWebGPU();
            if (!success) {
                alert('WebGPU is not available on this browser');
            }
        }
    });

    btnWASM.addEventListener('click', async () => {
        console.log('WASM button clicked');
        if (currentBackendType !== 'wasm') {
            const success = await initWASM();
            if (!success) {
                alert('WASM backend failed to initialize');
            }
        }
    });

    btnJS.addEventListener('click', async () => {
        console.log('JS button clicked');
        if (currentBackendType !== 'js') {
            await initJS();
        }
    });

    // FPS limit button handlers
    btnFPS60.addEventListener('click', () => {
        targetFPS = 60;
        frameInterval = 1000 / targetFPS;
        targetFpsElem.innerText = '60';
        btnFPS60.style.background = '#4CAF50';
        btnFPS120.style.background = '#555';
        console.log('FPS limit set to 60');
    });

    btnFPS120.addEventListener('click', () => {
        targetFPS = 120;
        frameInterval = 1000 / targetFPS;
        targetFpsElem.innerText = '120';
        btnFPS60.style.background = '#555';
        btnFPS120.style.background = '#4CAF50';
        console.log('FPS limit set to 120');
    });

    // Try to initialize WebGPU by default, fallback to WASM, then JS
    let initialized = await initWebGPU();
    if (!initialized) {
        initialized = await initWASM();
    }
    if (!initialized) {
        initialized = await initJS();
    }

    if (!initialized) {
        alert('Failed to initialize any backend!');
        return;
    }
}

run().catch(console.error);
