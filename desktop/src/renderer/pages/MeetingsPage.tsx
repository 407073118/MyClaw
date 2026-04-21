import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { MeetingRecord, MeetingStatus, StructuredTranscript } from "@shared/contracts";

import { useMeetingRecorder } from "../hooks/useMeetingRecorder";
import AudioWaveform from "../components/meeting/AudioWaveform";
import AudioPlayer from "../components/meeting/AudioPlayer";
import TranscriptView from "../components/meeting/TranscriptView";

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${mo}-${day} ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

function statusPill(status: MeetingStatus): { text: string; className: string } {
  switch (status) {
    case "recording":
      return { text: "录音中", className: "glass-pill glass-pill--red" };
    case "transcribing":
      return { text: "转写中", className: "glass-pill glass-pill--yellow" };
    case "summarizing":
      return { text: "生成纪要", className: "glass-pill glass-pill--yellow" };
    case "done":
      return { text: "已完成", className: "glass-pill glass-pill--green" };
    case "failed":
      return { text: "失败", className: "glass-pill glass-pill--red" };
  }
}

// ---------------------------------------------------------------------------
// 列表视图
// ---------------------------------------------------------------------------

type ListViewProps = {
  meetings: MeetingRecord[];
  onOpen: (meetingId: string) => void;
  onDelete: (meetingId: string) => void;
  onStartRecording: () => void;
};

