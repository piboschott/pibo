---
title: Pibo Projects Area
version: 0.4
date_created: 2026-05-05
last_updated: 2026-05-07
owner: Pibo
status: draft
tags: [product, web-chat, projects, sessions, workflow, state-machine, docker, worktree]
---

# Introduction

This specification captures the proposed **Projects** area for the Pibo Chat Web App.

Projects are a coding-project-focused sibling concept to the existing `Sessions` area. The current `Sessions` area remains unchanged for now and can later evolve into a more general chat experience. The new `Projects` area reuses the proven room/session interaction model, but narrows the product language and workflow around coding projects, typed project sessions, specs, plans, agent implementation work, research work, human acceptance, Docker workers, worktrees, and cleanup.

## 1. Purpose & Scope

The purpose of the Projects area is to make agent-driven project work easier to manage. V1 focuses on standard coding sessions that move from feature/change idea to spec, plan, implementation, agent testing, human review, and cleanup.

In scope for the initial Projects concept:

- A new top-level `Projects` tab in the Chat Web App header/top bar.
- A project list and project detail experience structurally similar to the existing room/session UI.
- Project containers that replace the user-facing label `Rooms` with `Projects`.
- No personal/default chat project in the Projects area.
- Every Project must be linked to a concrete project folder/workspace path.
- Each Project can contain many Pibo Sessions.
- Project Sessions have explicit session types.
- V1 implements the standard coding session type only.
- A standard Main Project Session usually represents one feature, change, bugfix, or similar coding work item.
- Every Project Session automatically receives its own isolated worktree and Docker compute worker when it is created.
- Main Project Sessions have an extensible workflow state machine.
- The state machine must be selected by session type so future session types can define their own states and logic.
- Sub-Sessions are created by subagent calls from a Main Session and are not directly bound to the Main Session state machine.
- A required standard-session flow from specs to plan, from plan to implementation, from implementation to agent testing, and then to human review and cleanup.
- Agent-side implementation/test loops with bounded retries for standard sessions.
- Human review actions such as approve, send back with reason, or discard.
- Cleanup-oriented actions that help decide what to keep, push, merge, or discard after agent work.

Out of scope for V1:

- Removing or changing the existing `Sessions` area.
- Implementing non-standard Project Session types such as Research Sessions.
- Full Git hosting integration design.
- Full CI/CD pipeline orchestration.
- Multi-user/team permissions beyond the existing owner-scope model.
- Complete knowledge/document management design, except as a future extension direction.

## 2. Definitions

- **Projects Area**: The top-level Chat Web App area reached through the `Projects` tab.
- **Pibo Project**: A user-facing coding-work container that groups Pibo Sessions and is always linked to one project folder.
- **Project Folder**: The local workspace/root path associated with a Pibo Project. It is the source project folder from which isolated session worktrees are created.
- **Project Session**: A Pibo Session associated with a Pibo Project.
- **Project Session Type**: The workflow family of a Project Session, such as `standard` or a future `research` type. Session type selects the state machine, state classes, available actions, and default prompts for a Main Session.
- **Standard Session**: The V1 Project Session type. It represents one feature, change, bugfix, or similar coding work item and follows the specs/plan/implementation/test/review/cleanup flow.
- **Research Session**: A future Project Session type focused on gathering information, analysis, comparison, investigation, and recommendations. It may have its own states and logic and is not implemented in V1.
- **Main Project Session**: A top-level Project Session. For the V1 `standard` type, it usually represents one feature, change, bugfix, or similar work item. It owns the workflow state machine state for its session type.
- **Sub-Session**: A child Pibo Session created when the agent in a Main Project Session calls a subagent. A Sub-Session follows the task assigned by the Main Session's agent, not the project workflow state machine directly.
- **Project Session Workspace**: The isolated worktree and Docker compute worker assigned to one Project Session.
- **Session State**: The current workflow phase of a Main Project Session, interpreted according to the session type.
- **Session State Class**: A code-level state implementation that owns the behavior, available actions, validation, prompts, and side effects for one state.
- **Project State Machine**: The orchestration layer that owns allowed transitions between Session States for Main Project Sessions but does not embed state-specific behavior.
- **Spec Phase**: The standard-session phase where the desired feature/change is converted into durable specs.
- **Plan Phase**: The standard-session phase where an executable implementation plan is derived from the accepted specs.
- **Implementation Phase**: The standard-session phase where agents perform the coding work in the isolated Docker worker/worktree of the Main Session and may create Sub-Sessions for delegated work.
- **Agent Test Phase**: The standard-session automated/self-test phase run by the agent before work is handed to the user.
- **Human Review Phase**: The standard-session phase where the agent has already tested its own work and the human user reviews, tests, accepts, rejects, or asks for changes.
- **Cleanup Phase**: The standard-session phase where Pibo helps the user decide what to keep, discard, push, merge, or otherwise finalize.

