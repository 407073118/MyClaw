import json
from pathlib import Path

import requests
from requests import exceptions as req_exc

# ===== 配置区 =====
ASR_URL = "https://zh-offline-16k-asr-antalos-app-server.100credit.cn/recognition"
FILE_NAME = "recording-20260319-143133.wav"  # 只改这个文件名即可
# ==================


def main() -> None:
    base_dir = Path(__file__).resolve().parent
    audio_path = base_dir / FILE_NAME

    if not audio_path.exists():
        raise FileNotFoundError(f"音频文件不存在: {audio_path}")

    url = ASR_URL

    try:
        with audio_path.open("rb") as f:
            files = {
                "audio": (audio_path.name, f, "application/octet-stream"),
            }
            resp = requests.post(url, files=files, timeout=120)
    except req_exc.ConnectionError as e:
        raise SystemExit(
            f"无法连接 ASR 服务: {url}\n"
            f"- 请确认网络可访问该域名\n"
            f"- 请确认公司网络/代理未拦截 HTTPS 请求\n"
            f"原始错误: {e}"
        ) from e

    print(f"HTTP {resp.status_code}")
    resp.raise_for_status()

    text = ""
    raw = resp.text
    try:
        data = resp.json()
        if isinstance(data, dict):
            text = data.get("text", "")
            print("识别结果：")
            print(text if text else raw)
            return
    except json.JSONDecodeError:
        pass

    print("识别结果：")
    print(raw)


if __name__ == "__main__":
    main()
