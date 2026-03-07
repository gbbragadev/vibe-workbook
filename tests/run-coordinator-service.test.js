const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { RunCoordinatorService, buildExpectedOutputs } = require('../src/core/run-coordinator-service');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-run-test-'));
}

test('run coordinator creates and reuses active run for the same product stage', () => {
  const dir = makeTempDir();
  const service = new RunCoordinatorService({ runsFile: path.join(dir, 'runs.json') });
  const product = {
    product_id: 'zapcam',
    workspace: { runtime_workspace_id: 'ws-zap' }
  };
  const stage = {
    stage_id: 'brief',
    label: 'Brief',
    goal: 'Define the brief',
    recommended_role: 'product-designer',
    recommended_runtime_agent: 'claude',
    required_artifacts: ['brief']
  };

  const first = service.createOrReuseRun(product, stage, {
    objective: 'Create the product brief',
    role: 'product-designer',
    suggested_runtime_agent: 'claude',
    workspace_id: 'ws-zap',
    expected_outputs: buildExpectedOutputs(stage, {
      brief: { id: 'brief', label: 'Brief' }
    }),
    action_label: 'Start Brief run'
  });
  const second = service.createOrReuseRun(product, stage, {
    objective: 'Refine the product brief',
    action_label: 'Continue Brief run'
  });

  assert.equal(first.run_id, second.run_id);
  assert.equal(service.listRuns('zapcam').length, 1);
  assert.equal(second.objective, 'Refine the product brief');
  assert.ok(second.produced_outputs.some((output) => output.type === 'action' && output.label === 'Continue Brief run'));
});

test('run coordinator attaches session, links handoff and hydrates outputs', () => {
  const dir = makeTempDir();
  const service = new RunCoordinatorService({ runsFile: path.join(dir, 'runs.json') });
  const run = service.createOrReuseRun(
    {
      product_id: 'tool',
      workspace: { runtime_workspace_id: 'ws-tool' }
    },
    {
      stage_id: 'architecture',
      label: 'Architecture',
      goal: 'Define architecture',
      recommended_role: 'principal-architect',
      recommended_runtime_agent: 'codex',
      required_artifacts: ['architecture']
    },
    {
      workspace_id: 'ws-tool',
      expected_outputs: [{
        output_id: 'artifact:architecture',
        type: 'artifact',
        ref_id: 'architecture',
        label: 'Architecture',
        required: true
      }]
    }
  );

  service.attachSession(run.run_id, {
    id: 'sess-1',
    name: 'Architecture session',
    workspaceId: 'ws-tool',
    agent: 'codex'
  });

  service.linkHandoff(run.run_id, {
    handoff_id: 'handoff-1',
    from_stage: 'architecture',
    to_stage: 'implementation'
  });

  const hydrated = service.getHydratedCurrentRun('tool', {
    pipeline: [{ stage_id: 'architecture', label: 'Architecture', goal: 'Define architecture' }],
    sessions: [{
      id: 'sess-1',
      name: 'Architecture session',
      workspaceId: 'ws-tool',
      status: 'running',
      agent: 'codex',
      updatedAt: Date.now()
    }],
    handoffs: [{
      handoff_id: 'handoff-1',
      from_stage: 'architecture',
      to_stage: 'implementation',
      created_at: Date.now()
    }],
    artifacts: [{
      id: 'architecture',
      label: 'Architecture',
      exists: true,
      path: 'ARCHITECTURE.md',
      updatedAt: Date.now()
    }]
  });

  assert.equal(hydrated.status, 'completed');
  assert.equal(hydrated.current_session_id, 'sess-1');
  assert.ok(hydrated.linked_sessions.some((session) => session.id === 'sess-1'));
  assert.ok(hydrated.linked_handoffs.some((handoff) => handoff.handoff_id === 'handoff-1'));
  assert.equal(hydrated.latest_handoff.handoff_id, 'handoff-1');
  assert.equal(hydrated.next_stage_hint, 'implementation');
  assert.equal(hydrated.completion_summary.expected_total, 1);
  assert.equal(hydrated.completion_summary.required_expected_total, 1);
  assert.equal(hydrated.completion_summary.required_produced_total, 1);
  assert.ok(hydrated.completion_summary.produced_total >= 3);
  assert.equal(hydrated.incoming_handoffs.length, 0);
  assert.ok(hydrated.produced_outputs.some((output) => output.type === 'session' && output.ref_id === 'sess-1'));
  assert.ok(hydrated.produced_outputs.some((output) => output.type === 'handoff' && output.ref_id === 'handoff-1'));
  assert.ok(hydrated.produced_outputs.some((output) => output.type === 'artifact' && output.ref_id === 'architecture'));
});

test('run coordinator preserves knowledge driver metadata on runs', () => {
  const dir = makeTempDir();
  const service = new RunCoordinatorService({ runsFile: path.join(dir, 'runs.json') });
  const run = service.createOrReuseRun(
    {
      product_id: 'zapcam',
      workspace: { runtime_workspace_id: 'ws-zap' }
    },
    {
      stage_id: 'brief',
      label: 'Brief',
      goal: 'Define the brief',
      recommended_role: 'product-designer',
      recommended_runtime_agent: 'claude',
      required_artifacts: ['brief']
    },
    {
      objective: 'Create the brief',
      role: 'product-designer',
      suggested_runtime_agent: 'claude',
      workspace_id: 'ws-zap',
      expected_outputs: buildExpectedOutputs({
        stage_id: 'brief',
        required_artifacts: ['brief']
      }, {
        brief: { id: 'brief', label: 'Brief' }
      }),
      knowledge_pack_id: 'pm-skills',
      knowledge_pack_name: 'PM Skills',
      preset_type: 'workflow',
      preset_id: '/discover',
      preset_label: '/discover',
      preset_origin: 'next-action'
    }
  );

  const hydrated = service.getHydratedCurrentRun('zapcam', {
    pipeline: [{ stage_id: 'brief', label: 'Brief', goal: 'Define the brief' }],
    sessions: [],
    handoffs: [],
    artifacts: []
  });

  assert.equal(run.knowledge_pack_id, 'pm-skills');
  assert.equal(run.knowledge_pack_name, 'PM Skills');
  assert.equal(run.preset_type, 'workflow');
  assert.equal(run.preset_id, '/discover');
  assert.equal(run.preset_label, '/discover');
  assert.equal(run.preset_origin, 'next-action');
  assert.ok(hydrated);
  assert.equal(hydrated.knowledge_pack_id, 'pm-skills');
  assert.equal(hydrated.preset_type, 'workflow');
  assert.equal(hydrated.preset_id, '/discover');
});
