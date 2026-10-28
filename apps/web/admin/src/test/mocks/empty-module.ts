// Aliased in place of `server-only` under Vitest: that package throws when
// imported outside a React Server Components build, which is exactly what a
// unit test is. The real guard still runs in `next build`.
export {};
