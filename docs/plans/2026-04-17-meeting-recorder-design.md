# 会议录音功能设计文档

> 日期：2026-04-17
> 状态：设计完成，待实现

## 一、功能概述

MyClaw 桌面端新增「会议录音」功能，支持长时间会议录音、实时语音转写、说话人识别、AI 会议纪要生成，产出物（音频 + 转写稿 + 纪要）作为 Artifact 存储，且可注入对话上下文进行后续分析。

**核心价值：** 类似钉钉听记 / 飞书妙记，但集成在 MyClaw 桌面助手中，转写结果可直接和 LLM 对话分析。

## 二、关键决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 录音来源 | 仅麦克风 | 最简路径，覆盖线下会议场景 |
| ASR 处理时机 | 实时流式（WebSocket） | 有可用的实时 ASR 模型，体验好 |
| ASR 协议 | WebSocket 流式 + HTTP 离线双通道 | 公司已有基础设施 |
| 产出物 | 音频 wav + 转写稿 md + 会议纪要 md | 三件套完整保留 |
| 页面形态 | 独立「会议录音」页面 | 专注管理，和对话流分离 |
| ASR 配置 | SettingsPage 用户可配 | 灵活，支持不同环境 |
| 架构方案 | 主进程 WebSocket 直连（方案一） | 符合现有 IPC 架构，安全性好 |

## 三、ASR 基础设施

### 3.1 实时流式 ASR（WebSocket）

- 服务地址：`ws://192.168.160.55:10099`
- 协议：连接后发 JSON 配置帧 → 持续发送 PCM 二进制帧 → 服务端返回 `partial_text` / `final_text`
- 模式：`online`（低延迟）/ `2pass`（句尾离线纠错）
- 音频格式：PCM 16kHz 单声道
- 支持热词、ITN（数字转换）

### 3.2 离线 ASR（HTTP POST）

- 服务地址：`https://zh-offline-16k-asr-antalos-app-server.100credit.cn/recognition`
- 支持 wav / mp3
- `model_list=spk` 启用说话人识别
- 返回带 `spk`（说话人编号）、`start`/`end`（时间戳）的 `sentences` 数组
- 支持 `spk_center` 跨分片保持说话人一致性
- 支持异步识别 + 回调

## 四、整体数据流

```
┌─────────── Renderer ───────────┐     ┌──────────── Main Process ────────────────┐
│                                │     │                                          │
│  MeetingsPage                  │     │  meeting-recorder.ts                     │
│  ├─ getUserMedia (16kHz PCM)   │     │  ├─ WebSocket → 实时 ASR (online mode)   │
│  ├─ PCM chunks ──────────────────►   │  ├─ 实时 partial_text → push 回 Renderer │
│  │                             │ IPC │  ├─ 录音结束:                             │
│  │  ◄──────────────────────────────── │  │   ├─ 保存 wav 文件                     │
│  ├─ 实时显示 partial_text      │push │  │   ├─ HTTP POST → 离线 ASR (spk)       │
│  ├─ 录完后显示最终转写 + 纪要   │     │  │   ├─ 生成带说话人的转写稿 (.md)         │
│  └─ 录音列表 / 回放 / 管理     │     │  │   ├─ 转写稿 → LLM → 会议纪要 (.md)    │
│                                │     │  │   └─ 三个文件注册为 Artifact           │
│                                │     │  └─ 持久化录音元数据 (meetings.json)      │
└────────────────────────────────┘     └──────────────────────────────────────────┘
```

核心流程：
1. 用户点「开始录音」→ Renderer 采集麦克风 PCM → IPC 持续送 Main
2. Main 建立 WebSocket 连接，推送 PCM 帧，收到 `partial_text` 实时 push 给 Renderer 显示
3. 用户点「结束录音」→ 停止采集，通知 Main `{"is_speaking": false}`
4. Main 保存完整 wav 文件
5. Main 将 wav POST 给离线 ASR（`model_list=spk`），拿到说话人+时间戳的 sentences
6. Main 格式化为 Markdown 转写稿
7. Main 将转写稿送 LLM 生成会议纪要
8. 三个产物注册为 Artifact

## 五、数据模型

### 5.1 核心类型（desktop/shared/contracts/meeting.ts）

