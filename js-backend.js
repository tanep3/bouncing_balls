// Pure JavaScript backend for ball physics
export class JSBackend {
    constructor(canvas, maxBalls, splitRatio) {
        this.canvas = canvas;
        this.maxBalls = maxBalls;
        this.splitRatio = splitRatio;
        this.balls = [];

        // Initialize with one ball
        this.balls.push({
            x: canvas.width / 2,
            y: canvas.height / 2,
            vx: 8.0,
            vy: -6.0,
            radius: 60.0,
            color: 0xFF4444,
            justSplit: false,
        });
    }

    update() {
        const newBalls = [];

        for (let i = 0; i < this.balls.length; i++) {
            const ball = this.balls[i];
            const wasJustSplit = ball.justSplit;
            ball.justSplit = false;

            // Update position
            ball.x += ball.vx;
            ball.y += ball.vy;

            let hitX = false;
            let hitY = false;

            // Bounce X
            if (ball.x - ball.radius < 0) {
                ball.x = ball.radius;
                ball.vx = Math.abs(ball.vx);
                hitX = true;
            } else if (ball.x + ball.radius > this.canvas.width) {
                ball.x = this.canvas.width - ball.radius;
                ball.vx = -Math.abs(ball.vx);
                hitX = true;
            }

            // Bounce Y
            if (ball.y - ball.radius < 0) {
                ball.y = ball.radius;
                ball.vy = Math.abs(ball.vy);
                hitY = true;
            } else if (ball.y + ball.radius > this.canvas.height) {
                ball.y = this.canvas.height - ball.radius;
                ball.vy = -Math.abs(ball.vy);
                hitY = true;
            }

            // Split logic
            if ((hitX || hitY) && !wasJustSplit) {
                const newRadius = ball.radius * this.splitRatio;

                if (newRadius >= 1.0 && this.balls.length + newBalls.length < this.maxBalls) {
                    ball.radius = newRadius;
                    ball.justSplit = true;

                    // Create new ball
                    const speedFactor = 0.8 + Math.random() * 0.4;
                    const newBall = {
                        x: ball.x,
                        y: ball.y,
                        vx: ball.vx * speedFactor,
                        vy: ball.vy * speedFactor,
                        radius: newRadius,
                        color: Math.floor(Math.random() * 0xFFFFFF),
                        justSplit: true,
                    };

                    if (hitX) {
                        newBall.vy += (Math.random() - 0.5) * 2.0;
                    }
                    if (hitY) {
                        newBall.vx += (Math.random() - 0.5) * 2.0;
                    }

                    newBalls.push(newBall);
                } else {
                    ball.radius = Math.max(ball.radius, 1.0);
                }
            }
        }

        // Merge new balls
        this.balls.push(...newBalls);
    }

    render(ctx) {
        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Fast rendering mode: batch by color
        const useFastMode = this.balls.length > 10000;

        if (useFastMode) {
            // Group balls by color
            const colorGroups = new Map();

            for (const ball of this.balls) {
                if (!colorGroups.has(ball.color)) {
                    colorGroups.set(ball.color, []);
                }
                colorGroups.get(ball.color).push(ball);
            }

            // Draw all balls of the same color together
            for (const [color, balls] of colorGroups) {
                const r = (color >> 16) & 0xFF;
                const g = (color >> 8) & 0xFF;
                const b = color & 0xFF;
                ctx.fillStyle = `rgb(${r},${g},${b})`;

                for (const ball of balls) {
                    ctx.fillRect(ball.x - ball.radius, ball.y - ball.radius, ball.radius * 2, ball.radius * 2);
                }
            }
        } else {
            // Slow mode: draw circles
            for (const ball of this.balls) {
                const r = (ball.color >> 16) & 0xFF;
                const g = (ball.color >> 8) & 0xFF;
                const b = ball.color & 0xFF;
                ctx.fillStyle = `rgb(${r},${g},${b})`;

                ctx.beginPath();
                ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.closePath();
            }
        }
    }

    getBallCount() {
        return this.balls.length;
    }

    async readBallCount() {
        return this.balls.length;
    }
}
