# ASR实时语音交互流程：
## 一 建立连接

客户端与服务端建立websocket连接

服务地址实时语音识别支持就近地域智能接入，示例  服务ip168.160.55端口号：10099 对应服务请求url：url = "ws://192.168.160.55:10099"   使用 加密传输时 url = "wss://192.168.160.55:10099"

## 二 开始识别

客户端发送请求，服务端确认请求有效，需要在请求消息中进行参数设置，各参数含义如下：

字段

类型

是否必选

是否为 client 启动参数

说明

- `mode`

string

是

是

`offline`表示推理模式为一句话识别；`online`表示推理模式为实时语音识别；`2pass`表示为实时语音识别，并且说话句尾采用离线模型进行纠错。

默认为 `2pass`

- `chunk_size`

string

否

是

默认是‘5,10,5’，表示流式模型latency配置`[5,10,5]`，表示当前音频解码片段为600ms，并且回看300ms，右看300ms，也可以设置为‘8，8，4’。

- `audio_fs`

Integer

否

是

pcm音频采样率；默认为16000

- `itn`

Bool

否

是

设置是否使用itn，默认1开启，设置为0关闭

- `ssl`

Bool

是

是

ssl=0时 不启用ssl，通过ws协议请求，ssl=1时使用wss；默认是1

- `audio_in`

string

否

是

支持3种格式：1、输入文件所在目录，请以/结尾; 2、单一文件.wav   3、scp 文件列表，每行为 id 空格 path

- `wav_format`

string

否

否

只能是 "pcm","PCM" 或者 不传

- `chunk_interval`

int

否

是

默认传 10 ，目前 C++ 服务不读这个参数，但是客户端需要这个参数计算每次要传给服务端的二进制数据量

- `is_speaking`

Bool

是

否

开始传音频流时，必须传该参数，告诉 wfst 重置状态。

”是否为 client 启动参数“ 表示该参数能否在 streaming_asr_wss_client_br.py 客户端启动时指定，如果为否，说明客户端会计算该值并传给服务端。

对于开发者而言，以python客户端为例，需要发送如下 message给服务端，然后开始发送音频流，详见 streaming_asr_wss_client_br.py：

```text
message = json.dumps({"mode": args.mode, "chunk_size": args.chunk_size, "chunk_interval": args.chunk_interval, "audio_fs":sample_rate, "wav_name": wav_name, "wav_format": wav_format, "is_speaking": True, "hotwords":hotword_msg, "itn": use_itn})
```

## 三 识别中：发送音频二进制流，接受中间结果

发送内容只包含 二进制数据，不要发送文件头，具体方法参考 streaming_asr_wss_client_br.py 。

接收结果并解析：

字段

类型

说明

- `wav_name`

string

音频id

- `is_final`

bool

音频流识别是否结束，即检测到 音频断点 vad_speech_end_time

- `text`

string

语音识别结果

- `vad_trigger_time`

int

vad_trigger_time不等于-1时代表 vad 检测到当前音频的第一个语音开始段，需要根据这个值来决定是否对智能客服做打断。

- `vad_speech_start_time`

int

用于检测语音开始的标志，用于打断。

- `vad_speech_end_time`

int

用于检测语音结束的标志，用于打断。

- `partial_text`

string

实时识别结果，NOTE：本次修改（20250923）后，实时识别结果包含了有效 vad_speech_start_time 到当前时间点的识别结果，不再是单个 Token

- `final_text`

string

一句话识别结果，或者在检测到 vad_speech_end_time 时，后处理得到的阶段性结果。该结果包含标点，文本数字会转为阿拉伯数字

当服务端返回的message中的vad_trigger_time不等于-1时，意味着检测到了当前音频speech开始的位置。
online模式时，partial_text 从服务端持续返回识别的中间结果。
## 四 发送结束与识别结束

客户端可以主动通知服务端语音数据发送完成（ {"is_speaking":False} )

服务端识别结束后通知客户端识别完毕（is_final=True）。

## 五 F&Q
识别出现乱码，不说人话？大概率是采样率的问题，请检查一下传入的 audio_fs 和 wav 格式是否一致，默认是 16k 即 16000；典型的其他值有 44100
## 六 python 客户端调用示例：
```text
python streaming_asr_wss_client_br.py --mode=2pass --host=192.168.160.55 --port=10099 --audio_in=${path_to_wavs}/  --ssl=0 # 如果服务端没有开 ssl,客户端也应该置ssl为0
```

```text
python streaming_asr_wss_client_br.py --mode=online --host=192.168.160.55 --port=10099 --audio_in=${path_to_wavs}/  --ssl=0
```
# path_to_wavs 是音频所在目录，或者音频本身，或者 csp 文件

客户端代码示例：

## 七 改动流水

20250923 改动：

partial_text 的含义发生变化，会包含有效 vad_speech_start_time 到当前时间点的所有识别结果，不再是当前音频段对应的 Token，前端如果对 partial_text 有拼接积累操作应该换为赋值操作。原因是： online-wfst 解码器可能修改已经输出的文本结果。
chunk_size 建议改为 ‘5,10,8’ ；做实验发现，结合 online-wfst，这种 chunk_size 得到的解码结果较好。 虽然效果会好，但是会导致性能上的卡顿，已经在cpp代码里强制使用 '5,10,5' ,客户端此参数不再生效。
mode 建议使用 online 模式，减少推理长尾延时。
text 表述和代码不一致，文档已经修改。
