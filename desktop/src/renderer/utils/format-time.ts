/** 消息时间格式化工具函数 */

/** 格式化消息时间为 HH:MM（24小时制） */
export function formatMessageTime(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** 格式化完整时间，用于 hover title */
export function formatFullTime(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** 格式化日期分割线文本（今天 / 昨天 / X月X日 / XXXX年X月X日） */
export function formatDateSeparator(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 判断两个时间戳是否属于不同天 */
export function isDifferentDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.toDateString() !== db.toDateString();
}

/** 格式化相对时间（中文）：刚刚 / X分钟前 / X小时前 / X天前 */
export function formatRelativeTime(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 0) return "刚刚";
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "刚刚";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}天前`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}个月前`;
  return `${Math.floor(diffMonth / 12)}年前`;
}
