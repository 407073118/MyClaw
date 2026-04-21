import argparse
from pathlib import Path
from typing import Any

import requests

ASR_URL = "https://zh-offline-16k-asr-antalos-app-server.100credit.cn/recognition"
FILE_PATH = r"E:\py_test\PythonProject1\asr-test\03-10 HRBP面试 王颖.mp3"


def build_spk_lines(sentences: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    current_spk: int | None = None
    current_text_parts: list[str] = []

    def flush_current() -> None:
        nonlocal current_spk, current_text_parts
        if current_spk is None or not current_text_parts:
            return
        merged = "".join(current_text_parts).strip()
        if merged:
            lines.append(f"发言人{current_spk}：{merged}")
        current_spk = None
        current_text_parts = []

    for item in sentences:
        text = str(item.get("text", "")).strip()
        if not text:
            continue

        spk_raw = item.get("spk", 0)
        try:
            spk = int(spk_raw)
        except (TypeError, ValueError):
            spk = 0

        if current_spk is None:
            current_spk = spk
            current_text_parts.append(text)
            continue

        if spk == current_spk:
            current_text_parts.append(text)
        else:
            flush_current()
            current_spk = spk
            current_text_parts.append(text)

    flush_current()
    return lines


def recognize_with_spk(file_path: str) -> str:
    audio_path = Path(file_path).expanduser().resolve()
    if not audio_path.exists():
        raise FileNotFoundError(f"文件不存在: {audio_path}")
    if not audio_path.is_file():
        raise ValueError(f"不是文件: {audio_path}")

    with audio_path.open("rb") as f:
        files = {
            "audio": (audio_path.name, f, "application/octet-stream"),
        }
        data = {
            "model_list": "spk",
        }
        resp = requests.post(ASR_URL, files=files, data=data, timeout=180)

    resp.raise_for_status()
    payload = resp.json()

    if not isinstance(payload, dict):
        raise ValueError(f"接口返回非 JSON 对象: {payload}")

    sentences = payload.get("sentences", [])
    if not isinstance(sentences, list):
        raise ValueError("接口返回中 `sentences` 字段不是数组")

    lines = build_spk_lines(sentences)
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="上传音频到 ASR，并按说话人输出逐条记录")
    parser.add_argument("--file_path", type=str, default=FILE_PATH, help="音频文件路径（wav/mp3）")
    args = parser.parse_args()

    result = recognize_with_spk(args.file_path)
    print(result)


if __name__ == "__main__":
    main()
