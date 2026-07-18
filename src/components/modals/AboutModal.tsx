/* About window: app info, version placeholder and license overview.
   License texts for the bundled fonts live in src/assets/fonts/. */

import { Modal } from '../ui/Modal'
import { AppLogo } from '../ui/AppLogo'
import pkg from '../../../package.json'

interface AboutModalProps {
  onClose: () => void
}

/** Keys joined with `sep`: '+' = pressed together, '/' = either key. */
const SHORTCUTS: { keys: string[]; sep?: '+' | '/'; action: string }[] = [
  { keys: ['Space'], action: 'Play / pause the timeline' },
  { keys: ['←', '→'], sep: '/', action: 'Step one frame back / forward' },
  { keys: ['Ctrl', 'Z'], action: 'Undo' },
  { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo (also Ctrl+Y)' },
  { keys: ['+', '−'], sep: '/', action: 'Zoom the viewport in / out' },
  { keys: ['0'], action: 'Fit the image to the viewport' },
  { keys: ['1'], action: 'Zoom to 100%' },
  { keys: ['C'], action: 'Hold to show the original image' },
  { keys: ['Del'], action: 'Delete the selected keyframe' },
  { keys: ['Esc'], action: 'Close dialogs, menus and pickers' },
]

const THIRD_PARTY = [
  { name: 'react / react-dom', license: 'MIT', role: 'UI framework' },
  { name: 'fflate', license: 'MIT', role: 'ZIP creation for sequence export' },
  { name: 'lucide-react', license: 'ISC', role: 'Icon set (bundled locally)' },
  { name: 'mp4-muxer', license: 'MIT', role: 'MP4 muxing for video export' },
  { name: 'gifenc', license: 'MIT', role: 'GIF encoding for animation export' },
  { name: 'vite', license: 'MIT', role: 'Build tool (dev dependency)' },
  { name: 'typescript', license: 'Apache-2.0', role: 'Compiler (dev dependency)' },
]

export function AboutModal({ onClose }: AboutModalProps) {
  return (
    <Modal title="About" onClose={onClose} wide>
      <div className="about-head">
        <AppLogo size={44} className="about-logo" />
        <div>
          <h3 className="about-name">Sonitus — Dither Studio</h3>
          <p className="about-version">Version {pkg.version} (placeholder)</p>
        </div>
      </div>
      <p className="modal-note">
        A professional, fully offline image dithering studio for single images, image
        sequences and MP4 video frames. All processing happens locally in your browser —
        nothing is uploaded anywhere.
      </p>

      <h4 className="modal-subhead">Keyboard shortcuts</h4>
      <table className="about-table about-table--keys">
        <thead>
          <tr>
            <th>Keys</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.action}>
              <td className="about-keys">
                {s.keys.map((k, i) => (
                  <span key={k}>
                    {i > 0 && <span className="key-sep">{s.sep ?? '+'}</span>}
                    <kbd className="key">{k}</kbd>
                  </span>
                ))}
              </td>
              <td>{s.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="modal-note">
        On macOS, use Cmd instead of Ctrl. Double-click a slider value to reset it
        to its default.
      </p>

      <h4 className="modal-subhead">App license</h4>
      <p className="modal-note">
        [PLACEHOLDER — insert the final Sonitus application license text here. No license
        is claimed for the application code until this is filled in.]
      </p>

      <h4 className="modal-subhead">Third-party libraries</h4>
      <table className="about-table">
        <thead>
          <tr>
            <th>Library</th>
            <th>License</th>
            <th>Used for</th>
          </tr>
        </thead>
        <tbody>
          {THIRD_PARTY.map((d) => (
            <tr key={d.name}>
              <td>{d.name}</td>
              <td>{d.license}</td>
              <td>{d.role}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="modal-note">
        Each library is distributed together with its full license text.
      </p>

      <h4 className="modal-subhead">Icons</h4>
      <p className="modal-note">
        Lucide icons — © Lucide Contributors, ISC License. Bundled with the app;
        no icons are loaded from the internet.
      </p>

      <h4 className="modal-subhead">Fonts</h4>
      <p className="modal-note">
        DM Sans — © The DM Sans Project Authors, SIL Open Font License 1.1.<br />
        JetBrains Mono — © JetBrains, SIL Open Font License 1.1.<br />
        Both families are bundled with the app together with their OFL license
        texts; no fonts are loaded from the internet.
      </p>
    </Modal>
  )
}
