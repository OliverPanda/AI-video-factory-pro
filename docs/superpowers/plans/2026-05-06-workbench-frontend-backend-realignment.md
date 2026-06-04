# 工作台前后端重构实施计划（归档）

该计划对应的是已经删除的旧版本地前端工作台方案。

当前状态：
- 旧静态前端稿已经移除
- 旧浏览器端脚本与样式文件已经移除
- 当前仓库只保留 API-only 的只读 Workbench 服务

保留这份文档的目的：
- 说明这里曾经存在过前后端拆分方案
- 避免后续继续按旧前端实现回填代码
- 将历史讨论收敛为归档说明，而不是继续作为实施依据

如果要看现在的实际入口，请改看：
- scripts/workbench-server.js
- src/workbench/http/router.js
- README.md 中的 Workbench API-only 说明

