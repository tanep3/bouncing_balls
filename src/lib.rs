use wasm_bindgen::prelude::*;
use rand::prelude::*;

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Ball {
    pub x: f32,
    pub y: f32,
    pub vx: f32,
    pub vy: f32,
    pub radius: f32,
    pub color: u32,
    pub just_split: u32, // Using u32 instead of bool for C compatibility (0 = false, 1 = true)
}

#[wasm_bindgen]
pub struct World {
    balls: Vec<Ball>,
    width: f32,
    height: f32,
    max_balls: usize,
    split_ratio: f32,
}

#[wasm_bindgen]
impl World {
    pub fn new(width: f32, height: f32, max_balls: usize, split_ratio: f32) -> World {
        let mut balls = Vec::with_capacity(max_balls);
        balls.push(Ball {
            x: width / 2.0,
            y: height / 2.0,
            vx: 8.0,
            vy: -6.0,
            radius: 60.0,
            color: 0xFF4444,
            just_split: 0,
        });
        World {
            balls,
            width,
            height,
            max_balls,
            split_ratio,
        }
    }

    pub fn update(&mut self) {
        let mut new_balls = Vec::new();
        let mut rng = rand::thread_rng();
        let current_len = self.balls.len();

        for ball in &mut self.balls {
            // Reset the just_split flag at the start of each frame
            let was_just_split = ball.just_split == 1;
            ball.just_split = 0;
            
            ball.x += ball.vx;
            ball.y += ball.vy;

            let mut hit_x = false;
            let mut hit_y = false;

            // Bounce x
            if ball.x - ball.radius < 0.0 {
                ball.x = ball.radius;
                ball.vx = ball.vx.abs(); // Force positive (right)
                hit_x = true;
            } else if ball.x + ball.radius > self.width {
                ball.x = self.width - ball.radius;
                ball.vx = -ball.vx.abs(); // Force negative (left)
                hit_x = true;
            }

            // Bounce y
            if ball.y - ball.radius < 0.0 {
                ball.y = ball.radius;
                ball.vy = ball.vy.abs(); // Force positive (down)
                hit_y = true;
            } else if ball.y + ball.radius > self.height {
                ball.y = self.height - ball.radius;
                ball.vy = -ball.vy.abs(); // Force negative (up)
                hit_y = true;
            }

            // Split logic: only split if we hit a wall AND didn't just split in the previous frame
            if (hit_x || hit_y) && !was_just_split && (current_len + new_balls.len() < self.max_balls) {
                // Calculate new radius
                let new_radius = ball.radius * self.split_ratio;
                
                // Only split if new radius would be >= 1.0 pixel
                if new_radius >= 1.0 {
                    ball.radius = new_radius;
                    ball.just_split = 1;
                    
                    // Create new ball
                    let mut new_ball = *ball;
                    
                    // Randomize velocity slightly but keep direction away from wall
                    let speed_factor = 0.8 + rng.gen::<f32>() * 0.4;
                    
                    new_ball.vx = ball.vx * speed_factor;
                    new_ball.vy = ball.vy * speed_factor;
                    
                    // Add slight angle jitter to make the split more visible
                    if hit_x {
                        // Perturb VY freely, but keep VX sign
                        new_ball.vy += (rng.gen::<f32>() - 0.5) * 2.0;
                    }
                    if hit_y {
                        // Perturb VX freely, but keep VY sign
                        new_ball.vx += (rng.gen::<f32>() - 0.5) * 2.0;
                    }

                    // Random color for new ball
                    new_ball.color = rng.gen::<u32>() & 0xFFFFFF;
                    new_ball.just_split = 1;
                    
                    new_balls.push(new_ball);
                } else {
                    // Keep minimum radius of 1.0
                    ball.radius = ball.radius.max(1.0);
                }
            }
        }

        self.balls.append(&mut new_balls);
    }

    pub fn get_balls_ptr(&self) -> *const Ball {
        self.balls.as_ptr()
    }

    pub fn get_balls_len(&self) -> usize {
        self.balls.len()
    }
    
    // New: Render directly to pixel buffer (RGBA format for ImageData)
    pub fn render_to_buffer(&self, buffer: &mut [u8], width: usize, height: usize) {
        // Clear buffer (black background)
        for pixel in buffer.chunks_exact_mut(4) {
            pixel[0] = 26;  // R
            pixel[1] = 26;  // G
            pixel[2] = 26;  // B
            pixel[3] = 255; // A
        }
        
        // Draw each ball as filled circles
        for ball in &self.balls {
            let cx = ball.x;
            let cy = ball.y;
            let r = ball.radius;
            let r_squared = r * r;
            
            // Extract RGB from color
            let red = ((ball.color >> 16) & 0xFF) as u8;
            let green = ((ball.color >> 8) & 0xFF) as u8;
            let blue = (ball.color & 0xFF) as u8;
            
            // Bounding box for efficiency
            let x_min = ((cx - r).max(0.0) as i32).max(0);
            let x_max = ((cx + r).min(width as f32) as i32).min(width as i32);
            let y_min = ((cy - r).max(0.0) as i32).max(0);
            let y_max = ((cy + r).min(height as f32) as i32).min(height as i32);
            
            // Draw filled circle using distance check
            for py in y_min..y_max {
                for px in x_min..x_max {
                    let dx = px as f32 - cx;
                    let dy = py as f32 - cy;
                    let dist_squared = dx * dx + dy * dy;
                    
                    // Only draw if inside circle
                    if dist_squared <= r_squared {
                        let idx = ((py as usize * width + px as usize) * 4) as usize;
                        if idx + 3 < buffer.len() {
                            buffer[idx] = red;
                            buffer[idx + 1] = green;
                            buffer[idx + 2] = blue;
                            buffer[idx + 3] = 255;
                        }
                    }
                }
            }
        }
    }
    
    // Get pointer to pixel buffer for zero-copy transfer
    pub fn get_buffer_ptr(&self) -> *const u8 {
        std::ptr::null() // Placeholder - buffer will be passed from JS
    }
}
