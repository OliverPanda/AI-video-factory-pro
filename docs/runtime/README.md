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
    B --> C[Script Parser]
    C --> D[Character Registry]
    D --> E[Prompt Engineer]
    E --> F[Image Generator]
    F --> G[Consistency Checker]
    G --> H[Continuity Checker]
    C --> I[Motion Planner]
    H --> I
    I --> J[Performance Planner]
    J --> K[Video Router]
    F --> K
    E --> K
    K --> L{Video Provider}
    L --> L1[Runway Video Agent]
    L --> L2[Seedance Video Agent]
    L1 --> M[Motion Enhancer]
    L2 --> M
    M --> N[Shot QA Agent]
    N --> O[Bridge Shot Planner]
    O --> P[Bridge Shot Router]
    P --> Q[Bridge Clip Generator]
    Q --> R[Bridge QA Agent]
    C --> S[Dialogue Normalizer]
    D --> T[TTS Agent]
    S --> T
    T --> U[TTS QA Agent]
    F --> V[Lip-sync Agent]
    T --> V
    N --> W[Video Composer]
    R --> W
    U --> W
    V --> W
    F --> W
    W --> X[output/final-video.mp4]
    B --> Y[temp/<jobId>/state.json]
    B --> Z[temp/projects/.../run-jobs]
    B --> AA[temp/projects/.../runs/<runId>]
```

## 目录与数据流关系

```mermaid
flowchart LR
    A[temp/<jobId>] --> B[state.json]
    A --> C[images/]
    A --> D[video/]
    A --> E[audio/]
    F[temp/projects/.../runs/<runId>] --> G[01~10 + 09g~09j agent run packages]
    F --> H[qa-overview.md / qa-overview.json]
    F --> I[state.snapshot.json]
    J[output/<project>/<episode>] --> K[final-video.mp4]
    J --> L[delivery-summary.md]
```
