# tvbox-config

电视端 TVBox 使用的**静态配置**仓库：零服务器、零费用、零运行时依赖。改完 `sources/sources.json` 跑一条命令，推上去即生效。

适配目标设备：小米电视 3S 48"（Android 4.4.4 / 774MB RAM / 仅 H.264 硬解），TVBox `20260914-1520`。

## 工作原理

```
[你编辑 sources.json] → [node build.mjs 校验/去重/测速] → [tvbox.json 推送到 GitHub Pages]
                                                                    ↓
                                              [电视端 TVBox 读取该 URL → 直连各采集站]
```

TVBox 拿到的是**源清单**，播放时直连采集站，不经过任何中转服务器 —— 所以电脑关机、仓库 404 都不影响已加载的列表。

## 快速开始

```bash
# 1. 编辑源列表
notepad sources/sources.json

# 2. 构建（会探测每个源的可用性与延迟，按延迟排序，挂掉的排最后）
node build.mjs

# 3. 提交发布
git add -A && git commit -m "update sources" && git push
```

构建产物：仓库根目录 `tvbox.json`（Pages 直接对外提供）+ `dist/stats.json`（本次探测报告）。

### 常用参数

| 参数 | 作用 |
|---|---|
| `--no-probe` | 不联网探测，只做校验去重（离线可用，秒出结果） |
| `--timeout 8000` | 单源探测超时，默认 7000ms |
| `--import <url>` | 从现有配置地址导入站点并合并（适合从别的配置迁移） |

> 探测从你的电脑发起，若电脑挂了代理，结果会偏慢失真；电视直连通常更快。所以**测速只用于排序，不用来判断"能不能用"**。

## 源字段速查

```jsonc
{
  "key": "csp_abc",                          // 唯一标识，重复会被去重（先到先留）
  "name": "[A] 某影视",                       // TVBox 显示名，建议加前缀方便排序辨认
  "type": 3,                                 // 3 = Apple CMS 采集站
  "api": "https://域名/api.php/provide/vod/", // 接口地址（注意保留结尾斜杠）
  "searchable": 1,                           // 参与全站搜索
  "quickSearch": 1,                          // 参与首页快搜（源多会拖慢，只给主力源开）
  "filterable": 1,                           // 支持分类筛选
  "ext": ""                                  // 扩展参数，一般留空
}
```

## 部署到 GitHub Pages

首次：

```bash
git init && git add -A && git commit -m "init"
git remote add origin https://github.com/<用户名>/<仓库名>.git
git push -u origin main
```

仓库 Settings → Pages → Source 选 `main` / `(root)` → 保存。约 1 分钟后可访问：

```
https://<用户名>.github.io/<仓库名>/tvbox.json
```

电视端：TVBox → 设置 → 配置地址 → 粘贴上面的 URL（**结尾不要加斜杠**）→ 确定 → 回首页等待加载。

## 部署到 Cloudflare Pages（备份线路，已完成）

GitHub Pages 在国内"时快时慢"，Cloudflare Pages 作为第二公网源。**注意：`tvbox-config` 项目名已被占用，实际分配的域名为 `tvbox-config-5gm.pages.dev`。**

```bash
# 一次性准备部署目录（与仓库根目录内容一致的干净副本）
rm -rf public && mkdir public && cp tvbox.json live.txt README.md public/

# 登录（浏览器 OAuth 授权，一次即可）
npx wrangler login

# 首次创建项目
npx wrangler pages project create tvbox-config --production-branch main

# 部署（更新配置后重新执行本条即可）
npx wrangler pages deploy public --project-name tvbox-config --branch main --commit-dirty=true
```

公网地址：`https://tvbox-config-5gm.pages.dev/tvbox.json`

**与 GitHub Pages 的差异**：GitHub Pages 由每日 CI 自动重建保鲜；Cloudflare Pages 是手动快照，**改完配置需重跑上面的 deploy 命令**。两个源内容以 `sources.json` 为唯一上游。

