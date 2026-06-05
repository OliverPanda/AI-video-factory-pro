import path from 'node:path';

import { createWorkbenchServer } from '../src/workbench/http/router.js';

const workspaceRoot = path.resolve(process.cwd());
const defaultPort = Number(process.env.WORKBENCH_PORT || 4180);
const host = process.env.WORKBENCH_HOST || '127.0.0.1';

const server = createWorkbenchServer({ workspaceRoot });

server.listen(defaultPort, host, () => {
  console.log(
    `Workbench server running at http://${host}:${defaultPort}/api/workbench`
  );
});
