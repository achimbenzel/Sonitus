/* ============================================================
   Themeable app logo.

   The SVG (src/assets/sonitos-logo-placeholder.svg — replace the
   file with the final Sonitos logo, same filename) is used as a
   CSS mask, so a black/any-color source SVG is recolored purely
   via CSS: each theme sets `--logo-color` (falls back to the ink
   color). Nothing in the SVG file itself is modified.
   ============================================================ */

import logoUrl from '../../assets/sonitos-logo-placeholder.svg'

interface AppLogoProps {
  size?: number
  className?: string
}

export function AppLogo({ size = 22, className = '' }: AppLogoProps) {
  const mask = `url(${logoUrl})`
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