## 3. Product Model

### 3.1 Projects vs Sessions

The existing `Sessions` area remains the general conversation/session surface.

The new `Projects` area is optimized for coding and project work:

- The left-side grouping concept is called `Projects`, not `Rooms`.
- A Project must have a project folder.
- A Project can contain multiple typed Project Sessions over time.
- Each Main Project Session has a session type.
- V1 supports only `standard` Main Sessions.
- A standard Main Project Session normally represents one feature/change/bugfix and moves through the full standard workflow.
- A standard Main Project Session is not only a specs session or only a planning session. It starts in specs/planning and then continues through implementation, testing, review, and cleanup.
- Future Main Session types may have different workflows. For example, a Research Session may focus on information gathering and analysis instead of code implementation.
- Sub-Sessions appear below the Main Session when subagents are called.
- A Project may later collect knowledge, documentation, project files, acceptance notes, and operational history.

### 3.2 Relationship to Pibo Rooms

Implementation may initially reuse the existing Pibo Room/session infrastructure, but the product concept should remain separate:

- A Pibo Room is a general Chat Web container.
- A Pibo Project is a coding-focused product container.
- If Projects are backed by rooms in the first implementation, that should be treated as a storage bridge, not as the permanent product language.
- UI labels in the Projects area must consistently say `Project`/`Projects`, not `Room`/`Rooms`.

### 3.3 Project Folder Requirement

Every Project must be linked to one project folder before it can be used for agent coding work.

The folder link should provide:

- Display name/path in the Project header.
- Source workspace context for new Project Sessions.
- A stable basis for creating session worktrees and for cleanup checks such as Git status, worktree state, branch, changed files, and test commands.

### 3.4 Project Session Types

Project Sessions must be typed to keep the system extensible.

V1 implements only the `standard` session type:

- It is the default type when a new Project Session is created.
- It represents coding work such as a feature, change, bugfix, refactor, cleanup, or similar implementation task.
- It uses the standard specs/plan/implementation/agent-test/human-review/cleanup flow.

Future session types should be possible without changing the core Project model:

- A `research` session type could gather information, inspect code, compare options, analyze logs, summarize tradeoffs, or produce recommendations.
- A research workflow might use states such as `question`, `research`, `analysis`, `summary`, and `completed`.
- Other future types may support documentation, design, incident analysis, release preparation, migration planning, or dependency upgrade workflows.

Each session type should be able to define:

- Its own state names.
- Its own state classes and behavior.
- Its own allowed transitions.
- Its own default prompts and acceptance criteria.
- Its own UI actions.
- Its own completion and failure semantics.

### 3.5 Project Session Isolation

Every Project Session, including Main Sessions and Sub-Sessions, must automatically create and use an isolated execution workspace when created:

- A new worktree is created for the session.
- A Docker compute worker is spawned for the session.
- The agent for that session works only inside that session's worktree and Docker worker.
- Browser checks, builds, tests, gateway restarts, and implementation commands run inside the worker context.
- The host checkout must not be used as the experimental workspace.
- The Project Session should persist the worker id, worktree path, branch name, web port, CDP port, and lifecycle status when available.

This keeps each standard feature attempt, future research/investigation task, and delegated subagent task reviewable, disposable, and safe to clean up.

### 3.6 Main Sessions and Sub-Sessions

Projects must clearly distinguish Main Sessions from Sub-Sessions:

