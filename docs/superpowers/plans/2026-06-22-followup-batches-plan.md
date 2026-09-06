# AI漫剧自动化生成系统 - 后续三批次计划

> 更新时间：2026-06-22
> 目的：把上一轮 fix 收口后明确拆出三个独立批次，避免继续把“交付证据、结构治理、部署安全”混在同一轮里推进

---

## 1. 当前判断

基于当前仓库状态，这三类工作都值得做，但性质不同：

- `交付证据补齐`：是交付证明问题，目标是把“能用”变成“有证据证明能交付”
- `结构治理`：是代码治理问题，目标是降低 `router.js / director.js / storyboardContextMemory.js` 的继续膨胀风险
- `部署安全`：是部署边界问题，目标是让本地单机 / 局域网 workbench 在最小成本下具备基本防护

因此应拆成三个独立批次推进，而不是继续合并在当前修复批次里。

---

## 2. 批次一：交付证据补齐

### 2.1 批次目标

- 形成可采信的真实样本交付证据
- 补齐 review 成片播放证据
- 补齐 voice 保存回读证据
- 补齐浏览器级关键路径 E2E 证据

### 2.2 当前已知现状

- 已有 review API、editor、character、scene、voice 的代码与接口
- 已有夹具 smoke 和部分真实工作区打开验证
- 当前仍缺：
  - 真实可播放 `final-video.mp4` 的 review 证据
  - 真实 voice 样本的保存回读证据
  - 一轮完整浏览器 E2E 录像 / 截图 / 报告

### 2.3 执行清单

- [ ] 选定一组真实工作区 run 作为验收样本
- [ ] 确认该 run 具备：
  - [ ] `final-video.mp4`
  - [ ] review 相关 JSON
  - [ ] voice 数据
  - [ ] episode detail 可读写对象
- [ ] 补一轮 `/review/:runId` 真浏览器验证
  - [ ] 页面打开
  - [ ] review 数据渲染
  - [ ] 成片视频可播放
  - [ ] 任务状态写回可见
- [ ] 补一轮 `/editor` 真浏览器验证
  - [ ] shot 字段保存
  - [ ] scene 字段保存
  - [ ] emotion 字段保存
  - [ ] 回读一致
- [ ] 补一轮 `/drama/:id/characters`、`/scenes`、`/voices`
  - [ ] Character 保存回读
  - [ ] Scene 保存回读
  - [ ] Voice 保存回读
- [ ] 固化交付证据到：
  - [ ] 自测报告
  - [ ] 截图或录屏证据
  - [ ] 勾选清单状态更新

### 2.4 验收标准

- [ ] 至少一组真实 run 的 review 页面存在“可播放成片”证据
- [ ] Voice 保存回读有真实样本证明，不再停留在 `voices=0`
- [ ] 形成一轮浏览器级关键路径 E2E 证据，而不是只停留在夹具 smoke

---

## 3. 批次二：结构治理

### 3.1 批次目标

- 控制 `router.js` 继续变大
- 控制 `director.js` 继续承担业务判断与状态桥接
- 控制 `storyboardContextMemory.js` 继续膨胀
- 在不改行为的前提下提高可维护性

### 3.2 当前已知现状

- `src/workbench/http/router.js` 已是高密度多职责文件
- `src/agents/director.js` 仍是唯一 orchestrator，但已承载大量状态判断与串接
- `src/domain/storyboardContextMemory.js` 已经是重型 domain 模块
- 当前 fix 批次明确没有动这些结构项

### 3.3 执行清单

#### A. router.js

- [ ] 先做职责切片，不先动行为
- [ ] 拆出 settings 路由处理
- [ ] 拆出 review 路由处理
- [ ] 拆出 storyboard edit 路由处理
- [ ] 保留 `createWorkbenchServer()` 作为总入口
- [ ] 保持现有测试可复用

#### B. director.js

- [ ] 先做 orchestration / business-rule 边界梳理
- [ ] 识别可下沉的纯业务判断块
- [ ] 将后处理拼装逻辑优先移出主文件
- [ ] 将错误整理 / 状态组装 / artifact 组装优先抽 helper
- [ ] 保证 `Director` 仍是唯一 orchestrator，不引入第二调度中心

