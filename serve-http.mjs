#!/usr/bin/env node
/**
 * 局域网 HTTP 回退服务器
 * 用途：当电视端无法校验 GitHub Pages 的 Let's Encrypt 证书链（Android 4.4 无 ISRG Root X1）时，
 *      用本机把 tvbox.json 以纯 HTTP 提供给电视，绕开 TLS。
 *
 * 用法：node serve-http.mjs [端口]     默认 8000
 * 电视端配置地址填：http://<本机IP>:8000/tvbox.json
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || 8000);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let file = url.pathname === '/' ? '/tvbox.json' : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(ROOT, file);
  if (!full.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const data = await fs.readFile(full);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(data);
    console.log(`${new Date().toLocaleTimeString()}  200  ${req.url}  <- ${req.socket.remoteAddress}`);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    console.log(`${new Date().toLocaleTimeString()}  404  ${req.url}`);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    }
  }
  console.log('▶ TVBox HTTP 回退服务器已启动');
  console.log(`  本机可用的配置地址（任选其一，优先有线网卡的）：`);
  ips.forEach((ip) => console.log(`    http://${ip}:${PORT}/tvbox.json`));
  console.log('  提示：此方式要求这台电脑开机；不用时 Ctrl+C 关闭。');
});
