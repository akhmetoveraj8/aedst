/**
 * Renders a schema.org JSON-LD block. `<` is escaped so a string value can
 * never close the script tag early (the XSS vector Next's own JSON-LD guide
 * calls out).
 */

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: serialized JSON with `<` escaped
      dangerouslySetInnerHTML={{
        // biome-ignore lint/style/useNamingConvention: key mandated by React
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