- Main Sessions are top-level typed sessions inside a Project.
- Main Sessions own the state-machine state and follow the workflow for their session type.
- Sub-Sessions are created by the Main Session's agent when it invokes subagents.
- Sub-Sessions are children of the Main Session through normal Pibo Session hierarchy.
- Sub-Sessions are not independently driven through the Main Session's project workflow states.
- A Sub-Session's scope is the task delegated by the Main Session's agent.
- The Main Session remains responsible for integrating subagent results into its workflow state.

## 4. Standard Main Session Workflow

### 4.1 Required Flow

V1 implements the `standard` Main Project Session workflow. A standard Main Project Session should normally start in the specs/planning part of the workflow and then move through the complete feature/change/bugfix lifecycle:

```text
specs -> plan -> implementation -> agent_test
                            ^              |
                            |              v
                    needs_changes <- agent_test_failed
                                           |
                                           v
                                     human_review
                                           |
            +------------------------------+------------------------------+
            v                              v                              v
        cleanup                    implementation                    discarded
            |
            v
        completed
```

The important product rules are:

- A standard Main Session usually represents one feature, change, bugfix, refactor, cleanup, or similar coding work item.
- The Main Session is the unit that moves through workflow states.
- The desired change should first become a spec update.
- The implementation plan is derived from the specs.
- Execution follows the plan.
- The agent tests its own work before handing it to the user.
- The user reviews only after the agent believes the work is ready.
- Sub-Sessions can be created during implementation or other phases, but they do not own the Main Session state.

### 4.2 States

Required `standard` Main Session states:

- `specs`: The desired feature/change/bugfix is converted into durable specs. Standard Main Sessions normally start here.
- `plan`: The agent derives an execution plan from the specs.
- `implementation`: The agent executes the plan in the session worktree/Docker worker and may delegate work to Sub-Sessions.
- `agent_test`: The agent runs its own tests and checks.
- `needs_changes`: The work needs another implementation iteration after failed tests or explicit feedback.
- `human_review`: The work is ready for the user to test and accept or reject.
- `cleanup`: The user approved the direction and Pibo helps finalize the working tree.
- `completed`: The Main Session's feature/change/bugfix is finalized.
- `failed`: The agent reached the retry limit or determines it cannot complete the work.
- `discarded`: The Main Session's feature/change/bugfix is intentionally abandoned.

Optional future or UI-only pre-state:

- `discussion`: The user and agent clarify a desired change before a formal Project Session is started. If represented as a state, it must transition into `specs` before implementation can begin.

### 4.3 Retry Loop

The implementation/test loop must support bounded retries on the standard Main Session:

```text
implementation -> agent_test -> needs_changes -> implementation
```

- The Main Session should track `retryCount` and `maxRetries`.
- `agent_test` may transition to `human_review` when checks pass.
- `agent_test` may transition to `needs_changes` when checks fail and retries remain.
- `agent_test` may transition to `failed` when retries are exhausted.
- The agent may also mark the Main Session as `failed` when it determines the requested work cannot be completed safely or correctly.
- Each failed test iteration should produce a durable reason and summary.

### 4.4 Human Review Actions

In the `human_review` state, the user must have clear decision actions:

- **Approve / Release**: Move the Main Session to `cleanup`.
- **Send back**: Move the Main Session back to `needs_changes` or `implementation` with a required reason.
- **Discard**: Move the Main Session to `discarded`, preferably with an optional reason.

The send-back reason must become durable context so the next agent iteration can see what was rejected or missing.

### 4.5 Cleanup Actions

In the `cleanup` state, Pibo should help answer:

- What changed in the Main Session worktree and relevant Sub-Session worktrees?
- Which files should be kept?
- Which files should be reverted or deleted?
- Are tests still passing?
- Should this be committed, pushed, merged to `main`, or left as a branch/worktree?
- Should session Docker workers be released?

Initial UI actions may be lightweight wrappers around inspectable operations:

- Show Git status.
- Show changed files.
- Show diffs.
- Run configured test command.
- Mark files/changes as keep or discard.
- Create a cleanup summary.
- Release Docker compute workers after confirmation.
- Mark cleanup as completed.

Potential later actions:

- Create commit.
- Push branch.
- Open pull request.
- Merge to main.
- Delete or archive worktrees.

## 5. State Machine Architecture

The state system should be extensible across session types. The state machine defines flow; state classes define behavior.

### 5.1 Design Principle