```typescript
/** 转写稿原子单元 */
interface TranscriptSegment {
  speaker: number;
  speakerLabel?: string;
  text: string;
  startMs: number;
  endMs: number;
}

/** 结构化转写结果 */
interface StructuredTranscript {
  segments: TranscriptSegment[];
  speakerCount: number;
  durationMs: number;
  speakerCenters?: number[][];
}

/** 会议录音记录 */
interface MeetingRecord {
  id: string;
  title: string;
  createdAt: string;
  durationMs: number;
  status: "recording" | "transcribing" | "summarizing" | "done" | "failed";
  audioArtifactId?: string;
  transcriptArtifactId?: string;
  summaryArtifactId?: string;
  structuredTranscriptPath?: string;
  linkedSessionId?: string;
  speakerCount?: number;
  speakerLabels?: Record<number, string>;
  errorMessage?: string;
}

/** 实时转写推送事件 */
interface MeetingTranscribeEvent {
  meetingId: string;
  partialText: string;
  finalText?: string;
  isFinal: boolean;
}

/** ASR 服务配置 */
interface AsrConfig {
  wsUrl: string;
  httpUrl: string;
  mode: "online" | "2pass";
  audioSampleRate: number;
  ssl: boolean;
  enableSpeaker: boolean;
  maxSpeakers: number;
  summaryModelProfileId: string | null;
}
```

### 5.2 存储结构

```
{dataRoot}/meetings/
  ├── meetings.json                   — 元数据索引
  └── {meetingId}/
      ├── recording.wav               — 原始音频
      ├── transcript.json             — 结构化转写（核心数据源）
      ├── transcript.md               — 可读版转写稿
      └── summary.md                  — LLM 会议纪要
```

### 5.3 IPC 通道

```
meetings:start        → 开始录音，返回 meetingId
meetings:stop         → 停止录音，触发后处理
meetings:audio-chunk  → PCM 数据推送（fire-and-forget，用 ipcRenderer.send）
meetings:cancel       → 取消录音
meetings:list         → 获取所有录音记录
meetings:get          → 获取单条记录 + 结构化转写
meetings:delete       → 删除录音
meetings:update-speaker → 更新说话人标签
meetings:open-session → 创建/打开关联 ChatSession
meetings:event        → Main → Renderer 推送（实时转写、状态变更）
```

## 六、可扩展架构

### 6.1 MeetingIntelligenceProvider 接口

```typescript
interface MeetingIntelligenceProvider {
  startStreaming(config: StreamConfig): StreamingSession;
  transcribeAudio(audioPath: string, options?: TranscribeOptions): Promise<StructuredTranscript>;
  analyze(transcript: StructuredTranscript, tasks: AnalysisTask[]): Promise<AnalysisResult>;
}

// 当前实现：桌面端直连 ASR
class DirectAsrProvider implements MeetingIntelligenceProvider { ... }

// 未来实现：调独立服务
class RemoteMeetingServiceProvider implements MeetingIntelligenceProvider { ... }
```

### 6.2 对话分析集成

用户点「对话分析」→ 创建 ChatSession（linkedMeetingId）→ prompt-composer 检测到关联会议 → 从 transcript.json 加载结构化转写注入 system context → 用户自由提问。

### 6.3 扩展路线

| 扩展方向 | 实现方式 |
|---------|---------|
| 对话式问答 | prompt-composer 加 meeting transcript context block |
| 跨会议检索 | transcript.json 建向量索引，RAG 检索注入对话 |
| 自动待办提取 | summarizing 阶段加结构化 TODO 提取 |
| 说话人实名 | 离线 ASR 声纹库 search_spkdb 映射 |
| 回听定位 | segment.startMs 驱动音频 seek |
| 切换独立服务 | 新增 RemoteMeetingServiceProvider 实现 |

## 七、Main Process 核心服务

### 7.1 asr-client.ts

- `startStreaming(config)` — 建立 WebSocket，发初始化 JSON，返回 StreamingSession
- `StreamingSession.sendAudio(chunk)` — 推送 PCM 帧
- `StreamingSession.finish()` — 发送 `{is_speaking: false}`，等待 is_final
- `transcribeOffline(audioPath, options)` — HTTP POST form-data，返回 StructuredTranscript
- 长音频分片策略：超 30 分钟按 10 分钟切片，带 spk_center 保持说话人一致

