# Lightout Mechanic Lab

一个面向 Switch-Toggling Puzzle 的玩法研究原型。棋盘支持方形、六边形与三角形三种完整基础拓扑，不再额外包装菱形、环形等裁切“棋盘形状”。格子结构、格子角色、影响属性、初始局面和目标约束统一保存在可编辑的 `PuzzleDesign` 中，再编译为 Engine 使用的拓扑、状态与规则。

## 运行

```bash
pnpm install
pnpm dev
```

质量检查：

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 架构边界

```text
apps/lab                    React + SVG 研究界面
packages/engine             无 UI 的确定性模拟内核
packages/mechanics-standard 标准拓扑、选择器、效果、目标与系统
packages/solver             只通过 Engine API 观察和模拟规则
packages/generator          生成请求、分层算法、固定约束与候选验收
```

`engine` 位于依赖底层；规则与求解器只依赖其公共 API，`generator` 组合规则编译与求解
能力，`apps/lab` 位于最上层。规则内核不导入 React、DOM、SVG、动画或求解器。

一次操作按以下顺序解析：

```text
GameCommand
  -> Selector（选择目标）
  -> Effect（规划并应用变化）
  -> Settle Systems（可选的后续演化）
  -> Goal / Loss Conditions
  -> GameState + GameEvent[]
```

- `PuzzleDesign` 是编辑与保存的唯一真相；编译后的 `GameState` 是一次游玩会话的唯一运行时状态。
- `GameEvent[]` 服务于表现、诊断和回放，不是唯一持久化来源。
- 基础棋盘使用带关系与方向的图表达方形、六边形和三角形拓扑；节点位置只负责布局。
- 方向性系统读取拓扑关系；例如重力沿方阵的 `down` 边移动，不读取显示坐标。
- 实体与格位分离，为移动、掉落、障碍和多层对象保留空间。
- 实体的静态 `properties` 与动态 `channels` 分离；`entityKinds` 分别校验属性和状态通道。
- `exists` 在编译阶段决定节点是否进入运行时拓扑；空格会阻断射线传播。
- `hasPower` 与 `activatable` 是两个独立能力；当前设计层提供普通格、纯开关和被动灯三种有效组合，存在的格子至少拥有其中一种能力。
- 目标作为 Ruleset 约束保存，不再塞入实体状态，也不使用 `-1` 之类的哨兵值。
- 随机局面由 seed 确定，并从目标状态通过合法操作反向生成，因此保证可达。

## 扩展机制

常见实验应只修改设计数据：状态数、格子能力、逐格目标、统一或逐格影响关系和结算系统。不同编辑器预设可以写入相同的底层属性，不制造重复语义。真正的新语义通过机制注册表增加：

```ts
registerSelector(registry, "connected-color", selector);
registerEffect(registry, "spread-charge", effect);
registerGoal(registry, "match-pattern", goal);
registerSystem(registry, "gravity-down", gravity);
```

关卡和规则只引用稳定的机制 ID 与 JSON 参数，不保存可执行函数。

新增机制的验收条件：

1. 不修改 `packages/engine` 也能注册。
2. 相同 seed 和 command 序列得到相同状态。
3. 机制产生领域事件，渲染器不需要推测状态差异。
4. State Schema 能捕获非法通道或越界值。
5. Solver 若不支持该规则，必须显式返回 `unsupported`，不能给出伪答案。

## 求解器选择与扩展

UI 只调用统一入口 `solvePuzzle(state, ruleset, mechanics, solvers)`。每个求解器通过
`supports()` 独立验证规则能力，注册表再按 `priority` 选择最合适的精确算法：

```ts
const solvers = createDefaultSolverRegistry();
registerSolver(solvers, customSolver);
const result = solvePuzzle(state, ruleset, mechanics, solvers);
```

Ruleset 描述真实机制，不绑定具体求解器名称。新增搜索或专用算法时实现 `PuzzleSolver`
接口即可，不需要修改 UI 或 Engine。默认注册表包含 GF(p) 质数域求解器和 Z/4Z 模环
求解器；不满足线性前提的规则会继续尝试其他已注册算法，否则返回 `unsupported`。

## 关卡生成器

生成器是 `PuzzleDesign` 的上游生产者，不直接修改 `GameState`。`PuzzleGenerationRequest`
分别描述结构、角色、影响、目标和初始五层，每层都支持完整生成、完整固定或部分格子硬
锁定；算法以稳定 ID、版本和 JSON 参数注册。候选必须经过 `compilePuzzleDesign` 与
Solver/Evaluator 验收后才能进入预览。

生成任务使用确定性 seed、尝试/时间预算、进度回调与取消信号。候选预览不写入 Workspace
或撤销历史；确认后只会把候选应用为当前牌局，不会新增、复制或改换 Rule Deck 中的规则。
生成配方和报告保存在 `RulePreset.game.generation`，与当前牌局设计
`RulePreset.game.design` 一同持久化；规则身份与牌局实例在数据结构中保持分层。

## 当前实现与明确边界

已实现：

- 完整方形、六边形与三角形基础拓扑，棋盘裁切不再被包装成“形状规则”；
- 十字、对角、全部相邻、八方向、整行整列五个内置影响 Profile，以及统一或逐格两种属性应用策略；
- 每格独立的存在性、亮灭状态能力、点击能力和影响 Profile；支持普通格、纯开关与被动灯；
- 2–5 状态循环、逐格任意目标状态与部分目标约束；
- 棋盘结构、格子角色、影响属性、初始棋局和目标棋局五层可视化编辑，统一进入设计快照撤销/重做与本地保存；
- 格子内芯始终表达当前状态，四角标记固定表达角色、目标、影响与求解提示；编辑表面只突出对应标记，不替换格子的视觉身份；
- 可注册的确定性分层关卡生成器；结构、角色、影响、目标与初始层均支持生成、固定和逐格混合锁定；
- 生成候选经过编译与求解验收，在独立预览中比较后应用为当前牌局，Rule Deck 保持不变；
- 调试用单格校准工具；
- 状态快照撤销/重做；
- 事件日志和影响范围预览；
- 浅色/夜间主题；所有规则共享统一的工作台主色与视觉语言；
- 求解器注册表按规则能力自动选择精确算法；
- 二、三、五态及其他质数模数规则使用 GF(p) 质数域线性求解；
- 四态循环使用支持矩形矩阵的 Z/4Z 模环线性求解，不错误复用 GF(4)；
- 求解矩阵以可点击格为列、目标灯格为行，因此开关和灯数量无需相等；
- 求解结果提供约束秩、自由变量与最短性分析，集成测试通过 Engine 重放验证；
- 可注册的 settle system，并提供重力系统实现作为接口探针。

暂未假装通用：

- 除内建的逐格影响选择器外，其他状态相关选择、失败条件或 settle system 的非线性规则会明确显示不支持；
- 尚未建立万能关卡 DSL，先让机制注册接口稳定；
- 尚未引入 Phaser；需要验证强动效时新增 renderer，而不修改规则内核；
- 当前精确线性求解保持纯函数和同步执行；加入通用搜索或扩大棋盘后可直接将代数层迁入 Web Worker。
- Workspace 只读取当前存储 schema，不迁移历史字段；无效预设会被单独忽略，其余有效设计继续加载。
