export class RunJobStore {
  createRunJob(_input, _options = {}) {
    throw new Error('RunJobStore.createRunJob() not implemented');
  }

  appendAgentTaskRun(_runJobRef, _taskRunInput, _options = {}) {
    throw new Error('RunJobStore.appendAgentTaskRun() not implemented');
  }

  finishRunJob(_runJobRef, _finishInput = {}, _options = {}) {
    throw new Error('RunJobStore.finishRunJob() not implemented');
  }
}

export default RunJobStore;
