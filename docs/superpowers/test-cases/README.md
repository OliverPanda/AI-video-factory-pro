# 测试用例资产

当前 M0-M5 全阶段测试用例 Excel 是归档测试资产，不再保留一次性生成脚本。

输出文件：

- `docs/superpowers/test-cases/2026-06-19-M0-M5-测试用例明细.xlsx`

生成依据：

- `docs/superpowers/plans/serene-sleeping-dragonfly.md`
- `docs/superpowers/plans/2026-06-19-交付现状与开发排期勾选清单.md`

说明：

- 这是测试用例资产，不是执行报告。
- `结果` 列默认表示当前执行状态，如 `未执行`、`研发补齐后执行`。
- 已覆盖 `M0` 到 `M5` 全部阶段，并对每个阶段保持不少于 20 条详细测试用例。
- 若计划文档更新，应按新的 harness contract 重新生成测试资产，并在本目录补充生成脚本或生成说明，避免 README 指向不存在的临时脚本。
