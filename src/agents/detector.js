import { ClaudeCodeAgent } from './claude-code.js';
import { CursorAgent } from './cursor.js';
import { CodexAgent } from './codex.js';
import { logger } from '../utils/logger.js';

const agents = [
  { name: 'claude-code', class: ClaudeCodeAgent },
  { name: 'cursor-agent', class: CursorAgent },
  { name: 'codex', class: CodexAgent }
];

export async function detectAgents() {
  const detectedAgents = [];

  for (const agentConfig of agents) {
    try {
      const agent = new agentConfig.class();
      const result = await agent.detectInstallation();

      if (result.installed) {
        detectedAgents.push({
          name: agentConfig.name,
          version: result.version,
          path: result.path,
          beta: result.beta || false
        });

        logger.info(`Detected ${agentConfig.name}: ${result.version}`);
      }
    } catch (error) {
      logger.verbose(`Failed to detect ${agentConfig.name}:`, error.message);
    }
  }

  return detectedAgents;
}

export async function testAgent(agentName) {
  const agentConfig = agents.find(a => a.name === agentName);

  if (!agentConfig) {
    throw new Error(`Unknown agent: ${agentName}`);
  }

  const agent = new agentConfig.class();
  const result = await agent.detectInstallation();

  if (result.installed) {
    try {
      const testResult = await agent.executePrompt(
        'echo "Test successful"',
        process.cwd(),
        { timeout: 5000 }
      );

      return {
        ...result,
        testOutput: testResult.text || testResult.raw
      };
    } catch (error) {
      return {
        ...result,
        testError: error.message
      };
    }
  }

  return result;
}

export function createAgent(agentName, config = {}) {
  const agentConfig = agents.find(a => a.name === agentName);

  if (!agentConfig) {
    throw new Error(`Unknown agent: ${agentName}`);
  }

  return new agentConfig.class(config);
}

export function getPreferredAgent(preferredName, detectedAgents) {
  if (preferredName) {
    const preferred = detectedAgents.find(a => a.name === preferredName);
    if (preferred) {
      return preferred.name;
    }
  }

  const priority = ['claude-code', 'cursor-agent', 'codex'];

  for (const name of priority) {
    const agent = detectedAgents.find(a => a.name === name);
    if (agent) {
      return agent.name;
    }
  }

  return detectedAgents.length > 0 ? detectedAgents[0].name : null;
}