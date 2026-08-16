export type ProjectsRequestToken = {
  generation: number;
  routeKey: string;
  signal: AbortSignal;
};

export class LatestProjectsRequestGate {
  private generation = 0;
  private controller: AbortController | null = null;

  begin(routeKey: string): ProjectsRequestToken {
    this.controller?.abort();
    this.controller = new AbortController();
    this.generation += 1;
    return {
      generation: this.generation,
      routeKey,
      signal: this.controller.signal,
    };
  }

  isCurrent(token: ProjectsRequestToken, currentRouteKey: string): boolean {
    return (
      !token.signal.aborted &&
      token.generation === this.generation &&
      token.routeKey === currentRouteKey
    );
  }

  abort(): void {
    this.controller?.abort();
    this.controller = null;
    this.generation += 1;
  }
}

export function projectsBootstrapRequestKey(
  projectId?: string,
  piboSessionId?: string,
  includeArchived = false,
): string {
  return JSON.stringify([
    projectId ?? null,
    piboSessionId ?? null,
    includeArchived,
  ]);
}