function MeetingListView({ meetings, onOpen, onDelete, onStartRecording }: ListViewProps) {
  const [keyword, setKeyword] = useState("");

  const filtered = useMemo(() => {
    const k = keyword.trim();
    if (!k) return meetings;
    return meetings.filter((m) => m.title.includes(k));
  }, [meetings, keyword]);

  return (
    <>
      <header className="page-header">
        <div className="header-text">
          <span className="eyebrow">MEETINGS</span>
          <h2 className="page-title">会议录音</h2>
          <p className="page-subtitle">实时转写 + 说话人分离 + AI 纪要，录完即用。</p>
        </div>
        <div className="header-actions" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索会议..."
            style={{
              width: 200,
              padding: "8px 12px",
              fontSize: 13,
              color: "var(--text-primary)",
              background: "var(--bg-base)",
              border: "1px solid var(--glass-border)",
              borderRadius: "var(--radius-md)",
              outline: "none",
            }}
          />
          <button type="button" className="btn-premium accent" onClick={onStartRecording}>
            开始录音
          </button>
        </div>
      </header>

      {filtered.length === 0 ? (
        <div
          style={{
            padding: "64px 32px",
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: 14,
            border: "1px dashed var(--glass-border)",
            borderRadius: "var(--radius-xl)",
          }}
        >
          {meetings.length === 0 ? "还没有录音记录，点击「开始录音」开启第一次会议" : "没有匹配的录音"}
        </div>
      ) : (
        <div className="glass-grid glass-grid--md">
          {filtered.map((m) => {
            const pill = statusPill(m.status);
            return (
              <div key={m.id} className="glass-card glass-card--accent">
                <div className="glass-card__header">
                  <h3>{m.title}</h3>
                  <span className={pill.className}>{pill.text}</span>
                </div>
                <div className="glass-card__body">
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
                    {formatDate(m.createdAt)}
                  </p>
                  <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
                    时长 {formatDuration(m.durationMs)}
                    {m.speakerCount != null ? ` · ${m.speakerCount} 位发言人` : ""}
                  </p>
                  {m.errorMessage && (
                    <p style={{ fontSize: 12, color: "var(--status-red)", margin: "6px 0 0" }}>
                      {m.errorMessage}
                    </p>
                  )}
                </div>
                <div className="glass-card__footer">
                  <button
                    type="button"
                    className="glass-action-btn glass-action-btn--danger"
                    onClick={() => onDelete(m.id)}
                  >
                    删除
                  </button>
                  <button
                    type="button"
                    className="glass-action-btn glass-action-btn--primary"
                    style={{ marginLeft: "auto" }}
                    onClick={() => onOpen(m.id)}
                  >
                    查看详情
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 录音中视图
// ---------------------------------------------------------------------------

type RecordingViewProps = {
  onStop: () => void;
  onCancel: () => void;
};

function MeetingRecordingView({ onStop, onCancel }: RecordingViewProps) {
  const recorder = useMeetingRecorder();

  // 进入视图即开始录音（懒启动）
  useEffect(() => {
    if (recorder.status === "idle") {
      void recorder.startRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStop = async () => {
    await recorder.stopRecording();
    onStop();
  };

  const handleCancel = async () => {
    await recorder.cancelRecording();
    onCancel();
  };

  return (
    <>
      <header className="page-header">
        <div className="header-text">
          <span className="eyebrow" style={{ color: "var(--status-red)" }}>RECORDING</span>
          <h2 className="page-title">正在录音</h2>
          <p className="page-subtitle">
            {recorder.error
              ? `出错：${recorder.error}`
              : "麦克风已开启，请尽量靠近声源以获得更好的识别效果。"}
          </p>
        </div>
        <div className="header-actions" style={{ display: "flex", gap: 12 }}>
          <button type="button" className="btn-premium" onClick={handleCancel}>
            取消
          </button>
          <button type="button" className="btn-premium accent" onClick={handleStop}>
            结束录音
          </button>
        </div>
      </header>

      <section
        className="glass-card glass-card--flat"
        style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "var(--status-red)",
              boxShadow: "0 0 0 0 rgba(239,68,68,0.7)",
              animation: "meetingPulse 1.4s ease-in-out infinite",
            }}
          />
          <span style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>
            {formatDuration(recorder.durationMs)}
          </span>
        </div>

        <AudioWaveform analyserNode={recorder.analyserNode} height={96} />

        <div
          style={{
            minHeight: 120,
            maxHeight: 280,
            overflowY: "auto",
            padding: "12px 14px",
            background: "rgba(0,0,0,0.25)",
            border: "1px solid var(--glass-border)",
            borderRadius: "var(--radius-lg)",
            fontSize: 14,
            lineHeight: 1.7,
            color: "var(--text-primary)",
          }}
        >
          {recorder.confirmedLines.length === 0 && !recorder.partialText ? (
            <span style={{ color: "var(--text-muted)", fontSize: 13 }}>等待识别结果...</span>
          ) : (
            <>
              {recorder.confirmedLines.map((line, idx) => (
                <div key={idx}>{line}</div>
              ))}
              {recorder.partialText && (
                <div style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>
                  {recorder.partialText}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <style>{`
        @keyframes meetingPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.7); }
          50% { box-shadow: 0 0 0 10px rgba(239,68,68,0); }
        }
      `}</style>
    </>
  );
}

// ---------------------------------------------------------------------------
// 详情视图
// ---------------------------------------------------------------------------

type DetailViewProps = {
  meetingId: string;
  onBack: () => void;
  onDeleted: () => void;
};

function MeetingDetailView({ meetingId, onBack, onDeleted }: DetailViewProps) {
  const [meeting, setMeeting] = useState<MeetingRecord | null>(null);
  const [transcript, setTranscript] = useState<StructuredTranscript | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [tab, setTab] = useState<"transcript" | "summary">("transcript");
  const [seekMs, setSeekMs] = useState<number | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [importingFollowUps, setImportingFollowUps] = useState(false);
  const [followUpNotice, setFollowUpNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const payload = await window.myClawAPI.meetings.get(meetingId);
    setMeeting(payload.meeting);
    setTranscript(payload.transcript);
    setSummary(payload.summary);
    setLoading(false);
  }, [meetingId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 订阅状态变更事件：后处理完成后自动刷新
  useEffect(() => {
    const unsubscribe = window.myClawAPI.meetings.onEvent((event) => {
      if (event.type === "status" && event.meetingId === meetingId) {
        if (event.status === "done" || event.status === "failed") {
          void refresh();
        } else if (meeting) {
          setMeeting({ ...meeting, status: event.status, errorMessage: event.errorMessage });
        }
      }
    });
    return unsubscribe;
  }, [meetingId, meeting, refresh]);

  // 加载 wav → Blob URL
  useEffect(() => {
    if (!meeting || meeting.status !== "done") return;
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      const { buffer } = await window.myClawAPI.meetings.readAudio(meetingId);
      if (cancelled || !buffer) return;
      const blob = new Blob([buffer], { type: "audio/wav" });
      createdUrl = URL.createObjectURL(blob);
      setAudioUrl(createdUrl);
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [meeting, meetingId]);

  const handleDelete = async () => {
    if (!window.confirm("确定删除这条录音吗？")) return;
    await window.myClawAPI.meetings.delete(meetingId);
    onDeleted();
  };

  const handleUpdateSpeaker = async (speakerIndex: number, label: string) => {
    await window.myClawAPI.meetings.updateSpeaker(meetingId, speakerIndex, label);
    await refresh();
  };

  const handleBuildFollowUps = async () => {
    setImportingFollowUps(true);
    try {
      const payload = await window.myClawAPI.meetings.buildFollowUps(meetingId);
      const total = payload.commitments.length + payload.reminders.length + payload.suggestedEvents.length;
      setFollowUpNotice(
        total > 0
          ? `已导入 ${total} 个跟进事项到时间中心。`
          : "没有识别到可导入的跟进事项。",
      );
    } finally {
      setImportingFollowUps(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>加载中...</div>
    );
  }

  if (!meeting) {
    return (
      <>
        <header className="page-header">
          <div className="header-text">
            <h2 className="page-title">录音不存在</h2>
          </div>
          <div className="header-actions">
            <button type="button" className="btn-premium" onClick={onBack}>
              返回列表
            </button>
          </div>
        </header>
      </>
    );
  }

  const pill = statusPill(meeting.status);
  const processing = meeting.status === "transcribing" || meeting.status === "summarizing";

  return (
    <>
      <header className="page-header">
        <div className="header-text">
          <span className="eyebrow">MEETING</span>
          <h2 className="page-title">{meeting.title}</h2>
          <p className="page-subtitle">
            {formatDate(meeting.createdAt)} · 时长 {formatDuration(meeting.durationMs)}
            {meeting.speakerCount != null ? ` · ${meeting.speakerCount} 位发言人` : ""}
            <span className={pill.className} style={{ marginLeft: 12 }}>
              {pill.text}
            </span>
          </p>
        </div>
        <div className="header-actions" style={{ display: "flex", gap: 12 }}>
          <button type="button" className="btn-premium" onClick={onBack}>
            返回
          </button>
          <button
            type="button"
            className="btn-premium accent"
            onClick={handleBuildFollowUps}
            disabled={processing || importingFollowUps}
          >
            {importingFollowUps ? "导入中..." : "导入到时间中心"}
          </button>
          <button
            type="button"
            className="glass-action-btn glass-action-btn--danger"
            onClick={handleDelete}
          >
            删除
          </button>
        </div>
      </header>

      {processing && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "var(--radius-lg)",
            background: "rgba(245, 158, 11, 0.1)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            color: "var(--status-yellow)",
            fontSize: 13,
          }}
        >
          后处理进行中：{pill.text}。该会议将在后台自动完成，无需停留在此页面。
        </div>
      )}

      {followUpNotice && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "var(--radius-lg)",
            background: "rgba(16, 163, 127, 0.12)",
            border: "1px solid rgba(16, 163, 127, 0.3)",
            color: "var(--text-primary)",
            fontSize: 13,
          }}
        >
          {followUpNotice}
        </div>
      )}

      {audioUrl && (
        <AudioPlayer src={audioUrl} seekToMs={seekMs} onTimeUpdate={setCurrentMs} />
      )}

      <div
        style={{
          display: "flex",
          gap: 8,
          borderBottom: "1px solid var(--glass-border)",
          paddingBottom: 8,
        }}
      >
        <button
          type="button"
          className={`glass-action-btn${tab === "transcript" ? " glass-action-btn--primary" : ""}`}
          onClick={() => setTab("transcript")}
        >
          转写稿
        </button>
        <button
          type="button"
          className={`glass-action-btn${tab === "summary" ? " glass-action-btn--primary" : ""}`}
          onClick={() => setTab("summary")}
        >
          会议纪要
        </button>
      </div>

      {tab === "transcript" ? (
        transcript ? (
          <TranscriptView
            transcript={transcript}
            speakerLabels={meeting.speakerLabels}
            currentTimeMs={currentMs}
            onSeek={setSeekMs}
            onUpdateSpeaker={handleUpdateSpeaker}
          />
        ) : (
          <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>
            {processing ? "转写稿尚未生成..." : "没有可用的转写稿"}
          </div>
        )
      ) : summary ? (
        <article
          style={{
            padding: "20px 24px",
            background: "var(--bg-card)",
            border: "1px solid var(--glass-border)",
            borderRadius: "var(--radius-xl)",
            whiteSpace: "pre-wrap",
            fontSize: 14,
            lineHeight: 1.8,
            color: "var(--text-primary)",
          }}
        >
          {summary}
        </article>
      ) : (
        <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>
          {processing ? "会议纪要正在生成..." : "没有可用的会议纪要"}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 页面根组件
// ---------------------------------------------------------------------------

export default function MeetingsPage() {
  const navigate = useNavigate();
  const { id: routeMeetingId } = useParams<{ id?: string }>();

  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [view, setView] = useState<"list" | "recording" | "detail">(
    routeMeetingId ? "detail" : "list",
  );

  const refreshList = useCallback(async () => {
    const { items } = await window.myClawAPI.meetings.list();
    setMeetings(items);
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // 订阅事件：有状态变化时刷新列表
  useEffect(() => {
    const unsubscribe = window.myClawAPI.meetings.onEvent((event) => {
      if (event.type === "status") {
        void refreshList();
      }
    });
    return unsubscribe;
  }, [refreshList]);

  // 路由变化时同步视图
  useEffect(() => {
    if (routeMeetingId) {
      setView("detail");
    } else if (view === "detail") {
      setView("list");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeMeetingId]);

  return (
    <main className="page-container" style={{ height: "100%", overflowY: "auto" }}>
      {view === "list" && (
        <MeetingListView
          meetings={meetings}
          onOpen={(id) => navigate(`/meetings/${id}`)}
          onDelete={async (id) => {
            if (!window.confirm("确定删除这条录音吗？")) return;
            await window.myClawAPI.meetings.delete(id);
            await refreshList();
          }}
          onStartRecording={() => setView("recording")}
        />
      )}

      {view === "recording" && (
        <MeetingRecordingView
          onStop={async () => {
            setView("list");
            await refreshList();
          }}
          onCancel={async () => {
            setView("list");
            await refreshList();
          }}
        />
      )}

      {view === "detail" && routeMeetingId && (
        <MeetingDetailView
          meetingId={routeMeetingId}
          onBack={() => navigate("/meetings")}
          onDeleted={async () => {
            navigate("/meetings");
            await refreshList();
          }}
        />
      )}
    </main>
  );
}
