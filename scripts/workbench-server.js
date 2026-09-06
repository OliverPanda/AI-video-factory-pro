import 'dotenv/config';
import path from 'node:path';
import portfinder from 'portfinder';

import { createWorkbenchServer } from '../src/app/workbench/server.js';

/**
 * Workbench 服务入口
 * package.json 的 workbench 指向这里：`npm run workbench`
 *
 * 这个入口只负责启动 HTTP 服务；
 * 具体路由、鉴权、run 数据聚合和页面数据模型都在 src/app/workbench/server.js 内部组装。
 */
const workspaceRoot = path.resolve(process.cwd());
const defaultPort = Number(process.env.WORKBENCH_PORT || 4180);
const host = process.env.WORKBENCH_HOST || '127.0.0.1';

portfinder.basePort = defaultPort;
portfinder.getHost = () => host;

const port = await portfinder.getPortPromise();

const server = createWorkbenchServer({ workspaceRoot });

server.listen(port, host, () => {
  console.log(
    `Workbench server running at http://${host}:${port}/api/workbench`
  );
});
