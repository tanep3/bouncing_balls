import { computeShaderCode, vertexShaderCode, fragmentShaderCode } from './compute-shader.js';

export class WebGPUBackend {
    constructor(canvas, maxBalls, splitRatio) {
        this.canvas = canvas;
        this.maxBalls = maxBalls;
        this.splitRatio = splitRatio;
        this.device = null;
        this.context = null;
        this.computePipeline = null;
        this.renderPipeline = null;
        this.computeBindGroup = null;
        this.renderBindGroup = null;
        this.ballBuffer = null;
        this.configBuffer = null;
        this.ballCountBuffer = null;
        this.resolutionBuffer = null;
        this.ballCount = 1;
    }

    async init() {
        if (!navigator.gpu) {
            throw new Error('WebGPU not supported');
        }

        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            throw new Error('No WebGPU adapter found');
        }

        this.device = await adapter.requestDevice();

        // Configure canvas context
        this.context = this.canvas.getContext('webgpu');
        const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
            device: this.device,
            format: canvasFormat,
            alphaMode: 'opaque',
        });

        // Create shader modules
        const computeModule = this.device.createShaderModule({ code: computeShaderCode });
        const vertexModule = this.device.createShaderModule({ code: vertexShaderCode });
        const fragmentModule = this.device.createShaderModule({ code: fragmentShaderCode });

        // Create compute pipeline
        this.computePipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: {
                module: computeModule,
                entryPoint: 'main',
            },
        });

        // Create render pipeline
        this.renderPipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: vertexModule,
                entryPoint: 'main',
            },
            fragment: {
                module: fragmentModule,
                entryPoint: 'main',
                targets: [{ format: canvasFormat }],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });

        await this.initBuffers();
        return true;
    }

    async initBuffers() {
        const ballSize = 32;
        const maxBufferSize = this.maxBalls * ballSize;

        // Create ball buffer
        this.ballBuffer = this.device.createBuffer({
            size: maxBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        // Create config buffer (uniform, read-only)
        this.configBuffer = this.device.createBuffer({
            size: 16, // 4 floats
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Create ball count buffer (storage, atomic)
        this.ballCountBuffer = this.device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });

        // Create resolution buffer
        this.resolutionBuffer = this.device.createBuffer({
            size: 8,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Initialize with one ball
        const initialBall = new Float32Array([
            this.canvas.width / 2, this.canvas.height / 2,  // pos
            8.0, -6.0,                                       // vel
            60.0,                                            // radius
        ]);
        const initialBallU32 = new Uint32Array([
            0xFF4444,  // color
            0,         // just_split
            0,         // padding
        ]);

        const initialData = new ArrayBuffer(ballSize);
        new Float32Array(initialData, 0, 5).set(initialBall);
        new Uint32Array(initialData, 20, 3).set(initialBallU32);

        this.device.queue.writeBuffer(this.ballBuffer, 0, initialData);

        // Initialize ball count
        this.device.queue.writeBuffer(this.ballCountBuffer, 0, new Uint32Array([1]));

        this.updateConfig();
        this.updateResolution();

        // Create bind groups
        this.computeBindGroup = this.device.createBindGroup({
            layout: this.computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.ballBuffer } },
                { binding: 1, resource: { buffer: this.configBuffer } },
                { binding: 2, resource: { buffer: this.ballCountBuffer } },
            ],
        });

        this.renderBindGroup = this.device.createBindGroup({
            layout: this.renderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.ballBuffer } },
                { binding: 1, resource: { buffer: this.resolutionBuffer } },
            ],
        });
    }

    updateConfig() {
        // Shader struct Config:
        // width: f32, height: f32, max_balls: u32, split_ratio: f32
        const configData = new ArrayBuffer(16);
        const f32View = new Float32Array(configData);
        const u32View = new Uint32Array(configData);

        f32View[0] = this.canvas.width;   // offset 0: f32
        f32View[1] = this.canvas.height;  // offset 4: f32
        u32View[2] = this.maxBalls;       // offset 8: u32
        f32View[3] = this.splitRatio;     // offset 12: f32

        this.device.queue.writeBuffer(this.configBuffer, 0, configData);

        console.log(`Config updated: width=${this.canvas.width}, height=${this.canvas.height}, max_balls=${this.maxBalls}, split_ratio=${this.splitRatio}`);
    }

    updateResolution() {
        const resolution = new Float32Array([this.canvas.width, this.canvas.height]);
        this.device.queue.writeBuffer(this.resolutionBuffer, 0, resolution);
    }

    update() {
        const commandEncoder = this.device.createCommandEncoder();

        // Compute pass
        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this.computePipeline);
        computePass.setBindGroup(0, this.computeBindGroup);

        const workgroupCount = Math.ceil(this.ballCount / 64);
        computePass.dispatchWorkgroups(workgroupCount);
        computePass.end();

        this.device.queue.submit([commandEncoder.finish()]);
    }

    render() {
        const commandEncoder = this.device.createCommandEncoder();

        // Render pass
        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });

        renderPass.setPipeline(this.renderPipeline);
        renderPass.setBindGroup(0, this.renderBindGroup);
        renderPass.draw(6, this.ballCount, 0, 0);
        renderPass.end();

        this.device.queue.submit([commandEncoder.finish()]);
    }

    async readBallCount() {
        const readBuffer = this.device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyBufferToBuffer(this.ballCountBuffer, 0, readBuffer, 0, 4);
        this.device.queue.submit([commandEncoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);
        const count = new Uint32Array(readBuffer.getMappedRange())[0];
        readBuffer.unmap();

        this.ballCount = count;
        return count;
    }

    getBallCount() {
        return this.ballCount;
    }
}
