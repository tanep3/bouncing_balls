// WebGPU Compute Shader for ball physics
export const computeShaderCode = `
struct Ball {
    pos: vec2<f32>,
    vel: vec2<f32>,
    radius: f32,
    color: u32,
    just_split: u32,
    padding: u32,
}

struct Config {
    width: f32,
    height: f32,
    max_balls: u32,
    split_ratio: f32,
}

@group(0) @binding(0) var<storage, read_write> balls: array<Ball>;
@group(0) @binding(1) var<uniform> config: Config;
@group(0) @binding(2) var<storage, read_write> ball_count: atomic<u32>;

// Simple random number generator
var<private> seed: u32;

fn random() -> f32 {
    seed = seed * 747796405u + 2891336453u;
    let result = ((seed >> ((seed >> 28u) + 4u)) ^ seed) * 277803737u;
    return f32((result >> 22u) ^ result) / 4294967295.0;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;
    let current_count = atomicLoad(&ball_count);
    
    if (idx >= current_count) {
        return;
    }
    
    seed = idx * 747796405u + u32(config.width * config.height);
    
    var ball = balls[idx];
    let was_just_split = ball.just_split == 1u;
    ball.just_split = 0u;
    
    // Update position
    ball.pos += ball.vel;
    
    var hit_x = false;
    var hit_y = false;
    
    // Bounce X
    if (ball.pos.x - ball.radius < 0.0) {
        ball.pos.x = ball.radius;
        ball.vel.x = abs(ball.vel.x);
        hit_x = true;
    } else if (ball.pos.x + ball.radius > config.width) {
        ball.pos.x = config.width - ball.radius;
        ball.vel.x = -abs(ball.vel.x);
        hit_x = true;
    }
    
    // Bounce Y
    if (ball.pos.y - ball.radius < 0.0) {
        ball.pos.y = ball.radius;
        ball.vel.y = abs(ball.vel.y);
        hit_y = true;
    } else if (ball.pos.y + ball.radius > config.height) {
        ball.pos.y = config.height - ball.radius;
        ball.vel.y = -abs(ball.vel.y);
        hit_y = true;
    }
    
    // Split logic
    if ((hit_x || hit_y) && !was_just_split) {
        // Calculate new radius first
        let new_radius = ball.radius * config.split_ratio;
        
        // Only split if the new radius would be >= 1.0 pixel
        if (new_radius >= 1.0) {
            let current_total = atomicLoad(&ball_count);
            
            // Check if we can add one more ball
            if (current_total < config.max_balls) {
                ball.radius = new_radius;
                ball.just_split = 1u;
                
                // Try to reserve a slot for the new ball
                let new_idx = atomicAdd(&ball_count, 1u);
                
                // atomicAdd returns the OLD value, so new_idx is the index we got
                // The new count is now new_idx + 1
                // Only create the ball if the NEW count doesn't exceed max_balls
                if (new_idx + 1u <= config.max_balls) {
                    var new_ball = ball;
                    let speed_factor = 0.8 + random() * 0.4;
                    new_ball.vel = ball.vel * speed_factor;
                    
                    if (hit_x) {
                        new_ball.vel.y += (random() - 0.5) * 2.0;
                    }
                    if (hit_y) {
                        new_ball.vel.x += (random() - 0.5) * 2.0;
                    }
                    
                    new_ball.color = u32(random() * 16777215.0);
                    new_ball.just_split = 1u;
                    
                    balls[new_idx] = new_ball;
                } else {
                    // We exceeded the limit, decrement back
                    atomicSub(&ball_count, 1u);
                }
            }
        } else {
            // Radius too small, keep current size
            ball.radius = max(ball.radius, 1.0);
        }
    }
    
    balls[idx] = ball;
}
`;

// WebGPU Vertex Shader for rendering circles
export const vertexShaderCode = `
struct Ball {
    pos: vec2<f32>,
    vel: vec2<f32>,
    radius: f32,
    color: u32,
    just_split: u32,
    padding: u32,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec3<f32>,
    @location(1) uv: vec2<f32>,
}

@group(0) @binding(0) var<storage, read> balls: array<Ball>;
@group(0) @binding(1) var<uniform> resolution: vec2<f32>;

@vertex
fn main(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
    let ball = balls[instanceIndex];
    
    // Create a quad
    var positions = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>( 1.0,  1.0)
    );
    
    let pos = positions[vertexIndex];
    let worldPos = ball.pos + pos * ball.radius;
    
    // Convert to clip space
    let clipPos = (worldPos / resolution) * 2.0 - 1.0;
    
    var output: VertexOutput;
    output.position = vec4<f32>(clipPos.x, -clipPos.y, 0.0, 1.0);
    output.uv = pos; // -1 to 1
    
    // Extract RGB from u32 color
    let r = f32((ball.color >> 16u) & 0xFFu) / 255.0;
    let g = f32((ball.color >> 8u) & 0xFFu) / 255.0;
    let b = f32(ball.color & 0xFFu) / 255.0;
    output.color = vec3<f32>(r, g, b);
    
    return output;
}
`;

// WebGPU Fragment Shader - draw circles
export const fragmentShaderCode = `
@fragment
fn main(
    @location(0) color: vec3<f32>,
    @location(1) uv: vec2<f32>
) -> @location(0) vec4<f32> {
    // Draw circle using distance from center
    let dist = length(uv);
    if (dist > 1.0) {
        discard;
    }
    return vec4<f32>(color, 1.0);
}
`;
