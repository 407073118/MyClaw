import json
import ssl
import time
import websocket
import sys
from websocket import ABNF
import glob
import threading
import struct
from datetime import datetime
import os
import queue

context = ""
# 修改re_list为results_dict，用于存储音频文件名和识别结果的映射
results_dict = {}
# 添加线程锁，确保结果字典的线程安全
results_lock = threading.Lock()
accessNumber = str(int(time.time() * 1000))
task_id = str(int(accessNumber) + 1)

url = "ws://zh-stream-asr-antaios-app-server-pre.k8s.brapp.com:80"
# 输入-音频目录
filePath = "recording/"
# 输出-识别结果
textPath = './asr.rec'
# 输入-标注文件
labPath = './lab.txt'

# 定义并发数
THREAD_NUM = 1
# 使用队列来管理音频文件
file_queue = queue.Queue()
# 成功计数和锁
success_count = 0
success_lock = threading.Lock()

submit_start_recognition = {
    "signal": "start",
    "nbest": 1,
    "continuous_decoding": True,
    "voiceId": accessNumber
}

submit_stop_recognition = {
    "signal": "end"
}

# 读取lab.txt文件，建立音频文件名到标注文本的映射
label_map = {}
if os.path.exists(labPath):
    with open(labPath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        for line in lines:
            parts = line.strip().split('\t')
            if len(parts) >= 2:
                filename = parts[0]
                label = parts[1]
                label_map[filename] = label
print(label_map)


class WebsocketClient(object):
    def __init__(self, address):
        super(WebsocketClient, self).__init__()
        self.address = address
        self.recv = None

    def on_message(self, ws, message):
        global results_dict, success_count
        try:
            json_object = json.loads(message)

            if json_object['type'] == "server_ready":
                step = 320
                first_iter = 0
                with open(self.file, 'rb') as f:
                    f.seek(44)
                    while True:
                        read_data = f.read(step)
                        if read_data:
                            ws.send(read_data, ABNF.OPCODE_BINARY)
                        if len(read_data) < step:
                            break
                        time.sleep(0.02)
                    first_iter = 0

                ws.send(json.dumps(submit_stop_recognition))

            if json_object['type'] == "final_result":
                if json_object['nbest'] is not None:
                    result = json.loads(json_object['nbest'])[0]['sentence']
                    # 使用线程锁保护结果字典的写入
                    filename = os.path.basename(self.file)
                    filename = filename.replace(".wav", "")
                    with results_lock:
                        if filename not in results_dict:
                            results_dict[filename] = result
                        else:
                            results_dict[filename] = results_dict[filename] + result

            if json_object['type'] == "speech_end":
                # 成功计数
                with success_lock:
                    global success_count
                    success_count += 1
                    print(f"成功处理: {self.file}, 成功数: {success_count}")
                ws.close()

        except ValueError as e:
            print(f"JSON解析错误: {e}")
            return False
        except Exception as e:
            print(f"处理消息时发生错误: {e}")
            return False

    def on_error(self, ws, error):
        # print(f"### 连接错误 {self.file}:", error)
        ws.close()

    def on_close(self, ws, close_status_code, close_reason):
        # print(f"### 连接关闭 {self.file} ### close_status_code:{close_status_code}, close_reason:{close_reason}")
        ws.close()

    def on_open(self, ws):
        ws.send(json.dumps(submit_start_recognition))

    def run(self, file):
        self.file = file
        websocket.enableTrace(False)
        self.ws = websocket.WebSocketApp(self.address,
                                         on_message=self.on_message,
                                         on_open=self.on_open,
                                         on_close=self.on_close,
                                         on_error=self.on_error)
        self.ws.run_forever(sslopt={"cert_reqs": ssl.CERT_NONE})


def thread_func():
    """线程函数，从队列中获取文件进行处理"""
    while True:
        try:
            # 从队列获取文件，超时3秒后退出
            file = file_queue.get(timeout=3)
        except queue.Empty:
            # 队列为空，线程退出
            break

        try:
            print(f'线程 {threading.current_thread().name} 开始处理: {file}')
            ws_client = WebsocketClient(url)
            ws_client.run(file)

            filename = os.path.basename(file)
            with results_lock:
                filename = filename.replace(".wav", "")
                if filename in results_dict:
                    print(f"处理完成: {file}, 识别结果: {results_dict[filename]}")
                else:
                    print(f"处理完成但无结果: {file}")

        except Exception as e:
            print(f"线程 {threading.current_thread().name} 处理文件 {file} 时出错: {e}")
        finally:
            # 标记任务完成
            file_queue.task_done()


def mul_threads():
    """多线程处理函数"""
    # 获取所有wav文件
    file_list = glob.glob(filePath + "*.wav")

    if not file_list:
        print("未找到任何wav文件")
        return

    print(f"找到 {len(file_list)} 个wav文件，使用 {THREAD_NUM} 个线程处理")

    # 将文件添加到队列
    for file in file_list:
        file_queue.put(file)

    threads = []

    # 创建并启动线程
    for i in range(THREAD_NUM):
        t = threading.Thread(target=thread_func, name=f"Thread-{i + 1}")
        t.daemon = True
        threads.append(t)
        t.start()

    # 等待所有任务完成
    file_queue.join()

    print("所有文件处理完成")

    # 写入结果文件
    write_results_to_file()

    print(f"成功处理 {success_count} 个文件")
    print("主线程结束")


def write_results_to_file():
    """将结果写入文件"""
    with open(textPath, 'w', encoding='utf-8') as f:
        # 按照"音频名\t标注\t识别结果"的格式写入文件
        for filename, result in results_dict.items():
            label = label_map.get(filename, "")  # 获取标注，如果不存在则为空字符串
            line = f"{filename}\t{label}\t{result}\n"
            print(line.strip())
            f.write(line)
    print("文件写入成功")


if __name__ == '__main__':
    mul_threads()