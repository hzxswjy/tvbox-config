#!/usr/bin/env node
/**
 * TVBox 静态配置构建器
 * 流程：读取 sources/sources.json → 校验字段 → 去重 → （可选）测速探测 → 排序 → 产出 tvbox.json
 *
 * 用法：
 *   node build.mjs                 构建并测速（默认）
 *   node build.mjs --no-probe      只校验去重，不联网（离线/快速模式）
 *   node build.mjs --import <url>  从现有配置地址导入 sources（合并去重）
 *   node build.mjs --timeout 8000  单源探测超时（毫秒）
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC_FILE = path.join(ROOT, 'sources', 'sources.json');
const OUT_FILE = path.join(ROOT, 'tvbox.json');
const DIST_DIR = path.join(ROOT, 'dist');

const argv = process.argv.slice(2);
const getFlag = (n) => argv.includes(n);
const getOpt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const PROBE = !getFlag('--no-probe');
const TIMEOUT = Number(getOpt('--timeout', '7000'));
const IMPORT_URL = getOpt('--import', '');
const CONCURRENCY = 6;

/** 抓取任意 JSON（配置仓库或现有 TVBox 配置） */
async function fetchJson(url, timeout = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 tvbox-config-builder' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** 校验单个站点条目 */
function validateSite(s, idx) {
  const errs = [];
  if (!s || typeof s !== 'object') return ['不是对象'];
  if (!s.name) errs.push('缺少 name');
  if (s.type === undefined) errs.push('缺少 type');
  // type 3 = CMS 采集站，必须有 api；type 0/1 为内置/直链，需要 ext 或 api
  if (Number(s.type) === 3 && !s.api) errs.push('type=3 缺少 api');
  if (!s.key) s.key = `auto_${idx}_${String(s.name || 'x').replace(/\s+/g, '')}`;
  return errs;
}

/** 统一站点字段，补齐 TVBox 需要的默认值 */
function normalizeSite(s) {
  const out = {
    key: String(s.key),
    name: String(s.name),
    type: Number(s.type ?? 3),
    api: s.api ?? '',
    searchable: s.searchable ? 1 : 0,
    quickSearch: s.quickSearch ? 1 : 0,
    filterable: s.filterable ? 1 : 0,
    ext: typeof s.ext === 'string' ? s.ext : s.ext ? JSON.stringify(s.ext) : '',
  };
  if (s.playerType) out.playerType = Number(s.playerType);
  if (s.jar) out.jar = s.jar;
  if (s.spider) out.spider = s.spider;
  return out;
}

/** 探测单个采集站可用性与延迟 */
async function probeSite(site) {
  if (!site.api || !/^https?:/i.test(site.api)) {
    return { ...site, _alive: false, _ms: null, _note: '非 http(s) 接口，跳过探测' };
  }
  const sep = site.api.includes('?') ? '&' : '?';
  const probeUrl = `${site.api}${sep}ac=videolist&wd=${encodeURIComponent('测试')}&pg=1`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT);
  const started = Date.now();
  try {
    const res = await fetch(probeUrl, {
      signal: ac.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 Chrome/90.0 Mobile Safari/537.36',
        Accept: 'application/json,text/plain,*/*',
      },
    });
    const ms = Date.now() - started;
    if (!res.ok) return { ...site, _alive: false, _ms: ms, _note: `HTTP ${res.status}` };
    const text = await res.text();
    let hay = text.slice(0, 4000);
    // 部分采集站返回 JSONP，剥壳后再判断
    if (/^\s*[\w$.]+\s*\(/.test(hay)) {
      const m = hay.match(/\(([\s\S]*)\)\s*;?\s*$/);
      if (m) hay = m[1];
    }
    let ok = false;
    try {
      const j = JSON.parse(hay);
      ok = Array.isArray(j?.list) || j?.code === 1 || j?.code === '1';
    } catch {
      ok = /"list"\s*:/.test(text);
    }
    return { ...site, _alive: ok, _ms: ms, _note: ok ? '正常' : '返回内容非标准采集格式' };
  } catch (e) {
    const ms = Date.now() - started;
    const msg = e.name === 'AbortError' ? '超时' : e.message;
    return { ...site, _alive: false, _ms: ms, _note: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** 并发受限的批量探测 */
async function probeAll(sites) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, sites.length) }, async () => {
    while (cursor < sites.length) {
      const i = cursor++;
      results[i] = await probeSite(sites[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log('▶ TVBox 配置构建器');
  let cfg;
  try {
    cfg = JSON.parse(await fs.readFile(SRC_FILE, 'utf8'));
  } catch (e) {
    console.error(`✗ 无法读取 ${SRC_FILE}: ${e.message}`);
    process.exit(1);
  }

  let rawSites = Array.isArray(cfg.sites) ? cfg.sites : [];
  const lives = Array.isArray(cfg.lives) ? cfg.lives : [];
  const parses = Array.isArray(cfg.parses) ? cfg.parses : [];
  const flags = Array.isArray(cfg.flags) ? cfg.flags : [];

  // 从现有配置导入
  if (IMPORT_URL) {
    console.log(`▶ 导入现有配置: ${IMPORT_URL}`);
    try {
      const ext = await fetchJson(IMPORT_URL);
      const imported = Array.isArray(ext.sites) ? ext.sites : [];
      console.log(`  导入 ${imported.length} 个站点`);
      rawSites = rawSites.concat(imported);
    } catch (e) {
      console.error(`  ✗ 导入失败: ${e.message}（继续使用本地源）`);
    }
  }

  // 校验
  const valid = [];
  const skipped = [];
  rawSites.forEach((s, i) => {
    const errs = validateSite(s, i);
    if (errs.length) skipped.push({ name: s?.name || `#${i}`, errs });
    else valid.push(normalizeSite(s));
  });

  // 去重：同 key、同 api 只保留第一个
  const seenKey = new Set();
  const seenApi = new Set();
  const deduped = [];
  let dupKey = 0;
  let dupApi = 0;
  for (const s of valid) {
    if (seenKey.has(s.key)) {
      dupKey++;
      continue;
    }
    const apiKey = (s.api || '').replace(/\/+$/, '').toLowerCase();
    if (apiKey && seenApi.has(apiKey)) {
      dupApi++;
      continue;
    }
    seenKey.add(s.key);
    if (apiKey) seenApi.add(apiKey);
    deduped.push(s);
  }

  let finalSites = deduped;
  if (PROBE && deduped.length) {
    console.log(`▶ 探测 ${deduped.length} 个源（超时 ${TIMEOUT}ms，并发 ${CONCURRENCY}）…`);
    const probed = await probeAll(deduped);
    finalSites = probed.sort((a, b) => {
      if (a._alive !== b._alive) return a._alive ? -1 : 1;
      return (a._ms ?? 1e9) - (b._ms ?? 1e9);
    });
    const alive = finalSites.filter((s) => s._alive).length;
    console.log(`  可用 ${alive} / ${finalSites.length}`);
  } else if (deduped.length) {
    console.log('▶ 跳过探测（--no-probe）');
  }

  // 产出：去掉内部字段
  const out = {
    sites: finalSites.map(({ _alive, _ms, _note, ...rest }) => rest),
    lives,
    parses,
    flags: flags.length ? flags : ['qq', 'iqiyi', 'youku', 'mgtv', 'bilibili'],
  };

  await fs.mkdir(DIST_DIR, { recursive: true });
  const json = JSON.stringify(out, null, 2);
  await fs.writeFile(OUT_FILE, json, 'utf8');
  await fs.writeFile(path.join(DIST_DIR, 'tvbox.json'), json, 'utf8');

  const stats = {
    builtAt: new Date().toISOString(),
    total: finalSites.length,
    alive: finalSites.filter((s) => s._alive).length,
    duplicates: { byKey: dupKey, byApi: dupApi },
    skipped: skipped.length,
    sources: finalSites.map((s) => ({
      name: s.name,
      ms: s._ms ?? null,
      alive: s._alive ?? null,
      note: s._note ?? '',
    })),
  };
  await fs.writeFile(path.join(DIST_DIR, 'stats.json'), JSON.stringify(stats, null, 2), 'utf8');

  // 终端报告
  console.log('\n序号  状态   延迟      源名称');
  console.log('─'.repeat(56));
  finalSites.forEach((s, i) => {
    const st = s._alive === undefined ? '  ?  ' : s._alive ? ' OK  ' : ' FAIL';
    const ms = s._ms == null ? '   -   ' : `${String(s._ms).padStart(4)}ms `;
    console.log(`${String(i + 1).padStart(3)}  ${st} ${ms}  ${s.name}${s._note ? '  (' + s._note + ')' : ''}`);
  });
  if (skipped.length) {
    console.log(`\n跳过 ${skipped.length} 条不合规：`);
    skipped.forEach((s) => console.log(`  - ${s.name}: ${s.errs.join(', ')}`));
  }
  console.log(`\n✓ 输出: ${OUT_FILE}`);
  console.log(`  去重: key ${dupKey} / api ${dupApi}；直播 ${lives.length} 组；解析 ${parses.length} 条`);
}

main().catch((e) => {
  console.error('✗ 构建失败:', e);
  process.exit(1);
});