- The **Project State Machine** owns allowed transitions and transition history for Main Sessions.
- State-machine definitions are scoped by Project Session Type.
- Each **Session State Class** owns the functionality of that state.
- Adding a new session type should not require rewriting the standard session workflow.
- Adding a new state to one session type should not require rewriting one large state-machine function.
- UI actions should be derived from the active state class where possible.
- State-specific prompts, validation, side effects, and completion criteria should live with the state class.
- Sub-Sessions do not execute the Main Session state machine directly. They receive their behavior from the delegated subagent task and report results back through the normal session/subagent trace.

### 5.2 Draft Interfaces

```ts
export type PiboProjectSessionType = "standard" | string;

export type PiboStandardProjectSessionStateName =
  | "specs"
  | "plan"
  | "implementation"
  | "agent_test"
  | "needs_changes"
  | "human_review"
  | "cleanup"
  | "completed"
  | "failed"
  | "discarded";

export type PiboProjectSessionKind = "main" | "sub";

export type PiboProjectTransition = {
  piboSessionId: string;
  sessionType: PiboProjectSessionType;
  from: string;
  to: string;
  action: string;
  reason?: string;
};

export type PiboProjectAction = {
  id: string;
  label: string;
  kind: "user" | "agent" | "system";
  requiresReason?: boolean;
  destructive?: boolean;
};

export interface PiboProjectSessionStateHandler {
  readonly sessionType: PiboProjectSessionType;
  readonly name: string;

  getAvailableActions(context: PiboProjectSessionStateContext): PiboProjectAction[];

  canEnter?(context: PiboProjectSessionStateContext): Promise<boolean> | boolean;
  onEnter?(context: PiboProjectSessionStateContext): Promise<void> | void;
  onExit?(context: PiboProjectSessionStateContext): Promise<void> | void;

  handleAction(
    actionId: string,
    context: PiboProjectSessionStateContext,
    input?: Record<string, unknown>,
  ): Promise<PiboProjectTransition | void> | PiboProjectTransition | void;
}

export interface PiboProjectStateMachineDefinition {
  readonly sessionType: PiboProjectSessionType;
  canTransition(from: string, to: string): boolean;
  transition(transition: PiboProjectTransition): Promise<void>;
}

export interface PiboProjectSessionTypeDefinition {
  readonly type: PiboProjectSessionType;
  readonly label: string;
  readonly defaultInitialState: string;
  readonly stateMachine: PiboProjectStateMachineDefinition;
  getStateHandler(stateName: string): PiboProjectSessionStateHandler | undefined;
}
```

The exact interface can change during implementation, but the separation should remain: session-type definitions select the state machine and handlers; state handlers own behavior; the state machine owns flow and transition persistence for Main Sessions.

## 6. UI Requirements

- **REQ-001**: The Chat Web App top bar MUST include a new `Projects` tab.
- **REQ-002**: The existing `Sessions` tab and behavior MUST remain unchanged for the initial Projects work.
- **REQ-003**: The Projects area MUST not create or show a personal/default chat project.
- **REQ-004**: Creating a Project MUST require selecting or entering a project folder.
- **REQ-005**: The Projects sidebar SHOULD resemble the Sessions room/session layout but use Project language.
- **REQ-006**: Project Sessions MUST be listed under the selected Project.
- **REQ-007**: Project Sessions MUST have a visible session type where it is useful for understanding workflow.
- **REQ-008**: V1 MUST support creating `standard` Project Sessions.
- **REQ-009**: V1 MAY show future session types as unavailable or omit them entirely.
- **REQ-010**: The UI MUST visually distinguish Main Sessions from Sub-Sessions.
- **REQ-011**: A selected Main Session MUST show its workflow state prominently.
- **REQ-012**: A selected Sub-Session MUST show its delegated task context and parent Main Session, but MUST NOT expose independent project state transitions.
- **REQ-013**: New sessions created inside a Project MUST automatically create a worktree and Docker compute worker.
- **REQ-014**: New Main Sessions created inside a Project MUST inherit the Project's folder/workspace context but MUST execute only in the session worktree.
- **REQ-015**: Sub-Sessions MUST also execute only in their own session workspace unless a later design explicitly chooses shared workspaces.
- **REQ-016**: The UI SHOULD show the active worktree path, worker status, and relevant worker ports when available.
- **REQ-017**: The Specs phase MUST make spec changes visible and durable for standard sessions.
- **REQ-018**: The Plan phase MUST show the plan derived from the specs before execution for standard sessions.
- **REQ-019**: The Agent Test phase MUST show test attempts, failures, retry count, and max retries for standard Main Sessions.
- **REQ-020**: The Human Review phase MUST expose approve, send-back-with-reason, and discard actions for standard Main Sessions.
- **REQ-021**: The Cleanup phase SHOULD expose project-folder/worktree inspection and cleanup helper actions.
- **REQ-022**: Main Session state transitions MUST be visible in the Project timeline or activity history.

