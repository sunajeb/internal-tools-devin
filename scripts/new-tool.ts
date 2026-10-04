import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const id = process.argv[2] ?? '';
if (!/^[a-z][a-z0-9-]{1,40}$/.test(id)) {
  throw new Error(
    'Use a lowercase tool ID, for example: npm run new-tool -- case-review',
  );
}

const root = resolve(process.env.NEW_TOOL_ROOT ?? process.cwd());
const toolRoot = resolve(root, 'tools', id);
if (
  await stat(toolRoot).then(
    () => true,
    () => false,
  )
) {
  throw new Error(`tools/${id} already exists`);
}

const symbol = id.replace(/-([a-z0-9])/g, (_, letter: string) =>
  letter.toUpperCase(),
);
const schema = id.replaceAll('-', '_');
const name = id
  .replaceAll('-', ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase());
const component = name.replaceAll(' ', '');
const role = `${schema}_operator`;
const readPermission = `${id}.read`;
const writePermission = `${id}.write`;

async function write(path: string, content: string) {
  const target = resolve(toolRoot, path);
  await mkdir(resolve(target, '..'), { recursive: true });
  await writeFile(target, content);
}

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

await write(
  'package.json',
  json({
    name: `@internal-tools/${id}`,
    version: '0.1.0',
    private: true,
    type: 'module',
    main: './src/index.ts',
    types: './src/index.ts',
    exports: { '.': './src/index.ts', './web': './src/web.tsx' },
    dependencies: {
      '@internal-tools/foundation': '*',
      '@internal-tools/ui-kit': '*',
      '@tanstack/react-query': '^5.66.9',
      'lucide-react': '^0.468.0',
      react: '^18.3.1',
      'react-router-dom': '^7.18.4',
      zod: '^3.24.2',
    },
  }),
);
await write(
  'tsconfig.json',
  json({
    extends: '../../tsconfig.base.json',
    compilerOptions: {
      rootDir: 'src',
      outDir: 'dist',
      jsx: 'react-jsx',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    },
    references: [
      { path: '../../packages/foundation' },
      { path: '../../packages/ui-kit' },
    ],
    include: ['src/**/*.ts', 'src/**/*.tsx'],
  }),
);
await write(
  'src/registry.ts',
  `import { defineTool } from '@internal-tools/foundation';

export const ${symbol}Tool = defineTool({
  id: '${id}',
  name: '${name}',
  owner: 'tool-owner@company.example',
  dataClass: 'internal',
  roles: {
    ${role}: { idpGroup: '${id}-operator' },
    auditor: { idpGroup: 'auditor' },
  },
  permissions: {
    '${readPermission}': ['${role}', 'auditor'],
    '${writePermission}': ['${role}'],
  },
});
`,
);
await write(
  'src/api.ts',
  `import { defineRoute, type ToolRegistration } from '@internal-tools/foundation';
import { z } from 'zod';
import { ${symbol}Tool } from './registry.js';

const RecordInput = z.object({ title: z.string().trim().min(3).max(200) });

export const ${symbol}Routes = [
  defineRoute({
    method: 'GET',
    path: '/api/tools/${id}/records',
    permission: '${readPermission}',
    handler: async ({ tx }) => {
      const result = await tx.query(
        'SELECT id,title,created_by,created_at FROM ${schema}.records ORDER BY created_at DESC LIMIT 50',
      );
      return { items: result.rows };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/tools/${id}/records',
    permission: '${writePermission}',
    body: RecordInput,
    idempotent: true,
    handler: async ({ tx, body, user, audit }) => {
      const result = await tx.query(
        'INSERT INTO ${schema}.records(title,created_by) VALUES($1,$2) RETURNING id,title,created_by,created_at',
        [body.title, user.id],
      );
      const record = result.rows[0];
      await audit({
        action: '${id}.record_created',
        objectType: 'record',
        objectId: String(record.id),
        after: { title: body.title },
      });
      return { statusCode: 201, body: record };
    },
  }),
];

export const ${symbol}Registration: ToolRegistration = {
  tool: ${symbol}Tool,
  routes: ${symbol}Routes,
};
`,
);
await write(
  'src/index.ts',
  `export { ${symbol}Tool, ${symbol}Tool as tool } from './registry.js';
export {
  ${symbol}Registration,
  ${symbol}Registration as registration,
  ${symbol}Routes,
} from './api.js';
`,
);
await write(
  'src/web.tsx',
  `import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { api, dateTime } from '@internal-tools/ui-kit';

type User = { id: string; displayName: string; roles: string[] };
type ToolRecord = { id: string; title: string; created_by: string; created_at: string };

export const ${symbol}Navigation = [
  {
    to: '/tools/${id}',
    label: '${name}',
    icon: ClipboardList,
    roles: ['${role}', 'auditor'],
  },
];

function ${component}Page({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const records = useQuery({
    queryKey: ['${id}', 'records'],
    queryFn: () => api<{ items: ToolRecord[] }>('/api/tools/${id}/records'),
  });
  const create = useMutation({
    mutationFn: () =>
      api('/api/tools/${id}/records', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ title }),
      }),
    onSuccess: () => {
      setTitle('');
      return queryClient.invalidateQueries({ queryKey: ['${id}'] });
    },
  });
  const canWrite = user.roles.includes('${role}');
  return (
    <section className="page">
      <p className="eyebrow">INTERNAL TOOL</p>
      <h1>${name}</h1>
      {canWrite && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label>
            Record title
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <button className="primary-btn" type="submit" disabled={create.isPending}>
            Add record
          </button>
          {create.error && <p role="alert">{create.error.message}</p>}
        </form>
      )}
      <ul aria-label="${name} records">
        {(records.data?.items ?? []).map((record) => (
          <li key={record.id}>
            {record.title} · {record.created_by} · {dateTime(record.created_at)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ${component}Pages({ user }: { user: User }) {
  return (
    <Routes>
      <Route path="/" element={<${component}Page user={user} />} />
    </Routes>
  );
}

export const tool = {
  id: '${id}',
  name: '${name}',
  description: 'Generated internal tool',
  routePath: '/tools/${id}/*',
  icon: ClipboardList,
  navigation: ${symbol}Navigation,
  Pages: ${component}Pages,
};
`,
);
await write(
  'migrations/001_init.sql',
  `CREATE SCHEMA IF NOT EXISTS ${schema};

CREATE TABLE IF NOT EXISTS ${schema}.records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`,
);
await write(
  'src/registry.test.ts',
  `import { describe, expect, it } from 'vitest';
import { ${symbol}Tool } from './registry.js';
import { ${symbol}Routes } from './api.js';

describe('${name} registry', () => {
  it('declares every route permission in the tool matrix', () => {
    for (const route of ${symbol}Routes) {
      expect(Object.keys(${symbol}Tool.permissions)).toContain(route.permission);
    }
  });

  it('does not let an auditor write records', () => {
    expect(${symbol}Tool.permissions['${writePermission}']).not.toContain('auditor');
  });
});
`,
);
await write(
  'runbooks/README.md',
  `# ${name} runbook

1. Check the API health at \`/health/ready\`.
2. Check denied requests in the audit log for the \`${id}\` tool.
3. Write the alert, the inspection query and the safe recovery steps here.
`,
);