### 7.2 meeting-recorder.ts

- `start(title?)` — 创建目录、初始化 wav 写入流、建立实时 ASR 连接
- `onAudioChunk(chunk)` — 写 wav + 转发 ASR
- `stop()` — 关闭流、触发异步后处理
- `postProcess()` — 离线 ASR → transcript.json → transcript.md → LLM 纪要 → summary.md → 注册 Artifact

### 7.3 LLM 总结 System Prompt

```
你是一个专业的会议纪要助手。请根据以下会议转写稿生成结构化会议纪要。

输出格式：
## 会议概要
## 参会人
## 关键议题（议题名、讨论要点、结论）
## 待办事项（内容、负责人、截止时间）
## 关键决策
```

## 八、Renderer 端

### 8.1 页面三态

- **列表态**：glass-card 卡片列表，显示标题/时长/发言人数/状态，支持搜索
- **录音态**：红色脉冲圆点 + 计时器 + 波形可视化 + 实时转写预览区
- **详情态**：音频播放器 + tab 切换（转写稿/纪要）+ 点击某句跳转回听 + 对话分析入口

### 8.2 录音采集

- `useMeetingRecorder` hook 封装 getUserMedia + AudioContext(16kHz) + ScriptProcessorNode
- PCM chunk 通过 `ipcRenderer.send` fire-and-forget 推送 Main
- 订阅 `meetings:event` 接收实时 partial_text

### 8.3 组件

- `AudioWaveform` — canvas 绘制实时波形（AnalyserNode.getByteTimeDomainData）
- `AudioPlayer` — wav 回放、进度条、倍速、外部 seekToMs 控制
- `TranscriptView` — 转写稿展示，点击句子触发音频定位

## 九、设置页 ASR 配置

SettingsPage 新增「语音识别服务」区域：
- 实时 ASR WebSocket 地址 + 模式选择（online/2pass）+ SSL 开关
- 离线 ASR HTTP 地址 + 说话人识别开关 + 最大说话人数
- 纪要生成模型选择（下拉已配置的模型 Profile）
- 测试连接按钮

持久化到 settings.json 的 `asr` 字段。

## 十、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `desktop/shared/contracts/meeting.ts` | 新增 | 领域类型 |
| `desktop/shared/contracts/index.ts` | 修改 | 导出 meeting |
| `desktop/src/main/services/asr-client.ts` | 新增 | ASR 客户端 |
| `desktop/src/main/services/meeting-recorder.ts` | 新增 | 录音服务 |
| `desktop/src/main/ipc/meetings.ts` | 新增 | IPC 注册 |
| `desktop/src/main/ipc/index.ts` | 修改 | 引入 meetings |
| `desktop/src/main/services/runtime-context.ts` | 修改 | 注册新服务 |
| `desktop/src/main/index.ts` | 修改 | 初始化 |
| `desktop/src/preload/index.ts` | 修改 | 暴露 meetings API |
| `desktop/src/renderer/pages/MeetingsPage.tsx` | 新增 | 页面 |
| `desktop/src/renderer/hooks/useMeetingRecorder.ts` | 新增 | 录音 hook |
| `desktop/src/renderer/components/meeting/AudioWaveform.tsx` | 新增 | 波形 |
| `desktop/src/renderer/components/meeting/AudioPlayer.tsx` | 新增 | 播放器 |
| `desktop/src/renderer/components/meeting/TranscriptView.tsx` | 新增 | 转写稿 |
| `desktop/src/renderer/router/index.tsx` | 修改 | 路由 |
| `desktop/src/renderer/layouts/AppShell.tsx` | 修改 | 导航 |
| `desktop/src/renderer/pages/SettingsPage.tsx` | 修改 | ASR 配置 |
| `desktop/src/main/services/model-runtime/prompt-composer.ts` | 修改 | 会议上下文注入 |
| `desktop/shared/contracts/artifact.ts` | 修改 | scope 增加 meeting |
| `desktop/src/main/services/artifact-registry.ts` | 修改 | 支持 meeting scope |