#### C. storyboardContextMemory.js

- [ ] 按职责切成：
  - [ ] signature / freshness
  - [ ] memory build
  - [ ] markdown / artifact 输出
  - [ ] normalize / derive helpers
- [ ] 先拆纯函数，不改 schema
- [ ] 保持既有 fixture 和 acceptance 断言不失效

### 3.4 验收标准

- [ ] `router.js` 至少完成第一轮按职责拆分
- [ ] `director.js` 规模下降且没有新增调度中心
- [ ] `storyboardContextMemory.js` 完成第一轮模块切分
- [ ] 现有主流程测试仍可通过

---

## 4. 批次三：部署安全

### 4.1 批次目标

- 为本地单机 / 局域网 workbench 建立最小可行防护
- 明确“默认允许什么，默认不允许什么”
- 不引入过重的 SaaS 化安全体系

### 4.2 当前已知现状

- 当前部署文档已明确是“本地单机 / 局域网部署形态”
- `router.js` 里已经存在 `WORKBENCH_TOKEN` 的最小写操作保护逻辑
- 当前仍缺：
  - 默认暴露策略说明
  - 局域网访问建议
  - token 使用方式文档
  - 更完整的最小鉴权验收项

### 4.3 执行清单

#### A. workbench token

- [ ] 明确 `WORKBENCH_TOKEN` 的使用方式
- [ ] 明确哪些写操作必须带 token
- [ ] 为 token 鉴权补独立测试
- [ ] 将 token 配置写入部署文档

#### B. 局域网暴露策略

- [ ] 明确默认推荐仅监听 `127.0.0.1`
- [ ] 如果要开放局域网，明确前置条件：
  - [ ] 手动改 host
  - [ ] 开启 token
  - [ ] 不对公网暴露
- [ ] 将“局域网可用”和“公网可暴露”清晰区分

#### C. 最小鉴权

- [ ] 维持“只保护写接口”的最小方案评估
- [ ] 评估是否需要把高风险读接口也纳入保护：
  - [ ] settings
  - [ ] review video
  - [ ] 导出类接口
- [ ] 不在本批次引入完整用户系统

### 4.4 验收标准

- [ ] `WORKBENCH_TOKEN` 有清晰文档和测试
- [ ] 部署文档明确本地 / 局域网 / 公网边界
- [ ] 最小鉴权方案在代码和文档里一致

---

## 5. 推荐顺序

建议顺序：

1. `交付证据补齐`
2. `部署安全`
3. `结构治理`

原因：

- 先补交付证据，才能让当前交付闭环更完整
- 再补部署安全，避免局域网使用时边界模糊
- 结构治理价值高，但不直接决定当前交付是否可汇报

---

## 6. 昨晚改动梳理口径

### 已完成

- [x] 收紧 `.env` 读写边界
- [x] 对核心 URL path segment 加校验
- [x] Settings 保存继续限制白名单 key
- [x] Settings 预检链路保存失败时不再继续 precheck
- [x] 修复 `workbenchServer.test.js` 的 `process.env` 污染
- [x] 补了非法 path / unknown key / workspace `.env` 的回归测试
- [x] 修正文档中的过时命令、绝对路径和旧样本引用
- [x] 完成一轮 fix-review 口径复核

### 已验证

- [x] `pnpm --dir views build`
- [x] 受影响的 workbench server 定向测试

### 明确没做

- [ ] 没把 review 成片证据、voice 回读、真浏览器 E2E 在昨晚这一轮里补齐
- [ ] 没做 `router.js / director.js / storyboardContextMemory.js` 的结构拆分
- [ ] 没把 workbench 提升成完整公网安全模型

---

## 7. 汇报建议

对外汇报时建议这样表述：

- 当前 fix 批次已经完成，重点问题已修，范围控制住了，没有引入过度设计
- 现在剩下的不是同一类问题，而是三个独立批次：
  - 交付证据补齐
  - 结构治理
  - 部署安全
- 建议先做交付证据补齐，再做部署安全，最后做结构治理
