// Registry edits for `task new:module` (scripts/new-module.mjs). Every edit is a pair of pure functions
// text -> text: `add` inserts the module's line/block, `remove` deletes exactly what `add` inserted.
// Both are idempotent (add on an already-registered module and remove on an absent one return the text
// unchanged) and both throw when the anchor they need is missing, so a drifted registry fails loudly
// instead of silently skipping a platform.

const lines = (text) => text.split('\n');
const anchorError = (what) => new Error(`anchor not found: ${what}`);
const withoutLine = (text, line) => lines(text).filter((l) => l !== line).join('\n');

/** Insert `newLine` among the lines matching `lineRe`, keeping them sorted by `keyOf`. */
function sortedLine(lineRe, newLine, keyOf) {
  return {
    add(text) {
      const ls = lines(text);
      if (ls.includes(newLine)) return text;
      const idx = ls.map((l, i) => (lineRe.test(l) ? i : -1)).filter((i) => i >= 0);
      if (idx.length === 0) throw anchorError(String(lineRe));
      const key = keyOf(newLine);
      const before = idx.find((i) => keyOf(ls[i]) > key);
      ls.splice(before ?? idx[idx.length - 1] + 1, 0, newLine);
      return ls.join('\n');
    },
    remove: (text) => withoutLine(text, newLine),
  };
}

/** Insert `newLine` after the last line matching `lineRe`. */
function afterLastLine(lineRe, newLine) {
  return {
    add(text) {
      const ls = lines(text);
      if (ls.includes(newLine)) return text;
      let last = -1;
      ls.forEach((l, i) => {
        if (lineRe.test(l)) last = i;
      });
      if (last < 0) throw anchorError(String(lineRe));
      ls.splice(last + 1, 0, newLine);
      return ls.join('\n');
    },
    remove: (text) => withoutLine(text, newLine),
  };
}

/** Insert `newLine` before the first line matching `closeRe` that follows a line matching `openRe`. */
function beforeClose(openRe, closeRe, newLine) {
  const locate = (ls) => {
    const open = ls.findIndex((l) => openRe.test(l));
    if (open < 0) throw anchorError(String(openRe));
    const close = ls.findIndex((l, i) => i > open && closeRe.test(l));
    if (close < 0) throw anchorError(String(closeRe));
    return [open, close];
  };
  return {
    add(text) {
      const ls = lines(text);
      const [open, close] = locate(ls);
      if (ls.slice(open, close).includes(newLine)) return text;
      ls.splice(close, 0, newLine);
      return ls.join('\n');
    },
    remove(text) {
      const ls = lines(text);
      const [open, close] = locate(ls);
      const at = ls.findIndex((l, i) => i > open && i < close && l === newLine);
      if (at >= 0) ls.splice(at, 1);
      return ls.join('\n');
    },
  };
}

/** Edit the item list on the one line matching `lineRe` (groups: prefix, items, suffix). */
function listLine(lineRe, { sep, format, position, name }) {
  const item = format(name);
  const edit = (text, fn) => {
    const ls = lines(text);
    const i = ls.findIndex((l) => lineRe.test(l));
    if (i < 0) throw anchorError(String(lineRe));
    const m = lineRe.exec(ls[i]);
    const items = m[2].split(sep).map((s) => s.trim()).filter(Boolean);
    ls[i] = `${m[1]}${fn(items).join(sep === ',' ? ', ' : sep)}${m[3]}`;
    return ls.join('\n');
  };
  return {
    add: (text) =>
      edit(text, (items) => {
        if (items.includes(item)) return items;
        if (position === 'prepend') return [item, ...items];
        if (position === 'sorted') return [...items, item].sort();
        return [...items, item];
      }),
    remove: (text) => edit(text, (items) => items.filter((s) => s !== item)),
  };
}

/** Append a block at the end of the file (preceded by a blank line). */
function appendBlock(block) {
  return {
    add: (text) => (text.includes(block) ? text : `${text.replace(/\n*$/, '\n')}\n${block}`),
    remove: (text) => (text.includes(`\n${block}`) ? text.replace(`\n${block}`, '') : text.replace(block, '')),
  };
}

