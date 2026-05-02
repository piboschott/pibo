import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface DesktopEnv {
  display?: string;
  waylandDisplay?: string;
  xauthority?: string;
  xdgRuntimeDir?: string;
  dbusSessionBusAddress?: string;
}

export function hasDesktopDisplay(desktop: DesktopEnv): boolean {
  return Boolean(desktop.display || desktop.waylandDisplay);
}

function getRuntimeDir(): string | undefined {
  if (process.env.XDG_RUNTIME_DIR) return process.env.XDG_RUNTIME_DIR;
  if (typeof process.getuid !== 'function') return undefined;
  return `/run/user/${process.getuid()}`;
}

function findXDisplay(): string | undefined {
  if (process.env.DISPLAY) return process.env.DISPLAY;
  if (!existsSync('/tmp/.X11-unix/X0')) return undefined;
  return ':0';
}

function findWaylandDisplay(runtimeDir: string | undefined): string | undefined {
  if (process.env.WAYLAND_DISPLAY) return process.env.WAYLAND_DISPLAY;
  if (!runtimeDir) return undefined;
  if (existsSync(join(runtimeDir, 'wayland-0'))) return 'wayland-0';
  return undefined;
}

function findXauthority(runtimeDir: string | undefined): string | undefined {
  if (process.env.XAUTHORITY) return process.env.XAUTHORITY;
  if (!runtimeDir || !existsSync(runtimeDir)) return undefined;

  let authFile: string | undefined;
  try {
    authFile = readdirSync(runtimeDir).find((name) => name.startsWith('.mutter-Xwaylandauth.'));
  } catch {
    return undefined;
  }
  return authFile ? join(runtimeDir, authFile) : undefined;
}

export function detectDesktopEnv(): DesktopEnv {
  if (process.platform !== 'linux') return {};

  const xdgRuntimeDir = getRuntimeDir();
  const display = findXDisplay();
  const waylandDisplay = findWaylandDisplay(xdgRuntimeDir);
  const xauthority = findXauthority(xdgRuntimeDir);
  const dbusPath = xdgRuntimeDir ? join(xdgRuntimeDir, 'bus') : undefined;
  const dbusSessionBusAddress =
    process.env.DBUS_SESSION_BUS_ADDRESS ??
    (dbusPath && existsSync(dbusPath) ? `unix:path=${dbusPath}` : undefined);

  return {
    display,
    waylandDisplay,
    xauthority,
    xdgRuntimeDir,
    dbusSessionBusAddress,
  };
}

export function getDesktopProcessEnv(): NodeJS.ProcessEnv {
  const desktop = detectDesktopEnv();
  const env: NodeJS.ProcessEnv = {};

  if (desktop.display) env.DISPLAY = desktop.display;
  if (desktop.waylandDisplay) env.WAYLAND_DISPLAY = desktop.waylandDisplay;
  if (desktop.xauthority) env.XAUTHORITY = desktop.xauthority;
  if (desktop.xdgRuntimeDir) env.XDG_RUNTIME_DIR = desktop.xdgRuntimeDir;
  if (desktop.dbusSessionBusAddress) env.DBUS_SESSION_BUS_ADDRESS = desktop.dbusSessionBusAddress;

  return env;
}

export function printDesktopEnvStatus(indent = '  '): void {
  const desktop = detectDesktopEnv();
  if (hasDesktopDisplay(desktop)) {
    const parts = [
      desktop.display ? `DISPLAY=${desktop.display}` : undefined,
      desktop.waylandDisplay ? `WAYLAND_DISPLAY=${desktop.waylandDisplay}` : undefined,
      desktop.xauthority ? `XAUTHORITY=${desktop.xauthority}` : undefined,
    ].filter(Boolean);
    console.log(`${indent}desktop: detected (${parts.join(', ')})`);
    console.log(`${indent}headed browser: available after applying pibo tools env`);
    return;
  }

  console.log(`${indent}desktop: not detected`);
  console.log(`${indent}warning: headed browser mode is unavailable; use headless mode or start a desktop display first.`);
}

export function printLinuxVirtualDisplayHint(indent = '  '): void {
  if (process.platform !== 'linux') return;

  console.log(`${indent}linux headed browser hint:`);
  console.log(`${indent}  Install a virtual X display if this host has no desktop session.`);
  console.log(`${indent}  Ubuntu/Debian: sudo apt update && sudo apt install -y xvfb xauth x11-xserver-utils`);
  console.log(`${indent}  Start one display: Xvfb :0 -screen 0 1920x1080x24 -ac -nolisten tcp`);
  console.log(`${indent}  Then export DISPLAY=:0 before running browser-use.`);
}
