# Physarum Oracle 技术文档

## 1. 技术栈

Vanilla JavaScript、Vite、gpu-io 0.2.7、WebGL2/GPGPU fragment shader、CSS。

## 2. 目录结构

- `src/main.js`：原作 Physarum shader、GPU pass、触控、计时与结算。
- `src/style.css`：全屏移动端界面、幽灵手指与结算。
- `index.html`：语义结构与平台壳接入。
- `public/THIRD_PARTY_NOTICES.txt`：原作者、源码和 MIT 许可。

## 3. 核心模块

`GPUComposer` 编排粒子位置/方向双缓冲和 trail 双缓冲；RAF 主循环执行五个 pass。Pointer Events 写入吸引剂，双指切换原作预设。IntersectionObserver 在离开信息流可见区域时停止 RAF，24 秒后采样 framebuffer 计算结果。

## 4. 扩展点

- 改玩法：调整 `ROUND_MS`、`finishRound()`。
- 换生长法则：修改 `PRESETS`。
- 调性能：修改 `SIM_SCALE` 与 `PARTICLE_DENSITY`。
- 加后端排行榜：在 `finishRound()` 中接平台排行 API，永久 UUID 由发布脚本注入。
