# Lightout Mechanic Lab

一个面向 Switch-Toggling Puzzle 的玩法研究原型。默认实验是经典 `N×N`、亮灭双态、点击影响自身与十字邻居；经典规则不是引擎假设，而是第一份配置。

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
```

依赖只能朝向 `engine`。规则内核不导入 React、DOM、SVG、动画或求解器。

一次操作按以下顺序解析：

```text
GameCommand
  -> Selector（选择目标）
  -> Effect（规划并应用变化）
  -> Settle Systems（可选的后续演化）
  -> Goal / Loss Conditions
  -> GameState + GameEvent[]
```

- `GameState` 是唯一真相和撤销快照。
- `GameEvent[]` 服务于表现、诊断和回放，不是唯一持久化来源。
- 棋盘使用带关系类型的图；节点位置仅用于布局。
- 实体与格位分离，为移动、掉落、障碍和多层对象保留空间。
- `entityKinds` 为每种实体声明 Channel Schema，防止配置扩展退化成无约束 JSON。
- 随机局面由 seed 确定，并从目标状态通过合法操作反向生成，因此保证可达。

## 扩展机制

常见实验应只修改规则配置：状态数、目标值、关系组合、棋盘形状和结算系统。真正的新语义通过机制注册表增加：

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

## 当前实现与明确边界

已实现：

- 完整方阵、菱形与环形图拓扑；
- 十字、对角、八方向、整行整列影响关系；
- 2–5 状态循环与任意目标状态；
- 调试用单格校准工具；
- 状态快照撤销/重做；
- 事件日志和影响范围预览；
- 浅色/夜间主题与圆形/轻圆角矩形节点渲染；
- 求解器注册表按规则能力自动选择精确算法；
- 二、三、五态及其他质数模数规则使用 GF(p) 质数域线性求解；
- 四态循环使用 Z/4Z 模环线性求解，不错误复用 GF(4)；
- 求解结果提供约束秩、自由变量与最短性分析，集成测试通过 Engine 重放验证；
- 可注册的 settle system，并提供重力系统实现作为接口探针。

暂未假装通用：

- 带状态相关选择、失败条件或 settle system 的非线性规则会明确显示不支持；
- 尚未建立万能关卡 DSL，先让机制注册接口稳定；
- 尚未引入 Phaser；需要验证强动效时新增 renderer，而不修改规则内核；
- 当前精确线性求解保持纯函数和同步执行；加入通用搜索或扩大棋盘后可直接将代数层迁入 Web Worker。