async function insertMarker(file: string, marker: string, value: string) {
  const path = resolve(root, file);
  const source = await readFile(path, 'utf8');
  if (!source.includes(marker))
    throw new Error(`Integration marker ${marker} is missing from ${file}`);
  await writeFile(path, source.replace(marker, `${value}\n  ${marker}`));
}

async function addReference(file: string, reference: string) {
  const path = resolve(root, file);
  const config = JSON.parse(await readFile(path, 'utf8')) as {
    references: Array<{ path: string }>;
  };
  if (!config.references.some((entry) => entry.path === reference)) {
    config.references.push({ path: reference });
    await writeFile(path, json(config));
  }
}

await insertMarker(
  'apps/api/src/tool-registry.ts',
  '// <DEVIN-API-TOOL-REGISTRY>',
  `import('@internal-tools/${id}'),`,
);
await insertMarker(
  'apps/web/src/tool-registry.ts',
  '// <DEVIN-WEB-TOOL-REGISTRY>',
  `import('@internal-tools/${id}/web'),`,
);
await addReference('tsconfig.json', `./tools/${id}`);
await addReference('apps/api/tsconfig.json', `../../tools/${id}`);
await addReference('apps/web/tsconfig.json', `../../tools/${id}`);

console.log(
  `Created tools/${id}. Run npm install, then add the ${id}-operator group to infra/keycloak.`,
);
