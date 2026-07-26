# Physarum Oracle 技术文档

## 1. 技术栈

Vanilla JavaScript、Vite、gpu-io 0.2.7、WebGL2/GPGPU fragment shader、CSS、Web Audio。

## 2. 目录结构

- `src/main.js`：Physarum GPU pass、触控引导、信标命中、法则切换和结算。
- `src/style.css`：全屏网络、双环信标、幽灵手指与完成层。
- `index.html`：HUD、四个信标、平台壳和语义结构。
- `public/THIRD_PARTY_NOTICES.txt`：原作者、源码和 MIT 许可。

## 3. 核心模块

`GPUComposer` 编排粒子位置/方向双缓冲和 trail 双缓冲，RAF 执行感知、移动、沉积、扩散与显示。`BEACONS` 保存四个归一化位置；`distanceToSegment()` 检查手指轨迹到节点的最短距离，42 px 内由 `activateBeacon()` 点亮。根节点初始激活，全部连通后继续模拟 1.2 秒再显示完成层。双指切换 `PRESETS` 并重建网络；IntersectionObserver 离屏暂停 GPU 更新。

## 4. 扩展点

- 换生长法则：修改 `PRESETS`。
- 改信标布局/半径：修改 `BEACONS` 与 `42`。
- 调完成节奏：修改 `activateBeacon()` 的 1200 ms。
- 调性能：修改 `particleDensity` 与 GPU pass 参数。
- 改完成评价：修改 `finishRound()` 的路径效率公式。