## 7. Data Contract Draft

```ts
export type PiboProjectSessionType = "standard" | string;

export type PiboStandardProjectSessionStateName =
  | "specs"
  | "plan"
  | "implementation"
  | "agent_test"
  | "needs_changes"
  | "human_review"
  | "cleanup"
  | "completed"
  | "failed"
  | "discarded";

export type PiboProject = {
  id: string;
  ownerScope: string;
  name: string;
  description?: string;
  projectFolder: string;
  currentMainSessionId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type PiboProjectSession = {
  projectId: string;
  piboSessionId: string;
  kind: "main" | "sub";
  type: PiboProjectSessionType;
  parentMainSessionId?: string;
  title?: string;
  state?: string;
  retryCount?: number;
  maxRetries?: number;
  createdAt: string;
  updatedAt: string;
};

export type PiboProjectSessionWorkspace = {
  projectId: string;
  piboSessionId: string;
  sourceProjectFolder: string;
  worktreePath: string;
  branchName?: string;
  dockerWorkerId?: string;
  webPort?: number;
  cdpPort?: number;
  status: "creating" | "ready" | "running" | "released" | "failed";
  createdAt: string;
  updatedAt: string;
};

export type PiboProjectEvent = {
  id: string;
  projectId: string;
  piboSessionId?: string;
  actorId?: string;
  type:
    | "project.created"
    | "project.updated"
    | "project.session_created"
    | "project.session_state_changed"
    | "project.spec_updated"
    | "project.plan_created"
    | "project.agent_test_started"
    | "project.agent_test_failed"
    | "project.agent_test_passed"
    | "project.review_sent_back"
    | "project.review_approved"
    | "project.session_failed"
    | "project.session_discarded"
    | "project.cleanup_summary_created"
    | "project.workspace_created"
    | "project.workspace_released";
  payload: Record<string, unknown>;
  createdAt: string;
};
```

Project Sessions may initially be associated through `PiboSession.metadata.projectId`, `PiboSession.metadata.projectSessionKind`, `PiboSession.metadata.projectSessionType`, and normal `parentId` hierarchy, but long-term implementations may introduce first-class relation tables if needed.

## 8. Future Extensions

Projects are intended to become more than session groups. Future versions may add:

- Research Sessions for information gathering, codebase analysis, tradeoff analysis, and recommendations.
- Project knowledge and documentation.
- Project-scoped context files.
- Acceptance criteria tracking.
- Agent-generated implementation plans.
- Test plans and manual test checklists.
- Git branch/worktree lifecycle management.
- Docker worker lifecycle tracking.
- Project-level summaries across many sessions.
- Reusable cleanup playbooks.
- GitHub/GitLab pull request integration.
- CI result integration.

## 9. Open Questions

- Should a Project represent one long-lived repository, while each standard Main Session represents one feature/change/bugfix?
- Should a standard Main Session always start in `specs`, or can some sessions import existing specs and start in `plan`?
- What should the first post-V1 Project Session type be: `research`, documentation, incident analysis, or something else?
- Should Sub-Sessions inherit the Main Session type, use their own type, or remain untyped delegated work?
- Should Sub-Sessions always receive separate worktrees/workers, or should some delegated tasks share the Main Session workspace?
- Should project folders be limited to local paths, or can they later represent remote repositories?
- Which cleanup operations should be UI-only confirmations vs direct executable actions?
- How much Git automation is safe before explicit user confirmation is required?
- What should the default `maxRetries` be for the agent implementation/test loop?
