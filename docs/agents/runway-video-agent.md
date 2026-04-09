# Runway Video Agent

这是历史兼容文档。

当前用户侧不再把兼容视频链路称为 `Runway Video Agent`，而统一称为：

- [Fallback Video Adapter](fallback-video-adapter.md)

说明：

- `Runway Video Agent` 代表的是项目早期的兼容视频 provider 叫法
- 当前用户配置入口已经改为 `VIDEO_PROVIDER=fallback_video`
- 当前内部实现也不再等同于旧的 Runway 专用 API，而是通用 fallback video adapter
- 为了保持历史 run、老测试和旧设计文档可追溯，这个文件暂时保留为跳转说明

如果你在看现在的真实运行链路，请改看：

- [Fallback Video Adapter](fallback-video-adapter.md)
- [Seedance Video Agent](seedance-video-agent.md)
- [Video Router Agent](video-router.md)
