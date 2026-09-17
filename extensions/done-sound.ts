/**
 * pi-notify-sound —— 任务完成提示音
 *
 * 监听 `agent_settled`（pi 彻底空闲：无重试、无自动压缩、无排队后续消息），
 * 播放提示音。命令：
 *
 *   /sound              查看状态
 *   /sound on|off       开启 / 关闭
 *   /sound test         试听当前音源
 *   /sound bell         改用终端响铃（BEL）
 *   /sound list         列出内置音源
 *   /sound chime        选用内置音源（chime / ding / success）
 *   /sound <path>       选用本地音频文件（wav / aiff / ogg / mp3，取决于系统播放器）
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** 扩展自带音源所在目录 */
const ASSET_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets");

/** 写入 ~/.pi/agent/done-sound.json；用 getAgentDir() 以兼容改名发行版 */
const CONFIG_PATH = join(getAgentDir(), "done-sound.json");

/** 内置音源：别名 -> assets 下的文件名 */
const BUILTIN_SOUNDS: Record<string, string> = {
  chime: "chime.wav",
  ding: "ding.wav",
  success: "success.wav",
};

/** 两次提示音的最小间隔，避免连发的排队消息导致连续播放 */
const MIN_INTERVAL_MS = 1500;

const BELL = "bell";

function platformDefault(): string {
  switch (platform()) {
    case "win32":
      return "C:/Windows/Media/Windows Notify System Generic.wav";
    case "darwin":
      return "/System/Library/Sounds/Glass.aiff";
    default:
      return "/usr/share/sounds/freedesktop/stereo/complete.oga";
  }
}

interface SoundConfig {
  enabled: boolean;
  /** 绝对路径、"bell"，或内置别名 */
  sound: string;
}

const FALLBACK_CONFIG: SoundConfig = { enabled: true, sound: BELL };

function loadConfig(): SoundConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<SoundConfig>;
    return {
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : FALLBACK_CONFIG.enabled,
      sound: typeof raw.sound === "string" && raw.sound.length > 0 ? raw.sound : FALLBACK_CONFIG.sound,
    };
  } catch {
    return { ...FALLBACK_CONFIG };
  }
}

function saveConfig(cfg: SoundConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
}

/**
 * 把配置里的音源解析为「绝对路径」或 `bell`。
 * 已存在的路径优先；否则尝试内置别名；再否则回退到平台默认；最后 `bell`。
 */
export function resolveSound(sound: string): string {
  if (!sound || sound === BELL) return BELL;

  const expanded = sound.startsWith("~/") ? join(homedir(), sound.slice(2)) : sound;
  if (isAbsolute(expanded) || /^[a-zA-Z]:[\\/]/.test(expanded)) {
    return existsSync(expanded) ? expanded : BELL;
  }

  const builtin = BUILTIN_SOUNDS[sound.toLowerCase()];
  if (builtin) {
    const asset = join(ASSET_DIR, builtin);
    if (existsSync(asset)) return asset;
  }

  const byPlatform = platformDefault();
  return existsSync(byPlatform) ? byPlatform : BELL;
}

function emitBell(): void {
  process.stdout.write("\x07");
}

/**
 * 后台启动播放进程：不等待、不阻塞 TUI，父进程退出后子进程仍会播完。
 * 命令不存在或播放失败时回退到终端响铃。
 */
function spawnQuiet(command: string, args: string[], onError?: () => void): void {
  try {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    child.on("error", () => onError?.());
    child.unref();
  } catch {
    onError?.();
  }
}

