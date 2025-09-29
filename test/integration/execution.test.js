import { jest } from '@jest/globals';
import { ExecutionPlanner } from '../../src/execution/planner.js';
import { ExecutionOrchestrator } from '../../src/execution/executor.js';
import { SessionManager } from '../../src/security/session.js';

describe('Execution Flow Integration Tests', () => {
  let planner;
  let orchestrator;
  let sessionManager;
  let mockConfig;

  beforeEach(() => {
    mockConfig = {
      security: {
        sessionTimeout: 3600000,
        maxCommandsPerMinute: 100
      },
      agents: {
        timeout: 300000,
        retryAttempts: 3
      },
      git: {
        createBackupBranch: true,
        requireCleanWorkingTree: false
      }
    };

    sessionManager = new SessionManager(mockConfig);
    planner = new ExecutionPlanner(sessionManager, mockConfig);
    orchestrator = new ExecutionOrchestrator(sessionManager, mockConfig);
    orchestrator.planner = planner;
  });

  describe('Plan-Execute Flow Enforcement', () => {
    test('should require plan mode before execution', async () => {
      const mockSession = {
        id: 'test-session',
        appName: 'test-app',
        appUrl: 'http://localhost:3000',
        clientPublicKey: 'mock-key'
      };

      // Try to execute without a plan
      await expect(
        orchestrator.executePlan('nonexistent-plan', mockSession.id)
      ).rejects.toThrow('Plan not found');
    });

    test('should require plan approval before execution', async () => {
      // Mock agent that always succeeds in plan mode
      const mockAgent = {
        executeInPlanMode: jest.fn().mockResolvedValue({
          success: true,
          plan: 'Mock plan: do something',
          modifiedFiles: ['test.js']
        }),
        cleanup: jest.fn()
      };

      // Mock agent creation
      jest.doMock('../../src/agents/detector.js', () => ({
        createAgent: jest.fn().mockReturnValue(mockAgent)
      }));

      const plan = await planner.createPlan(
        'test prompt',
        '/tmp',
        'claude-code',
        { sessionId: 'test-session' }
      );

      expect(plan.approved).toBe(false);

      // Try to execute unapproved plan
      await expect(
        orchestrator.executePlan(plan.id, 'test-session')
      ).rejects.toThrow('Plan not approved');

      // Approve plan
      const approvedPlan = planner.approvePlan(plan.id);
      expect(approvedPlan.approved).toBe(true);
    });

    test('should enforce session ownership of plans', async () => {
      const mockAgent = {
        executeInPlanMode: jest.fn().mockResolvedValue({
          success: true,
          plan: 'Mock plan',
          modifiedFiles: []
        })
      };

      jest.doMock('../../src/agents/detector.js', () => ({
        createAgent: jest.fn().mockReturnValue(mockAgent)
      }));

      const plan = await planner.createPlan(
        'test prompt',
        '/tmp',
        'claude-code',
        { sessionId: 'session-1' }
      );

      planner.approvePlan(plan.id);

      // Try to execute with different session
      await expect(
        orchestrator.executePlan(plan.id, 'session-2')
      ).rejects.toThrow('Plan does not belong to this session');
    });
  });

  describe('Execution Queueing', () => {
    test('should queue executions per session', async () => {
      const mockAgent = {
        executeInPlanMode: jest.fn().mockResolvedValue({
          success: true,
          plan: 'Mock plan',
          modifiedFiles: []
        }),
        executePrompt: jest.fn().mockImplementation(() =>
          new Promise(resolve => setTimeout(() => resolve({ text: 'done' }), 100))
        ),
        cleanup: jest.fn()
      };

      jest.doMock('../../src/agents/detector.js', () => ({
        createAgent: jest.fn().mockReturnValue(mockAgent)
      }));

      // Create and approve two plans
      const plan1 = await planner.createPlan('prompt 1', '/tmp', 'claude-code');
      const plan2 = await planner.createPlan('prompt 2', '/tmp', 'claude-code');

      planner.approvePlan(plan1.id);
      planner.approvePlan(plan2.id);

      // Start both executions simultaneously
      const exec1Promise = orchestrator.executePlan(plan1.id, 'test-session');
      const exec2Promise = orchestrator.executePlan(plan2.id, 'test-session');

      const [exec1, exec2] = await Promise.all([exec1Promise, exec2Promise]);

      // Both should complete successfully but in sequence
      expect(exec1.status).toBe('completed');
      expect(exec2.status).toBe('completed');
    });
  });
});