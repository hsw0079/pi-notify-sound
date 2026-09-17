# pi-notify-sound

给 [pi](https://pi.dev) coding agent 加**任务完成提示音**。任务真正跑完（不是每次底层 run 结束）时响一声，并提供一个 `/sound` 命令来开关、试听、切换音源。

## 为什么用 `agent_settled`

pi 的 `agent_end` 只表示「一次底层 run 结束」，此时 pi 可能还在自动重试、自动压缩上下文，或者继续处理排队的后续消息，用它会在任务没结束时误响。本扩展监听 `agent_settled`，它表示 pi 已经彻底空闲。

## 安装

```bash
pi install npm:pi-notify-sound
```

本地开发 / 不发布时，也可以指向目录：

```bash
pi install /absolute/path/to/pi-notify-sound
# 或临时试用
pi -e /absolute/path/to/pi-notify-sound
```

首次安装后音源为空，提示音会退化为终端响铃（BEL）。建议先选一个音源：

```
/sound chime      # 内置双音提示
/sound ding       # 内置单声清响
/sound success    # 内置上行三音
/sound bell       # 终端响铃
```

Windows 上也可以直接用系统音效：

```
/sound C:/Windows/Media/Windows Notify System Generic.wav
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `/sound` | 查看当前状态与生效的音源 |
| `/sound on` / `/sound off` | 开启 / 关闭提示音 |
| `/sound test` | 试听当前音源 |
| `/sound list` | 列出内置音源 |
| `/sound chime` / `ding` / `success` | 切换内置音源 |
| `/sound bell` | 使用终端响铃（BEL） |
| `/sound <绝对路径>` | 使用本地音频文件 |

`/sound` 支持参数自动补全。

## 配置

配置写在 `~/.pi/agent/done-sound.json`，也可以用 `/sound` 命令修改：

```json
{
  "enabled": true,
  "sound": "chime"
}
```

`sound` 接受三种值：

- 内置别名：`chime`、`ding`、`success`
- 绝对路径：`C:/Windows/Media/chimes.wav`，或 `~/sounds/done.wav`
- `bell`：终端响铃

音源解析优先级：**绝对路径存在 → 内置别名 → 当前系统的默认音效 → `bell`**。所以配置里写了不存在的路径也不会静默失败，而是退回响铃。

## 播放方式

| 平台 | 实现 |
| --- | --- |
| Windows | `powershell.exe` 的 `Media.SoundPlayer`（WAV）；非 WAV 交给系统默认关联程序 |
| macOS | `afplay` |
| Linux | `paplay`，失败退回 `aplay`，再失败退回响铃 |

播放进程在后台启动且不阻塞 TUI，父进程退出后仍会播完；播放器缺失或失败时自动退回终端响铃。

## 行为细节

- **防连响**：两次提示音间隔小于 1.5 秒时跳过，避免排队消息连续触发。
- **脚本模式静音**：`-p`（print）和 JSON 模式下默认不发声，避免污染脚本输出。需要强制开启时设 `PI_DONE_SOUND_ALWAYS=1`。
- **依赖**：零运行依赖，只有 `@earendil-works/pi-coding-agent` 作为 peer dependency。

## 内置音源

`assets/` 下是三个用正弦波合成的短音效（22050 Hz / 16-bit / 单声道 WAV），都很短：

| 文件 | 时长 | 内容 |
| --- | --- | --- |
| `chime.wav` | 0.42s | C6 → E6 |
| `ding.wav` | 0.30s | 1760 Hz 单响 |
| `success.wav` | 0.58s | C6 → E6 → G6 |

想换成自己的音频，用 `/sound <路径>` 即可，无需改代码。

## License

MIT