function playSound(sound: string): void {
  const target = resolveSound(sound);
  if (target === BELL) {
    emitBell();
    return;
  }

  switch (platform()) {
    case "win32": {
      // Media.SoundPlayer 只能播 WAV；其他格式交给系统默认关联程序
      if (!/\.wav$/i.test(target)) {
        spawnQuiet("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Start-Process '${target.replace(/'/g, "''")}'`], emitBell);
        return;
      }
      const escaped = target.replace(/'/g, "''");
      spawnQuiet(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", `(New-Object Media.SoundPlayer '${escaped}').PlaySync()`],
        emitBell,
      );
      return;
    }
    case "darwin":
      spawnQuiet("afplay", [target], emitBell);
      return;
    default:
      spawnQuiet(
        "sh",
        ["-c", 'paplay "$1" 2>/dev/null || aplay -q "$1" 2>/dev/null || printf "\\a"', "sh", target],
        emitBell,
      );
  }
}

let lastPlayedAt = 0;

export default function (pi: ExtensionAPI) {
  pi.on("agent_settled", async (_event, ctx) => {
    // print / json 模式常用于脚本，默认静音；设 PI_DONE_SOUND_ALWAYS=1 可强制开启
    const forced = process.env.PI_DONE_SOUND_ALWAYS === "1";
    if (!forced && (ctx.mode === "print" || ctx.mode === "json")) return;

    const cfg = loadConfig();
    if (!cfg.enabled || cfg.sound === "off") return;

    const now = Date.now();
    if (now - lastPlayedAt < MIN_INTERVAL_MS) return;
    lastPlayedAt = now;

    playSound(cfg.sound);
  });

  pi.registerCommand("sound", {
    description: "任务完成提示音：/sound [on|off|test|bell|list|<音源>]",
    getArgumentCompletions: (prefix: string) => {
      const items = ["on", "off", "test", "bell", "list", ...Object.keys(BUILTIN_SOUNDS)];
      const unique = [...new Set(items)];
      const matched = unique.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
      return matched.length > 0 ? matched : null;
    },
    handler: async (args, ctx) => {
      const cfg = loadConfig();
      const arg = (args ?? "").trim();

      const status = () => `提示音 ${cfg.enabled ? "开启" : "关闭"}｜音源 ${cfg.sound}（实际播放：${resolveSound(cfg.sound)}）`;

      if (!arg) {
        ctx.ui.notify(status(), "info");
        return;
      }

      if (arg === "on" || arg === "off") {
        cfg.enabled = arg === "on";
        saveConfig(cfg);
        ctx.ui.notify(`任务完成提示音已${cfg.enabled ? "开启" : "关闭"}`, "info");
        return;
      }

      if (arg === "list") {
        ctx.ui.notify(`内置音源：${Object.keys(BUILTIN_SOUNDS).join("、")}；另可用 /sound bell 或绝对路径`, "info");
        return;
      }

      if (arg === "test") {
        playSound(cfg.sound);
        ctx.ui.notify(`试听：${resolveSound(cfg.sound)}`, "info");
        return;
      }

      if (arg === BELL) {
        cfg.sound = BELL;
        cfg.enabled = true;
        saveConfig(cfg);
        playSound(cfg.sound);
        ctx.ui.notify(`已切换为终端响铃（BEL）｜${status()}`, "info");
        return;
      }

      // 内置别名
      if (arg.toLowerCase() in BUILTIN_SOUNDS) {
        cfg.sound = arg.toLowerCase();
        cfg.enabled = true;
        saveConfig(cfg);
        playSound(cfg.sound);
        ctx.ui.notify(`已切换音源｜${status()}`, "info");
        return;
      }

      // 本地文件
      const expanded = arg.startsWith("~/") ? join(homedir(), arg.slice(2)) : arg;
      if (existsSync(expanded)) {
        cfg.sound = resolve(expanded);
        cfg.enabled = true;
        saveConfig(cfg);
        playSound(cfg.sound);
        ctx.ui.notify(`音源已设为 ${cfg.sound}｜${status()}`, "info");
        return;
      }

      ctx.ui.notify(`找不到音源「${arg}」。用法：/sound [on|off|test|bell|list|chime|<绝对路径>]`, "warning");
    },
  });
}
