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

## 自动保鲜

`.github/workflows/refresh-sources.yml` 每天北京时间 02:30 自动重跑探测并提交结果：挂掉的源被排到末尾（不删，留给你自己判断），延迟变化会体现在排序里。所以**即使你三个月不管它，配置也不会烂掉**。也可以在 Actions 页面手动 `Run workflow` 立即触发。

## 已知风险与对策

1. **证书链**：GitHub Pages 用 Let's Encrypt，当前链根是 `ISRG Root X1`。Android 4.4 系统信任库**不含**该根（本机实测确认），若 TVBox 未做 trust-all 会报 SSL 错误。
   - 本设备已装 TVBox 含自定义 `SSLContext`/`checkServerTrusted`，多数分支为 trust-all，概率可用；
   - 若电视端报 `SSLHandshakeException` / `certificate`：改用本地 HTTP 方式（电脑或 NAS 起 `python -m http.server`，地址 `http://<内网IP>:8000/tvbox.json`），或换装内置 trust-all 的 TVBox 版本。
2. **国内可达性**：`*.github.io` 在国内**时快时慢**（本机实测首字节 9s，偶发超时）。TVBox 加载有重试，通常能过；若长期打不开，把同一份 `tvbox.json` 放到国内静态托管（OSS/COS 静态网站 + 自定义域名）即可，文件内容不用改。
3. **静态配置没有的能力**：跨源同名合并、多端观看记录同步、源健康度自动停用、服务端代理转发。这些属于 MoonTV 一类服务端方案，见主方案的方案对比结论。
4. **源失效**：采集站变动频繁，定期 `node build.mjs` 重跑，`dist/stats.json` 里 FAIL 的删掉即可。
