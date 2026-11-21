/**
 * System light/dark only (no toggle): adds the `.dark` class the design
 * tokens use, before first paint, and follows a change of the system setting.
 * An inline script of ~200 bytes instead of a theme provider island: the page
 * has no theme state, so no React code is needed (the CSP already allows the
 * inline scripts Next emits on static pages, see next.config.ts).
 */
const THEME_SCRIPT =
  '(()=>{const m=matchMedia("(prefers-color-scheme: dark)"),a=()=>document.documentElement.classList.toggle("dark",m.matches);a();m.addEventListener("change",a)})()';

export function ThemeScript() {
  return (
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant string, no user input
      dangerouslySetInnerHTML={{
        // biome-ignore lint/style/useNamingConvention: key mandated by React
        __html: THEME_SCRIPT,
      }}
    />
  );
}
