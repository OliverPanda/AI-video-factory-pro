# AI漫剧自动化生成系统 - 部署安全批次

> 更新时间：2026-06-23  
> 目标：确认当前本地单机 / 局域网 Workbench 的最小可行防护边界  
> 原则：只做最小鉴权和暴露边界说明，不扩成完整公网权限系统

## 1. 当前结论

这批次当前已经有实质进展，不是空白状态：

- [x] `WORKBENCH_TOKEN` 的最小写接口保护已在代码中存在
- [x] `WORKBENCH_TOKEN` 的定向测试已通过
- [x] 部署文档已明确本机监听、局域网前提和公网禁区

当前还没做完的是：

- [ ] 是否需要把少量高风险只读接口纳入保护
- [ ] 是否需要补一份更聚焦的部署安全汇报口径

## 2. 当前代码状态

相关位置：

- [router.js](D:/My-Project/AI-video-factory-pro/src/workbench/http/router.js)
- [workbenchServer.test.js](D:/My-Project/AI-video-factory-pro/tests/workbench/workbenchServer.test.js)
- [deployment.md](D:/My-Project/AI-video-factory-pro/docs/deployment.md)

已确认行为：

- [x] 当未配置 `WORKBENCH_TOKEN` 时，不拦截写请求
- [x] 当配置 `WORKBENCH_TOKEN` 时，`POST / PUT / PATCH / DELETE` 需要 `Authorization: Bearer <token>`
- [x] 当前只读接口默认仍可访问

这说明当前实现是“局域网最小方案”，不是完整用户体系。

## 3. 当前测试证据

2026-06-23 重新跑过的定向测试：

```bash
node --test --test-name-pattern "WORKBENCH_TOKEN|settings|PUT /api/settings/providers" tests/workbench/workbenchServer.test.js
```

结果：

- [x] `PUT /api/settings/providers requires WORKBENCH_TOKEN when configured`
- [x] `PUT /api/settings/providers accepts Bearer token when WORKBENCH_TOKEN is configured`
- [x] 相关 settings / workspace `.env` 约束回归仍通过

## 4. 当前文档状态

部署文档中已经明确：

- [x] 默认建议只监听 `127.0.0.1`
- [x] 当前形态适合本地单机或受控局域网
- [x] 不应直接暴露到公网
- [x] 如需局域网访问，先配置 `WORKBENCH_TOKEN`
- [x] 局域网可访问不等于公网可暴露
- [x] 当前最小鉴权不等于完整用户权限系统

重点位置：

- [deployment.md](D:/My-Project/AI-video-factory-pro/docs/deployment.md)

## 5. 当前未完成项

### 5.1 可继续评估

- [ ] `review video` 这类高风险只读接口是否需要 token
- [ ] 导出类接口是否需要 token
- [ ] 是否把 `settings` 读取也纳入保护

### 5.2 当前明确不做

- [ ] 完整登录体系
- [ ] 多用户权限模型
- [ ] 全量 CSRF 方案
- [ ] 公网部署级安全加固

## 6. 当前判断

对当前 workbench 形态，部署安全这批次已经接近“阶段完成”：

- 代码有最小保护
- 测试有定向证据
- 文档已写清边界

剩余部分主要是“要不要再多保护少量只读接口”的范围判断，而不是主干缺失。

## 7. 本批次状态

- [x] 最小写接口鉴权已落地
- [x] `WORKBENCH_TOKEN` 测试证据已存在并已复跑
- [x] 本地 / 局域网 / 公网边界已写入部署文档
- [ ] 高风险只读接口是否纳入保护，仍待最终取舍
