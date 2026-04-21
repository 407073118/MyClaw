# 会话数据目录与文件展示重构

> 日期：2026-04-16

## 目标

将对话产出的文件按 session 隔离存储，展示层简化为中文时间倒序列表，去掉不必要的生命周期管理概念。

## 设计决策

| 决策 | 选择 |
|------|------|
| 目录结构 | 扁平式 `data/<sessionId>/` |
| 创建时机 | 懒创建——有文件产出才建目录 |
| 展示方式 | 按时间倒序单一列表，不分区 |
| 操作按钮 | 只保留「打开」「定位」 |
| UI 语言 | 全中文 |

## 一、存储改造

### 目录结构

```
myClaw/
  data/
    <sessionId>/              # 主聊天对话产出
      output.docx
      chart.png

  silicon-persons/<personId>/
    data/
      <sessionId>/            # 硅基员工对话产出
        analysis.xlsx
```

### 核心规则

- 对话产生文件时才创建 `data/<sessionId>/` 目录
- 模型执行产出的文件默认存到当前 session 目录
- 用户明确指定路径的，按用户指定路径存
- 旧的全局 `artifacts/` 路径不再写入新文件

### 改动文件

- `desktop/src/main/services/directory-service.ts`
  - 新增 `getSessionDataDir(sessionId): string`
  - 新增 `getPersonSessionDataDir(personId, sessionId): string`
- `desktop/src/main/services/artifact-manager.ts`
  - 存储路径从 `artifacts/` 改为 `data/<sessionId>/`
  - 写入时检测目录不存在则 `mkdirSync(recursive: true)`

## 二、展示层改造

### WorkFilesPanel 组件

- 去掉 4 个分区（Just Now / Final / Working / Archived）
- 改为按 `updatedAt` 倒序的单一列表
- 每项显示：类型图标、文件名、类型中文标签 + 大小 + 相对时间
- 操作按钮只保留「打开」「定位」
- 去掉 `lifecycle` 相关逻辑（markFinal 等）
- 去掉 6 条限制，显示全部文件
- 空状态：「暂无文件——对话产生的文件会显示在这里」
- 底部显示目录路径 + 「打开文件夹」按钮

### 中文化

| 原文 | 改为 |
|------|------|
| Open | 打开 |
| Reveal | 定位 |
| Session Files | 会话文件 |
| Doc | 文档 |
| Image | 图片 |
| Code | 代码 |
| Dataset | 数据集 |
| Archive | 压缩包 |
| Log | 日志 |
| Other | 其他 |
| Unknown size | 未知大小 |
| just now | 刚刚 |
| X minutes ago | X分钟前 |

## 三、数据流改动

### workspace store

- `loadArtifactsByScope()` 逻辑不变
- 去掉 `markArtifactFinal()` 方法
- 排序统一 `updatedAt` 倒序

### ChatPage / SiliconPersonWorkspacePage

- 标题描述改为中文
- 去掉 "View All" 和 6 条限制

### sessions IPC

- 文件写入路径改为 `data/<sessionId>/`
- 新增 `getSessionDataPath(sessionId)` IPC 方法

### format-time.ts

- 时间显示中文化（已有文件，需调整输出为中文）
