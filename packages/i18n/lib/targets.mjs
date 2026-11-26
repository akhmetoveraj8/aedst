// Which platforms use which key: <module>/targets.json maps a key to a platform list; a key that is absent
// (or a module without the file) is used by every platform, which is the end state of the migration.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { root } from './load.mjs';

export const PLATFORMS = ['web', 'android', 'apple', 'desktop'];
/** shared module -> the Android module directory that owns its strings and the resource-name prefix (default: the module name). */
export const ANDROID_HOMES = {
  auth: { home: 'feature/auth' },
  admin: { home: 'feature/admin' },
  media: { home: 'feature/media' },
  notifications: { home: 'feature/notifications' },
  search: { home: 'feature/search' },
  tasks: { home: 'feature/tasks' },
  app: { home: 'app', prefix: '' },
  ui: { home: 'core/ui', prefix: 'aedst' },
  mediacore: { home: 'core/media', prefix: 'media' },
};
export const androidPrefix = (mod) => ANDROID_HOMES[mod]?.prefix ?? mod;

/** shared module -> the String Catalog (relative to apps/apple) that owns its strings and the key prefix (default: the module name). */
export const APPLE_HOMES = {
  auth: { file: 'Features/Auth/Sources/AuthPresentation/Resources/Localizable.xcstrings' },
  admin: { file: 'Features/Admin/Sources/AdminPresentation/Resources/Localizable.xcstrings' },
  media: { file: 'Features/Media/Sources/MediaPresentation/Resources/Localizable.xcstrings' },
  notifications: { file: 'Features/Notifications/Sources/NotificationsPresentation/Resources/Localizable.xcstrings' },
  search: { file: 'Features/Search/Sources/SearchPresentation/Resources/Localizable.xcstrings' },
  tasks: { file: 'Features/Tasks/Sources/TasksPresentation/Resources/Localizable.xcstrings' },
  app: { file: 'App/Shared/Sources/AedstAppCore/Resources/Localizable.xcstrings' },
  ui: { file: 'Core/AedstDesignSystem/Sources/AedstDesignSystem/Resources/Localizable.xcstrings', prefix: 'ds' },
  error: { file: 'Core/AedstCore/Sources/AedstCore/Resources/Localizable.xcstrings' },
};
export const applePrefix = (mod) => APPLE_HOMES[mod]?.prefix ?? mod;

/** Desktop crate -> shared module. `desktop` is the app-shell module that only Desktop uses. */
export const DESKTOP_HOMES = {
  'aedst-desktop': 'desktop',
  'aedst-feature-admin': 'admin',
  'aedst-feature-media': 'media',
  'aedst-feature-notifications': 'notifications',
  'aedst-feature-search': 'search',
  'aedst-feature-tasks': 'tasks',
};

export function readTargets(mod) {
  const file = path.join(root, mod, 'targets.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

export const platformsOf = (targets, key) => targets[key] ?? PLATFORMS;

/** Keep only the leaves whose key satisfies `keep` (nested JSON in, nested JSON out). */
export function pickNested(obj, keep, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') {
      const sub = pickNested(v, keep, key);
      if (Object.keys(sub).length) out[k] = sub;
    } else if (keep(key)) out[k] = v;
  }
  return out;
}

/** Validation errors for one module's targets.json. */
export function targetErrors(mod, targets, keys) {
  const errs = [];
  for (const [k, ps] of Object.entries(targets)) {
    if (!keys.has(k)) errs.push(`${mod}/targets.json: unknown key ${k}`);
    if (!Array.isArray(ps) || !ps.length || ps.some((p) => !PLATFORMS.includes(p))) errs.push(`${mod}/targets.json ${k}: platforms must be a non-empty list of ${PLATFORMS}`);
  }
  return errs;
}