/** Builds every registry edit for module `c` ({ name, Name }). */
export function registryEdits(c) {
  const { name, Name } = c;
  const keyOf = (re) => (l) => re.exec(l)?.[1] ?? l;
  const sortedBy = (re, line) => sortedLine(re, line, keyOf(re));

  const goImport = /^\t_ "github\.com\/aedst\/server\/internal\/modules\/([a-z0-9]+)\/module"$/;
  const mgrImport = /^import \{ manifest as ([a-z0-9]+) \} from "@\/modules\/[a-z0-9]+\/manifest";$/;
  const dtsImport = /^import type ([a-z0-9]+) from "@\/modules\/[a-z0-9]+\/i18n\/en\.json";$/;
  const renderImport = /^import ([a-z0-9]+)Messages from "@\/modules\/[a-z0-9]+\/i18n\/en\.json";$/;
  const kotlinImport = /^import com\.aedst\.feature\.([a-z0-9]+)\.navigation\./;
  const featureYaml = /^ {2}([a-z0-9]+): +\{ server: /;
  const cell = (s) => `${s},`.padEnd(14);
  const featureLine = `  ${`${name}:`.padEnd(15)}{ server: ${cell(name)}web: ${cell(name)}android: ${cell(name)}apple: ${cell(Name)}desktop: ~, flagged: false, outbox: [], i18n_namespace: ${name}, routes: [/${name}] }`;
  const words = (re) => listLine(re, { sep: ' ', format: (n) => n, position: 'append', name });
  const budget = `    "${name}": {\n      "routePrefix": "/[locale]/${name}",\n      "firstLoadGzipKB": 410\n    }`;

  return [
    // --- server ---
    { platform: 'server', file: 'apps/server/cmd/server/modules.go', ...sortedBy(goImport, `\t_ "github.com/aedst/server/internal/modules/${name}/module"`) },
    {
      platform: 'server',
      file: 'apps/server/sqlc.yaml',
      ...appendBlock(`  - schema: migrations/${name}
    queries: sql/${name}
    engine: postgresql
    gen:
      go:
        package: ${name}db
        out: gen/db/${name}
        sql_package: pgx/v5
        emit_json_tags: true
        emit_interface: true
    rules:
      - delete-needs-where
      - update-needs-where
`),
    },
    { platform: 'server', file: 'apps/server/Taskfile.yml', ...words(/^(\s*MODULES: )(.*)()$/) },
    { platform: 'server', file: 'apps/server/Taskfile.yml', ...listLine(/^(\s*MODULES_REVERSE: )(.*)()$/, { sep: ' ', format: (n) => n, position: 'prepend', name }) },
    { platform: 'server', file: 'apps/server/scripts/lint-migrations.sh', ...words(/^(MODULES="\$\{MODULES:-)([^}]*)(\}")$/) },
    { platform: 'server', file: 'apps/server/deployments/helm/aedst-server/values.yaml', ...listLine(/^(\s*modules: \[)("platform".*)(\])$/, { sep: ',', format: (n) => `"${n}"`, position: 'append', name }) },
    { platform: 'server', file: 'apps/server/architecturetest/layers_test.go', ...listLine(/^(var expectedModules = \[\]string\{)(.*)(\})$/, { sep: ',', format: (n) => `"${n}"`, position: 'sorted', name }) },
    // --- parity matrix ---
    { platform: 'all', file: 'features.yaml', ...sortedBy(featureYaml, featureLine) },
    // --- web ---
    { platform: 'web', file: 'apps/web/app/src/app/config/modules/registry.ts', ...sortedBy(mgrImport, `import { manifest as ${name} } from "@/modules/${name}/manifest";`) },
    { platform: 'web', file: 'apps/web/app/src/app/config/modules/registry.ts', ...beforeClose(/^export const manifests: /, /^\];$/, `  ${name},`) },
    { platform: 'web', file: 'apps/web/app/src/app/config/i18n/messages.d.ts', ...sortedBy(dtsImport, `import type ${name} from "@/modules/${name}/i18n/en.json";`) },
    { platform: 'web', file: 'apps/web/app/src/app/config/i18n/messages.d.ts', ...beforeClose(/^type Messages = \{/, /^\};$/, `  ${name}: typeof ${name};`) },
    { platform: 'web', file: 'apps/web/app/src/test/render.tsx', ...sortedBy(renderImport, `import ${name}Messages from "@/modules/${name}/i18n/en.json";`) },
    { platform: 'web', file: 'apps/web/app/src/test/render.tsx', ...beforeClose(/^export const messages = \{/, /^\};$/, `  ${name}: ${name}Messages,`) },
    {
      platform: 'web',
      file: 'apps/web/app/bundle-budget.json',
      add(text) {
        if (text.includes(`"${name}": {`)) return text;
        const re = /(\n {4}\})(\n {2}\},\n {2}"shell": \{)/;
        if (!re.test(text)) throw anchorError('bundle-budget.json modules/shell boundary');
        return text.replace(re, `$1,\n${budget}$2`);
      },
      remove: (text) => text.replace(`,\n${budget}`, ''),
    },
    // --- android ---
    { platform: 'android', file: 'apps/android/settings.gradle.kts', ...afterLastLine(/^include\(":feature:/, `include(":feature:${name}")`) },
    { platform: 'android', file: 'apps/android/app/build.gradle.kts', ...afterLastLine(/^ {4}implementation\(project\(":feature:/, `    implementation(project(":feature:${name}"))`) },
    { platform: 'android', file: 'apps/android/app/src/main/kotlin/com/aedst/android/navigation/AppNavHost.kt', ...sortedBy(kotlinImport, `import com.aedst.feature.${name}.navigation.${Name}NavGraph`) },
    { platform: 'android', file: 'apps/android/app/src/main/kotlin/com/aedst/android/navigation/AppNavHost.kt', ...beforeClose(/^private val featureGraphs: /, /^\)$/, `    ${Name}NavGraph(),`) },
    {
      platform: 'android',
      file: 'apps/android/core/navigation/src/main/kotlin/com/aedst/core/navigation/AedstKey.kt',
      ...appendBlock(`@Serializable\ndata object ${Name}Key : AedstKey {\n    override val screenName: String get() = "${name}"\n}\n`),
    },
    // --- apple ---
    { platform: 'apple', file: 'apps/apple/App/Shared/Package.swift', ...afterLastLine(/^ {8}\.package\(path: "\.\.\/\.\.\/Features\//, `        .package(path: "../../Features/${Name}"),`) },
    { platform: 'apple', file: 'apps/apple/App/Shared/Package.swift', ...beforeClose(/^ {8}\.target\($/, /^ {12}\],$/, `                "${Name}",`) },
  ];
}
