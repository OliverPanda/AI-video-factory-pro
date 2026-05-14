import path from 'node:path';

import { createWorkbenchServer } from '../src/workbench/http/router.js';

const workspaceRoot = path.resolve(process.cwd());
const defaultPort = Number(process.env.WORKBENCH_PORT || 4178);

const server = createWorkbenchServer({ workspaceRoot });

server.listen(defaultPort, () => {
  console.log(
    `Workbench server running at http://127.0.0.1:${defaultPort}/views/ai-video-factory-ui-visual-draft.html`
  );
});
