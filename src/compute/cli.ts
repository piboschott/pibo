import { Command } from "commander";
import {
	IMAGE_NAME,
	imageExists,
	shouldRebuild,
	dockerBuild,
	saveHash,
	spawnWorker,
	listWorkers,
	releaseWorker,
	reapWorkers,
	getSourceHash,
} from "./docker.js";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const WORKSPACE_DIR = process.env.PIBO_COMPUTE_WORKSPACE || "/root/code/pibo";
const HASH_FILE = path.join(os.homedir(), ".pibo", "compute-image-hash");

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

export async function runComputeCli(argv: string[]): Promise<void> {
	const program = new Command();
	program.name("pibo compute").description("Manage Pibo Docker compute workers").helpOption(false);

	program
		.command("spawn")
		.description("Spawn a new Pibo worker container")
		.option("--name <name>", "Custom container name")
		.option("--owner <owner>", "Owner tag for the container")
		.action(async (options: { name?: string; owner?: string }) => {
			await mkdir(path.dirname(HASH_FILE), { recursive: true });

			const needsBuild = !(await imageExists(IMAGE_NAME)) || (await shouldRebuild(WORKSPACE_DIR, HASH_FILE));
			if (needsBuild) {
				console.error(`Building ${IMAGE_NAME} from ${WORKSPACE_DIR}...`);
				await dockerBuild(WORKSPACE_DIR);
				await saveHash(WORKSPACE_DIR, HASH_FILE);
				console.error("Build complete.");
			}

			const worker = await spawnWorker({
				workspaceDir: WORKSPACE_DIR,
				name: options.name,
				owner: options.owner,
			});

			printJson(worker);
		});

	program
		.command("rebuild")
		.description("Force rebuild the pibo:latest image")
		.action(async () => {
			console.error(`Rebuilding ${IMAGE_NAME} from ${WORKSPACE_DIR}...`);
			await dockerBuild(WORKSPACE_DIR);
			await saveHash(WORKSPACE_DIR, HASH_FILE);
			console.error("Build complete.");
		});

	program
		.command("list")
		.description("List running Pibo worker containers")
		.action(async () => {
			const workers = await listWorkers();
			if (workers.length === 0) {
				console.log("No worker containers running.");
				return;
			}
			console.log("NAME\t\tSTATUS\t\tPORTS\t\tCREATED");
			for (const w of workers) {
				console.log(`${w.name}\t${w.status}\t${w.ports}\t${w.createdAt}`);
			}
		});

	program
		.command("release")
		.description("Stop and remove a worker container")
		.argument("<id>", "Container name or ID")
		.action(async (id: string) => {
			await releaseWorker(id);
			console.log(`Released ${id}`);
		});

	program
		.command("reap")
		.description("Remove worker containers older than N minutes")
		.option("--max-age-minutes <n>", "Maximum age in minutes", "60")
		.action(async (options: { maxAgeMinutes: string }) => {
			const maxAge = Number(options.maxAgeMinutes);
			const removed = await reapWorkers(maxAge);
			if (removed.length === 0) {
				console.log("No old workers to reap.");
			} else {
				console.log(`Reaped ${removed.length} worker(s): ${removed.join(", ")}`);
			}
		});

	await program.parseAsync(argv);
}
