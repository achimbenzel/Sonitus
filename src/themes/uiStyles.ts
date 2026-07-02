/* ============================================================
   UI style (theme) system.

   A style is applied by setting `data-theme` on <html>; every
   theme's rules live in src/styles/themes.css as
   `[data-theme='<id>'] …` overrides of the base design tokens.
   Adding a theme = one entry here + one CSS block there.

   The "custom" style additionally injects user CSS from
   localStorage into a dedicated <style> element.
   ============================================================ */

export type UiStyleId = 'default' | 'light' | 'clean' | 'xp' | 'signal' | 'custom'

export interface UiStyleDef {
  id: UiStyleId
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
    description: 'Minimal neutral UI with flat surfaces.',
  },
  {
    id: 'xp',
    label: 'Experience',
    description: 'Early-2000s desktop silver & blue.',
  },
  {
    id: 'signal',
    label: 'Signal Core',
    description: 'Console dashboard: dark panels, lime glow.',
  },
  {
    id: 'custom',
    label: 'Custom CSS',
    description: 'Default style plus your own CSS file.',
  },
]

const STYLE_KEY = 'sonitus.uiStyle'
const CUSTOM_CSS_KEY = 'sonitus.customCss'
const CUSTOM_STYLE_EL_ID = 'sonitus-custom-css'

export function loadUiStyle(): UiStyleId {
  const stored = localStorage.getItem(STYLE_KEY)
  return stored && UI_STYLES.some((s) => s.id === stored) ? (stored as UiStyleId) : 'default'
}

/** The cached custom CSS text (loaded from a user file), if any. */
export function loadCustomCss(): string {
  return localStorage.getItem(CUSTOM_CSS_KEY) ?? ''
}

/** Cache custom CSS locally so it persists between sessions (offline). */
export function saveCustomCss(css: string): void {
  localStorage.setItem(CUSTOM_CSS_KEY, css)
}

export function clearCustomCss(): void {
  localStorage.removeItem(CUSTOM_CSS_KEY)
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
