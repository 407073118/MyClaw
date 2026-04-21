import os

import requests
import argparse
from concurrent.futures import ThreadPoolExecutor


parser = argparse.ArgumentParser()
parser.add_argument("--host", type=str, default="127.0.0.1", required=False, help="sever ip")
parser.add_argument("--port", type=int, default=8000, required=False, help="server port")
parser.add_argument(
    "--audio_path", type=str, required=True, help="use audio path"
)
parser.add_argument(
    "--thread_num", type=int,default=1, required=False, help="use audio path"
)
args = parser.parse_args()
print("-----------  Configuration Arguments -----------")
for arg, value in vars(args).items():
    print("%s: %s" % (arg, value))
print("------------------------------------------------")


url = f"http://{args.host}:{args.port}/recognition"
if args.port == 443:
    url = f"https://{args.host}:{args.port}/recognition"


headers = {}
audio_path:str= args.audio_path

def send_audio_file(a_id, a_path, url, headers):

    files = [
        (
            "audio",
            (
                os.path.basename(a_path),
                open(a_path, "rb"),
                "application/octet-stream",
            ),
        )
    ]
    response = requests.post(url, headers=headers, files=files)
    print(a_id, "\t", response.text)

if audio_path.lower().endswith(".scp") or audio_path.lower().endswith(".list"):
    with open(audio_path,encoding="utf8") as f, ThreadPoolExecutor(max_workers=args.thread_num) as executor:
        lines = f.readlines()
        for line in lines:
            cols = line.strip().split()
            if len(cols)==2:
                id=cols[0]
                a_path= cols[1]
            elif len(cols) ==1:
                id = cols[0]
                a_path= cols[0]

            executor.submit(send_audio_file, id, a_path, url, headers)


# 支持 .scp 或者文件列表.list
