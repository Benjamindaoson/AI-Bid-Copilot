// Local distribution: task content and credentials are never sent to upstream telemetry.
function createAgentErrorReporter() {
  return { reportFailure: async () => undefined, close: () => undefined };
}
module.exports = { createAgentErrorReporter };
