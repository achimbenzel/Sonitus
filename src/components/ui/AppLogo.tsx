/* ============================================================
   Themeable app logo.

   The Sonitus logo (src/assets/sonitus.svg, a black source SVG)
   is used as a CSS mask, so it is recolored purely via CSS: each
   theme sets `--logo-color` (falls back to the ink color).
   Nothing in the SVG file itself is modified.
   ============================================================ */

import logoUrl from '../../assets/sonitus.svg'

interface AppLogoProps {
  size?: number
  className?: string
}

export function AppLogo({ size = 22, className = '' }: AppLogoProps) {
  // The url MUST be quoted: in production Vite inlines the SVG as a
  // URL-encoded data: URL that contains single quotes, which break an
  // unquoted css url() — the mask silently fails and the logo renders
  // as a plain square.
  const mask = `url("${logoUrl}")`
  return (
    <span
      aria-hidden
      className={`app-logo ${className}`.trim()}
      style={{
        width: size,
        height: size,
        WebkitMaskImage: mask,
        maskImage: mask,
      }}
    />
  )
}