## 配置字段详解（公网部署要点）

### 1. `sites[].api` —— 采集站接口，**不能是内网地址**

`http://192.168.1.19:8000/dummy.json` 这类地址在公网部署后是**死的**：`192.168.x.x` 是 RFC1918 私有地址，公网设备无从路由，电视以外的人打开配置只会一直转圈/报错。它只在"电视和这台电脑同处一个局域网、且电脑开着服务"时有效。

本项目用**构建期重写**解决，不用手工改两遍：

- `sources/sources.json` 里可以放心写本机地址做占位；
- `node build.mjs` 会把所有内网前缀（`192.168.*` / `10.*` / `172.16-31.*` / `localhost` / `127.0.0.1`）重写为基地址下的同路径文件，产出两份：

| 产物 | 基地址 | 用途 |
|---|---|---|
| `tvbox.json` | `https://hzxswjy.github.io/tvbox-config` | 公网（GitHub Pages / Cloudflare Pages） |
| `dist/tvbox.lan.json` | `http://192.168.1.19:8000`（自动探测本机 IP） | 局域网（`serve-http.mjs` 对电视提供） |

改基地址：`node build.mjs --base https://tvbox-config-5gm.pages.dev`（Cloudflare 部署时用）。

**公网 `api` 的正确形态**（三选一）：

1. **真实采集站**：`https://某站.com/api.php/provide/vod/`（必须公网可达，建议 https，结尾斜杠按站点要求保留）
2. **同仓库托管的静态占位**：`https://hzxswjy.github.io/tvbox-config/dummy.json` —— 本仓库已提供 `dummy.json`（返回空列表的合法 CMS 响应），保证占位站点不报错、不卡 UI
3. **不要**留空、不要指向 `127.0.0.1`、不要指向任何内网段

### 2. `lives[].url` —— 直播源文本，**必须是绝对 URL**

`http://192.168.1.19:8000/live.txt` 同样是内网地址，公网不可达。正确形态：

```
https://hzxswjy.github.io/tvbox-config/live.txt      # GitHub Pages
https://tvbox-config-5gm.pages.dev/live.txt          # Cloudflare Pages
```

要点：
- **必须是绝对地址**（含 `https://` 和完整文件名）。TVBox 不支持相对路径，写成 `live.txt` 会直接拉取失败；
- 指向的是 **M3U/TXT 纯文本**（TVBox 直播格式：`分组名,#genre#` + `频道名,播放地址`），不是 JSON；
- 内容是**直播频道清单**，与 `sites`（点播）互不影响；
- 多组直播就写多条，电视端会显示为一个"直播源"下拉。

### 3. `parses` —— 点播 VIP 解析器（当前为空）

作用：部分采集站的影片直链被平台加密/防盗链，直接播会失败。`parses` 定义"拿到播放页 URL 后，交给谁去解出真实 m3u8/mp4"，电视端播放失败时会弹出解析器列表让你选。

常见字段：

| 字段 | 说明 |
|---|---|
| `name` | 显示名（遥控器上看到的就是它，建议短） |
| `type` | 解析方式：`0` 直链拼接（`url + 视频页URL`）、`1` 解析接口/嗅探（最常见）、`2` JSON 专用解析、`3` 聚合/特殊（`"url":"Web"` 表示走内置 Web 解析）。不同 TVBox 分支对 `2/3` 的解释略有差异 |
| `url` | 解析接口地址，留空则使用内置嗅探 |
| `ext` | 扩展：`flag` 限定只对哪些平台生效、`header` 自定义 UA/Referer、`js` 自定义脚本 |

可扩展写法（把 URL 换成你自己验证过的解析接口）：

