# API仕様書

**プロジェクト名**: Bouncing Balls ハイパフォーマンスシミュレーション  
**バージョン**: 2.0  
**作成日**: 2025-12-02  
**最終更新**: 2025-12-02

---

## 目次

1. [共通インターフェース](#1-共通インターフェース)
2. [WebGPU Backend API](#2-webgpu-backend-api)
3. [WASM Backend API](#3-wasm-backend-api)
4. [Pure JS Backend API](#4-pure-js-backend-api)
5. [データ型定義](#5-データ型定義)

---

## 1. 共通インターフェース

すべてのバックエンドは以下のインターフェースを実装します。

### 1.1 Backend Interface

```typescript
interface Backend {
    /**
     * 物理演算を実行（1フレーム分）
     */
    update(): void;
    
    /**
     * 描画を実行
     * @param ctx Canvas 2D Context（WebGPUでは不要）
     */
    render(ctx?: CanvasRenderingContext2D): void;
    
    /**
     * 現在のボール数を取得（同期）
     * @returns ボール数
     */
    getBallCount(): number;
    
    /**
     * 現在のボール数を取得（非同期、WebGPUのみ）
     * @returns ボール数のPromise
     */
    readBallCount?(): Promise<number>;
}
```

---

## 2. WebGPU Backend API

### 2.1 クラス: `WebGPUBackend`

**ファイル**: `webgpu-backend.js`

#### 2.1.1 コンストラクタ

```javascript
constructor(canvas: HTMLCanvasElement, maxBalls: number, splitRatio: number)
```

**パラメータ**:
- `canvas`: 描画対象のCanvas要素
- `maxBalls`: 最大ボール数（例: 1000000）
- `splitRatio`: 分裂時のサイズ比率（例: 0.8）

**例**:
```javascript
const backend = new WebGPUBackend(canvas, 1000000, 0.8);
```

---

#### 2.1.2 メソッド: `init()`

```javascript
async init(): Promise<boolean>
```

**説明**: WebGPUデバイスを初期化し、パイプラインとバッファを作成します。

**戻り値**: 初期化成功時 `true`

**エラー**: WebGPU非対応時、例外をスロー

**例**:
```javascript
try {
    await backend.init();
    console.log('WebGPU initialized');
} catch (error) {
    console.error('WebGPU not supported:', error);
}
```

---

#### 2.1.3 メソッド: `update()`

```javascript
update(): void
```

**説明**: GPU Compute Shaderで物理演算を実行します。

**処理内容**:
1. Compute Pipelineを設定
2. Workgroupを起動（`Math.ceil(ballCount / 64)`個）
3. GPUコマンドをサブミット

**例**:
```javascript
backend.update();
```

---

#### 2.1.4 メソッド: `render()`

```javascript
render(): void
```

**説明**: GPU Render Pipelineで描画を実行します。

**処理内容**:
1. Render Pipelineを設定
2. インスタンス描画（`draw(6, ballCount, 0, 0)`）
3. GPUコマンドをサブミット

**例**:
```javascript
backend.render();
```

---

#### 2.1.5 メソッド: `getBallCount()`

```javascript
getBallCount(): number
```

**説明**: キャッシュされたボール数を返します（高速、非同期なし）。

**戻り値**: ボール数

**例**:
```javascript
const count = backend.getBallCount();
console.log(`Balls: ${count}`);
```

---

#### 2.1.6 メソッド: `readBallCount()`

```javascript
async readBallCount(): Promise<number>
```

**説明**: GPUからボール数を読み取ります（低速、正確）。

**処理内容**:
1. 読み取り用バッファを作成
2. `ball_count`バッファをコピー
3. `mapAsync()`で読み取り
4. キャッシュを更新

**戻り値**: ボール数のPromise

**例**:
```javascript
const count = await backend.readBallCount();
console.log(`Accurate count: ${count}`);
```

---

#### 2.1.7 メソッド: `updateResolution()`

```javascript
updateResolution(): void
```

**説明**: Canvas解像度が変更された時、解像度バッファを更新します。

**例**:
```javascript
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    backend.updateResolution();
});
```

---

### 2.2 内部データ構造

#### 2.2.1 Ball Buffer（Storage）

**サイズ**: `maxBalls * 32` バイト

**レイアウト**:
```
struct Ball {
    pos: vec2<f32>,      // offset 0, 8バイト
    vel: vec2<f32>,      // offset 8, 8バイト
    radius: f32,         // offset 16, 4バイト
    color: u32,          // offset 20, 4バイト
    just_split: u32,     // offset 24, 4バイト
    padding: u32,        // offset 28, 4バイト
}
```

#### 2.2.2 Config Buffer（Uniform）

**サイズ**: 16バイト

**レイアウト**:
```
struct Config {
    width: f32,          // offset 0
    height: f32,         // offset 4
    max_balls: u32,      // offset 8
    split_ratio: f32,    // offset 12
}
```

#### 2.2.3 Ball Count Buffer（Storage, Atomic）

**サイズ**: 4バイト

**型**: `atomic<u32>`

---

## 3. WASM Backend API

### 3.1 クラス: `World` (Rust)

**ファイル**: `src/lib.rs`

#### 3.1.1 コンストラクタ

```rust
pub fn new(width: f32, height: f32, max_balls: usize, split_ratio: f32) -> World
```

**パラメータ**:
- `width`: Canvas幅
- `height`: Canvas高さ
- `max_balls`: 最大ボール数
- `split_ratio`: 分裂時のサイズ比率

**JavaScript例**:
```javascript
const backend = World.new(canvas.width, canvas.height, 1000000, 0.8);
```

---

#### 3.1.2 メソッド: `update()`

```rust
pub fn update(&mut self)
```

**説明**: 物理演算を実行します。

**処理内容**:
1. 各ボールの位置を更新
2. 壁衝突判定
3. 分裂処理（新しいボールを`Vec`に追加）
4. `just_split`フラグをクリア

**JavaScript例**:
```javascript
backend.update();
```

---

#### 3.1.3 メソッド: `render_to_buffer()`

```rust
pub fn render_to_buffer(&self, buffer: &mut [u8], width: usize, height: usize)
```

**説明**: ImageDataピクセルバッファに直接描画します。

**パラメータ**:
- `buffer`: RGBA形式のピクセルバッファ（`Uint8ClampedArray`）
- `width`: Canvas幅（ピクセル）
- `height`: Canvas高さ（ピクセル）

**処理内容**:
1. 背景クリア（RGB: 26, 26, 26）
2. 各ボールを円形で描画（距離判定）

**JavaScript例**:
```javascript
const imageData = ctx.createImageData(canvas.width, canvas.height);
backend.render_to_buffer(imageData.data, canvas.width, canvas.height);
ctx.putImageData(imageData, 0, 0);
```

---

#### 3.1.4 メソッド: `get_balls_len()`

```rust
pub fn get_balls_len(&self) -> usize
```

**説明**: 現在のボール数を返します。

**JavaScript例**:
```javascript
const count = backend.get_balls_len();
```

---

#### 3.1.5 メソッド: `get_balls_ptr()`

```rust
pub fn get_balls_ptr(&self) -> *const Ball
```

**説明**: ボール配列のポインタを返します（旧API、非推奨）。

**注意**: `render_to_buffer()`を使用することを推奨。

---

### 3.2 データ構造

#### 3.2.1 Ball構造体（Rust）

```rust
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Ball {
    pub x: f32,          // 位置X
    pub y: f32,          // 位置Y
    pub vx: f32,         // 速度X
    pub vy: f32,         // 速度Y
    pub radius: f32,     // 半径
    pub color: u32,      // 色（0xRRGGBB）
    pub just_split: u32, // 分裂フラグ（0 or 1）
}
```

**サイズ**: 28バイト

---

## 4. Pure JS Backend API

### 4.1 クラス: `JSBackend`

**ファイル**: `js-backend.js`

#### 4.1.1 コンストラクタ

```javascript
constructor(canvas: HTMLCanvasElement, maxBalls: number, splitRatio: number)
```

**パラメータ**:
- `canvas`: 描画対象のCanvas要素
- `maxBalls`: 最大ボール数
- `splitRatio`: 分裂時のサイズ比率

**例**:
```javascript
const backend = new JSBackend(canvas, 1000000, 0.8);
```

---

#### 4.1.2 メソッド: `update()`

```javascript
update(): void
```

**説明**: 物理演算を実行します。

**処理内容**:
1. 各ボールの位置を更新
2. 壁衝突判定
3. 分裂処理（新しいボールを配列に追加）
4. `justSplit`フラグをクリア

**例**:
```javascript
backend.update();
```

---

#### 4.1.3 メソッド: `render()`

```javascript
render(ctx: CanvasRenderingContext2D): void
```

**説明**: Canvas 2D APIで描画します。

**パラメータ**:
- `ctx`: Canvas 2D Context

**処理内容**:
1. 背景クリア
2. 色グループ化（`Map`）
3. 同じ色をまとめて描画（`fillRect`）

**例**:
```javascript
const ctx = canvas.getContext('2d');
backend.render(ctx);
```

---

#### 4.1.4 メソッド: `getBallCount()`

```javascript
getBallCount(): number
```

**説明**: 現在のボール数を返します。

**戻り値**: `this.balls.length`

**例**:
```javascript
const count = backend.getBallCount();
```

---

### 4.2 データ構造

#### 4.2.1 Ball オブジェクト

```typescript
interface Ball {
    x: number;          // 位置X
    y: number;          // 位置Y
    vx: number;         // 速度X
    vy: number;         // 速度Y
    radius: number;     // 半径
    color: number;      // 色（0xRRGGBB）
    justSplit: boolean; // 分裂フラグ
}
```

---

## 5. データ型定義

### 5.1 共通型

#### 5.1.1 色（Color）

**型**: `number` (32ビット整数)

**フォーマット**: `0xRRGGBB`

**例**:
```javascript
const red = 0xFF0000;
const green = 0x00FF00;
const blue = 0x0000FF;
```

**RGB抽出**:
```javascript
const r = (color >> 16) & 0xFF;
const g = (color >> 8) & 0xFF;
const b = color & 0xFF;
```

---

#### 5.1.2 位置・速度

**型**: `number` (32ビット浮動小数点)

**単位**: ピクセル（位置）、ピクセル/フレーム（速度）

---

#### 5.1.3 半径

**型**: `number` (32ビット浮動小数点)

**単位**: ピクセル

**制約**: `>= 1.0`（最小サイズ）

---

### 5.2 バックエンド固有型

#### 5.2.1 WebGPU

- **GPUDevice**: WebGPUデバイス
- **GPUBuffer**: GPUバッファ（Storage, Uniform）
- **GPUComputePipeline**: Compute Shader パイプライン
- **GPURenderPipeline**: Render パイプライン

#### 5.2.2 WASM

- **World**: Rustの`World`構造体（wasm-bindgenでエクスポート）
- **WebAssembly.Memory**: 共有メモリ

#### 5.2.3 Pure JS

- **Array<Ball>**: ボール配列

---

## 6. 使用例

### 6.1 WebGPU Backend

```javascript
import { WebGPUBackend } from './webgpu-backend.js';

const canvas = document.getElementById('canvas');
const backend = new WebGPUBackend(canvas, 1000000, 0.8);

await backend.init();

function loop() {
    backend.update();
    backend.render();
    requestAnimationFrame(loop);
}

loop();
```

---

### 6.2 WASM Backend

```javascript
import init, { World } from './pkg/bouncing_balls.js';

await init();

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const backend = World.new(canvas.width, canvas.height, 1000000, 0.8);

const imageData = ctx.createImageData(canvas.width, canvas.height);

function loop() {
    backend.update();
    backend.render_to_buffer(imageData.data, canvas.width, canvas.height);
    ctx.putImageData(imageData, 0, 0);
    requestAnimationFrame(loop);
}

loop();
```

---

### 6.3 Pure JS Backend

```javascript
import { JSBackend } from './js-backend.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const backend = new JSBackend(canvas, 1000000, 0.8);

function loop() {
    backend.update();
    backend.render(ctx);
    requestAnimationFrame(loop);
}

loop();
```

---

## 7. エラーコード

| コード | 説明 | 対処法 |
|--------|------|--------|
| `WebGPU not supported` | WebGPU非対応ブラウザ | WASMまたはPure JSにフォールバック |
| `No WebGPU adapter found` | GPUアダプタ取得失敗 | ドライバ更新、別ブラウザを試す |
| `Failed to get 2D context` | Canvas 2D Context取得失敗 | Canvas再作成 |
| `WASM module failed to load` | WASMモジュールロード失敗 | ビルド確認、Pure JSにフォールバック |

---

**変更履歴**:

| バージョン | 日付 | 変更内容 |
|-----------|------|---------|
| 1.0 | 2025-11-XX | 初版（WASM API） |
| 2.0 | 2025-12-02 | WebGPU/Pure JS API追加、`render_to_buffer`追加 |
