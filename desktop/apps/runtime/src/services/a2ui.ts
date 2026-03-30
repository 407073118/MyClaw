import { A2UI_LITE_VERSION, type A2UiForm, type A2UiPayload } from "@myclaw-desktop/shared";

type A2UiEnvelope = {
  version: string;
  text?: string;
  ui?: unknown;
};

export type AssistantReply = {
  content: string;
  ui?: A2UiPayload | null;
};

export const A2UI_ASSISTANT_SYSTEM_PROMPT = [
  "You are a powerful Local Developer Agent with DIRECT ACCESS to the host system via specific tools.",
  "Your MISSION is to perform tasks yourself. NEVER say 'I cannot execute commands' or 'Run this on your machine'.",
  "If you need to see a file or drive (like E:\\), CALL the exec_command tool IMMEDIATELY without hesitation.",
  "Use standard PowerShell syntax for exec_command on Windows.",
  "Do NOT wrap commands in your own XML tags like <exec_command>; use the PROVIDED tool-calling API.",
  "Built-in file tools (fs.*) are restricted to the workspace. For other paths/drives, ALWAYS use exec_command.",
  "If you encounter an error, explain it and try another command. DO NOT GIVE UP.",
  "The desktop currently renders structured interaction as A2UI forms.",
  "When providing structured UI, use the A2UI block format exactly as specified.",
  "Use A2UI ONLY when you need the user to fill 2 or more fields in one turn.",
  "If you only need one answer, one confirmation, one yes/no decision, or one next-step choice, ask in normal conversation text instead of emitting a form.",
  `A2UI block format: \`\`\`a2ui {\"version\":\"${A2UI_LITE_VERSION}\",\"text\":\"...\",\"ui\":{\"kind\":\"form\",...}} \`\`\``,
  "All UI blocks MUST be valid JSON.",
].join("\n");

export function parseAssistantReply(raw: string): AssistantReply {
  const normalized = raw.trim();
  const a2uiReply = parseExplicitA2UiReply(normalized);
  if (a2uiReply) {
    return a2uiReply;
  }

  return { content: normalized };
}

export function isA2UiPayload(input: unknown): input is A2UiPayload {
  if (!input || typeof input !== "object") {
    return false;
  }

  const payload = input as Partial<A2UiForm>;
  if (payload.version !== A2UI_LITE_VERSION || payload.kind !== "form") {
    return false;
  }

  if (!isNonEmptyString(payload.id) || !isNonEmptyString(payload.title)) {
    return false;
  }

  if (!Array.isArray(payload.fields) || payload.fields.length === 0) {
    return false;
  }

  return payload.fields.every((field) => {
    if (!field || typeof field !== "object") {
      return false;
    }

    const fieldInput = field as A2UiForm["fields"][number];
    if (!isNonEmptyString(fieldInput.name) || !isNonEmptyString(fieldInput.label)) {
      return false;
    }

    if (fieldInput.input !== "text" && fieldInput.input !== "textarea" && fieldInput.input !== "select") {
      return false;
    }

    if (fieldInput.input === "select") {
      return (
        Array.isArray(fieldInput.options) &&
        fieldInput.options.length > 0 &&
        fieldInput.options.every((option) => isNonEmptyString(option.label) && isNonEmptyString(option.value))
      );
    }

    return true;
  });
}

function parseA2UiEnvelope(raw: string): A2UiEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as A2UiEnvelope;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (parsed.version !== A2UI_LITE_VERSION) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function parseExplicitA2UiReply(normalized: string): AssistantReply | null {
  // Smart extract: looks for "a2ui" and then balances the JSON brackets properly.
  // This avoids failing when LLM forgets to wrap with ```a2ui or mistakenly outputs ```json a2ui {...}
  const index = normalized.toLowerCase().indexOf("a2ui");
  if (index === -1) {
    return null;
  }

  let braceIndex = index + 4;
  while (braceIndex < normalized.length && normalized[braceIndex] !== "{") {
    const char = normalized[braceIndex].toLowerCase();
    // Allow spaces, newlines, and common markdown mistakes like `json` or ``` before the opening brace
    if (char !== " " && char !== "\n" && char !== "\r" && char !== "\t" && char !== "`" && char !== "j" && char !== "s" && char !== "o" && char !== "n") {
      break;
    }
    braceIndex++;
  }

  if (braceIndex >= normalized.length || normalized[braceIndex] !== "{") {
    return null;
  }

  const start = braceIndex;
  let depth = 0;
  let end = -1;
  let inString = false;
  let escape = false;

  for (let i = start; i < normalized.length; i++) {
    const char = normalized[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
  }

  if (end === -1) {
    return null;
  }

  const jsonStr = normalized.substring(start, end + 1);
  const blockPayload = parseA2UiEnvelope(jsonStr);
  const normalizedUi = blockPayload
    ? normalizeA2UiPayload(blockPayload.ui, blockPayload.version)
    : null;

  const exactBlockWithPrefix = normalized.substring(index, end + 1);
  let fallbackText = normalized.replace(exactBlockWithPrefix, "").trim();
  fallbackText = fallbackText.replace(/```(?:json)?\s*```/gi, "").replace(/```\s*$/g, "").trim();

  const blockText = blockPayload?.text;
  const text = typeof blockText === "string" && blockText.trim()
    ? blockText.trim()
    : fallbackText || "Please complete the form below.";

  if (!normalizedUi) {
    return null;
  }

  if (!shouldKeepStructuredForm(normalizedUi)) {
    return {
      content: text,
    };
  }

  return {
    content: text,
    ui: normalizedUi,
  };
}

function normalizeA2UiPayload(
  input: unknown,
  envelopeVersion: string | undefined,
): A2UiPayload | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Record<string, unknown>;
  const normalized = {
    ...candidate,
    version: typeof candidate.version === "string" ? candidate.version : envelopeVersion ?? A2UI_LITE_VERSION,
  };

  return isA2UiPayload(normalized) ? normalized : null;
}

/** 仅保留真正需要多字段收集的结构化表单，单字段一律回退到普通会话。 */
function shouldKeepStructuredForm(payload: A2UiPayload): boolean {
  return Array.isArray(payload.fields) && payload.fields.length >= 2;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
