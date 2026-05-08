import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Mic, Trash2, Settings2, Radio, ArrowLeft, AlertCircle } from "lucide-react";

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

function statusTag(status: MeetingStatus): { text: string; variant: "red" | "yellow" | "green" | "muted" | "accent" } {
  switch (status) {
    case "recording":    return { text: "录音中",   variant: "red" };
    case "transcribing": return { text: "转写中",   variant: "yellow" };
    case "summarizing":  return { text: "生成纪要", variant: "yellow" };
    case "done":         return { text: "已完成",   variant: "green" };
    case "failed":       return { text: "失败",     variant: "red" };
  }
}

function statusDot(status: MeetingStatus): "red" | "yellow" | "green" | "muted" | "accent" {
  switch (status) {
    case "recording":    return "accent";
    case "transcribing": return "yellow";
    case "summarizing":  return "yellow";
    case "done":         return "green";
    case "failed":       return "red";
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
    <div className="page-shell">
      <header className="page-header page-header--sticky">
        <div className="page-header__lead">
          <div className="page-header__eyebrow">
            <Mic size={14} />
            <span>Meetings</span>
          </div>
          <h2 className="page-header__title">会议录音</h2>
          <p className="page-header__subtitle">实时转写 + 说话人分离 + AI 纪要，录完即用。</p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="btn-primary" onClick={onStartRecording}>
            <Mic size={14} />
            开始录音
          </button>
        </div>
      </header>
      <main className="page-content">
        <div className="toolbar">
          <input
            className="input toolbar__search"
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索会议..."
          />
          <span className="toolbar__count">{filtered.length} 条</span>
        </div>

        {filtered.length === 0 ? (
          <section className="empty-state">
            <Mic size={32} className="empty-state__icon" />
            <h3 className="empty-state__title">
              {meetings.length === 0 ? "还没有录音记录" : "没有匹配的录音"}
            </h3>
            <p className="empty-state__body">
              {meetings.length === 0 ? "点击「开始录音」开启第一次会议。" : "调整搜索关键词试试。"}
            </p>
            {meetings.length === 0 && (
              <button type="button" className="btn-primary" onClick={onStartRecording}>
                <Mic size={14} />开始录音
              </button>
            )}
          </section>
        ) : (
          <div className="list-rows">
            {filtered.map((m) => {
              const tag = statusTag(m.status);
              const dot = statusDot(m.status);
              return (
                <article key={m.id} className="list-row">
                  <div className="list-row__lead">
                    <span className={`status-dot status-dot--${dot}`} title={tag.text} />
                  </div>
                  <div className="list-row__main">
                    <div className="list-row__title-row">
                      <button
                        type="button"
                        className="list-row__title list-row__title-btn"
                        onClick={() => onOpen(m.id)}
                      >
                        {m.title}
                      </button>
                      <span className={`tag tag--${tag.variant}`}>{tag.text}</span>
                    </div>
                    <div className="list-row__meta-row">
                      <span className="list-row__meta">{formatDate(m.createdAt)}</span>
                      <span className="list-row__meta-sep" />
                      <span className="list-row__meta">时长 {formatDuration(m.durationMs)}</span>
                      {m.speakerCount != null && (
                        <>
                          <span className="list-row__meta-sep" />
                          <span className="list-row__meta">{m.speakerCount} 位发言人</span>
                        </>
                      )}
                      {m.errorMessage && (
                        <>
                          <span className="list-row__meta-sep" />
                          <span className="list-row__meta list-row__meta--error" title={m.errorMessage}>
                            {m.errorMessage}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="list-row__trailing">
                    <button type="button" className="icon-btn" title="删除" onClick={() => onDelete(m.id)}>
                      <Trash2 size={14} />
                    </button>
                    <button type="button" className="btn-toolbar" onClick={() => onOpen(m.id)}>
                      <Settings2 size={14} />详情
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
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
    <div className="page-shell">
      <header className="page-header page-header--sticky">
        <div className="page-header__lead">
          <div className="page-header__eyebrow" style={{ color: "var(--status-red)" }}>
            <Radio size={14} />
            <span>Recording</span>
          </div>
          <h2 className="page-header__title">正在录音</h2>
          <p className="page-header__subtitle">
            {recorder.error
              ? `出错：${recorder.error}`
              : "麦克风已开启，请尽量靠近声源以获得更好的识别效果。"}
          </p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="btn-ghost" onClick={handleCancel}>
            取消
          </button>
          <button type="button" className="btn-primary" onClick={handleStop}>
            结束录音
          </button>
        </div>
      </header>
      <main className="page-content">
        <section
          className="glass-card glass-card--flat meeting-record-panel"
        >
          <div className="meeting-record-panel__timer-row">
            <span className="meeting-record-panel__dot" />
            <span className="meeting-record-panel__timer">
              {formatDuration(recorder.durationMs)}
            </span>
          </div>

          <AudioWaveform analyserNode={recorder.analyserNode} height={96} />

          <div className="meeting-live-transcript">
            {recorder.confirmedLines.length === 0 && !recorder.partialText ? (
              <span className="meeting-live-transcript__placeholder">等待识别结果...</span>
            ) : (
              <>
                {recorder.confirmedLines.map((line, idx) => (
                  <div key={idx}>{line}</div>
                ))}
                {recorder.partialText && (
                  <div className="meeting-live-transcript__partial">
                    {recorder.partialText}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </main>
    </div>
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
          ? `已导入 ${total} 个跟进事项到日程规划。`
          : "没有识别到可导入的跟进事项。",
      );
    } finally {
      setImportingFollowUps(false);
    }
  };

  if (loading) {
    return (
      <div className="meeting-state-placeholder">加载中...</div>
    );
  }

  if (!meeting) {
    return (
      <div className="page-shell">
        <header className="page-header page-header--sticky">
          <div className="page-header__lead">
            <h2 className="page-header__title">录音不存在</h2>
          </div>
          <div className="page-header__actions">
            <button type="button" className="btn-toolbar" onClick={onBack}>
              <ArrowLeft size={14} />返回列表
            </button>
          </div>
        </header>
      </div>
    );
  }

  const processing = meeting.status === "transcribing" || meeting.status === "summarizing";

  return (
    <div className="page-shell">
      <header className="page-header page-header--sticky">
        <div className="page-header__lead">
          <div className="page-header__eyebrow">
            <Mic size={14} />
            <span>Meeting</span>
          </div>
          <h2 className="page-header__title">{meeting.title}</h2>
          <p className="page-header__subtitle">
            {formatDate(meeting.createdAt)} · 时长 {formatDuration(meeting.durationMs)}
            {meeting.speakerCount != null ? ` · ${meeting.speakerCount} 位发言人` : ""}
            <span className={`tag tag--${statusTag(meeting.status).variant} meeting-status-tag`}>
              {statusTag(meeting.status).text}
            </span>
          </p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="btn-toolbar" onClick={onBack}>
            <ArrowLeft size={14} />返回
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleBuildFollowUps}
            disabled={processing || importingFollowUps}
          >
            {importingFollowUps ? "导入中..." : "导入到日程规划"}
          </button>
          <button type="button" className="btn-ghost btn-ghost--danger" onClick={handleDelete}>
            <Trash2 size={14} />删除
          </button>
        </div>
      </header>
      <main className="page-content">
        {processing && (
          <div className="banner banner--warning">
            <AlertCircle size={16} />
            <span>后处理进行中：{statusTag(meeting.status).text}。该会议将在后台自动完成，无需停留在此页面。</span>
          </div>
        )}

        {followUpNotice && (
          <div className="banner banner--info">
            <span>{followUpNotice}</span>
          </div>
        )}

        {audioUrl && (
          <AudioPlayer src={audioUrl} seekToMs={seekMs} onTimeUpdate={setCurrentMs} />
        )}

        <div className="meeting-detail-tabs">
          <button
            type="button"
            className={`btn-toolbar meeting-detail-tab${tab === "transcript" ? " is-active" : ""}`}
            onClick={() => setTab("transcript")}
          >
            转写稿
          </button>
          <button
            type="button"
            className={`btn-toolbar meeting-detail-tab${tab === "summary" ? " is-active" : ""}`}
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
            <div className="meeting-state-placeholder">
              {processing ? "转写稿尚未生成..." : "没有可用的转写稿"}
            </div>
          )
        ) : summary ? (
          <article className="meeting-summary">
            {summary}
          </article>
        ) : (
          <div className="meeting-state-placeholder">
            {processing ? "会议纪要正在生成..." : "没有可用的会议纪要"}
          </div>
        )}
      </main>
    </div>
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
    <>
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
    </>
  );
}
