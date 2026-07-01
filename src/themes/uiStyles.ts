/* ============================================================
   UI style (theme) system.

   A style is applied by setting `data-theme` on <html>; every
   theme's rules live in src/styles/themes.css as
   `[data-theme='<id>'] …` overrides of the base design tokens.
   Adding a theme = one entry here + one CSS block there.

   The "custom" style additionally injects user CSS from
   localStorage into a dedicated <style> element.
   ============================================================ */

export interface UiStyleDef {
  id: string
  label: string
  description: string
}

export const UI_STYLES: UiStyleDef[] = [
  {
    id: 'default',
    label: 'Aqua Glass',
    description: 'The default dark Frutiger-Aero look.',
  },
  {
    id: 'light',
    label: 'Aqua Light',
    description: 'Same design language on light surfaces.',
  },
  {
    id: 'clean',
    label: 'Clean',
    description: 'Minimal neutral UI, shadcn-inspired.',
  },
  {
    id: 'xp',
    label: 'Retro XP',
    description: 'Windows XP inspired silver & blue.',
  },
  {
    id: 'custom',
    label: 'Custom CSS',
    description: 'Default style plus your own CSS overrides.',
  },
]

const STYLE_KEY = 'sonitus.uiStyle'
const CUSTOM_CSS_KEY = 'sonitus.customCss'
const CUSTOM_STYLE_EL_ID = 'sonitus-custom-css'

export function loadUiStyle(): string {
  const stored = localStorage.getItem(STYLE_KEY)
  return stored && UI_STYLES.some((s) => s.id === stored) ? stored : 'default'
}

export function loadCustomCss(): string {
  return localStorage.getItem(CUSTOM_CSS_KEY) ?? ''
}

export function saveCustomCss(css: string): void {
  localStorage.setItem(CUSTOM_CSS_KEY, css)
}

function customStyleEl(): HTMLStyleElement {
  let el = document.getElementById(CUSTOM_STYLE_EL_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = CUSTOM_STYLE_EL_ID
    document.head.appendChild(el)
  }
  return el
}

/** Applies a UI style (and, for "custom", the stored user CSS). */
export function applyUiStyle(id: string, customCss?: string): void {
  const valid = UI_STYLES.some((s) => s.id === id) ? id : 'default'
  document.documentElement.dataset.theme = valid
  localStorage.setItem(STYLE_KEY, valid)
  customStyleEl().textContent = valid === 'custom' ? (customCss ?? loadCustomCss()) : ''
}
