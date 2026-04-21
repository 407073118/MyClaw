# 说明：offline 是指上传文件后，服务进行处理，当音频文件完全处理完才返回最终结果。

现在提供 （一）（二） 两种方式；（三）是对返回信息的说明

## （一）客户端脚本调用方法：

客户端脚本

# 客户端脚本调用示例：
```text
python client_scp_asyn.py  --host xxx.abc.cn --port 80 --audio_path ./one.list
```

识别结果会打印到控制台

脚本参数：

参数名	含义	默认
--host	服务器地址；域名或IP	127.0.0.1

- `--port`

访问端口	10095

- `--audio_path`

音频文件列表，支持 .scp 和 .list

scp 每行为音频的id 和音频路径

list 每行为音频路径

当前支持音频格式 .wav .mp3

必传

- `--thread_num`

发送 http 请求的线程数，本客户端支持多线程

单一生产环境的服务器，最佳支持 25 并发

offline asr 技术文档 - zhongyu.wang - 百融云创-知识库

1

.scp 示例：

abc abc.wav
## （二）手动发送 http post 请求
同步识别请求
参数名	示例	含义	属性	值类型
/recognition

```text
http://{host}:{port}/recognition
```

```text
https://zh-offline-16k-asr-antalos-app-server.100credit.cn/recognition
```

请求接口地址

线上服务需要用 https 访问

接口

- `audio`

上传的文件，支持 .wav .mp3

form-data  key

文件

- `model_list`

示例1 emo

示例2 spk

示例3 emo,spk

传入emo时开启情绪识别

传入 spk 开启说话人识别

传入 noasr 时，关闭 ASR；ASR 是默认开启的

传入 search_spkdb 时，在说话人库中匹配说话人。【注意，声纹库还没由 milvus 换成 qdrant 这个  search_spkdb  暂时不要用了】

使用英文逗号隔开。

form-data  key

字符串，可选

取值范围：

【emo,spk,noasr,search_spkdb】

- `spk_center`

'[[]]' float 二维数组，典型形状为 [2x192]

每一行代表一个说话人的聚类中心。

由客户端返回给服务端

json 字符串，里边是一个二维数组

可选，首次请求时不要传。后续请求带上首次结果返回的 spk_center 才能保证说话人的一致性。

同一段音频切片时，且需要区分说话人，应当注意这个参数

- `offset`

60000

当前切片的起始时刻 (ms)

form-data  key

int  可选，默认是0

- `max_num_spks`

3

最大说话人数目，可以提高说话人聚类的准确率

form-data  key

int  可选，默认是2

- `snr_thres`

-17

vad 会把信噪比小于该阈值的音频标记为非语音，减小这个数可以让嘈杂音频进入 ASR；增大这个值会让进入 ASR 的音频更纯净，但是更可能漏字

form-data  key

float 可选，默认是 7.0

- `search_mode`

示例一 center

示例二 utt

只在传入 spk 以及 search_spkdb 时生效

center 表示使用说话人聚类的中心作为说话人 embedding 进行搜索

utt 表示得到说话人聚类结果后，对时间段内的音频重新算说话人向量，再对不同时间段内相同说话人的向量取均值，再搜索；

utt 的效果好一点，但是占用更多计算资源

开启 search_spkdb  后，使用数据库来匹配说话人，防止反转；不再使用 spk_center 防止反转；

form-data  key

字符串，可选，默认 center

取值范围：

【center,utt】

postman 调用示例

异步请求
异步请求：client 向 ASR 服务发送
参数名	示例	含义	属性	值类型
/async_recognition

```text
http://{host}:{port}/async_recognition
```

接口

- `audio`

上传的文件，支持 .wav .mp3

【可选，当指定path时该值无效】

form-data  key

文件数据

- `callback`

```text
http://client_ip:client_port/callback
```

回调 url 地址

form-data  key

url  string

- `callback_data`

json string

client端透传信息

form-data  key

json string

- `path`

/path/to/audio.wav

服务器上保存的音频文件【可选】

form-data  key

string

异步请求返回：ASR 服务会在接收完音频后立即返回。会返回 202 HTTP代码，代表请求已经被接受。
异步请求回调：解码完成后 ASR 服务向 client 发送；保持与同步接口一致
参数名	示例	含义	属性	值类型
/callback

```text
http://client_ip:client_port/callback
```

client 开放的回调接口

接口

- `callback_data`

{"file_id": 123, "a": "b"}

json  key

json string

text	你好。这是识别结果示例	ASR 结果

json  key

拼接了所有ASR结果片段

string
- `sentences`

[ {"spk":0,"text":"你好。"},{"spk":0,"text":"这是识别结果示例"}]

每个分段的详细信息	json  key	[{}，{}]
code	0	成功时返回 0	json  key	int
异步请求回调返回：client 收到结果后，向ASR服务返回一个状态信息。

## （三）识别请求响应信息
参数名	类型	含义	备注
key	str	文件名，去除了拓展名	记录 ASR 文本的来源
text	str	ASR 结果	拼接了所有ASR结果片段
sentences	[{}，{}]	每个分片的详细信息	字典数组；按照 asr 内部 vad 切分得到分片，这是每个分片的识别结果
code	int	成功时返回 0

- `spk_center`

[ [ ] ]

说话人嵌入

只在首段返回，只在 model_list 包含 spk 时返回

二维数组，典型形状 2x192

可能返回空的二维数组 [ [ ]] ，返回空时表示没有识别到音频。

后续段落请带上 spk_center

vad分片识别的详细信息 sentences[i]

参数名	类型	含义	备注
spk	int	当前说话人	只在 model_list 包含 spk 时返回；注意，当使用 search_spkdb 时，spk 不从 0 开始编号，值是该说话人在数据库中的 id
spk_detail	string	当前说话人|id 例如

"李达康|463434898488906102"

只在 model_list 包含 search_spkdb 时返回
text	str	本片音频的ASR识别结果

start	int	本片音频的开始时间点

end	int	本片音频的结束时间点

- `predicted_emotion`

str	本片音频的情绪识别结果	只在 model_list 包含 emo 时返回
## （四）说话人注册
说话人注册(同步请求)：【注意，声纹库还没由 milvus 换成 qdrant 这个注册接口暂时不要用了】
参数名	示例	含义	属性	值类型
/register_spk

```text
http://{host}:{port}/register_spk
```

```text
https://zh-offline-16k-asr-antalos-app-server.100credit.cn/register_spk
```

请求接口地址

线上服务需要用 https 访问

接口

- `audio`

上传的文件，支持 .wav .mp3

form-data  key

文件

- `spk_name`

李达康

说话人姓名，这个在数据层面没有限定唯一

form-data  key

字符串，必传

注册请求的响应信息
参数名	类型	含义	备注
key	str	文件名，去除了拓展名	记录 音频来源

spk_embedding_shape

[ ] 长度为2的数组

拼接了所有ASR结果片段

- `embeddingid`

int	该说话人在数据库中的 id	该 id 在整个数据库上是唯一的

- `code`

int	正常为0

注册请求示例
