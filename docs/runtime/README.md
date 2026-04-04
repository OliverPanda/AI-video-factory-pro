# 运行时目录文档

这组文档不解释单个 Agent，而是解释运行过程中磁盘上的目录组织方式。

适合回答这类问题：

- `temp/` 里每层目录是干嘛的
- `output/` 里什么才算最终交付
- 出错时应该先看哪个目录

## 入口

- [temp/ 目录说明](temp-structure.md)
- [output/ 目录说明](output-structure.md)
- [断点续跑说明](resume-from-step.md)

## 运行主流程图

```mermaid
flowchart TD
    A[输入剧本 / Project-Script-Episode] --> B[Director]
    B --> C[生成与检查前半程<br/>script -> prompt -> image -> consistency -> continuity]
    C --> D[视频主路径<br/>motion -> router -> runway -> shot QA]
    D --> E[音频与表演路径<br/>dialogue -> tts -> tts QA -> lipsync]
    E --> F[Video Composer]
    F --> G[output/final-video.mp4]
    B --> H[temp/<jobId>/state.json]
    B --> I[temp/projects/.../run-jobs]
    B --> J[temp/projects/.../runs/<runId>]
```

## 目录与数据流关系

```mermaid
flowchart LR
    A[temp/<jobId>] --> B[state.json]
    A --> C[images/]
    A --> D[video/]
    A --> E[audio/]
    F[temp/projects/.../runs/<runId>] --> G[01~10 agent run packages]
    F --> H[qa-overview.md]
    I[output/<project>/<episode>] --> J[final-video.mp4]
    I --> K[delivery-summary.md]
```
