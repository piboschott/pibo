import { Command } from 'commander';
import { createDefaultPiboRalphStore } from './store.js';
import type { PiboRalphTarget } from './types.js';

function printDiscovery(): void { console.log(`pibo ralph

Manage continuous Ralph Pibo agent jobs.

Commands:
  status    Show Ralph status
  list      List Ralph jobs
  add       Create a Ralph job
  edit      Update a Ralph job
  start     Start a Ralph job now
  stop      Stop after the current session finishes
  cancel    Abort the current session and stop
  remove    Delete a Ralph job
  runs      List Ralph runs

Next: pibo ralph add --help`); }
function ownerScope(value: unknown): string { const trimmed = typeof value === 'string' ? value.trim() : ''; if (!trimmed) throw new Error('--owner-scope is required for Ralph operations'); return trimmed; }
function targetFromOptions(options: { room?: string; personal?: boolean; principalId?: string; ownerScope: string }): PiboRalphTarget { if (options.room) return { kind: 'room', roomId: options.room }; if (options.personal || options.principalId) return { kind: 'personal', principalId: options.principalId ?? options.ownerScope }; throw new Error('Choose a target: --room <room-id> or --personal'); }
function maybeTargetFromOptions(options: { room?: string; personal?: boolean; principalId?: string; ownerScope: string }): PiboRalphTarget | undefined { if (options.room || options.personal || options.principalId) return targetFromOptions(options); return undefined; }
function printJson(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
function maxIterations(value: string | undefined): number | undefined { if (value === undefined) return undefined; const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--max-iterations must be a positive integer'); return parsed; }
function storyStopPaths(value: string | undefined): string[] | undefined { if (value === undefined) return undefined; const paths = Array.from(new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))); return paths.length ? paths : undefined; }