```json
"parses": [
  {
    "name": "聚合",
    "type": 3,
    "url": "Web"
  },
  {
    "name": "Json解析",
    "type": 1,
    "url": "https://jx.example.com/json.php?url=",
    "ext": {
      "flag": ["qq", "iqiyi", "youku", "mgtv", "bilibili"],
      "header": {
        "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/110 Mobile Safari/537.36"
      }
    }
  },
  {
    "name": "直链",
    "type": 0,
    "url": "https://jx.example.com/?url="
  },
  {
    "name": "嗅探",
    "type": 1,
    "url": ""
  }
]
```

注意：解析接口失效极其常见（今天能用明天挂），所以**顺序很重要**——把稳定的放前面；本仓库目前保持 `parses: []`，不做无用配置，等你确认可用的解析接口再加。

### 4. `flags` —— 启用哪些内置解析平台

作用：告诉 TVBox"这些平台的链接，允许用内置解析器处理"。它是**平台白名单**，不是解析器定义；没有匹配 `flag` 的链接不会进入解析流程。

当前值 `["qq","iqiyi","youku","mgtv","bilibili"]` 即腾讯视频、爱奇艺、优酷、芒果TV、哔哩哔哩。

常见可加值（按需增删，写多了不影响，写少了对应平台播不了）：

```json
"flags": ["qq", "iqiyi", "youku", "mgtv", "bilibili", "sohu", "letv", "pptv", "wasu", "migu"]
```

与 `parses[].ext.flag` 的区别：`flags` 是**全局**白名单（决定"哪些平台参与解析"），`ext.flag` 是**单个解析器**的适用范围（决定"这个解析器只管哪几个平台"）。两者是交集关系。

## 自动保鲜

`.github/workflows/refresh-sources.yml` 每天北京时间 02:30 自动重跑探测并提交结果：挂掉的源被排到末尾（不删，留给你自己判断），延迟变化会体现在排序里。所以**即使你三个月不管它，配置也不会烂掉**。也可以在 Actions 页面手动 `Run workflow` 立即触发。

## 电视端实测结论（jun fork 20260914）

- **`lives` 必须非空**：该 fork 加载配置时在 `load-config_live` 阶段对直播数组取下标，空数组会抛 `IndexOutOfBoundsException`，表现为"配置解析失败"。这是本次部署中排障最久的问题，与 sites 无关。
- 配置地址可以直接用局域网 HTTP（`http://192.168.1.19:8000/tvbox.json`），不强制 HTTPS。
- `live.txt` 由 iptv-org 的公开中国频道列表（`cn.m3u.raw`，155 频道/26 分组）转换生成；更新直播：重下 m3u 后重跑转换，或直接编辑 `live.txt`。

## 已知风险与对策

1. **证书链**：GitHub Pages 用 Let's Encrypt，当前链根是 `ISRG Root X1`。Android 4.4 系统信任库**不含**该根（本机实测确认，156 个系统证书无一命中），若 TVBox 未做 trust-all 会报 SSL 错误。
   - 本设备已装 TVBox 含自定义 `SSLContext`/`checkServerTrusted`，多数分支为 trust-all，概率可用；
   - **若电视端报 `SSLHandshakeException` / `certificate`，启用 HTTP 回退**：

     ```bash
     node serve-http.mjs        # 默认 8000 端口，纯 HTTP，无 TLS
     ```

     电视端配置地址改为：`http://192.168.1.19:8000/tvbox.json`
     （本机防火墙已放行 8000 入站；此方式要求电脑开机，且电脑 IP 需在路由器静态绑定）
2. **国内可达性**：`*.github.io` 在国内**时快时慢**（本机实测首字节 9s，偶发超时）。TVBox 加载有重试，通常能过；若长期打不开，把同一份 `tvbox.json` 放到国内静态托管（OSS/COS 静态网站 + 自定义域名）即可，文件内容不用改。
3. **静态配置没有的能力**：跨源同名合并、多端观看记录同步、源健康度自动停用、服务端代理转发。这些属于 MoonTV 一类服务端方案，见主方案的方案对比结论。
4. **源失效**：采集站变动频繁，定期 `node build.mjs` 重跑，`dist/stats.json` 里 FAIL 的删掉即可。