export async function runRalphCli(argv = process.argv): Promise<void> {
	const program = new Command();
	program.name('pibo ralph').description('Manage continuous Ralph Pibo jobs').helpOption('-h, --help');
	program.option('--store <path>', 'Ralph store path');
	program.option('--owner-scope <scope>', 'Owner scope for user-owned Ralph jobs', process.env.PIBO_OWNER_SCOPE);
	program.command('status').description('Show Ralph store status').option('--json', 'Print JSON').action((options) => { const store = createDefaultPiboRalphStore({ path: program.opts().store }); const status = store.status(); if (options.json) printJson(status); else { console.log(`jobs\t${status.jobs}`); console.log(`running\t${status.running}`); } store.close(); });
	program.command('list').description('List Ralph jobs').option('--all', 'Include stopped jobs').option('--json', 'Print JSON').action((options) => { const scope = ownerScope(program.opts().ownerScope); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const jobs = store.listJobs({ ownerScope: scope, includeDisabled: options.all }); if (options.json) printJson(jobs); else for (const job of jobs) console.log(`${job.id}\t${job.enabled ? 'running' : 'stopped'}\t${job.state.runningAt ? 'active' : '-'}\t${job.name}`); store.close(); });
	program.command('add').description('Create a Ralph job').requiredOption('--prompt <text>', 'Task prompt').option('--name <name>', 'Job name').option('--description <text>', 'Job description').option('--profile <profile>', 'Agent profile', 'default').option('--room <room-id>', 'Target room id').option('--personal', 'Target personal room').option('--principal-id <id>', 'Personal target principal id').option('--max-iterations <n>', 'Stop after n successful sessions')
		.option('--story-stop-files <paths>', 'Newline-separated JSON story stop file paths')
		.option('--start', 'Start immediately').option('--json', 'Print JSON').action((options) => { const scope = ownerScope(program.opts().ownerScope); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const job = store.createJob({ ownerScope: scope, name: options.name, description: options.description, enabled: options.start === true, target: targetFromOptions({ ...options, ownerScope: scope }), profile: options.profile, prompt: options.prompt, maxIterations: maxIterations(options.maxIterations), storyStopPaths: storyStopPaths(options.storyStopFiles) }); if (options.json) printJson(job); else console.log(`${job.id}\t${job.enabled ? 'running' : 'stopped'}\t${job.name}`); store.close(); });
	program.command('edit').argument('<id>', 'Ralph job id').description('Update a Ralph job').option('--prompt <text>', 'Task prompt').option('--name <name>', 'Job name').option('--description <text>', 'Job description').option('--profile <profile>', 'Agent profile').option('--room <room-id>', 'Target room id').option('--personal', 'Target personal room').option('--principal-id <id>', 'Personal target principal id').option('--max-iterations <n>', 'Stop after n successful sessions').option('--story-stop-files <paths>', 'Newline-separated JSON story stop file paths').option('--json', 'Print JSON').action((id, options) => { const scope = ownerScope(program.opts().ownerScope); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const patch: Record<string, unknown> = {}; if (options.name !== undefined) patch.name = options.name; if (options.description !== undefined) patch.description = options.description; if (options.profile !== undefined) patch.profile = options.profile; if (options.prompt !== undefined) patch.prompt = options.prompt; if (options.maxIterations !== undefined) patch.maxIterations = maxIterations(options.maxIterations); if (options.storyStopFiles !== undefined) patch.storyStopPaths = storyStopPaths(options.storyStopFiles) ?? []; const target = maybeTargetFromOptions({ ...options, ownerScope: scope }); if (target) patch.target = target; if (Object.keys(patch).length === 0) throw new Error('No Ralph job update fields provided'); const job = store.updateJob(scope, id, patch); if (!job) throw new Error('Ralph job not found'); if (options.json) printJson(job); else console.log(`${job.id}\tupdated\t${job.name}`); store.close(); });
	program.command('start').argument('<id>').description('Mark a Ralph job running; the gateway service starts the next session').option('--json', 'Print JSON').action((id, options) => { const scope = ownerScope(program.opts().ownerScope); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const job = store.updateJob(scope, id, { enabled: true }); if (!job) throw new Error('Ralph job not found'); if (options.json) printJson(job); else console.log(`${job.id}\trunning\t${job.name}`); store.close(); });
	program.command('stop').argument('<id>').description('Stop after the current session finishes').option('--json', 'Print JSON').action((id, options) => { const scope = ownerScope(program.opts().ownerScope); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const job = store.requestStop(scope, id); if (!job) throw new Error('Ralph job not found'); if (options.json) printJson(job); else console.log(`${job.id}\tstopping\t${job.name}`); store.close(); });
	program.command('cancel').argument('<id>').description('Abort the current session and stop').option('--json', 'Print JSON').action((id, options) => { const scope = ownerScope(program.opts().ownerScope); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const job = store.requestCancel(scope, id); if (!job) throw new Error('Ralph job not found'); if (options.json) printJson(job); else console.log(`${job.id}\tcancel-requested\t${job.name}`); store.close(); });
	program.command('remove').argument('<id>').description('Delete a Ralph job').option('--json', 'Print JSON').action((id, options) => { const scope = ownerScope(program.opts().ownerScope); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const removed = store.removeJob(scope, id); if (options.json) printJson({ removed }); else console.log(removed ? 'removed' : 'not found'); store.close(); });
	program.command('runs').description('List Ralph runs').option('--job <id>', 'Filter by job').option('--json', 'Print JSON').action((options) => { const scope = ownerScope(program.opts().ownerScope); const store = createDefaultPiboRalphStore({ path: program.opts().store }); const runs = store.listRuns({ ownerScope: scope, jobId: options.job }); if (options.json) printJson(runs); else for (const run of runs) console.log(`${run.id}\t${run.jobId}\t${run.status}\t${run.piboSessionId ?? '-'}\t${run.completedAt ?? '-'}`); store.close(); });
	if (argv.length <= 2 || argv.includes('--help') || argv.includes('-h')) { printDiscovery(); return; }
	await program.parseAsync(argv);
}
